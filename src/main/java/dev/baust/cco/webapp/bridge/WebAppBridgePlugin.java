package dev.baust.cco.webapp.bridge;

import com.sap.scco.ap.plugin.BasePlugin;
import com.sap.scco.ap.plugin.annotation.ui.CSSInject;
import com.sap.scco.ap.plugin.annotation.ui.JSInject;

import java.io.InputStream;

public class WebAppBridgePlugin extends BasePlugin {
    @Override
    public String getId() {
        return "WebAppBridgePlugin";
    }

    @Override
    public String getName() {
        return "WebAppBridgePlugin";
    }

    @Override
    public String getVersion() {
        return getClass().getPackage().getImplementationVersion();
    }

    @JSInject(targetScreen = "NGUI")
    public InputStream[] jsInject() {
        return new InputStream[]{
                this.getClass().getResourceAsStream("/cco-web-app-bridge.js")
        };
    }

    @CSSInject(targetScreen = "NGUI")
    public InputStream[] cssInject() {
        return new InputStream[]{
                this.getClass().getResourceAsStream("/cco-web-app-bridge.css")
        };
    }
}
