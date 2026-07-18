import { Component, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

export interface Medication {
  id: string; start?: string; stop?: string;
  patient?: string; payer?: string; encounter?: string;
  code?: string; description?: string;
  baseCost?: number; payerCoverage?: number;
  dispenses?: number; totalCost?: number;
  reasonCode?: string; reasonDescription?: string;
}

@Component({
  selector: 'app-medications',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatTableModule, MatButtonModule, MatIconModule,
    MatInputModule, MatFormFieldModule, MatProgressBarModule,
    MatDialogModule, MatPaginatorModule, MatSnackBarModule,
  ],
  templateUrl: './medications.component.html',
  styleUrl: './medications.component.scss',
})
export class MedicationsComponent implements OnInit {
  @Input() baseUrl = '';

  medications  = signal<Medication[]>([]);
  loading      = signal(false);
  total        = signal(0);
  lastKey      = signal<any>(null);
  showForm     = signal(false);
  editing      = signal<Medication | null>(null);
  filterText   = signal('');

  displayedColumns = ['id', 'patient', 'code', 'description', 'baseCost', 'totalCost', 'actions'];

  form = this.fb.group({
    patient:     ['', Validators.required],
    code:        ['', Validators.required],
    description: ['', Validators.required],
    payer:       [''],
    encounter:   [''],
    baseCost:    [0],
    payerCoverage: [0],
    dispenses:   [1],
    totalCost:   [0],
    start:       [''],
    stop:        [''],
    reasonCode:  [''],
    reasonDescription: [''],
  });

  constructor(
    private http: HttpClient,
    private fb: FormBuilder,
    private snack: MatSnackBar,
  ) {}

  ngOnInit(): void { this.load(); }

  load(limit = 50): void {
    this.loading.set(true);
    const params: any = { limit };
    if (this.lastKey()) params.startKey = JSON.stringify(this.lastKey());
    this.http.get<any>(`${this.baseUrl}/medications/`, { params }).subscribe({
      next: res => {
        this.medications.set(res.items ?? []);
        this.lastKey.set(res.lastEvaluatedKey || null);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openCreate(): void {
    this.editing.set(null);
    this.form.reset({ dispenses: 1, baseCost: 0, payerCoverage: 0, totalCost: 0 });
    this.showForm.set(true);
  }

  openEdit(med: Medication): void {
    this.editing.set(med);
    this.form.patchValue(med as any);
    this.showForm.set(true);
  }

  save(): void {
    if (this.form.invalid) return;
    const body = this.form.value;
    const ed = this.editing();
    const obs = ed
      ? this.http.put(`${this.baseUrl}/medications/${ed.id}`, body)
      : this.http.post(`${this.baseUrl}/medications/`, body);
    obs.subscribe({
      next: () => { this.showForm.set(false); this.load(); this.snack.open('Saved ✓', '', { duration: 2000 }); },
      error: err => this.snack.open(err.error?.error ?? 'Error', '', { duration: 3000 }),
    });
  }

  delete(med: Medication): void {
    if (!confirm(`Delete medication ${med.id}?`)) return;
    this.http.delete(`${this.baseUrl}/medications/${med.id}`).subscribe({
      next: () => { this.load(); this.snack.open('Deleted', '', { duration: 2000 }); },
      error: err => this.snack.open(err.error?.error ?? 'Error', '', { duration: 3000 }),
    });
  }

  get filteredMeds(): Medication[] {
    const q = this.filterText().toLowerCase();
    if (!q) return this.medications();
    return this.medications().filter(m =>
      [m.id, m.patient, m.code, m.description].some(v => v?.toLowerCase().includes(q)));
  }
}
