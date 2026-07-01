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
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

@Component({
  selector: 'app-glue-uploader',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatTabsModule, MatInputModule, MatFormFieldModule,
    MatSelectModule, MatExpansionModule, MatChipsModule, MatSnackBarModule,
  ],
  templateUrl: './glue-uploader.component.html',
  styleUrl: './glue-uploader.component.scss',
})
export class GlueUploaderComponent implements OnInit {
  @Input() baseUrl = '';
  @Output() closed = new EventEmitter<void>();

  // S3 state
  buckets      = signal<string[]>([]);
  selectedBucket = signal('dgs-glue-staging');
  s3Prefix     = signal('');
  s3Objects    = signal<any[]>([]);

  // Glue state
  databases    = signal<string[]>([]);
  selectedDb   = signal('fhir-table-db');
  glueTables   = signal<any[]>([]);

  // Upload state
  uploadFile   = signal<File | null>(null);
  uploadTable  = signal('');
  uploadPrefix = signal('fhir/');

  // Pipeline state
  pipelineBucket = signal('dgs-glue-staging');
  pipelinePrefix = signal('fhir/');

  loading      = signal(false);
  result       = signal<any>(null);

  constructor(private http: HttpClient, private snack: MatSnackBar) {}

  ngOnInit(): void {
    this.loadBuckets();
    this.loadDatabases();
  }

  loadBuckets(): void {
    this.http.get<any>(`${this.baseUrl}/export/s3/buckets`).subscribe({
      next: r => this.buckets.set(r.buckets ?? []),
      error: () => {},
    });
  }

  loadDatabases(): void {
    this.http.get<any>(`${this.baseUrl}/export/glue/databases`).subscribe({
      next: r => this.databases.set(r.databases ?? []),
      error: () => {},
    });
  }

  listObjects(): void {
    this.loading.set(true);
    const bucket = this.selectedBucket();
    const prefix = this.s3Prefix();
    const params: any = {};
    if (prefix) params.prefix = prefix;
    this.http.get<any>(`${this.baseUrl}/export/s3/${bucket}/objects`, { params }).subscribe({
      next: r => { this.s3Objects.set(r.objects ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  loadGlueTables(): void {
    this.loading.set(true);
    const db = this.selectedDb();
    this.http.get<any>(`${this.baseUrl}/export/glue/databases/${db}/tables`).subscribe({
      next: r => { this.glueTables.set(r.tables ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.uploadFile.set(input.files[0]);
      if (!this.uploadTable()) {
        const name = input.files[0].name.replace(/\.csv$/i, '');
        this.uploadTable.set(name);
      }
    }
  }

  exportToS3(): void {
    const file = this.uploadFile();
    if (!file) { this.snack.open('Select a CSV file first', '', { duration: 2000 }); return; }
    this.loading.set(true);
    const reader = new FileReader();
    reader.onload = () => {
      const content = (reader.result as string).split(',')[1] ?? reader.result as string;
      this.http.post<any>(`${this.baseUrl}/export/s3`, {
        table: this.uploadTable(),
        bucket: this.selectedBucket(),
        prefix: this.uploadPrefix(),
        filename: file.name,
        content,
      }).subscribe({
        next: r => {
          this.result.set(r);
          this.loading.set(false);
          this.snack.open('Exported to S3 ✓', '', { duration: 3000 });
        },
        error: err => {
          this.result.set(err.error);
          this.loading.set(false);
          this.snack.open('Export failed', '', { duration: 3000 });
        },
      });
    };
    reader.readAsDataURL(file);
  }

  registerGlueTable(): void {
    const file = this.uploadFile();
    if (!this.uploadTable()) { this.snack.open('Enter a table name', '', { duration: 2000 }); return; }
    this.loading.set(true);
    this.http.post<any>(`${this.baseUrl}/export/glue`, {
      database: this.selectedDb(),
      table_name: this.uploadTable(),
      bucket: this.selectedBucket(),
      key: `${this.uploadPrefix()}${file?.name ?? this.uploadTable() + '.csv'}`,
    }).subscribe({
      next: r => {
        this.result.set(r);
        this.loading.set(false);
        this.snack.open('Glue table registered ✓', '', { duration: 3000 });
        this.loadGlueTables();
      },
      error: err => {
        this.result.set(err.error);
        this.loading.set(false);
        this.snack.open('Registration failed', '', { duration: 3000 });
      },
    });
  }

  runPipeline(): void {
    if (!confirm('Export all DynamoDB tables to S3 and register in Glue? This may take several minutes.')) return;
    this.loading.set(true);
    this.result.set(null);
    this.http.post<any>(`${this.baseUrl}/export/pipeline/all`, {
      bucket: this.pipelineBucket(),
      prefix: this.pipelinePrefix(),
    }).subscribe({
      next: r => {
        this.result.set(r);
        this.loading.set(false);
        this.snack.open('Pipeline complete ✓', '', { duration: 4000 });
      },
      error: err => {
        this.result.set(err.error);
        this.loading.set(false);
        this.snack.open('Pipeline failed', '', { duration: 3000 });
      },
    });
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }
}
