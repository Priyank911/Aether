import { z } from 'zod';

/*
 * Tool argument schemas. They are flat objects with no unions, because some
 * model providers reject nested anyOf in tool JSON Schema. Descriptions are
 * kept short and length limits are left to the handlers: all eight tool
 * definitions together must stay under 900 tokens.
 */

export const RefSchema = z.string().regex(/^e\d+$/, 'Refs look like e12');

export const ActionOpSchema = z.enum(['click', 'fill', 'key', 'hover', 'scroll', 'dialog', 'upload']);

export const ActionRiskSchema = z.enum(['read', 'reversible', 'irreversible']);

export const ActionItemSchema = z.object({
  op: ActionOpSchema,
  ref: RefSchema.optional(),
  value: z.string().optional().describe('text, option, true/false, key (Enter, Shift+Tab), up/down, accept/dismiss'),
});

export const ActParamsSchema = z.object({
  actions: z.array(ActionItemSchema).min(1).max(8),
  risk: ActionRiskSchema.describe('irreversible: buy, pay, send, delete, submit'),
  why: z.string(),
});

export const OpenParamsSchema = z.object({
  url: z.string().url(),
  new_tab: z.boolean().optional(),
});

export const LookParamsSchema = z.object({
  ref: RefSchema.optional(),
  as: z.enum(['outline', 'text']).optional(),
  after: z.string().regex(/^[et]\d+$/).optional(),
});

export const FindParamsSchema = z.object({
  query: z.string().min(1),
  role: z.string().optional(),
});

export const ScreenshotParamsSchema = z.object({
  ref: RefSchema.optional(),
});

export const AskParamsSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).max(4).optional(),
  handoff: z.string().optional(),
});

export const MemoryParamsSchema = z.object({
  op: z.enum(['recall', 'save']),
  site: z.string().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
});

export const DoneParamsSchema = z.object({
  result: z.string(),
  evidence: z.string(),
  success: z.boolean(),
});

export const CdpWireMessageSchema = z.union([
  z.object({
    id: z.number().int(),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    sessionId: z.string().optional(),
  }),
  z.object({
    id: z.number().int(),
    result: z.record(z.string(), z.unknown()).optional(),
    error: z.object({
      code: z.number().int(),
      message: z.string(),
      data: z.string().optional(),
    }).optional(),
    sessionId: z.string().optional(),
  }),
  z.object({
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
    sessionId: z.string().optional(),
  }),
]);

export const PolicyOutcomeSchema = z.enum([
  'allow',
  'needs_approval',
  'human_must_perform',
  'refuse',
]);

export const PolicyDecisionSchema = z.object({
  outcome: PolicyOutcomeSchema,
  reason: z.string(),
  actionRef: z.string().optional(),
});

/*
 * Run state: one machine in the engine. The overlay, the side panel and tool
 * results all render these frames; none of them keeps state of its own.
 */

export const RunStateNameSchema = z.enum(['idle', 'acting', 'waiting_human', 'resuming']);

export const WaitReasonSchema = z.enum(['question', 'approval', 'must_perform', 'user_interrupted', 'captcha']);

export const ApprovalDetailSchema = z.object({
  site: z.string(),
  element: z.string(),
  /** Form values about to be sent, with secrets masked. */
  values: z.array(z.object({ label: z.string(), value: z.string() })),
  /** The agent's stated reason; shown as its claim, not as fact. */
  agentReason: z.string(),
});

export const PendingSchema = z.object({
  id: z.string(),
  reason: WaitReasonSchema,
  prompt: z.string(),
  options: z.array(z.string()).optional(),
  approval: ApprovalDetailSchema.optional(),
  createdAt: z.number().int(),
});

export const RunStateFrameSchema = z.object({
  type: z.literal('aether.state'),
  state: RunStateNameSchema,
  step: z.number().int(),
  label: z.string(),
  pending: PendingSchema.optional(),
  timestamp: z.number().int(),
});

/** What the person did in the side panel or the page pill. Only these unlock a held call. */
export const HumanReplySchema = z.object({
  type: z.literal('aether.reply'),
  id: z.string(),
  kind: z.enum(['answer', 'approve', 'deny', 'done', 'resume']),
  text: z.string().max(2000).optional(),
});

/** Run controls that need no pending request. */
export const RunControlSchema = z.object({
  type: z.literal('aether.control'),
  kind: z.enum(['stop', 'takeover']),
});

export type RunStateName = z.infer<typeof RunStateNameSchema>;
export type WaitReason = z.infer<typeof WaitReasonSchema>;
export type ApprovalDetail = z.infer<typeof ApprovalDetailSchema>;
export type Pending = z.infer<typeof PendingSchema>;
export type RunStateFrame = z.infer<typeof RunStateFrameSchema>;
export type HumanReply = z.infer<typeof HumanReplySchema>;
export type RunControl = z.infer<typeof RunControlSchema>;

