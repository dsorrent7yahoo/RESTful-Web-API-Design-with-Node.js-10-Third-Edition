import { ApplicationConfig, APP_INITIALIZER, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { jwtInterceptor } from './interceptors/jwt.interceptor';

const TOKEN_KEY = 'healthCareToken';

/**
 * Runs synchronously before the router starts its initial navigation.
 * If the URL contains ?sso=<token>, store it in localStorage so the
 * authGuard can read it during the very first canActivate check.
 */
function ssoInitializer(): () => void {
  return () => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('sso');
    if (ssoToken) {
      localStorage.setItem(TOKEN_KEY, ssoToken);
    }
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([jwtInterceptor])),
    { provide: APP_INITIALIZER, useFactory: ssoInitializer, multi: true },
  ],
};
