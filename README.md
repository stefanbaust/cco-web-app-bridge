# cco-web-app-bridge

[![Build](https://github.com/stefanbaust/cco-web-app-bridge/actions/workflows/build.yml/badge.svg)](https://github.com/stefanbaust/cco-web-app-bridge/actions/workflows/build.yml)
[![Maven Central](https://img.shields.io/maven-central/v/dev.baust.cco.webapp.bridge/cco-web-app-bridge)](https://central.sonatype.com/artifact/dev.baust.cco.webapp.bridge/cco-web-app-bridge)
[![License: LGPL v3](https://img.shields.io/badge/License-LGPL_v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)

Reusable bridge library for embedding web applications (SPAs) as iframes inside SAP Customer Checkout (CCO) NGUI plugins.

Provides an abstract base class and a templated JavaScript bridge that handles:

- Bidirectional communication between POS and iframe via `postMessage`
- RPC calls (receipt data, item selection, locale)
- POS event bus integration (push/subscribe events)
- HTTP proxy servlet for CORS bypass
- Plugin configuration via UI event channel
- Embedded and popup iframe modes
- Keyboard input forwarding

## Prefix mechanism

Multiple bridge-based plugins can run simultaneously without collisions. Each plugin defines a unique prefix that is applied to all shared identifiers (JS class names, iframe DOM IDs, event names, servlet actions, DynamicProperties keys).

The prefix is set in the concrete plugin's constructor:

```java
public class MyPlugin extends AbstractWebAppBridgePlugin {
    public MyPlugin() {
        super("MY");  // All identifiers will use "MY" as prefix
    }
}
```

Resolved identifiers for prefix `MY`:

| Identifier | Value |
|---|---|
| JS class | `Plugin.MYBridgePlugin` |
| Embedded iframe ID | `MY_iframe_embedded` |
| Popup iframe ID | `MY_iframe_popup` |
| Window ref | `window.MYBridgeRef` |
| DynamicProperties key | `MY_WEBVIEW_EMBEDDED` |
| Show popup event | `MY_SHOW_WEBVIEW` |
| Config event | `MY_GET_PLUGIN_CONFIG` |
| Servlet actions | `MYServlet`, `MYResource`, `MYConfig`, `MYProxy` |

Standard POS events (`SALESITEM_ADD`, `SHOW_MESSAGE`, `TOGGLE_KEYBOARD`, etc.) are not prefixed — they are global CCO events.

## Classloader

It is recommended to use the mechanism from CCO to have isolated classloaders. For this put the plugin in a subfolder called `CL_your-plugin-name`. 

## Usage

### 1. Add the dependency

```xml
<dependency>
    <groupId>dev.baust.cco.webapp.bridge</groupId>
    <artifactId>cco-web-app-bridge</artifactId>
    <version>0.1.3</version>
</dependency>
```

### 2. Create your plugin class

The concrete plugin class owns the CCO annotations and delegates to the base class:

```java
public class MyPlugin extends AbstractWebAppBridgePlugin {

    public MyPlugin() {
        super("MY");
    }

    @Override
    public String getId() { return "MyPlugin"; }

    @Override
    public String getName() { return "My Plugin"; }

    @JSInject(targetScreen = "NGUI")
    public InputStream[] jsInject() {
        return getBridgeJsInject();
    }

    @CSSInject(targetScreen = "NGUI")
    public InputStream[] cssInject() {
        return new InputStream[]{};
    }

    @ListenToExit(exitName = "PluginServlet.callback.get")
    public void pluginServletGet(Object caller, Object[] args) throws Exception {
        handleBridgeServletGet(caller, args);
    }

    @ListenToExit(exitName = "PluginServlet.callback.post")
    public void pluginServletPost(Object caller, Object[] args) throws Exception {
        handleBridgeServletPost(caller, args);
    }

    @ListenToExit(exitName = PluginExitPoints.TECH_CONTROLLER_UI_EVENT_CHANNEL)
    public void uiEventChannel(Object calledBy, Object[] args) {
        handleBridgeUiEventChannel(calledBy, args);
    }
}
```

### 3. Include the embedded view in NGUI

Add the component to a Quickselection or layout using DynamicProperties (replace `MY` with your prefix):

```json
{
  "complex": {
    "component": "ContainerComponent",
    "props": {
      "static": {},
      "dynamic": "#dynamicProperties:MY_WEBVIEW_EMBEDDED"
    }
  }
}
```

### 4. Open the popup from the iframe

From your iframe app, push the prefixed event:

```javascript
pos.pushEvent('MY_SHOW_WEBVIEW', {});
```

### 5. Use the iframe SDK

Include `pos-bridge-sdk.js` in your iframe app (it is bundled as a resource in this library):

```javascript
const pos = new POSBridge();
await pos.ready();

const receipt = await pos.getReceipt();
pos.on('receiptChanged', (receipt) => { /* ... */ });
pos.pushEvent('SHOW_MESSAGE', 'Hello from iframe!');
```

## Dynamic Store Access

The bridge provides a generic proxy API that lets iframe apps call any CCO store method and subscribe to store changes — without requiring bridge-side code changes per method.

### Basic usage

```javascript
const pos = new POSBridge();
await pos.ready();

const receipt = pos.store('ReceiptStore');
const model = await receipt.getReceiptModel();
const selected = await receipt.isItemSelected('key123');

const sales = pos.store('SalesStore');
const state = await sales.getCurrentState();
```

### Subscribe to store changes

```javascript
const receipt = pos.store('ReceiptStore');

receipt.subscribe((data) => {
  console.log('Store changed:', data.payload);
});

// Later: unsubscribe
receipt.unsubscribe();
```

The `subscribe()` callback receives an object with `{ store, payload }` where `store` is the store name and `payload` is the observer payload from CCO.

## Event Bus Handling

Iframe apps can subscribe to arbitrary CCO event bus events using `handleEvent()`. This goes beyond the curated events (`receiptChanged`, `selectedItem`) — any event type can be observed.

The optional `consume` flag controls whether the event is consumed (stops propagation to other plugins). Since `handleEvent()` on the CCO side is synchronous, the consume decision is declared at registration time, not per callback invocation.

### Basic usage

```javascript
const pos = new POSBridge();
await pos.ready();

// Observe an event without consuming it (default)
pos.handleEvent('SALESITEM_ADD', (payload) => {
  console.log('Item added:', payload);
});

// Handle an event and consume it (other plugins won't receive it)
pos.handleEvent('MY_CUSTOM_EVENT', (payload) => {
  console.log('Processing:', payload);
}, { consume: true });

// Stop handling an event
pos.removeEventHandler('MY_CUSTOM_EVENT');
```

### Notes

- Each event type can have one handler at a time. Calling `handleEvent()` again for the same event type replaces the previous registration.
- `handleEvent()` returns a Promise that resolves when the bridge has registered the handler.
- Events handled via `handleEvent()` are delivered through the same `POS_EVENT` mechanism as store subscriptions and curated events.
- The existing `WORKCENTER_LOADED` and prefix-specific `SHOW_WEBVIEW` handling runs first and is unaffected.

## Remote mode

The bridge supports embedding remote web apps that normally block iframe embedding (via `X-Frame-Options` or CSP `frame-ancestors`). The servlet proxies the entire remote app, strips anti-embedding headers, rewrites relative asset paths, and auto-injects `pos-bridge-sdk.js`.

### How it works

```
Browser iframe
  → PluginServlet?action={prefix}Servlet        (same URL as local mode)
    → fetches https://remote-app.example.com/index.html via OkHttp
    → strips X-Frame-Options, CSP headers
    → rewrites relative src/href to PluginServlet?action={prefix}Resource&path=...
    → injects <script src="...pos-bridge-sdk.js"> before </body>
  → PluginServlet?action={prefix}Resource&path=main.js
    → fetches https://remote-app.example.com/main.js via OkHttp
    → strips anti-embedding headers, forwards body
  → PluginServlet?action={prefix}Resource&path=pos-bridge-sdk.js
    → served from classpath (special case, always available)
```

### Enabling remote mode

Use the two-argument constructor:

```java
public class MyRemotePlugin extends AbstractWebAppBridgePlugin {
    public MyRemotePlugin() {
        super("MY", "https://my-remote-app.example.com");
    }
}
```

Override `getRemoteBaseUrl()` for dynamic configuration (e.g., from plugin properties):

```java
@Override
protected String getRemoteBaseUrl() {
    String url = getProperty("REMOTE_BASE_URL", "");
    return url.isEmpty() ? super.getRemoteBaseUrl() : url;
}
```

The iframe URL remains `PluginServlet?action={prefix}Servlet` in both modes — no changes needed in `cco-web-app-bridge.js` or `pos-bridge-sdk.js`.

### Limitations (remote mode)

| Limitation | Reason | Workaround |
|---|---|---|
| CSS `url()` references may break | Browser resolves relative `url()` against the proxy URL | Use absolute URLs for fonts/images in CSS |
| HTML5 History routing unsupported | Path-based navigation resolves against POS server | Use hash-based routing (`#/route`) |
| Service Workers unsupported | SW scope is tied to the servlet path | N/A |
| Relative `fetch()` calls | Resolve against proxy URL, not remote server | Use absolute URLs or POS proxy via `pushEvent` |

## Build

```bash
mvn clean install
```

Produces a library JAR containing `AbstractWebAppBridgePlugin.class`, `cco-web-app-bridge.js` (templated), and `pos-bridge-sdk.js`.

## Security

### Choosing a Deployment Mode

**Use embedded (local) mode for production deployments.** It provides significantly stronger security:

| Aspect | Embedded (local) | Remote |
|---|---|---|
| Content integrity | Bundled in plugin JAR; immutable after deployment | Fetched at runtime; can change without POS update |
| Network exposure | No external dependency at runtime | Requires network access to remote server |
| MITM risk | None | Possible if TLS misconfigured or HTTP used |
| Trust boundary | Plugin author controls all code | External server is additional trust relationship |
| Update control | Requires explicit plugin redeployment | Remote app can change independently |
| Security headers | N/A (same origin) | Stripped — removes upstream CSP/X-Frame-Options |

Remote mode is appropriate for:
- Trusted internal applications on secure networks with TLS

Remote mode is **not appropriate** for:
- Untrusted third-party applications
- Apps hosted on shared infrastructure
- Production deployments over plain HTTP

### HTTPS Enforcement

When `DEVMODE=false` (production), the library enforces HTTPS for:
- All proxy target URLs (`{PREFIX}Proxy` endpoint)
- The remote base URL (remote mode resource fetching)

HTTP is only permitted when `DEVMODE=true`. This prevents man-in-the-middle injection of malicious code.

### SSRF Protection

The proxy endpoint (`{PREFIX}Proxy`) validates all target URLs before making server-side requests. The following are blocked:

- **Loopback addresses** — 127.0.0.0/8, ::1
- **Private/site-local networks** — 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
- **Link-local addresses** — 169.254.0.0/16, fe80::/10
- **Cloud metadata endpoints** — 169.254.169.254, metadata.google.internal
- **Multicast addresses**
- **Non-HTTP(S) schemes** — file://, ftp://, etc.

If your iframe app needs access to an internal service, expose it through a dedicated RPC handler rather than using the generic proxy.

### Origin Validation

The bridge extracts the expected origin from the iframe URL at setup time. All incoming `postMessage` events are checked against this origin. Messages from unexpected origins are dropped silently.

### iframe Sandbox

All iframes are created with:

```html
sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
```

This blocks top-level navigation, plugins, pointer lock, and fullscreen. Note that `allow-same-origin` is required because content is served through `PluginServlet` (same origin as the POS). This means **any code running in the iframe has same-origin access** — only trusted code should run there.

### Developer Recommendations

1. **Prefer embedded mode**
2. **Never enable `DEVMODE` in production** — it disables HTTPS enforcement and loads from localhost
3. **Keep your remote app behind TLS** with a valid certificate if using remote mode
4. **Do not serve user-generated content** from your iframe without XSS sanitization — CSP is stripped in remote mode

### Accepted Architectural Risks

These are inherent to the approach and cannot be fully eliminated:

- **Same-origin iframe content**: Content served via `PluginServlet` runs in the POS origin. XSS in the iframe app gives access to all POS data exposed through the bridge.
- **Security header stripping** (remote mode): `X-Frame-Options` must be removed for embedding. CSP from the remote app is also stripped.
- **Plugin JS in POS context**: `cco-web-app-bridge.js` runs in the POS parent window with full access to DOM, event bus, and stores. A compromised plugin JAR means full POS compromise. Mitigate with code review and supply chain security.
- **postMessage is broadcast**: Any script in the parent window can observe messages. Channel isolation prevents cross-plugin interference but does not provide confidentiality.

## Demos

- **Local mode**: See [cco-web-app-bridge-demo-foodinfo](https://github.com/stefanbaust/cco-web-app-bridge-demo-foodinfo) — Angular app bundled in the JAR
