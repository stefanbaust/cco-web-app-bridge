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
import okhttp3.ResponseBody;
import org.apache.commons.lang.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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

    private static final Set<String> STRIPPED_HEADERS = Set.of(
            "x-frame-options",
            "content-security-policy",
            "x-content-type-options",
            "transfer-encoding"
    );

    protected final String prefix;

    private final String servletAction;
    private final String resourceAction;
    private final String configAction;
    private final String proxyAction;
    private final String configEventName;
    private final String remoteBaseUrl;

    protected AbstractWebAppBridgePlugin(String prefix) {
        this(prefix, null);
    }

    protected AbstractWebAppBridgePlugin(String prefix, String remoteBaseUrl) {
        this.prefix = prefix;
        this.remoteBaseUrl = normalizeBaseUrl(remoteBaseUrl);
        this.servletAction = prefix + "Servlet";
        this.resourceAction = prefix + "Resource";
        this.configAction = prefix + "Config";
        this.proxyAction = prefix + "Proxy";
        this.configEventName = prefix + "_GET_PLUGIN_CONFIG";
    }

    protected String getRemoteBaseUrl() {
        return remoteBaseUrl;
    }

    private boolean isRemoteMode() {
        return getRemoteBaseUrl() != null;
    }

    private static String normalizeBaseUrl(String url) {
        if (url == null || url.isEmpty()) {
            return null;
        }
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
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
                props.put("REMOTE", StringUtils.isNotBlank(this.remoteBaseUrl));
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

        // SSRF protection: validate target URL before making request
        try {
            validateProxyTarget(targetUrl);
        } catch (SecurityException e) {
            logger.warn("[{}] Proxy request blocked: {}", prefix, e.getMessage());
            servletResponse.setStatus(HttpServletResponse.SC_FORBIDDEN);
            servletResponse.setContentType("application/json");
            servletResponse.getWriter().write("{\"error\":\"" + e.getMessage() + "\"}");
            return;
        }

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

    // -------------------------------------------------------
    // Index HTML serving
    // -------------------------------------------------------

    private void serveIndexHtml(HttpServletResponse response) throws IOException {
        if (isRemoteMode()) {
            serveRemoteIndexHtml(response);
        } else {
            serveLocalIndexHtml(response);
        }
    }

    private void serveLocalIndexHtml(HttpServletResponse response) throws IOException {
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

    private void serveRemoteIndexHtml(HttpServletResponse response) throws IOException {
        try {
            validateRemoteBaseUrl();
        } catch (SecurityException e) {
            logger.error("[{}] Remote base URL validation failed: {}", prefix, e.getMessage());
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.getWriter().write(e.getMessage());
            return;
        }

        String url = getRemoteBaseUrl() + "/index.html";
        Request request = new Request.Builder().url(url).get().build();

        try (Response upstreamResponse = httpClient.newCall(request).execute()) {
            if (!upstreamResponse.isSuccessful()) {
                response.setStatus(upstreamResponse.code());
                response.getWriter().write("Failed to fetch remote index.html from " + url);
                return;
            }

            ResponseBody body = upstreamResponse.body();
            if (body == null) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                response.getWriter().write("Empty response from remote server");
                return;
            }

            String html = body.string();

            // Rewrite relative src attributes (skip absolute URLs, data:, blob:, #, //)
            html = html.replaceAll(
                    "src=\"(?!https?://|data:|blob:|#|//|PluginServlet)([^\"]+)\"",
                    "src=\"PluginServlet?action=" + resourceAction + "&path=$1\""
            );

            // Rewrite relative href for CSS and JS (stylesheet, modulepreload, preload)
            html = html.replaceAll(
                    "href=\"(?!https?://|data:|blob:|#|//|PluginServlet)([^\"]+\\.(?:css|js))\"",
                    "href=\"PluginServlet?action=" + resourceAction + "&path=$1\""
            );

            // Inject pos-bridge-sdk.js before </body>
            String sdkScript = "<script src=\"PluginServlet?action=" + resourceAction
                    + "&path=pos-bridge-sdk.js\"></script>";
            html = html.replace("</body>", sdkScript + "\n</body>");

            byte[] content = html.getBytes(StandardCharsets.UTF_8);
            response.setContentType("text/html");
            response.setCharacterEncoding("UTF-8");
            response.setContentLength(content.length);
            response.getOutputStream().write(content);
        }
    }

    // -------------------------------------------------------
    // Resource serving
    // -------------------------------------------------------

    private void serveResource(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String path = request.getParameter("path");

        if (path == null || path.isEmpty() || path.contains("..")) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.getWriter().write("Invalid path");
            return;
        }

        // Strip leading slash — remote apps may have root-relative paths
        while (path.startsWith("/")) {
            path = path.substring(1);
        }

        if (path.isEmpty()) {
            response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
            response.getWriter().write("Invalid path");
            return;
        }

        if (isRemoteMode()) {
            serveRemoteResource(path, response);
        } else {
            serveLocalResource(path, response);
        }
    }

    private void serveLocalResource(String path, HttpServletResponse response) throws IOException {
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

    private void serveRemoteResource(String path, HttpServletResponse response) throws IOException {
        // Special case: pos-bridge-sdk.js is always served from classpath
        if ("pos-bridge-sdk.js".equals(path)) {
            serveClasspathResource("/pos-bridge-sdk.js", response);
            return;
        }

        try {
            validateRemoteBaseUrl();
        } catch (SecurityException e) {
            logger.error("[{}] Remote base URL validation failed: {}", prefix, e.getMessage());
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.getWriter().write(e.getMessage());
            return;
        }

        String url = getRemoteBaseUrl() + "/" + path;
        Request request = new Request.Builder().url(url).get().build();

        try (Response upstreamResponse = httpClient.newCall(request).execute()) {
            if (!upstreamResponse.isSuccessful()) {
                response.setStatus(upstreamResponse.code());
                response.getWriter().write("Failed to fetch remote resource: " + path);
                return;
            }

            // Forward upstream headers, stripping anti-embedding ones
            for (String name : upstreamResponse.headers().names()) {
                if (!STRIPPED_HEADERS.contains(name.toLowerCase())) {
                    response.setHeader(name, upstreamResponse.header(name));
                }
            }

            String contentType = upstreamResponse.header("Content-Type");
            if (contentType != null) {
                response.setContentType(contentType);
            } else {
                response.setContentType(getContentType(path));
            }

            byte[] responseBody = upstreamResponse.body() != null ? upstreamResponse.body().bytes() : new byte[0];
            response.setContentLength(responseBody.length);
            response.getOutputStream().write(responseBody);
        }
    }

    private void serveClasspathResource(String classpathPath, HttpServletResponse response) throws IOException {
        try (InputStream is = this.getClass().getResourceAsStream(classpathPath)) {
            if (is == null) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                response.getWriter().write("Classpath resource not found: " + classpathPath);
                return;
            }

            byte[] content = is.readAllBytes();
            response.setContentType(getContentType(classpathPath));
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

    // -------------------------------------------------------
    // Security: SSRF protection for proxy endpoint
    // -------------------------------------------------------

    /**
     * Validates that a proxy target URL is safe to request.
     * Blocks requests to private/internal networks and non-HTTPS URLs in production.
     */
    private void validateProxyTarget(String targetUrl) throws SecurityException {
        URI uri;
        try {
            uri = new URI(targetUrl);
        } catch (URISyntaxException e) {
            throw new SecurityException("Invalid proxy target URL: " + targetUrl);
        }

        String scheme = uri.getScheme();
        if (scheme == null) {
            throw new SecurityException("Proxy target URL must have a scheme: " + targetUrl);
        }

        // Enforce HTTPS in production mode
        boolean devMode = getProperty("DEVMODE", false);
        if (!devMode && !"https".equalsIgnoreCase(scheme)) {
            throw new SecurityException("Proxy target URL must use HTTPS in production: " + targetUrl);
        }

        // Only allow http/https schemes
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new SecurityException("Proxy target URL must use HTTP or HTTPS scheme: " + targetUrl);
        }

        String host = uri.getHost();
        if (host == null || host.isEmpty()) {
            throw new SecurityException("Proxy target URL must have a host: " + targetUrl);
        }

        // Block known internal/metadata hostnames
        if ("metadata.google.internal".equalsIgnoreCase(host)) {
            throw new SecurityException("Proxy target blocked (internal metadata): " + targetUrl);
        }

        // Resolve hostname and check against blocked IP ranges
        try {
            InetAddress[] addresses = InetAddress.getAllByName(host);
            for (InetAddress addr : addresses) {
                if (isBlockedAddress(addr)) {
                    throw new SecurityException("Proxy target resolves to blocked address: " + targetUrl);
                }
            }
        } catch (UnknownHostException e) {
            throw new SecurityException("Cannot resolve proxy target host: " + host);
        }
    }

    /**
     * Returns true if the address is in a private, loopback, link-local,
     * or otherwise internal network range that should not be accessible via proxy.
     */
    private static boolean isBlockedAddress(InetAddress addr) {
        return addr.isLoopbackAddress()
                || addr.isSiteLocalAddress()
                || addr.isLinkLocalAddress()
                || addr.isAnyLocalAddress()
                || addr.isMulticastAddress()
                || isCloudMetadataAddress(addr);
    }

    /**
     * Checks for well-known cloud metadata IP addresses (169.254.169.254, fd00:ec2::254).
     */
    private static boolean isCloudMetadataAddress(InetAddress addr) {
        byte[] bytes = addr.getAddress();
        // IPv4: 169.254.169.254
        if (bytes.length == 4) {
            return (bytes[0] & 0xFF) == 169
                    && (bytes[1] & 0xFF) == 254
                    && (bytes[2] & 0xFF) == 169
                    && (bytes[3] & 0xFF) == 254;
        }
        return false;
    }

    // -------------------------------------------------------
    // Security: HTTPS enforcement for remote base URL
    // -------------------------------------------------------

    /**
     * Validates that the remote base URL uses HTTPS when not in DEVMODE.
     * Called at request time since DEVMODE is a runtime property.
     */
    private void validateRemoteBaseUrl() throws SecurityException {
        String url = getRemoteBaseUrl();
        if (url == null) return;

        boolean devMode = getProperty("DEVMODE", false);
        if (!devMode && !url.toLowerCase().startsWith("https://")) {
            throw new SecurityException(
                    "Remote base URL must use HTTPS in production mode. "
                            + "Set DEVMODE=true for development with HTTP, or configure an HTTPS URL. "
                            + "Current URL: " + url);
        }
    }
}
