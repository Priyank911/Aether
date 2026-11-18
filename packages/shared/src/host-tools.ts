import { z } from 'zod';
import { RefSchema } from './schemas.js';

/*
 * The four host operations (plan 3.1, section 8.1). The `aether` command and
 * the optional MCP server both send exactly these to the app.
 *
 * The schemas are what hosts see as tool definitions, so they stay flat (no
 * unions, which some providers reject) and lean (the four together must stay
 * under 450 tokens). Length limits and cross-field rules are checked by the
 * functions below, which every connector calls before acting.
 */

export const HOST_LIMITS = { spaceName: 60, thought: 200, report: 2000 } as const;

export const AetherExecParamsSchema = z.object({
  space: z.string().optional(),
  thought: z.string(),
  code: z.string().optional(),
  wait: z.string().optional(),
});

export const AetherScreenshotParamsSchema = z.object({
  space: z.string(),
  ref: RefSchema.optional(),
});

export const AetherSpacesParamsSchema = z.object({
  op: z.enum(['list', 'focus', 'close']),
  space: z.string().optional(),
});

export const AetherDoneParamsSchema = z.object({
  space: z.string(),
  result: z.string(),
  evidence: z.string(),
  success: z.boolean(),
});

export const HostToolNameSchema = z.enum(['aether_exec', 'aether_screenshot', 'aether_spaces', 'aether_done']);

function spaceProblem(space: string | undefined, required: boolean): string | undefined {
  if (space === undefined) return required ? 'space is required' : undefined;
  if (space.trim().length === 0) return 'space must not be empty';
  if (space.length > HOST_LIMITS.spaceName) return `space names are at most ${HOST_LIMITS.spaceName} characters`;
  return undefined;
}

/** Returns the problem in words, or undefined when the call is valid. Exactly one of code or wait. */
export function execParamsProblem(params: z.infer<typeof AetherExecParamsSchema>): string | undefined {
  const space = spaceProblem(params.space, false);
  if (space) return space;
  const thought = params.thought.trim();
  if (thought.length === 0 || thought.length > HOST_LIMITS.thought || /[\r\n]/.test(thought)) {
    return `thought must be one line of 1 to ${HOST_LIMITS.thought} characters`;
  }
  const hasCode = params.code !== undefined && params.code.trim().length > 0;
  const hasWait = params.wait !== undefined;
  if (hasCode && hasWait) return 'send either code or wait, not both';
  if (!hasCode && !hasWait) return 'send code to run, or wait with the token of a held run';
  if (hasWait && !/^[0-9a-f]{16,80}$/.test(params.wait ?? '')) return 'wait must be the token a held run returned';
  return undefined;
}

export function screenshotParamsProblem(params: z.infer<typeof AetherScreenshotParamsSchema>): string | undefined {
  return spaceProblem(params.space, true);
}

/** focus and close need a space; list does not. */
export function spacesParamsProblem(params: z.infer<typeof AetherSpacesParamsSchema>): string | undefined {
  if (params.op !== 'list' && !params.space) return `op=${params.op} needs space`;
  return spaceProblem(params.space, false);
}

export function doneParamsProblem(params: z.infer<typeof AetherDoneParamsSchema>): string | undefined {
  const space = spaceProblem(params.space, true);
  if (space) return space;
  for (const field of ['result', 'evidence'] as const) {
    const value = params[field].trim();
    if (value.length === 0 || value.length > HOST_LIMITS.report) return `${field} must be 1 to ${HOST_LIMITS.report} characters`;
  }
  return undefined;
}

export type AetherExecParams = z.infer<typeof AetherExecParamsSchema>;
export type AetherScreenshotParams = z.infer<typeof AetherScreenshotParamsSchema>;
export type AetherSpacesParams = z.infer<typeof AetherSpacesParamsSchema>;
export type AetherDoneParams = z.infer<typeof AetherDoneParamsSchema>;
export type HostToolName = z.infer<typeof HostToolNameSchema>;
