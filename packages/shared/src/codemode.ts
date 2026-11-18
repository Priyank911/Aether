import { z } from 'zod';
import { ActionItemSchema, ActionRiskSchema, RefSchema } from './schemas.js';

/*
 * Code Mode (plan 3.1, section 7). A script in the sandbox calls `space.*`;
 * each call is one message to the engine, which validates the arguments with
 * the schemas below before Policy sees them. Only plain JSON crosses.
 */

export const CODEMODE_LIMITS = {
  /** A single returned string larger than this is rejected, never cut. */
  maxStringBytes: 256 * 1024,
  /** The whole serialized return value. */
  maxReturnBytes: 1024 * 1024,
  /** `space.state` per Space. */
  maxStateBytes: 64 * 1024,
  /** No space.* call, settle or hold for this long while the script is busy means it has stalled. */
  stallMs: 30_000,
  /** A held run answers the host with a token after this long. */
  holdReturnMs: 50_000,
  /** A held run's result is kept this long for `wait`. */
  heldResultTtlMs: 10 * 60_000,
  /** Script source size. */
  maxCodeBytes: 64 * 1024,
  /** `console.log` output kept per run for the debug trace. */
  maxLogBytes: 16 * 1024,
} as const;

export const PageArchetypeSchema = z.enum(['listing', 'product', 'form', 'article', 'auth_gate', 'captcha', 'other']);

const Url = z.string().url().max(4096);
const Cursor = z.string().regex(/^[et]\d+$/);

/** Argument tuples per method, as the sandbox sends them. */
export const SpaceCallArgs = {
  open: z.tuple([Url, z.object({ newTab: z.boolean().optional() }).strict().optional()]),
  openTabs: z.tuple([z.array(Url).min(1).max(100), z.object({ lazy: z.boolean().optional() }).strict().optional()]),
  /** One page of `mapPages`; the engine bounds how many run at once and hibernates each afterwards. */
  mapPage: z.tuple([Url]),
  switchTab: z.tuple([z.string().min(1).max(40)]),
  tabs: z.tuple([]),
  skim: z.tuple([]),
  focus: z.tuple([RefSchema, z.object({ after: Cursor.optional() }).strict().optional()]),
  text: z.tuple([RefSchema.optional(), z.object({ after: Cursor.optional() }).strict().optional()]),
  items: z.tuple([]),
  survey: z.tuple([
    z
      .object({
        query: z.string().min(1).max(200),
        budget: z.number().positive().optional(),
        minRating: z.number().min(0).max(5).optional(),
        maxPages: z.number().int().min(1).max(10).optional(),
      })
      .strict(),
  ]),
  find: z.tuple([z.string().min(1).max(200), z.string().max(40).optional()]),
  act: z.tuple([
    z.array(ActionItemSchema).min(1).max(8),
    z.object({ risk: ActionRiskSchema, why: z.string().min(1).max(300) }).strict(),
  ]),
  logStep: z.tuple([z.string().min(1).max(200)]),
  ask: z.tuple([
    z.string().min(1).max(500),
    z.object({ options: z.array(z.string().min(1).max(80)).min(2).max(4).optional(), handoff: z.boolean().optional() }).strict().optional(),
  ]),
  memory: z.tuple([
    z.enum(['recall', 'save']),
    z.object({ site: z.string().max(200).optional(), key: z.string().max(80).optional(), value: z.string().max(500).optional() }).strict().optional(),
  ]),
  stateGet: z.tuple([z.string().min(1).max(80)]),
  stateSet: z.tuple([z.string().min(1).max(80), z.unknown()]),
} as const;

export type SpaceMethod = keyof typeof SpaceCallArgs;

export const SpaceMethodSchema = z.enum(Object.keys(SpaceCallArgs) as [SpaceMethod, ...SpaceMethod[]]);

export type SpaceCallResult =
  | { ok: true; args: unknown[] }
  | { ok: false; message: string };

