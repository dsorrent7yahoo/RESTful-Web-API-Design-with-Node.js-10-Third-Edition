import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { BACKEND_PRESETS } from '../../services/api.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    MatCardModule, MatInputModule, MatButtonModule,
    MatProgressSpinnerModule, MatSelectModule,
    MatFormFieldModule, MatIconModule,
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  form = this.fb.group({
    email:    ['react-dgs@yahoo.com', [Validators.required, Validators.email]],
    password: ['python',              [Validators.required]],
    backend:  ['cmdline'],
  });

  loading  = signal(false);
  error    = signal('');
  presets  = Object.entries(BACKEND_PRESETS);

  constructor(
    private fb: FormBuilder,
    private auth: AuthService,
    private router: Router,
  ) {
    if (auth.isLoggedIn()) router.navigate(['/dashboard']);
  }

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set('');
    const { email, password, backend } = this.form.value;
    const baseUrl = BACKEND_PRESETS[backend as string] ?? BACKEND_PRESETS['cmdline'];
    this.auth.login(email!, password!, baseUrl).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: err => {
        this.error.set(err.error?.error ?? 'Login failed');
        this.loading.set(false);
      },
    });
  }
}
