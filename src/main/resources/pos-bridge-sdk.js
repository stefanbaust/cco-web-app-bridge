/**
 * POS Bridge SDK
 *
 * Client library for iframe apps to communicate with the POS system.
 * Include this script in your iframe app and use the POSBridge class.
 *
 * Usage:
 *   const pos = new POSBridge();
 *   await pos.ready();
 *   const receipt = await pos.getReceipt();
 *
 *   pos.on('receiptChanged', (receipt) => { ... });
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
  }

  // -------------------------------------------------------
  // POS Methods
  // -------------------------------------------------------

  /**
   * Get the current receipt.
   * @returns {Promise<Object>} The receipt model
   */
  getReceipt() {
    return this._rpc('getReceipt');
  }

  /**
   * Get the current receipt.
   * @returns {Promise<Object>} The receipt model
   */
  isItemSelected(salesItemKey) {
    return this._rpc('isItemSelected', salesItemKey);
  }

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
