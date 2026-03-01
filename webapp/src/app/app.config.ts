import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withHashLocation, Routes } from '@angular/router';
import { registerLocaleData } from '@angular/common';
import { proxyInterceptor } from './shared/proxy.interceptor';
import localeDe from '@angular/common/locales/de';
import localeEn from '@angular/common/locales/en';
import localeFr from '@angular/common/locales/fr';
import { PopupComponent } from './popup/popup';
import { EmbeddedComponent } from './embedded/embedded';

registerLocaleData(localeDe);
registerLocaleData(localeEn);
registerLocaleData(localeFr);

const routes: Routes = [
  { path: 'popup', component: PopupComponent },
  { path: 'embedded', component: EmbeddedComponent },
  { path: '**', redirectTo: 'popup' },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withHashLocation()),
    provideHttpClient(withInterceptors([proxyInterceptor])),
  ]
};
