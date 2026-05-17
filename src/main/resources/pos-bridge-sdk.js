/**
 * POS Bridge SDK
 *
 * Client library for iframe apps to communicate with the POS system.
 * Include this script in your iframe app and use the POSBridge class.
 *
 * Usage:
 *   const pos = new POSBridge();
 *   await pos.ready();
 *
 *   const receipt = pos.store('ReceiptStore');
 *   const model = await receipt.getReceiptModel();
 *   receipt.subscribe((data) => console.log('changed', data.payload));
 */
class POSBridge {
  constructor(options = {}) {
    this._targetOrigin = options.targetOrigin || '*';
    this._channel = options.channel || null;
    this._timeout = options.timeout || 10000;
    this._pendingRequests = new Map();
    this._eventListeners = new Map();
    this._bridgeReady = false;
    this._readyPromise = null;
    this._readyResolve = null;
    this._storeProxies = {};
    this._eventHandlerCallbacks = new Map();

    this._readyPromise = new Promise((resolve) => {
      this._readyResolve = resolve;
    });

    this._boundMessageHandler = this._handleMessage.bind(this);
    window.addEventListener('message', this._boundMessageHandler);

    // Notify parent we're ready
    window.addEventListener('load', () => {
      this._send({ type: 'IFRAME_READY' });
    });

    // If already loaded (script added late)
    if (document.readyState === 'complete') {
      this._send({ type: 'IFRAME_READY' });
    }
  }

  /**
   * Returns a promise that resolves when the bridge handshake is complete.
   */
  ready() {
    return this._readyPromise;
  }

  /**
   * Destroy the bridge instance and clean up listeners.
   */
  destroy() {
    window.removeEventListener('message', this._boundMessageHandler);
    // Reject all pending requests
    for (const [id, pending] of this._pendingRequests) {
      pending.reject(new Error('Bridge destroyed'));
    }
    this._pendingRequests.clear();
    this._eventListeners.clear();
    this._eventHandlerCallbacks.clear();
    this._storeProxies = {};
  }

  // -------------------------------------------------------
  // POS Methods
  // -------------------------------------------------------

  /**
   * Get the POS user locale (e.g. 'de', 'en', 'fr').
   * @returns {Promise<string>} The locale code
   */
  getLocale() {
    return this._rpc('getLocale');
  }

  /**
   * Push an event to the POS event bus.
   * @param {string} eventType - The event type to push
   * @param {*} eventData - The event data
   */
  pushEvent(eventType, eventData) {
    this._send({
      type: 'PUSH_EVENT',
      payload: { eventType, eventData },
    });
  }

  /**
   * Register a handler for a POS event bus event.
   * The callback is invoked whenever the event fires on the CCO event bus.
   *
   * @param {string} eventType - The event bus event type (e.g. 'SALESITEM_ADD')
   * @param {Function} callback - Called with the event payload
   * @param {Object} [options]
   * @param {boolean} [options.consume=false] - If true, the event is consumed
   *   (stops propagation to other plugins)
   * @returns {Promise} Resolves when the handler is registered on the bridge
   */
  handleEvent(eventType, callback, options) {
    this._eventHandlerCallbacks.set(eventType, callback);
    this.on('bus:' + eventType, callback);
    return this._rpc('__event_handle__', {
      eventType,
      consume: options?.consume ?? false,
    });
  }

  /**
   * Remove a previously registered event bus handler.
   * @param {string} eventType - The event type to stop handling
   * @returns {Promise} Resolves when the handler is removed on the bridge
   */
  removeEventHandler(eventType) {
    const callback = this._eventHandlerCallbacks.get(eventType);
    if (callback) {
      this.off('bus:' + eventType, callback);
      this._eventHandlerCallbacks.delete(eventType);
    }
    return this._rpc('__event_unhandle__', { eventType });
  }

