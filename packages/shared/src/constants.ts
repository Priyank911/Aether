export const DEFAULT_CDP_TIMEOUT_MS = 10000;

/**
 * Field names, ids and labels that identify secrets. One source for the
 * perceiver (value masking) and the policy classifier (human_must_perform).
 */
export const SENSITIVE_FIELD_PATTERN =
  /(password|passphrase|secret|credit[_\s-]*card|card[_\s-]*(?:number|no(?:$|[^a-z]))|security[_\s-]*code|(?:^|[^a-z0-9])(?:pin|otp|cvv|cvc|csc)(?:$|[^a-z0-9]))/i;

/** Frame URLs of CAPTCHA widgets. Their content is for the person to solve. */
export const CAPTCHA_FRAME_PATTERN = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|captcha-delivery/i;

/** Autocomplete tokens that mark a field as holding a secret. */
export const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
]);
