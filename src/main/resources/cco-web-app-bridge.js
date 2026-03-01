Plugin.WebAppBridgePlugin = class WebAppBridgePlugin {

    pluginEventSourceIdentifier = 'WebAppBridgePlugin';

    constructor(pluginService, eventBus) {
        this.T = pluginService.getContextInstance('T');

        console.info('WebAppBridgePlugin loaded');
        this.pluginService = pluginService;
        this.eventBus = eventBus;
        this.iframeWindow = null;
        this.iframeIdEmbedded = 'webAppBridgeIframeEmbedded';
        this.allowedOrigin = null;

        this._rpcHandlers = {};
        this._registerRpcHandlers();

        this.init();
        window.webAppBridgePluginRef = this;
    }

    async init() {
        this.eventBus.subscribe(this);
        this._boundMessageHandler = this._handlePostMessage.bind(this);
        window.addEventListener('message', this._boundMessageHandler);

        const receiptStore = this.pluginService.getContextInstance('ReceiptStore');
        receiptStore.addObserver(this);
        this.pluginConfig = await this.fetchPluginConfig();
        this.setupCustomerComponent();
    }

    setupCustomerComponent() {
        const propStore = this.pluginService.getContextInstance('DynamicPropertiesStore');

        const basePath = window.location.pathname.replace(/_\/$/, '/');
        let url = `${window.location.origin}${basePath}PluginServlet?action=webAppBridgeServlet#/embedded`;

        if(this.pluginConfig?.DEVMODE === true) {
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


        const props = propStore.getDynamicProperties('SB_WEBVIEW_EMBEDDED');
        if (props != null) {
            props.setAndEmitPropertiesIfChanged({
                content: customerComponent
            });
        } else {
            propStore.addDynamicProperties('SB_WEBVIEW_EMBEDDED', {
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
        const url = `${window.location.origin}${basePath}PluginServlet?action=webAppBridgeConfig`;
        const response = await fetch(url);
        const config = await response.json();
        console.info('Plugin config loaded', config);
        return config;
    }

    observe(store, payload) {
        if (store instanceof cco.ReceiptStore) {
            console.log('Current state', payload);
            this.sendEvent('receiptChanged', store.getReceiptModel());
        }
    }

    destroy() {
        window.removeEventListener('message', this._boundMessageHandler);
    }

    // -------------------------------------------------------
    // RPC Handler Registration
    // -------------------------------------------------------

    _registerRpcHandlers() {
        this._rpcHandlers['getReceipt'] = () => {
            const receiptStore = this.pluginService.getContextInstance('ReceiptStore');
            return receiptStore.getReceiptModel();
        };

        this._rpcHandlers['getLocale'] = () => {
            try {
                const userStore = this.pluginService.getContextInstance('UserStore');
                const langCode = userStore.getUser()?.getLanguageCode();
                if (langCode) return langCode;
            } catch (e) {
                console.warn('[WebAppBridge] Could not get user language:', e);
            }
            try {
                const translationStore = this.pluginService.getContextInstance('TranslationStore');
                return translationStore.getDefaultLanguage();
            } catch (e) {
                console.warn('[WebAppBridge] Could not get default language:', e);
            }
            return 'de';
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
            case 'SB_SHOW_WEBVIEW':
                this.showIframePopup();
                break;
        }
    }

    showIframePopup() {
        const basePath = window.location.pathname.replace(/_\/$/, '/');
        let url = `${window.location.origin}${basePath}PluginServlet?action=webAppBridgeServlet#/popup`;

        if(this.pluginConfig.DEVMODE === true) {
            url = 'http://localhost:4200#/popup'
        }

        try {
            this.allowedOrigin = new URL(url).origin;
        } catch (e) {
            console.error('Invalid iframe URL:', url);
            return;
        }

        const iframeId = 'webAppBridgeIframe';

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
            resultFunction: (positive) => {
                console.log('Iframe popup closed. Cancelled:', !positive);
                this.iframeWindow = null;
            }
        });

        setTimeout(() => {
            const iframe = document.getElementById(iframeId);
            console.log('got Iframe:', iframe);
            if (iframe) {
                this.iframeWindow = iframe.contentWindow;
            }
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

        console.log('[WebAppBridge] Received from iframe:', data);

        switch (data.type) {
            case 'IFRAME_READY':
                this._sendToIframe({ type: 'BRIDGE_READY' });
                break;

            case 'RPC_REQUEST':
                this._handleRpcRequest(data);
                break;

            case 'PUSH_EVENT':
                if (data.payload?.eventType) {
                    this.eventBus.push(data.payload.eventType, data.payload.eventData);
                }
                break;

            case 'CLOSE_POPUP':
                break;

            default:
                console.warn('[WebAppBridge] Unknown message type:', data.type);
        }
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
            console.error('[WebAppBridge] RPC error:', method, e);
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
        console.log('[WebAppBridge] Send to iframe:', message);
        if (this.iframeWindow && this.allowedOrigin) {
            this.iframeWindow.postMessage(message, this.allowedOrigin);
        } else {
            console.warn('[WebAppBridge] No iframe connected, cannot send:', message);
        }

        const iframeEmbedded  = document.getElementById(this.iframeIdEmbedded);
        if (iframeEmbedded && this.allowedOrigin) {
            const iframeEmbeddedWindow = iframeEmbedded.contentWindow;
            iframeEmbeddedWindow.postMessage(message, this.allowedOrigin);
        } else {
            console.warn('[WebAppBridge] No embedded iframe connected, cannot send:', message);
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
