Plugin.__PREFIX__BridgePlugin = class __PREFIX__BridgePlugin {

    pluginEventSourceIdentifier = '__PREFIX__BridgePlugin';
    channel = '__PREFIX__';

    constructor(pluginService, eventBus) {
        this.T = pluginService.getContextInstance('T');

        console.info('__PREFIX__BridgePlugin loaded');
        this.pluginService = pluginService;
        this.eventBus = eventBus;
        this.iframeWindow = null;
        this.iframeIdEmbedded = '__PREFIX___iframe_embedded';
        this.iframeIdPopup = '__PREFIX___iframe_popup';
        this.allowedOrigin = null;

        this._rpcHandlers = {};
        this._storeObservers = {};
        this._eventHandlers = {};
        this._registerRpcHandlers();

        this.init();
        window.__PREFIX__BridgeRef = this;
    }

    async init() {
        this.eventBus.subscribe(this);
        this._boundMessageHandler = this._handlePostMessage.bind(this);
        window.addEventListener('message', this._boundMessageHandler);

        this.pluginConfig = await this.fetchPluginConfig();
        this.setupCustomerComponent();
    }

    setupCustomerComponent() {
        const propStore = this.pluginService.getContextInstance('DynamicPropertiesStore');

        const basePath = window.location.pathname.replace(/_\/$/, '/');
        let url = `${window.location.origin}${basePath}PluginServlet?action=__PREFIX__Servlet#/embedded`;

        if (this.pluginConfig?.DEVMODE === true && !this.pluginConfig?.REMOTE) {
            // TODO make this configurable
            url = 'http://localhost:4200#/embedded'
        }

        try {
            this.allowedOrigin = new URL(url).origin;
        } catch (e) {
            console.error('Invalid iframe URL:', url);
            return;
        }

        const iframeId = this.iframeIdEmbedded;

        const customerComponent = {
            component: 'GridLayoutComponent',
            props: {
                rows: 9,
                cols: 9,
                elements: [
                    {
                        index: [0, 0],
                        hspan: 9,
                        vspan: 9,
                        content: {
                            component: 'HtmlComponent',
                            props: {
                                content: `
                                    <iframe
                                        id="${iframeId}"
                                        src="${url}"
                                        style="width:100%; height:100%; border:none;"
                                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                                    ></iframe>
                                    `
                            }
                        }
                    }
                ]
            }
        };


        const props = propStore.getDynamicProperties('__PREFIX___WEBVIEW_EMBEDDED');
        if (props != null) {
            props.setAndEmitPropertiesIfChanged({
                content: customerComponent
            });
        } else {
            propStore.addDynamicProperties('__PREFIX___WEBVIEW_EMBEDDED', {
                content: customerComponent
            });
        }

        setTimeout(() => {
            const iframe = document.getElementById(iframeId);
            console.log('got Iframe:', iframe);
        }, 0);
    }

    async fetchPluginConfig() {
        const basePath = window.location.pathname.replace(/_\/$/, '/');
        const url = `${window.location.origin}${basePath}PluginServlet?action=__PREFIX__Config`;
        const response = await fetch(url);
        const config = await response.json();
        console.info('Plugin config loaded', config);
        return config;
    }

    destroy() {
        for (const storeName of Object.keys(this._storeObservers)) {
            try {
                this._unsubscribeStore(storeName);
            } catch (e) {
                console.warn('[__PREFIX__Bridge] Error unsubscribing store on destroy:', storeName, e);
            }
        }
        this._eventHandlers = {};
        window.removeEventListener('message', this._boundMessageHandler);
    }

    // -------------------------------------------------------
    // Dynamic Store Access
    // -------------------------------------------------------

    _invokeStoreMethod(storeName, methodName, args) {
        const store = this.pluginService.getContextInstance(storeName);
        if (!store) {
            throw new Error(`Store not found: ${storeName}`);
        }
        if (typeof store[methodName] !== 'function') {
            throw new Error(`Method not found: ${storeName}.${methodName}`);
        }
        return store[methodName](...(Array.isArray(args) ? args : []));
    }

    _subscribeStore(storeName) {
        if (this._storeObservers[storeName]) {
            return { subscribed: true, alreadyActive: true };
        }
        const store = this.pluginService.getContextInstance(storeName);
        if (!store) {
            throw new Error(`Store not found: ${storeName}`);
        }
        if (typeof store.addObserver !== 'function') {
            throw new Error(`Store does not support observers: ${storeName}`);
        }
        const observer = {
            observe: (_store, payload) => {
                this.sendEvent('store:' + storeName, { store: storeName, payload });
            }
        };
        store.addObserver(observer);
        this._storeObservers[storeName] = { observer, store };
        return { subscribed: true };
    }

    _unsubscribeStore(storeName) {
        const entry = this._storeObservers[storeName];
        if (!entry) {
            return { unsubscribed: false, reason: 'No active subscription' };
        }
        if (typeof entry.store.removeObserver === 'function') {
            entry.store.removeObserver(entry.observer);
        }
        delete this._storeObservers[storeName];
        return { unsubscribed: true };
    }

    // -------------------------------------------------------
    // RPC Handler Registration
    // -------------------------------------------------------

    _registerRpcHandlers() {
        this._rpcHandlers['getLocale'] = () => {
            try {
                const userStore = this.pluginService.getContextInstance('UserStore');
                const langCode = userStore.getUser()?.getLanguageCode();
                if (langCode) return langCode;
            } catch (e) {
                console.warn('[__PREFIX__Bridge] Could not get user language:', e);
            }
            try {
                const translationStore = this.pluginService.getContextInstance('TranslationStore');
                return translationStore.getDefaultLanguage();
            } catch (e) {
                console.warn('[__PREFIX__Bridge] Could not get default language:', e);
            }
            return 'de';
        };

        this._rpcHandlers['__store__'] = (params) => {
            return this._invokeStoreMethod(params.store, params.method, params.args);
        };

        this._rpcHandlers['__store_subscribe__'] = (params) => {
            return this._subscribeStore(params.store);
        };

        this._rpcHandlers['__store_unsubscribe__'] = (params) => {
            return this._unsubscribeStore(params.store);
        };

        this._rpcHandlers['__event_handle__'] = (params) => {
            this._eventHandlers[params.eventType] = { consume: !!params.consume };
            return { registered: true };
        };

        this._rpcHandlers['__event_unhandle__'] = (params) => {
            delete this._eventHandlers[params.eventType];
            return { unregistered: true };
        };
    }

    // -------------------------------------------------------
    // Event Handling
    // -------------------------------------------------------

    handleEvent(event) {
        if (event.getType() === 'WORKCENTER_LOADED' && event.getSource() !== this.pluginEventSourceIdentifier) {
            if (!this.pluginConfig) {
                this.fetchPluginConfig().then((config) => {
                    this.pluginConfig = config;
                });
            }
        }
        switch (event.getType()) {
            case '__PREFIX___SHOW_WEBVIEW':
                this.showIframePopup();
                break;
        }

        const eventType = event.getType();
        const handler = this._eventHandlers[eventType];
        if (handler) {
            this.sendEvent('bus:' + eventType, event.getPayload());
            return handler.consume;
        }
    }

    showIframePopup() {
        const basePath = window.location.pathname.replace(/_\/$/, '/');
        let url = `${window.location.origin}${basePath}PluginServlet?action=__PREFIX__Servlet#/popup`;

        if(this.pluginConfig.DEVMODE === true) {
            url = 'http://localhost:4200#/popup'
        }

        try {
            this.allowedOrigin = new URL(url).origin;
        } catch (e) {
            console.error('Invalid iframe URL:', url);
            return;
        }

        const iframeId = this.iframeIdPopup;

        this.eventBus.push('SHOW_GENERIC_POPUP', {
            title: 'Web App',
            componentConfig: {
                component: 'HtmlComponent',
                props: {
                    content: `
                        <iframe
                            id="${iframeId}"
                            src="${url}"
                            style="width:100%; height:100%; border:none;"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        ></iframe>
                    `
                }
            },
            hideCancelButton: false,
            hideDoneButton: true,
            resultFunction: (positive) => {
                console.log('Iframe popup closed. Cancelled:', !positive);
                this.iframeWindow = null;
                const globalInputHandler = this.pluginService.getContextInstance('KeyboardTools');
                globalInputHandler.getInputHandler().popPrimaryTarget();
            }
        });

        setTimeout(() => {
            const iframe = document.getElementById(iframeId);
            console.log('got Iframe:', iframe);
            if (iframe) {
                this.iframeWindow = iframe.contentWindow;
            }
            const globalInputHandler = this.pluginService.getContextInstance('KeyboardTools');
            globalInputHandler.getInputHandler().pushPrimaryTarget({
                getValue: () => {
                    return '';
                },
                appendCharCode: (keyCode, newValue) => {
                    this._sendToIframe({ type: 'KEYBOARD_INPUT', keyCode });
                }
            })
        }, 0);
    }

    // -------------------------------------------------------
    // Incoming messages from iframe
    // -------------------------------------------------------

    _handlePostMessage(event) {
        if (this.allowedOrigin && event.origin !== this.allowedOrigin) {
            return;
        }

        const data = event.data;
        if (!data || !data.type) return;

        // IFRAME_READY is the discovery message — no channel yet.
        // Verify it came from our own iframe by checking event.source.
        if (data.type === 'IFRAME_READY') {
            if (this._isOurIframe(event.source)) {
                this._sendToIframe({ type: 'BRIDGE_READY' });
            }
            return;
        }

        // All other messages require channel match
        if (data.channel !== this.channel) return;

        console.log('[__PREFIX__Bridge] Received from iframe:', data);

        switch (data.type) {
            case 'RPC_REQUEST':
                this._handleRpcRequest(data);
                break;

            case 'PUSH_EVENT':
                if (data.payload?.eventType) {
                    if(data.payload?.eventType === 'TOGGLE_KEYBOARD') {
                        // workaround
                        data.payload.eventData.event = {
                            preventDefault: () => {}
                        }
                    }
                    this.eventBus.push(data.payload.eventType, data.payload.eventData);
                }
                break;

            case 'CLOSE_POPUP':
                break;

            default:
                console.warn('[__PREFIX__Bridge] Unknown message type:', data.type);
        }
    }

    _isOurIframe(source) {
        if (this.iframeWindow && this.iframeWindow === source) return true;
        const embedded = document.getElementById(this.iframeIdEmbedded);
        if (embedded && embedded.contentWindow === source) return true;
        const popup = document.getElementById(this.iframeIdPopup);
        if (popup && popup.contentWindow === source) return true;
        return false;
    }

    _handleRpcRequest(data) {
        const { id, method, args } = data;
        const handler = this._rpcHandlers[method];

        if (!handler) {
            this._sendToIframe({
                type: 'RPC_RESPONSE',
                id,
                error: `Unknown method: ${method}`
            });
            return;
        }

        try {
            const result = handler(args || {});

            // Support both sync and async handlers
            if (result && typeof result.then === 'function') {
                result.then(
                    (res) => this._sendToIframe({ type: 'RPC_RESPONSE', id, result: res }),
                    (err) => this._sendToIframe({ type: 'RPC_RESPONSE', id, error: String(err) })
                );
            } else {
                this._sendToIframe({ type: 'RPC_RESPONSE', id, result });
            }
        } catch (e) {
            console.error('[__PREFIX__Bridge] RPC error:', method, e);
            this._sendToIframe({
                type: 'RPC_RESPONSE',
                id,
                error: String(e)
            });
        }
    }

    // -------------------------------------------------------
    // Outgoing messages to iframe
    // -------------------------------------------------------

    _sendToIframe(message) {
        message.channel = this.channel;
        console.log('[__PREFIX__Bridge] Send to iframe:', message);
        if (this.iframeWindow && this.allowedOrigin) {
            this.iframeWindow.postMessage(message, this.allowedOrigin);
        } else {
            console.warn('[__PREFIX__Bridge] No iframe connected, cannot send:', message);
        }

        const iframeEmbedded  = document.getElementById(this.iframeIdEmbedded);
        if (iframeEmbedded && this.allowedOrigin) {
            const iframeEmbeddedWindow = iframeEmbedded.contentWindow;
            iframeEmbeddedWindow.postMessage(message, this.allowedOrigin);
        } else {
            console.warn('[__PREFIX__Bridge] No embedded iframe connected, cannot send:', message);
        }
    }

    /**
     * Push a POS event to the iframe app.
     * Use this from other plugins or POS event handlers.
     */
    sendEvent(event, data) {
        this._sendToIframe({ type: 'POS_EVENT', event, data });
    }

    /**
     * @deprecated Use sendEvent() instead
     */
    sendToApp(type, payload) {
        this._sendToIframe({ type, payload });
    }
}
