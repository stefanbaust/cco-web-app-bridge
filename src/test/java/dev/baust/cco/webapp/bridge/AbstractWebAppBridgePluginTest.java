/*
 * Copyright (C) 2025 Stefan Baust IT GmbH
 *
 * This file is part of CCO Web App Bridge.
 *
 * CCO Web App Bridge is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * CCO Web App Bridge is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with CCO Web App Bridge. If not, see <https://www.gnu.org/licenses/>.
 */
package dev.baust.cco.webapp.bridge;

import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import net.sf.json.JSONObject;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AbstractWebAppBridgePluginTest {

    private static final String PREFIX = "TEST";

    private static HttpServer failingUpstream;
    private static String failingUpstreamUrl;

    @BeforeAll
    static void startFailingUpstream() throws IOException {
        failingUpstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        failingUpstream.createContext("/", exchange -> {
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        failingUpstream.start();
        failingUpstreamUrl = "http://127.0.0.1:" + failingUpstream.getAddress().getPort();
    }

    @AfterAll
    static void stopFailingUpstream() {
        failingUpstream.stop(0);
    }

    private static class TestPlugin extends AbstractWebAppBridgePlugin {
        private final boolean devMode;

        TestPlugin(String remoteBaseUrl, boolean devMode) {
            super(PREFIX, remoteBaseUrl);
            this.devMode = devMode;
        }

        @Override
        public String getId() {
            return PREFIX;
        }

        @Override
        public String getName() {
            return "Test plugin";
        }

        // Plugin properties live in the CCO runtime, which is absent in unit tests
        @Override
        public boolean getProperty(String key, boolean defaultValue) {
            return devMode;
        }
    }

    private static class CapturedResponse {
        final HttpServletResponse mock = mock(HttpServletResponse.class);
        final StringWriter writerBody = new StringWriter();
        final ByteArrayOutputStream streamBody = new ByteArrayOutputStream();

        CapturedResponse() throws IOException {
            when(mock.getWriter()).thenReturn(new PrintWriter(writerBody, true));
            when(mock.getOutputStream()).thenReturn(new ServletOutputStream() {
                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setWriteListener(WriteListener writeListener) {
                }

                @Override
                public void write(int b) {
                    streamBody.write(b);
                }
            });
        }
    }

    private static HttpServletRequest resourceRequest(String path) {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getParameter("action")).thenReturn(PREFIX + "Resource");
        when(request.getParameter("path")).thenReturn(path);
        return request;
    }

    private static HttpServletRequest indexRequest() {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getParameter("action")).thenReturn(PREFIX + "Servlet");
        return request;
    }

    private static HttpServletRequest proxyRequest(String jsonBody) throws IOException {
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getParameter("action")).thenReturn(PREFIX + "Proxy");
        ByteArrayInputStream bytes = new ByteArrayInputStream(jsonBody.getBytes(StandardCharsets.UTF_8));
        when(request.getInputStream()).thenReturn(new ServletInputStream() {
            @Override
            public boolean isFinished() {
                return bytes.available() == 0;
            }

            @Override
            public boolean isReady() {
                return true;
            }

            @Override
            public void setReadListener(ReadListener readListener) {
            }

            @Override
            public int read() {
                return bytes.read();
            }
        });
        return request;
    }

    // -------------------------------------------------------
    // Local resource serving
    // -------------------------------------------------------

    @Test
    void rejectsPathTraversalAsPlainText() throws Exception {
        TestPlugin plugin = new TestPlugin(null, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{resourceRequest("../secret.txt"), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_BAD_REQUEST);
        verify(response.mock).setContentType("text/plain");
        assertEquals("Invalid path", response.writerBody.toString());
    }

    @Test
    void rejectsSlashOnlyPathAsPlainText() throws Exception {
        TestPlugin plugin = new TestPlugin(null, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{resourceRequest("///"), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_BAD_REQUEST);
        verify(response.mock).setContentType("text/plain");
        assertEquals("Invalid path", response.writerBody.toString());
    }

    @Test
    void missingLocalResourceIsReportedAsPlainText() throws Exception {
        TestPlugin plugin = new TestPlugin(null, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null,
                new Object[]{resourceRequest("<script>alert(1)</script>.js"), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_NOT_FOUND);
        verify(response.mock).setContentType("text/plain");
        assertTrue(response.writerBody.toString().startsWith("Resource not found:"));
    }

    @Test
    void servesLocalResourceWithMappedContentType() throws Exception {
        TestPlugin plugin = new TestPlugin(null, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{resourceRequest("/hello.js"), response.mock});

        verify(response.mock).setContentType("application/javascript");
        assertTrue(response.streamBody.toString(StandardCharsets.UTF_8).contains("hello from test resource"));
    }

    @Test
    void missingLocalIndexHtmlIsReportedAsPlainText() throws Exception {
        TestPlugin plugin = new TestPlugin(null, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{indexRequest(), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_NOT_FOUND);
        verify(response.mock).setContentType("text/plain");
        assertEquals("index.html not found", response.writerBody.toString());
    }

    // -------------------------------------------------------
    // Remote mode
    // -------------------------------------------------------

    @Test
    void remoteIndexOverHttpIsForbiddenInProduction() throws Exception {
        TestPlugin plugin = new TestPlugin(failingUpstreamUrl, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{indexRequest(), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_FORBIDDEN);
        verify(response.mock).setContentType("text/plain");
        assertTrue(response.writerBody.toString().contains("HTTPS"));
    }

    @Test
    void remoteResourceOverHttpIsForbiddenInProduction() throws Exception {
        TestPlugin plugin = new TestPlugin(failingUpstreamUrl, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{resourceRequest("main.js"), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_FORBIDDEN);
        verify(response.mock).setContentType("text/plain");
        assertTrue(response.writerBody.toString().contains("HTTPS"));
    }

    @Test
    void remoteIndexUpstreamErrorIsReportedAsPlainText() throws Exception {
        TestPlugin plugin = new TestPlugin(failingUpstreamUrl, true);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{indexRequest(), response.mock});

        verify(response.mock).setStatus(500);
        verify(response.mock).setContentType("text/plain");
        assertTrue(response.writerBody.toString().startsWith("Failed to fetch remote index.html"));
    }

    @Test
    void remoteResourceUpstreamErrorIsReportedAsPlainText() throws Exception {
        TestPlugin plugin = new TestPlugin(failingUpstreamUrl, true);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{resourceRequest("main.js"), response.mock});

        verify(response.mock).setStatus(500);
        verify(response.mock).setContentType("text/plain");
        assertEquals("Failed to fetch remote resource: main.js", response.writerBody.toString());
    }

    @Test
    void remoteSdkRequestIsServedFromClasspath() throws Exception {
        TestPlugin plugin = new TestPlugin(failingUpstreamUrl, true);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{resourceRequest("pos-bridge-sdk.js"), response.mock});

        verify(response.mock).setContentType("application/javascript");
        assertTrue(response.streamBody.size() > 0);
    }

    // -------------------------------------------------------
    // Proxy endpoint
    // -------------------------------------------------------

    @Test
    void blockedProxyTargetProducesValidJsonError() throws Exception {
        TestPlugin plugin = new TestPlugin(null, true);
        CapturedResponse response = new CapturedResponse();
        String body = new JSONObject().element("url", "http://127.0.0.1/internal").toString();

        plugin.handleBridgeServletPost(null, new Object[]{proxyRequest(body), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_FORBIDDEN);
        verify(response.mock).setContentType("application/json");
        JSONObject error = JSONObject.fromObject(response.writerBody.toString());
        assertTrue(error.getString("error").contains("blocked address"));
    }

    @Test
    void proxyErrorWithQuotesStaysValidJson() throws Exception {
        TestPlugin plugin = new TestPlugin(null, true);
        CapturedResponse response = new CapturedResponse();
        String body = new JSONObject().element("url", "http://\"quoted\".invalid/x").toString();

        plugin.handleBridgeServletPost(null, new Object[]{proxyRequest(body), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_FORBIDDEN);
        JSONObject error = JSONObject.fromObject(response.writerBody.toString());
        assertTrue(error.getString("error").length() > 0);
    }

    @Test
    void missingResourceErrorIsNeverServedAsHtml() throws Exception {
        TestPlugin plugin = new TestPlugin(null, false);
        CapturedResponse response = new CapturedResponse();

        plugin.handleBridgeServletGet(null, new Object[]{resourceRequest("hello.unknownext"), response.mock});

        verify(response.mock).setStatus(HttpServletResponse.SC_NOT_FOUND);
        verify(response.mock).setContentType("text/plain");
    }
}
