import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatChipsModule } from '@angular/material/chips';
import { AuthService } from '../../services/auth.service';
import { MICROSERVICE_URLS } from '../../services/api.service';

export interface Endpoint {
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  desc: string;
  defaultBody?: string;
}

export interface EndpointGroup {
  group: string;
  icon: string;
  endpoints: Endpoint[];
}

const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    group: 'System', icon: '⚙️',
    endpoints: [
      { label: 'Health Check',   method: 'GET',    path: '/health',   desc: 'Check if the API is online' },
      { label: 'Current User',   method: 'GET',    path: '/auth/me',  desc: 'Get the logged-in user profile' },
      { label: 'List Tables',    method: 'GET',    path: '/tables',   desc: 'List all DynamoDB tables' },
    ],
  },
  {
    group: 'Medications', icon: '💊',
    endpoints: [
      { label: 'List Medications',   method: 'GET',  path: '/medications/?limit=50', desc: 'Paginated list of medications' },
      { label: 'Get Medication',     method: 'GET',  path: '/medications/ITEM_ID',   desc: 'Fetch a single medication by ID' },
      { label: 'Create Medication',  method: 'POST', path: '/medications/',           desc: 'Create a new medication record',
        defaultBody: JSON.stringify({ patient: '', code: '', description: '', baseCost: 0 }, null, 2) },
      { label: 'Update Medication',  method: 'PUT',  path: '/medications/ITEM_ID',    desc: 'Update an existing medication',
        defaultBody: JSON.stringify({ description: '', baseCost: 0 }, null, 2) },
      { label: 'Delete Medication',  method: 'DELETE', path: '/medications/ITEM_ID',  desc: 'Delete a medication by ID' },
    ],
  },
  {
    group: 'Claims', icon: '🏥',
    endpoints: [
      { label: 'List CSV Files',   method: 'GET',  path: '/claims/files',        desc: 'List CSV files in S3 staging bucket' },
      { label: 'Generate Claims',  method: 'POST', path: '/claims/generate',     desc: 'Invoke Lambda to generate synthetic FHIR claims',
        defaultBody: '{}' },
      { label: 'Clean Claims',     method: 'POST', path: '/claims/clean',        desc: 'Run claims cleaner Lambda on the latest CSV',
        defaultBody: '{}' },
      { label: 'Process All',      method: 'POST', path: '/claims/process-all',  desc: 'Clean all CSVs and delete originals',
        defaultBody: '{}' },
    ],
  },
  {
    group: 'Athena', icon: '🗄',
    endpoints: [
      { label: 'List Databases',  method: 'GET',  path: '/athena/databases',      desc: 'List all Glue/Athena databases' },
      { label: 'List Tables',     method: 'GET',  path: '/athena/tables',         desc: 'List tables in the default database' },
      { label: 'Run Query',       method: 'POST', path: '/athena/query',          desc: 'Execute a SQL query via Athena',
        defaultBody: JSON.stringify({ sql: 'SELECT * FROM claims_clean LIMIT 10', database: 'fhir-table-db' }, null, 2) },
      { label: 'AI Generate SQL', method: 'POST', path: '/athena/generate-sql',   desc: 'Use Amazon Bedrock to write SQL from a natural language prompt',
        defaultBody: JSON.stringify({ prompt: 'Show me the top 10 patients by claim count', database: 'fhir-table-db' }, null, 2) },
    ],
  },
  {
    group: 'SQS', icon: '📬',
    endpoints: [
      { label: 'Queue Stats',    method: 'GET',    path: '/sqs/stats',      desc: 'Number of messages in the main queue' },
      { label: 'DLQ Stats',      method: 'GET',    path: '/sqs/dlq/stats',  desc: 'Number of messages in the dead-letter queue' },
      { label: 'Email Log',      method: 'GET',    path: '/sqs/email-log',  desc: 'Processed email notification log' },
      { label: 'Purge Queue',    method: 'DELETE', path: '/sqs/messages',   desc: 'Delete all messages from the queue' },
    ],
  },
  {
    group: 'S3 & Glue', icon: '☁️',
    endpoints: [
      { label: 'List S3 Buckets',      method: 'GET',  path: '/export/s3/buckets',                            desc: 'List all S3 buckets in the account' },
      { label: 'List S3 Objects',      method: 'GET',  path: '/export/s3/dgs-glue-staging/objects',          desc: 'List objects in an S3 bucket (edit bucket name in path)' },
      { label: 'Export Table to S3',   method: 'POST', path: '/export/s3',                                    desc: 'Scan a DynamoDB table and write CSV to S3',
        defaultBody: JSON.stringify({ table: 'medications', bucket: 'dgs-glue-staging', prefix: 'fhir/' }, null, 2) },
      { label: 'List Glue Databases',  method: 'GET',  path: '/export/glue/databases',                        desc: 'List Glue catalog databases' },
      { label: 'List Glue Tables',     method: 'GET',  path: '/export/glue/databases/fhir-table-db/tables',  desc: 'List tables in a Glue database (edit name in path)' },
      { label: 'Register Glue Table',  method: 'POST', path: '/export/glue',                                  desc: 'Register an S3 CSV as a Glue external table',
        defaultBody: JSON.stringify({ database: 'fhir-table-db', table_name: 'my_table', bucket: 'dgs-glue-staging', key: 'fhir/my_table.csv' }, null, 2) },
      { label: 'Run Full Pipeline',    method: 'POST', path: '/export/pipeline/all',                          desc: 'Export ALL DynamoDB tables to S3 and register each in Glue',
        defaultBody: JSON.stringify({ bucket: 'dgs-glue-staging', prefix: 'fhir/' }, null, 2) },
    ],
  },
];

