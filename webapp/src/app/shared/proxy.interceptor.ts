import { HttpInterceptorFn } from '@angular/common/http';

export const proxyInterceptor: HttpInterceptorFn = (req, next) => {
  const inPOS = window.location.pathname.includes('PluginServlet');
  const isExternal = req.url.startsWith('http');

  if (!inPOS || !isExternal) {
    return next(req);
  }

  const proxyUrl = `${window.location.origin}${window.location.pathname}?action=webAppProxy`;

  const proxyReq = req.clone({
    method: 'POST',
    url: proxyUrl,
    body: {
      url: req.url,
      method: req.method,
      headers: {} as Record<string, string>,
      body: req.body ? JSON.stringify(req.body) : '',
    },
  });

  return next(proxyReq);
};
