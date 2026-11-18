/** Anything that answers tools/call: an MCP client, or the test engine client. */
type ToolCaller = { callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<{ content?: unknown; isError?: unknown }> };

export interface CallResult {
  text: string;
  isError: boolean;
  hasImage: boolean;
}

export async function call(client: ToolCaller, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  const result = await client.callTool({ name, arguments: args });
  const blocks = Array.isArray(result.content) ? (result.content as Array<{ type: string; text?: string }>) : [];
  return {
    text: blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n'),
    isError: result.isError === true,
    hasImage: blocks.some((block) => block.type === 'image'),
  };
}

/** The ref on the first line matching `role "name...`. */
export function refIn(text: string, role: string, namePrefix: string): string {
  const escaped = namePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\[(e\\d+)\\] ${role} "${escaped}`).exec(text);
  if (!match?.[1]) throw new Error(`No ${role} "${namePrefix}..." in:\n${text}`);
  return match[1];
}

/** Tokens at 3.5 characters each, the same estimate the perceiver uses. */
export function tokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
