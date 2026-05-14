# cco-web-app-bridge

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

## Usage

### 1. Add the dependency

```xml
<dependency>
    <groupId>dev.baust.cco.webapp.bridge</groupId>
    <artifactId>cco-web-app-bridge</artifactId>
    <version>1.0-SNAPSHOT</version>
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

## Build

```bash
mvn clean install
```

Produces a library JAR containing `AbstractWebAppBridgePlugin.class`, `cco-web-app-bridge.js` (templated), and `pos-bridge-sdk.js`.

## Demo

See [cco-web-app-bridge-demo](https://github.com/stefanbaust/cco-web-app-bridge-demo) for a working example plugin with an Angular frontend.
