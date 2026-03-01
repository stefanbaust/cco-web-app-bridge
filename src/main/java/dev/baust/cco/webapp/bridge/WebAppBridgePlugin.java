package dev.baust.cco.webapp.bridge;

import com.sap.scco.ap.plugin.BasePlugin;
import com.sap.scco.ap.plugin.PluginConfigurationDTO;
import com.sap.scco.ap.plugin.PluginConfigurationType;
import com.sap.scco.ap.plugin.annotation.ListenToExit;
import com.sap.scco.ap.plugin.annotation.ui.CSSInject;
import com.sap.scco.ap.plugin.annotation.ui.JSInject;
import com.sap.scco.ap.plugin.helper.PluginExitPoints;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import net.sf.json.JSONObject;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public class WebAppBridgePlugin extends BasePlugin {

    private static Logger logger = LoggerFactory.getLogger(WebAppBridgePlugin.class);

    private static final OkHttpClient httpClient = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();

    private static final Map<String, String> CONTENT_TYPES = Map.ofEntries(
            Map.entry("js", "application/javascript"),
            Map.entry("css", "text/css"),
            Map.entry("html", "text/html"),
            Map.entry("json", "application/json"),
            Map.entry("svg", "image/svg+xml"),
            Map.entry("woff2", "font/woff2"),
            Map.entry("woff", "font/woff"),
            Map.entry("ttf", "font/ttf"),
            Map.entry("eot", "application/vnd.ms-fontobject"),
            Map.entry("png", "image/png"),
            Map.entry("jpg", "image/jpeg"),
            Map.entry("jpeg", "image/jpeg"),
            Map.entry("gif", "image/gif"),
            Map.entry("ico", "image/x-icon"),
            Map.entry("txt", "text/plain")
    );

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

    @Override
    public List<PluginConfigurationDTO> getPluginPropertyConfiguration() {
        List<PluginConfigurationDTO> result = new ArrayList<>();
        result.add(new PluginConfigurationDTO("DEVMODE", "Debug Mode", PluginConfigurationType.BOOLEAN));
        return result;
    }

    @Override
    public boolean persistPropertiesToDB() {
        return true;
    }

    @ListenToExit(exitName = PluginExitPoints.TECH_CONTROLLER_UI_EVENT_CHANNEL)
    public void uiEventChannel(Object calledBy, Object[] args) {
        String eventName = (String) args[0];
        JSONObject request = (JSONObject) args[2];
        Map<String, Object> responseMap = (Map<String, Object>) args[3];

        try {
            if("SB_BRIDGE_GET_PLUGIN_CONFIG".equals(eventName)) {
                Map<String, Object> props = new HashMap<>();
                props.put("DEVMODE", getProperty("DEVMODE", false));
                responseMap.put("config", props);
            }
        } catch (Exception e) {
            logger.error("Error occurred while processing request", e);
            responseMap.put("error", e.getMessage());
        }
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

    @ListenToExit(exitName = "PluginServlet.callback.get")
    public void pluginServletGet(Object caller, Object[] args) throws Exception {
        HttpServletRequest request = (HttpServletRequest) args[0];
        HttpServletResponse response = (HttpServletResponse) args[1];

        String action = request.getParameter("action");

        if ("webAppBridgeServlet".equals(action)) {
            serveIndexHtml(response);
        } else if ("webAppResource".equals(action)) {
            serveResource(request, response);
        } else if ("webAppBridgeConfig".equals(action)) {
            JSONObject config = new JSONObject();
            config.put("DEVMODE", getProperty("DEVMODE", false));
            byte[] content = config.toString().getBytes(StandardCharsets.UTF_8);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.setContentLength(content.length);
            response.getOutputStream().write(content);
        }
    }

    @ListenToExit(exitName = "PluginServlet.callback.post")
    public void pluginServletPost(Object caller, Object[] args) throws Exception {
        HttpServletRequest request = (HttpServletRequest) args[0];
        HttpServletResponse response = (HttpServletResponse) args[1];

        String action = request.getParameter("action");

        if ("webAppProxy".equals(action)) {
            handleProxy(request, response);
        }
    }

    private void handleProxy(HttpServletRequest servletRequest, HttpServletResponse servletResponse) throws IOException {
        String jsonBody = new String(servletRequest.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        JSONObject payload = JSONObject.fromObject(jsonBody);

        String targetUrl = payload.getString("url");
        String method = payload.optString("method", "GET").toUpperCase();

        // Build OkHttp request
        Request.Builder reqBuilder = new Request.Builder().url(targetUrl);

        // Forward headers from payload
        if (payload.has("headers")) {
            JSONObject headers = payload.getJSONObject("headers");
            for (Object key : headers.keySet()) {
                String headerName = (String) key;
                reqBuilder.addHeader(headerName, headers.getString(headerName));
            }
        }

        // Set method and body
        if ("GET".equals(method)) {
            reqBuilder.get();
        } else {
            String body = payload.optString("body", "");
            MediaType mediaType = MediaType.parse("application/json; charset=utf-8");
            reqBuilder.method(method, RequestBody.create(body, mediaType));
        }

        try (Response upstreamResponse = httpClient.newCall(reqBuilder.build()).execute()) {
            servletResponse.setStatus(upstreamResponse.code());

            // Forward content-type
            String contentType = upstreamResponse.header("Content-Type");
            if (contentType != null) {
                servletResponse.setContentType(contentType);
            }

            // Write response body
            byte[] responseBody = upstreamResponse.body() != null ? upstreamResponse.body().bytes() : new byte[0];
            servletResponse.setContentLength(responseBody.length);
            servletResponse.getOutputStream().write(responseBody);
        }
    }

    private void serveIndexHtml(HttpServletResponse response) throws IOException {
        try (InputStream is = this.getClass().getResourceAsStream("/app/index.html")) {
            if (is == null) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                response.getWriter().write("index.html not found");
                return;
            }

            String html = new String(is.readAllBytes(), StandardCharsets.UTF_8);

            // Rewrite relative asset paths to route through the servlet resource handler
            html = html.replaceAll("src=\"([^\"]+)\"", "src=\"PluginServlet?action=webAppResource&path=$1\"");
            html = html.replaceAll("href=\"([^\"]+\\.css)\"", "href=\"PluginServlet?action=webAppResource&path=$1\"");

            byte[] content = html.getBytes(StandardCharsets.UTF_8);
            response.setContentType("text/html");
            response.setCharacterEncoding("UTF-8");
            response.setContentLength(content.length);
            response.getOutputStream().write(content);
        }
    }

    private void serveResource(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String path = request.getParameter("path");

        if (path == null || path.isEmpty() || path.contains("..") || path.startsWith("/")) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.getWriter().write("Invalid path");
            return;
        }

        String resourcePath = "/app/" + path;

        try (InputStream is = this.getClass().getResourceAsStream(resourcePath)) {
            if (is == null) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                response.getWriter().write("Resource not found: " + path);
                return;
            }

            byte[] content = is.readAllBytes();
            response.setContentType(getContentType(path));
            response.setCharacterEncoding("UTF-8");
            response.setContentLength(content.length);
            response.getOutputStream().write(content);
        }
    }

    private String getContentType(String path) {
        int dotIndex = path.lastIndexOf('.');
        if (dotIndex >= 0) {
            String ext = path.substring(dotIndex + 1).toLowerCase();
            return CONTENT_TYPES.getOrDefault(ext, "application/octet-stream");
        }
        return "application/octet-stream";
    }
}
