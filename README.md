# Web App Bridge (Experiment)

```javascript
ccoEventBus.push('SB_SHOW_WEBVIEW', {'type': 'error', 'message': 'Hello World'});
```

## Include the WebView in Quickselection
```
{
  "complex": {
    "component": "ContainerComponent",
    "props": {
      "static": {},
      "dynamic": "#dynamicProperties:SB_WEBVIEW_EMBEDDED"
    }
  }
}
```

## 
