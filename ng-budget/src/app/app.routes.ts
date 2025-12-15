import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'budgets',
    loadComponent: () => import('./components/budgets/budgets.component').then(m => m.BudgetsComponent),
    canActivate: [authGuard]
  },
  {
    path: 'budgets/edit',
    loadComponent: () => import('./components/budgets/budget-form.component').then(m => m.BudgetFormComponent),
    canActivate: [authGuard]
  },
  {
    path: 'messaging',
    loadComponent: () => import('./components/messaging/messaging.component').then(m => m.MessagingComponent),
    canActivate: [authGuard]
  },
  {
    path: 'settings/slack',
    loadComponent: () => import('./components/slack-integration/slack-integration.component').then(m => m.SlackIntegrationComponent),
    canActivate: [authGuard]
  },
  {
    path: '',
    redirectTo: '/budgets',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: '/budgets'
  }
];
