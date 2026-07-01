import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ApiService, BACKEND_PRESETS, MICROSERVICE_URLS } from '../../services/api.service';
import { MedicationsComponent } from '../medications/medications.component';
import { ApiExplorerComponent } from '../api-explorer/api-explorer.component';
import { SqsMonitorComponent } from '../sqs-monitor/sqs-monitor.component';
import { ClaimsComponent } from '../claims/claims.component';
import { AthenaComponent } from '../athena/athena.component';
import { GlueUploaderComponent } from '../glue-uploader/glue-uploader.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatToolbarModule, MatButtonModule, MatIconModule,
    MatTabsModule, MatCardModule, MatSelectModule,
    MatFormFieldModule, MatChipsModule, MatDialogModule,
    MedicationsComponent, ApiExplorerComponent,
    SqsMonitorComponent, ClaimsComponent, AthenaComponent, GlueUploaderComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  selectedBackend = signal<string>('cmdline');
  microservicesOn = signal<boolean>(true);
  tables          = signal<string[]>([]);
  tablesLoading   = signal<boolean>(false);
  healthStatus    = signal<'ok' | 'error' | 'loading'>('loading');

  showSqsMonitor  = signal(false);
  showClaims      = signal(false);
  showAthena      = signal(false);
  showGlue        = signal(false);

  backendPresets = BACKEND_PRESETS;
  presetKeys = Object.keys(BACKEND_PRESETS);
  microUrls  = MICROSERVICE_URLS;
  serviceHealth: Record<string, 'ok' | 'error' | 'loading' | undefined> = {};

  constructor(
    public auth: AuthService,
    public api: ApiService,
    private http: HttpClient,
  ) {
    // Mirror whichever preset key was chosen on the login page
    this.selectedBackend = signal<string>(api.selectedPreset());
  }

  ngOnInit(): void {
    this.checkHealth();
    this.loadTables();
    if (this.microservicesOn()) this.checkMicroservices();
  }

  onBackendChange(key: string): void {
    const url = BACKEND_PRESETS[key] ?? key;
    this.api.setBaseUrl(url);
    this.checkHealth();
    this.loadTables();
  }

  toggleMicroservices(): void {
    this.microservicesOn.update(v => !v);
    if (this.microservicesOn()) this.checkMicroservices();
  }

  checkHealth(): void {
    this.healthStatus.set('loading');
    this.api.health().subscribe({
      next: () => this.healthStatus.set('ok'),
      error: () => this.healthStatus.set('error'),
    });
  }

  loadTables(): void {
    this.tablesLoading.set(true);
    this.api.getTables().subscribe({
      next: (res: any) => { this.tables.set(res.tables ?? []); this.tablesLoading.set(false); },
      error: () => this.tablesLoading.set(false),
    });
  }

  checkMicroservices(): void {
    Object.entries(MICROSERVICE_URLS).forEach(([key, url]) => {
      this.serviceHealth[key] = 'loading';
      this.http.get(`${url}/health`).subscribe({
        next: () => this.serviceHealth[key] = 'ok',
        error: () => this.serviceHealth[key] = 'error',
      });
    });
  }

  logout(): void {
    this.auth.logout(this.api.baseUrl());
  }

  get currentUrl(): string { return this.api.baseUrl(); }
}
