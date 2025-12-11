import { HttpInterceptorFn, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Add bearer token to requests if available
  const token = authService.getToken();
  let authReq = req;
  
  if (token && !req.headers.has('Authorization')) {
    authReq = req.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // If we get a 401 Unauthorized, the session has expired
      if (error.status === 401) {
        // Clear the authentication
        authService.logout();
        
        // Redirect to login page (only if not already on login page)
        if (!router.url.includes('/login')) {
          router.navigate(['/login']);
        }
      }
      
      // Re-throw the error so calling code can handle it if needed
      return throwError(() => error);
    })
  );
};

