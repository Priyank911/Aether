import { SENSITIVE_FIELD_PATTERN } from './constants.js';

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = digits.charCodeAt(index) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 13 to 19 digits, optionally spaced or dashed, that pass the Luhn check. */
export function looksLikeCardNumber(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{13,19}$/.test(digits) && passesLuhn(digits);
}

/** True when a key or value must never be stored: credentials, codes, card numbers. */
export function isSecretText(text: string): boolean {
  if (SENSITIVE_FIELD_PATTERN.test(text)) return true;
  for (const run of text.match(/\d[\d\s-]{11,}\d/g) ?? []) if (looksLikeCardNumber(run)) return true;
  return false;
}