@Component({
  selector: 'app-api-explorer',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatButtonModule, MatInputModule, MatFormFieldModule,
    MatSelectModule, MatIconModule, MatProgressBarModule, MatChipsModule,
  ],
  templateUrl: './api-explorer.component.html',
  styleUrl: './api-explorer.component.scss',
})
export class ApiExplorerComponent {
  @Input() baseUrl = '';
  @Input() microservicesOn = true;

  // Modal state
  activeEndpoint = signal<Endpoint | null>(null);
  modalPath      = signal('');
  modalBody      = signal('');
  modalTarget    = signal('backend');
  modalResponse  = signal('');
  modalStatus    = signal(0);
  loading        = signal(false);

  groups   = ENDPOINT_GROUPS;
  microKeys = Object.keys(MICROSERVICE_URLS);
  microUrls = MICROSERVICE_URLS;

  constructor(private http: HttpClient, private auth: AuthService) {}

  openEndpoint(ep: Endpoint): void {
    this.activeEndpoint.set(ep);
    this.modalPath.set(ep.path);
    this.modalBody.set(ep.defaultBody ?? '');
    this.modalResponse.set('');
    this.modalStatus.set(0);
  }

  closeModal(): void {
    this.activeEndpoint.set(null);
    this.loading.set(false);
  }

  get effectiveBaseUrl(): string {
    const t = this.modalTarget();
    if (t === 'backend') return this.baseUrl;
    return MICROSERVICE_URLS[t] ?? this.baseUrl;
  }

  send(): void {
    const ep = this.activeEndpoint();
    if (!ep) return;
    this.loading.set(true);
    this.modalResponse.set('');
    this.modalStatus.set(0);
    const url = this.effectiveBaseUrl + this.modalPath();
    let obs$;
    if (['POST', 'PUT', 'PATCH'].includes(ep.method)) {
      let parsedBody: any = {};
      try { parsedBody = JSON.parse(this.modalBody() || '{}'); } catch {}
      obs$ = this.http.request(ep.method, url, { body: parsedBody, observe: 'response' });
    } else {
      obs$ = this.http.request(ep.method, url, { observe: 'response' });
    }
    obs$.subscribe({
      next: (res: any) => {
        this.modalStatus.set(res.status);
        this.modalResponse.set(JSON.stringify(res.body, null, 2));
        this.loading.set(false);
      },
      error: (err: any) => {
        this.modalStatus.set(err.status ?? 0);
        this.modalResponse.set(JSON.stringify(err.error ?? { error: err.message }, null, 2));
        this.loading.set(false);
      },
    });
  }

  methodColor(m: string): string {
    switch (m) {
      case 'GET':    return 'method-get';
      case 'POST':   return 'method-post';
      case 'PUT':    return 'method-put';
      case 'DELETE': return 'method-delete';
      case 'PATCH':  return 'method-patch';
      default:       return '';
    }
  }

  get statusClass(): string {
    const s = this.modalStatus();
    if (s >= 200 && s < 300) return 'status-200';
    if (s >= 400 && s < 500) return 'status-4xx';
    if (s >= 500) return 'status-5xx';
    return '';
  }
}
