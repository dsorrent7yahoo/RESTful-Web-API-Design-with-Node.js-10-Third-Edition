import { Component, Input, Output, EventEmitter, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';

@Component({
  selector: 'app-claims',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTabsModule],
  templateUrl: './claims.component.html',
  styleUrl: './claims.component.scss',
})
export class ClaimsComponent implements OnInit {
  @Input() generatorUrl = 'http://localhost:4011';
  @Input() cleanerUrl   = 'http://localhost:4012';
  @Output() closed = new EventEmitter<void>();

  files       = signal<any[]>([]);
  parquetFiles = signal<any[]>([]);
  loading     = signal(false);
  genResult   = signal<any>(null);
  cleanResult = signal<any>(null);

  constructor(private http: HttpClient) {}

  ngOnInit(): void { this.loadFiles(); }

  loadFiles(): void {
    this.loading.set(true);
    Promise.all([
      this.http.get<any>(`${this.generatorUrl}/claims/files`).toPromise(),
      this.http.get<any>(`${this.cleanerUrl}/claims/parquet-files`).toPromise(),
    ]).then(([csv, parquet]) => {
      this.files.set(csv?.files ?? []);
      this.parquetFiles.set(parquet?.files ?? []);
      this.loading.set(false);
    }).catch(() => this.loading.set(false));
  }

  generate(): void {
    this.loading.set(true);
    this.http.post<any>(`${this.generatorUrl}/claims/generate`, {}).subscribe({
      next: res => { this.genResult.set(res); this.loading.set(false); this.loadFiles(); },
      error: err => { this.genResult.set({ error: err.error }); this.loading.set(false); },
    });
  }

  clean(key: string): void {
    this.loading.set(true);
    this.http.post<any>(`${this.cleanerUrl}/claims/clean`, { key }).subscribe({
      next: res => { this.cleanResult.set(res); this.loading.set(false); this.loadFiles(); },
      error: err => { this.cleanResult.set({ error: err.error }); this.loading.set(false); },
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
}
