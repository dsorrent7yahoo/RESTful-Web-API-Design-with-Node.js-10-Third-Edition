import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

@Component({
  selector: 'app-sqs-monitor',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTabsModule, MatSlideToggleModule],
  templateUrl: './sqs-monitor.component.html',
  styleUrl: './sqs-monitor.component.scss',
})
export class SqsMonitorComponent implements OnInit, OnDestroy {
  @Input() baseUrl = 'http://localhost:4013';
  @Output() closed = new EventEmitter<void>();

  stats     = signal<any>(null);
  dlqStats  = signal<any>(null);
  emailLog  = signal<any[]>([]);
  messages  = signal<any[]>([]);
  loading   = signal(false);
  autoRefresh = signal(false);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void { this.refresh(); }

  ngOnDestroy(): void { this.stopAutoRefresh(); }

  refresh(): void {
    this.loading.set(true);
    const base = this.baseUrl;
    Promise.all([
      this.http.get<any>(`${base}/sqs/stats`).toPromise(),
      this.http.get<any>(`${base}/sqs/dlq/stats`).toPromise(),
      this.http.get<any>(`${base}/sqs/email-log`).toPromise(),
    ]).then(([stats, dlq, log]) => {
      this.stats.set(stats);
      this.dlqStats.set(dlq);
      this.emailLog.set(log?.items ?? []);
      this.loading.set(false);
    }).catch(() => this.loading.set(false));
  }

  purge(): void {
    if (!confirm('Purge all messages from the queue?')) return;
    this.http.delete(`${this.baseUrl}/sqs/messages`).subscribe({
      next: () => this.refresh(),
    });
  }

  toggleAutoRefresh(enabled: boolean): void {
    this.autoRefresh.set(enabled);
    if (enabled) {
      this.refreshTimer = setInterval(() => this.refresh(), 5000);
    } else {
      this.stopAutoRefresh();
    }
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }
}
