import zxcvbn from 'zxcvbn';

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  score: number; // 0-4, where 4 is strongest
}

/**
 * Validate password strength
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * - zxcvbn score of at least 2 (moderate strength)
 */
export function validatePasswordStrength(password: string): PasswordValidationResult {
  const errors: string[] = [];

  // Basic length check
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  // Character requirements
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Check password strength using zxcvbn
  const result = zxcvbn(password);
  const score = result.score;

  // Require at least moderate strength (score >= 2)
  if (score < 2) {
    errors.push('Password is too weak. Please use a stronger password.');
  }

  // Additional check: if password is too common
  if (result.feedback.warning) {
    errors.push(result.feedback.warning);
  }

  return {
    isValid: errors.length === 0,
    errors,
    score,
  };
}

