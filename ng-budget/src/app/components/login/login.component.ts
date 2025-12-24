import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { LoginRequest, RegisterRequest } from '../../models/user.model';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  isLoginMode = signal(true);
  error = signal<string | null>(null);
  loading = signal(false);

  loginData: LoginRequest = {
    email: '',
    password: ''
  };

  registerData: RegisterRequest = {
    email: '',
    password: '',
    firstName: '',
    lastName: ''
  };

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  toggleMode() {
    this.isLoginMode.set(!this.isLoginMode());
    this.error.set(null);
  }

  onSubmit() {
    this.error.set(null);
    this.loading.set(true);

    if (this.isLoginMode()) {
      this.authService.login(this.loginData).subscribe({
        next: () => {
          this.router.navigate(['/budgets']);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('Login error:', err);
          const errorMessage = err.error?.error || err.message || 'Login failed. Please check if the backend is running.';
          this.error.set(errorMessage);
          this.loading.set(false);
        }
      });
    } else {
      this.authService.register(this.registerData).subscribe({
        next: () => {
          this.router.navigate(['/budgets']);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('Registration error:', err);
          let errorMessage = 'Registration failed';
          
          if (err.status === 0) {
            errorMessage = 'Cannot connect to server. Please check your connection and try again.';
          } else if (err.error?.error) {
            errorMessage = err.error.error;
          } else if (err.message) {
            errorMessage = err.message;
          }
          
          this.error.set(errorMessage);
          this.loading.set(false);
        }
      });
    }
  }
}

