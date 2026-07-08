import { Component, Input, Output, EventEmitter, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';

@Component({
  selector: 'app-sqs-monitor',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTabsModule],
  templateUrl: './sqs-monitor.component.html',
  styleUrl: './sqs-monitor.component.scss',
})
export class SqsMonitorComponent implements OnInit {
  @Input() baseUrl = 'http://localhost:4013';
  @Output() closed = new EventEmitter<void>();

  stats     = signal<any>(null);
  dlqStats  = signal<any>(null);
  emailLog  = signal<any[]>([]);
  messages  = signal<any[]>([]);
  loading   = signal(false);

  constructor(private http: HttpClient) {}

  ngOnInit(): void { this.refresh(); }

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
}
