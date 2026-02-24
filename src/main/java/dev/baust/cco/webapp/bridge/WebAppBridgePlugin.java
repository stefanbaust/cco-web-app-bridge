package dev.baust.cco.webapp.bridge;

import com.sap.scco.ap.plugin.BasePlugin;
import com.sap.scco.ap.plugin.annotation.ListenToExit;
import com.sap.scco.ap.plugin.annotation.ui.CSSInject;
import com.sap.scco.ap.plugin.annotation.ui.DOMInject;
import com.sap.scco.ap.plugin.annotation.ui.JSInject;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;

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

    @ListenToExit(exitName="PluginServlet.callback.get")
    public void pluginServletGet(Object caller, Object[] args) throws Exception {
        HttpServletRequest request = (HttpServletRequest) args[0];
        HttpServletResponse response = (HttpServletResponse) args[1];

        String action = request.getParameter("action");
        if (!"webAppBridgeServlet".equals(action)) {
            return;
        }

        response.setContentType("text/html");
        response.setCharacterEncoding("UTF-8");

        try (InputStream is = this.getClass().getResourceAsStream("/app/index.html")) {
            if (is == null) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                response.getWriter().write("index.html not found");
                return;
            }
            byte[] content = is.readAllBytes();
            response.setContentLength(content.length);
            response.getOutputStream().write(content);
        }
    }

    @CSSInject(targetScreen = "NGUI")
    public InputStream[] cssInject() {
        return new InputStream[]{
                this.getClass().getResourceAsStream("/cco-web-app-bridge.css")
        };
    }
}
