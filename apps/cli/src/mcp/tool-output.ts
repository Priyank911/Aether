import type { ToolOutput } from '@aether/engine';
import { wrapUntrustedPageText } from './untrusted.js';

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
