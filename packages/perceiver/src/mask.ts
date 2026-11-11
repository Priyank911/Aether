import { SENSITIVE_AUTOCOMPLETE, SENSITIVE_FIELD_PATTERN } from '@aether/shared';

export { looksLikeCardNumber } from '@aether/shared';

export const MASK = '***';

/** True when the field's DOM attributes or accessible name mark it as holding a secret. */
export function isSensitiveField(attributes: ReadonlyMap<string, string>, name: string): boolean {
  const type = (attributes.get('type') ?? '').toLowerCase();
  if (type === 'password') return true;
  const autocomplete = (attributes.get('autocomplete') ?? '').toLowerCase().split(/\s+/);
  if (autocomplete.some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) return true;
  for (const key of ['name', 'id']) {
    if (SENSITIVE_FIELD_PATTERN.test(attributes.get(key) ?? '')) return true;
  }
  return SENSITIVE_FIELD_PATTERN.test(name);
}

const IDENTITY_AUTOCOMPLETE = /^(name|given-name|family-name|additional-name|email|tel(-national)?|street-address|address-line[1-3]|address-level[1-4]|postal-code|country|country-name|bday(-day|-month|-year)?|sex|organization)$/;

/** True when autocomplete or the input type marks a field for personal details. */
export function isIdentityField(attributes: ReadonlyMap<string, string>): boolean {
  const type = (attributes.get('type') ?? '').toLowerCase();
  if (type === 'email' || type === 'tel') return true;
  return (attributes.get('autocomplete') ?? '').toLowerCase().split(/\s+/).some((token) => IDENTITY_AUTOCOMPLETE.test(token));
}

/** Chrome reports password values as bullets; treat a bullet-only value as a secret even without attributes. */
export function isMaskedByBrowser(value: string): boolean {
  return value.length > 0 && /^[•●*]+$/.test(value);
}
