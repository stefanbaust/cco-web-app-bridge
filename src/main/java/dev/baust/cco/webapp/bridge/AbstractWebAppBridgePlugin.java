package dev.baust.cco.webapp.bridge;

import com.sap.scco.ap.plugin.BasePlugin;
import com.sap.scco.ap.plugin.PluginConfigurationDTO;
import com.sap.scco.ap.plugin.PluginConfigurationType;
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

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

public abstract class AbstractWebAppBridgePlugin extends BasePlugin {

    private static final Logger logger = LoggerFactory.getLogger(AbstractWebAppBridgePlugin.class);

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

    protected final String prefix;

    private final String servletAction;
    private final String resourceAction;
    private final String configAction;
    private final String proxyAction;
    private final String configEventName;

    protected AbstractWebAppBridgePlugin(String prefix) {
        this.prefix = prefix;
        this.servletAction = prefix + "Servlet";
        this.resourceAction = prefix + "Resource";
        this.configAction = prefix + "Config";
        this.proxyAction = prefix + "Proxy";
        this.configEventName = prefix + "_GET_PLUGIN_CONFIG";
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

    // -------------------------------------------------------
    // JS / CSS injection helpers
    // -------------------------------------------------------

    protected InputStream[] getBridgeJsInject() {
        try {
            InputStream raw = getClass().getResourceAsStream("/cco-web-app-bridge.js");
            if (raw == null) {
                logger.error("cco-web-app-bridge.js not found on classpath");
                return new InputStream[0];
            }
            String js = new String(raw.readAllBytes(), StandardCharsets.UTF_8);
            js = js.replace("__PREFIX__", prefix);
            return new InputStream[]{new ByteArrayInputStream(js.getBytes(StandardCharsets.UTF_8))};
        } catch (IOException e) {
            logger.error("Failed to read cco-web-app-bridge.js", e);
            return new InputStream[0];
        }
    }

    // -------------------------------------------------------
    // Servlet handlers
    // -------------------------------------------------------

    protected void handleBridgeServletGet(Object caller, Object[] args) throws Exception {
        HttpServletRequest request = (HttpServletRequest) args[0];
        HttpServletResponse response = (HttpServletResponse) args[1];

        String action = request.getParameter("action");

        if (servletAction.equals(action)) {
            serveIndexHtml(response);
        } else if (resourceAction.equals(action)) {
            serveResource(request, response);
        } else if (configAction.equals(action)) {
            JSONObject config = new JSONObject();
            config.put("DEVMODE", getProperty("DEVMODE", false));
            byte[] content = config.toString().getBytes(StandardCharsets.UTF_8);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.setContentLength(content.length);
            response.getOutputStream().write(content);
        }
    }

    protected void handleBridgeServletPost(Object caller, Object[] args) throws Exception {
        HttpServletRequest request = (HttpServletRequest) args[0];
        HttpServletResponse response = (HttpServletResponse) args[1];

        String action = request.getParameter("action");

        if (proxyAction.equals(action)) {
            handleProxy(request, response);
        }
    }

    // -------------------------------------------------------
    // UI Event Channel handler
    // -------------------------------------------------------

    protected void handleBridgeUiEventChannel(Object calledBy, Object[] args) {
        String eventName = (String) args[0];
        JSONObject request = (JSONObject) args[2];
        Map<String, Object> responseMap = (Map<String, Object>) args[3];

        try {
            if (configEventName.equals(eventName)) {
                Map<String, Object> props = new HashMap<>();
                props.put("DEVMODE", getProperty("DEVMODE", false));
                responseMap.put("config", props);
            }
        } catch (Exception e) {
            logger.error("Error occurred while processing request", e);
            responseMap.put("error", e.getMessage());
        }
    }

    // -------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------

    private void handleProxy(HttpServletRequest servletRequest, HttpServletResponse servletResponse) throws IOException {
        String jsonBody = new String(servletRequest.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        JSONObject payload = JSONObject.fromObject(jsonBody);

        String targetUrl = payload.getString("url");
        String method = payload.optString("method", "GET").toUpperCase();

        Request.Builder reqBuilder = new Request.Builder().url(targetUrl);

        if (payload.has("headers")) {
            JSONObject headers = payload.getJSONObject("headers");
            for (Object key : headers.keySet()) {
                String headerName = (String) key;
                reqBuilder.addHeader(headerName, headers.getString(headerName));
            }
        }

        if ("GET".equals(method)) {
            reqBuilder.get();
        } else {
            String body = payload.optString("body", "");
            MediaType mediaType = MediaType.parse("application/json; charset=utf-8");
            reqBuilder.method(method, RequestBody.create(body, mediaType));
        }

        try (Response upstreamResponse = httpClient.newCall(reqBuilder.build()).execute()) {
            servletResponse.setStatus(upstreamResponse.code());

            String contentType = upstreamResponse.header("Content-Type");
            if (contentType != null) {
                servletResponse.setContentType(contentType);
            }

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

            html = html.replaceAll("src=\"([^\"]+)\"", "src=\"PluginServlet?action=" + resourceAction + "&path=$1\"");
            html = html.replaceAll("href=\"([^\"]+\\.css)\"", "href=\"PluginServlet?action=" + resourceAction + "&path=$1\"");

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