export const BridgeConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(32),
});

/*
 * Bridge between the engine and the extension service worker: one loopback
 * WebSocket opened by the extension. The native host only bootstraps it.
 */

/** First message from the extension; the socket closes unless the token matches. */
export const BridgeHelloSchema = z.object({
  type: z.literal('aether.hello'),
  token: z.string().min(32),
  version: z.string(),
});

export const BridgePingSchema = z.object({ type: z.literal('aether.ping'), n: z.number().int() });
export const BridgePongSchema = z.object({ type: z.literal('aether.pong'), n: z.number().int() });

/** chrome.debugger detached from the agent tab; refs and frames are gone. */
export const DebuggerDetachedSchema = z.object({ type: z.literal('aether.detached'), reason: z.string() });

/** Side panel memory tab to engine. The person's own edits; never from the page. */
export const MemoryCommandSchema = z.object({
  type: z.literal('aether.memory'),
  op: z.enum(['list', 'delete', 'set_enabled', 'save_fact']),
  kind: z.enum(['fact', 'note', 'procedure']).optional(),
  id: z.union([z.string(), z.number()]).optional(),
  enabled: z.boolean().optional(),
  key: z.string().max(80).optional(),
  value: z.string().max(500).optional(),
});

export const MemoryListingSchema = z.object({
  type: z.literal('aether.memory.listing'),
  enabled: z.boolean(),
  facts: z.array(z.object({ key: z.string(), value: z.string(), source: z.enum(['user', 'agent']) })),
  notes: z.array(z.object({ id: z.number(), site: z.string(), text: z.string() })),
  procedures: z.array(z.object({ id: z.number(), site: z.string(), goal: z.string(), steps: z.array(z.string()), successes: z.number(), stale: z.boolean() })),
  error: z.string().optional(),
});

export const ExtensionMessageSchema = z.union([
  MemoryCommandSchema,
  BridgeHelloSchema,
  BridgePongSchema,
  HumanReplySchema,
  RunControlSchema,
  DebuggerDetachedSchema,
  CdpWireMessageSchema,
]);

export const EngineMessageSchema = z.union([RunStateFrameSchema, BridgePingSchema, MemoryListingSchema, CdpWireMessageSchema]);

/** Native host to extension: where the engine listens, or that it is gone. */
export const NativeBootstrapSchema = z.union([
  z.object({ type: z.literal('aether.bridge'), port: z.number().int().min(1).max(65535), token: z.string().min(32) }),
  z.object({ type: z.literal('aether.bridge.gone') }),
]);

/*
 * Inside the extension: the service worker tells the side panel and the page
 * overlay about the engine connection and the run state; they send back
 * replies and controls. Both views only render what they receive.
 */

export const ConnectionStateSchema = z.enum(['no_host', 'waiting_engine', 'connecting', 'connected']);

export const ConnectionStatusSchema = z.object({
  type: z.literal('aether.connection'),
  state: ConnectionStateSchema,
  detail: z.string(),
});

export const AgentTabSchema = z.object({
  type: z.literal('aether.agent_tab'),
  tabId: z.number().int().optional(),
  title: z.string(),
});

export const PanelSyncSchema = z.object({ type: z.literal('aether.panel.sync') });

/** "Let Aether use this tab" from the side panel. */
export const AdoptTabSchema = z.object({ type: z.literal('aether.adopt_tab') });

export const PanelRequestSchema = z.union([PanelSyncSchema, AdoptTabSchema, HumanReplySchema, RunControlSchema, MemoryCommandSchema]);

export const PanelSnapshotSchema = z.object({
  connection: ConnectionStatusSchema,
  frame: RunStateFrameSchema.optional(),
  agentTab: AgentTabSchema,
  recent: z.array(RunStateFrameSchema),
});

export type ConnectionState = z.infer<typeof ConnectionStateSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type AgentTab = z.infer<typeof AgentTabSchema>;
export type PanelRequest = z.infer<typeof PanelRequestSchema>;
export type PanelSnapshot = z.infer<typeof PanelSnapshotSchema>;

export type PolicyOutcome = z.infer<typeof PolicyOutcomeSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;
export type ExtensionMessage = z.infer<typeof ExtensionMessageSchema>;
export type EngineMessage = z.infer<typeof EngineMessageSchema>;
export type NativeBootstrap = z.infer<typeof NativeBootstrapSchema>;
export type MemoryCommand = z.infer<typeof MemoryCommandSchema>;
export type MemoryListing = z.infer<typeof MemoryListingSchema>;