/**
 * Validate one call's arguments. Trailing optional arguments may be left out
 * by the script (`space.open(url)`); zod 3 tuples need them present, so the
 * list is padded with undefined first. Extra arguments are an error.
 */
export function parseSpaceCall(method: SpaceMethod, args: readonly unknown[]): SpaceCallResult {
  const schema = SpaceCallArgs[method];
  const size = schema.items.length;
  if (args.length > size) return { ok: false, message: `space.${method} takes at most ${size} argument${size === 1 ? '' : 's'}, got ${args.length}` };
  const padded = [...args];
  while (padded.length < size) padded.push(undefined);
  const parsed = schema.safeParse(padded);
  if (parsed.success) return { ok: true, args: parsed.data as unknown[] };
  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` (argument ${Number(issue.path[0]) + 1}${issue.path.length > 1 ? `, ${issue.path.slice(1).join('.')}` : ''})` : '';
  return { ok: false, message: `space.${method}: ${issue?.message ?? 'invalid arguments'}${where}` };
}

/** Sandbox to engine. */
export const CodeModeCallSchema = z.object({
  type: z.literal('call'),
  id: z.number().int().min(1),
  method: SpaceMethodSchema,
  args: z.array(z.unknown()).max(4),
});

export const CodeModeErrorCodeSchema = z.enum([
  'invalid_args',
  'refused',
  'denied',
  'stale_ref',
  'tab_crashed',
  'navigation',
  'stopped',
  'busy',
  'engine',
]);

/** Engine to sandbox. A rejected call becomes a rejected promise the script may catch. */
export const CodeModeReplySchema = z.union([
  z.object({ type: z.literal('reply'), id: z.number().int().min(1), ok: z.literal(true), value: z.unknown() }),
  z.object({
    type: z.literal('reply'),
    id: z.number().int().min(1),
    ok: z.literal(false),
    error: z.object({ code: CodeModeErrorCodeSchema, message: z.string() }),
  }),
]);

/** Sandbox to engine when the script ends. */
export const CodeModeDoneSchema = z.union([
  z.object({ type: z.literal('done'), ok: z.literal(true), json: z.string() }),
  z.object({
    type: z.literal('done'),
    ok: z.literal(false),
    message: z.string(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
  }),
]);

/** Debug output from `console.log`, capped per run. */
export const CodeModeLogSchema = z.object({ type: z.literal('log'), text: z.string() });

export const SandboxMessageSchema = z.union([CodeModeCallSchema, CodeModeDoneSchema, CodeModeLogSchema]);

/** What one aether_exec run produced. */
export const ExecOutcomeSchema = z.union([
  z.object({
    status: z.literal('complete'),
    /** JSON text of the script's return value; page-derived when `untrusted` is true. */
    json: z.string().optional(),
    untrusted: z.boolean(),
    origins: z.array(z.string()),
    durationMs: z.number().int().min(0),
  }),
  z.object({
    status: z.literal('held'),
    token: z.string().min(16),
    /** `working`: still running after the hold time with no person involved (a long survey). */
    reason: z.enum(['question', 'approval', 'must_perform', 'user_interrupted', 'captcha', 'working']),
    prompt: z.string(),
  }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    untrusted: z.boolean(),
    origins: z.array(z.string()),
  }),
  z.object({ status: z.literal('stopped'), by: z.enum(['person', 'stall']), message: z.string() }),
]);

export type PageArchetype = z.infer<typeof PageArchetypeSchema>;
export type CodeModeCall = z.infer<typeof CodeModeCallSchema>;
export type CodeModeReply = z.infer<typeof CodeModeReplySchema>;
export type CodeModeDone = z.infer<typeof CodeModeDoneSchema>;
export type CodeModeErrorCode = z.infer<typeof CodeModeErrorCodeSchema>;
export type SandboxMessage = z.infer<typeof SandboxMessageSchema>;
export type ExecOutcome = z.infer<typeof ExecOutcomeSchema>;
