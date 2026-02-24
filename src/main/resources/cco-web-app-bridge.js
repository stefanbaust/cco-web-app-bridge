Plugin.WebAppBridgePlugin = class WebAppBridgePlugin {

    pluginEventSourceIdentifier = 'WebAppBridgePlugin';

    constructor(pluginService, eventBus) {
        this.T = pluginService.getContextInstance('T');

        console.info('WebAppBridgePlugin loaded');
        this.pluginService = pluginService;
        this.eventBus = eventBus;
        this.iframeWindow = null;
        this.allowedOrigin = null;

        this.init();
        window.webAppBridgePluginRef = this;
    }

    init() {
        this.eventBus.subscribe(this);
        this._boundMessageHandler = this._handlePostMessage.bind(this);
        window.addEventListener('message', this._boundMessageHandler);
    }

    destroy() {
        window.removeEventListener('message', this._boundMessageHandler);
    }

    handleEvent(event) {
        switch (event.getType()) {
            case 'SB_SHOW_WEBVIEW':
                this.showIframePopup();
                break;
        }
    }

    showIframePopup() {
        // Extract origin for security validation
        const url = 'http://localhost:9999/1337/PluginServlet?action=webAppBridgeServlet';
        try {
            // TODO this has to be changed to figure out the URL on the fly
            this.allowedOrigin = new URL('http://localhost:9999/1337/PluginServlet?action=webAppBridgeServlet').origin;
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
                            style="width:100%; height:500px; border:none;"
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

        // Wait for DOM to render, then grab iframe reference
        setTimeout(() => {
            const iframe = document.getElementById(iframeId);
            console.log('got Iframe:', iframe);
            if (iframe) {
                this.iframeWindow = iframe.contentWindow;
                iframe.addEventListener('load', () => {
                    console.log('Iframe loaded');
                    // Notify the iframe app that the bridge is ready
                    this._sendToIframe({ type: 'BRIDGE_READY' });
                });
            }
        }, 500);
    }

    // --- Incoming messages from iframe ---

    _handlePostMessage(event) {
        // Security: only accept messages from the allowed origin
        if (this.allowedOrigin && event.origin !== this.allowedOrigin) {
            return;
        }

        const data = event.data;
        if (!data || !data.type) return;

        console.log('[WebAppBridge] Received from iframe:', data);

        switch (data.type) {
            case 'PUSH_EVENT':
                // Generic passthrough: let the iframe push any event onto the POS event bus
                if (data.payload?.eventType) {
                    this.eventBus.push(data.payload.eventType, data.payload.eventData);
                }
                break;

            case 'CLOSE_POPUP':
                // Could trigger popup close logic if supported
                break;

            default:
                console.warn('[WebAppBridge] Unknown message type:', data.type);
        }
    }

    // --- Outgoing messages to iframe ---

    _sendToIframe(message) {
        console.log('[WebAppBridge] Send to iframe:', message);
        if (this.iframeWindow && this.allowedOrigin) {
            this.iframeWindow.postMessage(message, this.allowedOrigin);
        } else {
            console.warn('[WebAppBridge] No iframe connected, cannot send:', message);
        }
    }

    /**
     * Send arbitrary data/events to the iframe app.
     * Can be called from other plugins or POS event handlers.
     */
    sendToApp(type, payload) {
        this._sendToIframe({ type, payload });
    }
}