  /**
   * Get a proxy for a CCO store. Any method call on the returned object
   * becomes an RPC to the POS bridge.
   *
   * @param {string} storeName - The CCO store name (e.g. 'ReceiptStore')
   * @returns {Proxy} A proxy where method calls become RPCs
   *
   * @example
   *   const receipt = pos.store('ReceiptStore');
   *   const model = await receipt.getReceiptModel();
   *   receipt.subscribe((payload) => console.log('changed', payload));
   *   receipt.unsubscribe();
   */
  store(storeName) {
    if (this._storeProxies[storeName]) {
      return this._storeProxies[storeName];
    }

    const bridge = this;
    let subscribeCallback = null;

    const proxy = new Proxy({}, {
      get(_target, prop) {
        // Prevent the proxy from being treated as a thenable or breaking serialization
        if (prop === 'then' || prop === 'toJSON' || prop === 'valueOf' || typeof prop === 'symbol') {
          return undefined;
        }

        if (prop === 'subscribe') {
          return function (callback) {
            subscribeCallback = callback;
            bridge.on('store:' + storeName, callback);
            return bridge._rpc('__store_subscribe__', { store: storeName });
          };
        }

        if (prop === 'unsubscribe') {
          return function () {
            if (subscribeCallback) {
              bridge.off('store:' + storeName, subscribeCallback);
              subscribeCallback = null;
            }
            return bridge._rpc('__store_unsubscribe__', { store: storeName });
          };
        }

        // Any other property access returns a function that issues an RPC
        return function (...args) {
          return bridge._rpc('__store__', { store: storeName, method: prop, args });
        };
      }
    });

    this._storeProxies[storeName] = proxy;
    return proxy;
  }

  // -------------------------------------------------------
  // Event Subscription
  // -------------------------------------------------------

  /**
   * Subscribe to a POS event.
   * @param {string} event - Event name (e.g. 'receiptChanged')
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event).add(callback);
  }

  /**
   * Unsubscribe from a POS event.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const listeners = this._eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this._eventListeners.delete(event);
      }
    }
  }

  // -------------------------------------------------------
  // Internal
  // -------------------------------------------------------

  _generateId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  }

  _send(message) {
    if (this._channel) {
      message.channel = this._channel;
    }
    window.parent.postMessage(message, this._targetOrigin);
  }

  _rpc(method, args = {}) {
    if (!this._bridgeReady) {
      return this._readyPromise.then(() => this._rpc(method, args));
    }

    return new Promise((resolve, reject) => {
      const id = this._generateId();

      const timer = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method} (${id})`));
      }, this._timeout);

      this._pendingRequests.set(id, { resolve, reject, timer });

      this._send({
        type: 'RPC_REQUEST',
        id,
        method,
        args,
      });
    });
  }

  _handleMessage(event) {
    const data = event.data;
    if (!data || !data.type) return;

    if (this._channel && data.channel !== this._channel) return;

    switch (data.type) {
      case 'BRIDGE_READY':
        if (!this._channel && data.channel) {
          this._channel = data.channel;
        }
        this._bridgeReady = true;
        if (this._readyResolve) {
          this._readyResolve();
          this._readyResolve = null;
        }
        break;

      case 'RPC_RESPONSE': {
        const pending = this._pendingRequests.get(data.id);
        if (pending) {
          clearTimeout(pending.timer);
          this._pendingRequests.delete(data.id);
          if (data.error) {
            pending.reject(new Error(data.error));
          } else {
            pending.resolve(data.result);
          }
        }
        break;
      }

      case 'KEYBOARD_INPUT': {
        const el = document.activeElement;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          if (data.keyCode === 8) {
            document.execCommand('delete', false);
          } else {
            document.execCommand('insertText', false, String.fromCharCode(data.keyCode));
          }
        }
        break;
      }

      case 'POS_EVENT': {
        const listeners = this._eventListeners.get(data.event);
        if (listeners) {
          for (const cb of listeners) {
            try {
              cb(data.data);
            } catch (e) {
              console.error(`[POSBridge] Error in "${data.event}" listener:`, e);
            }
          }
        }
        break;
      }
    }
  }
}
