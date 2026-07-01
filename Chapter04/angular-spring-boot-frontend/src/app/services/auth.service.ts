import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

const TOKEN_KEY = 'healthCareToken';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<{ email: string; username: string } | null>(null);

  constructor(private http: HttpClient, private router: Router) {
    const token = this.getToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          this.currentUser.set({ email: payload.sub, username: payload.username });
        } else {
          this.clearToken();
        }
      } catch { this.clearToken(); }
    }
  }

  login(email: string, password: string, baseUrl: string): Observable<any> {
    return this.http.post<any>(`${baseUrl}/auth/login`, { email, password }).pipe(
      tap(res => {
        localStorage.setItem(TOKEN_KEY, res.accessToken);
        this.currentUser.set({ email: res.user.email, username: res.user.username });
      })
    );
  }

  logout(baseUrl: string): void {
    this.http.post(`${baseUrl}/auth/logout`, {}).subscribe({ error: () => {} });
    this.clearToken();
    this.router.navigate(['/login']);
  }

  getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }

  isLoggedIn(): boolean {
    const token = this.getToken();
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch { return false; }
  }

  private clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.currentUser.set(null);
  }
}
