import { ContentSanitizer } from '@aether/policy';

export function wrapUntrustedPageText(text: string): string {
  return ContentSanitizer.wrapUntrusted(text);
}
