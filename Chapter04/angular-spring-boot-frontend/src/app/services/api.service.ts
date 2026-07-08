import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export const BACKEND_PRESETS: Record<string, string> = {
  cmdline: 'http://localhost:4003',
  docker:  'http://localhost:4003',
  aws:     'http://sorrentino-fargate-fhir-demo-alb-1996236158.us-east-1.elb.amazonaws.com',
};

export const MICROSERVICE_URLS: Record<string, string> = {
  glueCatalog:        'http://localhost:4010',
  claimsGenerator:    'http://localhost:4011',
  claimsCleaner:      'http://localhost:4012',
  sqsMonitor:         'http://localhost:4013',
  athenaClient:       'http://localhost:4014',
  patientsEncounters: 'http://localhost:4015',
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  baseUrl = signal<string>(BACKEND_PRESETS['cmdline']);
  microservicesMode = signal<boolean>(true);

  constructor(private http: HttpClient) {}

  setBaseUrl(url: string): void { this.baseUrl.set(url); }

  get<T>(path: string, params?: Record<string, string | number>): Observable<T> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') {
          httpParams = httpParams.set(k, String(v));
        }
      });
    }
    return this.http.get<T>(`${this.baseUrl()}${path}`, { params: httpParams });
  }

  post<T>(path: string, body: unknown, baseUrl?: string): Observable<T> {
    return this.http.post<T>(`${baseUrl ?? this.baseUrl()}${path}`, body);
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${this.baseUrl()}${path}`, body);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl()}${path}`);
  }

  raw<T>(method: string, url: string, body?: unknown): Observable<T> {
    return this.http.request<T>(method, url, { body });
  }

  getTables(): Observable<any> { return this.get('/tables'); }

  health(): Observable<any> { return this.get('/health'); }
}
