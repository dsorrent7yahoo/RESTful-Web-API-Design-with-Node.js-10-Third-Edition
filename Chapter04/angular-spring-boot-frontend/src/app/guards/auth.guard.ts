import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isLoggedIn()) return true;
  // No valid token — send back to the landing page portal for login
  const landingPage = window.location.hostname === 'localhost'
    ? 'http://localhost:5180'
    : `http://${window.location.hostname}`;
  window.location.href = landingPage;
  return false;
};
