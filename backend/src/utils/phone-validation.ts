/**
 * Phone number validation and normalization utilities
 */

/**
 * Normalize phone number to E.164 format (+[country code][number])
 * E.164 format: +1234567890 (no spaces, dashes, or parentheses)
 * Also handles WhatsApp format (whatsapp:+1234567890) by stripping the prefix
 */
export function normalizePhoneNumber(phone: string): string | null {
  if (!phone) {
    return null;
  }

  // Remove 'whatsapp:' prefix if present
  let cleaned = phone.trim();
  if (cleaned.toLowerCase().startsWith('whatsapp:')) {
    cleaned = cleaned.substring(9); // Remove 'whatsapp:' prefix
  }

  // Remove all non-digit characters except leading +
  let normalized = cleaned.replace(/[^\d+]/g, '');

  // If it doesn't start with +, assume US number and add +1
  if (!normalized.startsWith('+')) {
    // Remove leading 1 if present (US country code)
    if (normalized.startsWith('1') && normalized.length === 11) {
      normalized = '+' + normalized;
    } else {
      // Assume US number, add +1
      normalized = '+1' + normalized;
    }
  }

  // Validate E.164 format: + followed by 1-15 digits
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  if (!e164Regex.test(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Validate phone number format
 * Returns true if phone number is valid E.164 format
 */
export function validatePhoneNumber(phone: string): boolean {
  const normalized = normalizePhoneNumber(phone);
  return normalized !== null;
}

/**
 * Format phone number for display (e.g., +1 (234) 567-8900)
 */
export function formatPhoneNumber(phone: string): string {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) {
    return phone; // Return original if invalid
  }

  // Format US numbers: +1 (234) 567-8900
  if (normalized.startsWith('+1') && normalized.length === 12) {
    const number = normalized.substring(2);
    return `+1 (${number.substring(0, 3)}) ${number.substring(3, 6)}-${number.substring(6)}`;
  }

  // For other countries, just return normalized
  return normalized;
}

