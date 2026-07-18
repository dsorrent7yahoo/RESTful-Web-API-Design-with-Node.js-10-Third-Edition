import { Component, Input, Output, EventEmitter, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

@Component({
  selector: 'app-athena',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTabsModule, MatInputModule, MatFormFieldModule, MatSelectModule,
  ],
  templateUrl: './athena.component.html',
  styleUrl: './athena.component.scss',
})
export class AthenaComponent implements OnInit {
  @Input() baseUrl = 'http://localhost:4014';
  @Output() closed = new EventEmitter<void>();

  databases    = signal<string[]>([]);
  tables       = signal<string[]>([]);
  schema       = signal<Record<string, any[]>>({});
  selectedDb   = signal('fhir-table-db');
  selectedTbl  = signal('');
  sql          = signal('SELECT * FROM claims_clean LIMIT 10;');
  queryResult  = signal<any>(null);
  loading      = signal(false);

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadDatabases();
    this.loadTables();
  }

  loadDatabases(): void {
    this.http.get<any>(`${this.baseUrl}/athena/databases`).subscribe({
      next: r => this.databases.set(r.databases ?? []),
    });
  }

  loadTables(): void {
    this.http.get<any>(`${this.baseUrl}/athena/tables`,
      { params: { database: this.selectedDb() } }).subscribe({
      next: r => this.tables.set(r.tables ?? []),
    });
  }

  selectTable(tbl: string): void {
    this.selectedTbl.set(tbl);
    this.sql.set(`SELECT * FROM ${tbl} LIMIT 10;`);
  }

  execute(): void {
    this.loading.set(true);
    this.queryResult.set(null);
    this.http.post<any>(`${this.baseUrl}/athena/query`,
      { sql: this.sql(), database: this.selectedDb() }).subscribe({
      next: res => { this.queryResult.set(res); this.loading.set(false); },
      error: err => { this.queryResult.set({ error: err.error }); this.loading.set(false); },
    });
  }

  get resultColumns(): string[] {
    return this.queryResult()?.columns ?? [];
  }

  get resultRows(): any[] {
    return this.queryResult()?.rows ?? [];
  }
}
