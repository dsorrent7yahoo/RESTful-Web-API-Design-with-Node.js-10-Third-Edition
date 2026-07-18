import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthService } from '../../services/auth.service';
import { MICROSERVICE_URLS, BACKEND_PRESETS } from '../../services/api.service';

const PRESET_ENDPOINTS: Record<string, { method: string; path: string }[]> = {
  '/medications/':     [{ method: 'GET', path: '/medications/?limit=50' }],
  '/tables':           [{ method: 'GET', path: '/tables' }],
  '/health':           [{ method: 'GET', path: '/health' }],
  '/auth/me':          [{ method: 'GET', path: '/auth/me' }],
  '/athena/databases': [{ method: 'GET', path: '/athena/databases' }],
  '/athena/tables':    [{ method: 'GET', path: '/athena/tables' }],
  '/sqs/stats':        [{ method: 'GET', path: '/sqs/stats' }],
  '/claims/files':     [{ method: 'GET', path: '/claims/files' }],
};

@Component({
  selector: 'app-api-explorer',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatInputModule, MatFormFieldModule,
    MatSelectModule, MatIconModule, MatProgressBarModule,
  ],
  templateUrl: './api-explorer.component.html',
  styleUrl: './api-explorer.component.scss',
})
export class ApiExplorerComponent {
  @Input() baseUrl = '';
  @Input() microservicesOn = true;

  method     = signal('GET');
  path       = signal('/medications/?limit=50');
  body       = signal('');
  response   = signal('');
  status     = signal(0);
  loading    = signal(false);
  targetUrl  = signal('backend');

  methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
  presetKeys = Object.keys(PRESET_ENDPOINTS);
  microKeys  = Object.keys(MICROSERVICE_URLS);
  microUrls  = MICROSERVICE_URLS;

  constructor(private http: HttpClient, private auth: AuthService) {}

  get effectiveBaseUrl(): string {
    const t = this.targetUrl();
    if (t === 'backend') return this.baseUrl;
    return MICROSERVICE_URLS[t] ?? this.baseUrl;
  }

  send(): void {
    this.loading.set(true);
    this.response.set('');
    this.status.set(0);
    const url = this.effectiveBaseUrl + this.path();
    let obs$;
    const opts = { observe: 'response' as const };
    if (['POST', 'PUT', 'PATCH'].includes(this.method())) {
      let parsedBody: any = {};
      try { parsedBody = JSON.parse(this.body() || '{}'); } catch {}
      obs$ = this.http.request(this.method(), url, { body: parsedBody, observe: 'response' });
    } else {
      obs$ = this.http.request(this.method(), url, { observe: 'response' });
    }
    obs$.subscribe({
      next: (res: any) => {
        this.status.set(res.status);
        this.response.set(JSON.stringify(res.body, null, 2));
        this.loading.set(false);
      },
      error: (err: any) => {
        this.status.set(err.status ?? 0);
        this.response.set(JSON.stringify(err.error ?? { error: err.message }, null, 2));
        this.loading.set(false);
      },
    });
  }

  applyPreset(p: string): void {
    const endpoints = PRESET_ENDPOINTS[p];
    if (endpoints?.length) {
      this.method.set(endpoints[0].method);
      this.path.set(endpoints[0].path);
    }
  }

  get statusClass(): string {
    const s = this.status();
    if (s >= 200 && s < 300) return 'status-200';
    if (s >= 400 && s < 500) return 'status-4xx';
    if (s >= 500) return 'status-5xx';
    return '';
  }
}
