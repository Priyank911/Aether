import { wrapUntrusted } from '@aether/policy';
import type { ToolOutput } from './browser-session.js';

/** Page-derived text for the model, inside the nonce-tagged untrusted wrapper. */
export function wrapUntrustedPageText(text: string, url?: string): string {
  return wrapUntrusted(text, url);
}

/*
 * An engine output as MCP content: engine notes first and outside the
 * wrapper, page-derived text inside the nonce-tagged untrusted wrapper, then
 * an image when there is one.
 */

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export function toToolResult(output: ToolOutput): { content: ToolContent[]; isError: boolean } {
  const lines = [...output.notes];
  if (output.page !== undefined) lines.push(wrapUntrustedPageText(output.page, output.url));
  const content: ToolContent[] = [{ type: 'text', text: lines.join('\n') }];
  if (output.image) content.push({ type: 'image', data: output.image, mimeType: 'image/png' });
  return { content, isError: output.isError ?? false };
}
