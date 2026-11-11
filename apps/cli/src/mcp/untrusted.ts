import { wrapUntrusted } from '@aether/policy';

/** Page-derived text for the model, inside the nonce-tagged untrusted wrapper. */
export function wrapUntrustedPageText(text: string, url?: string): string {
  return wrapUntrusted(text, url);
}
