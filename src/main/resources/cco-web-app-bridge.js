Plugin.WebAppBridgePlugin = class WebAppBridgePlugin {

    pluginEventSourceIdentifier = 'WebAppBridgePlugin';

    constructor(pluginService, eventBus) {
        this.T = pluginService.getContextInstance('T');

        console.info('WebAppBridgePlugin loaded');
        this.pluginService = pluginService;
        this.eventBus = eventBus;

        this.init();
        window.webAppBridgePluginRef = this;
    }

    init() {
        this.eventBus.subscribe(this);
    }

    handleEvent(event) {
        switch (event.getType()) {
            case 'SB_SHOW_WEBVIEW':
                this.showSimplePopup();
                break;
        }
    }

    showSimplePopup() {
        //Simple example. Shown a popup with a big button.

        this.eventBus.push('SHOW_GENERIC_POPUP', {
            title: 'Simple popup',
            componentConfig: {
                component: 'HtmlComponent',
                props: {
                    content: `
                        <b>This is custom HTML</b><br/>
                        <button onclick="webAppBridgePluginRef.someFunctionCalledFromCustomHTML('Hello!');">Custom button</button><br/>
                        <span class="myCustomCss" id="span1">Span with custom css</span><br/>
                    `
                }
            },
            resultFunction: (positive) => {
                console.log('Popup closed. X or cancel clicked:', !positive);
            }
        });
    }

    someFunctionCalledFromCustomHTML(text) {
        //Function called by custom HTML code
        this.eventBus.push('SHOW_MESSAGE_BOX', text);
        document.getElementById('span1').classList.remove('myCustomCss');
        document.getElementById('span1').classList.add('myCustomCss2');
    }
}
