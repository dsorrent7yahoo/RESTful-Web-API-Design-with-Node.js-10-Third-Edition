import { Component, OnInit } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent implements OnInit {
  constructor(private router: Router, private auth: AuthService) {}

  ngOnInit(): void {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('sso');
    if (ssoToken) {
      // Token was already saved by APP_INITIALIZER before the guard ran.
      // Now hydrate the AuthService signal and strip the token from the URL.
      try {
        const b64 = ssoToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(b64));
        if (payload.exp * 1000 > Date.now()) {
          this.auth.currentUser.set({
            email:    payload.sub ?? payload.email ?? '',
            username: payload.username ?? payload.name ?? payload.sub ?? '',
          });
        }
      } catch { /* invalid token — guard already blocked it */ }
      // Replace the URL to remove the ?sso= param, then navigate to dashboard
      this.router.navigate(['/dashboard'], { replaceUrl: true });
    }
  }
}
