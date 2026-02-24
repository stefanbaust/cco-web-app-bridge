Plugin.WebAppBridgePlugin = class WebAppBridgePlugin {

    pluginEventSourceIdentifier = 'WebAppBridgePlugin';

    constructor(pluginService, eventBus) {
        this.T = pluginService.getContextInstance('T');

        console.info('WebAppBridgePlugin loaded');
        this.pluginService = pluginService;
        this.eventBus = eventBus;

        this.init();
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
                component: 'ButtonComponent',
                props: {
                    content: 'This is a simple button',
                    class: 'function1',
                    callback: () => {
                        console.log('Button pressed');
                    }
                }
            },
            resultFunction: (positive) => {
                console.log('Popup closed. X or cancel clicked:', !positive);
            }
        });
    }
}
