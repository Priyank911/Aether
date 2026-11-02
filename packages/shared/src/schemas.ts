import { z } from 'zod';

export const ActionOpSchema = z.enum([
  'click',
  'type',
  'key',
  'select',
  'scroll',
  'hover',
]);

export const ActionRiskSchema = z.enum([
  'read',
  'reversible',
  'irreversible',
]);

export const ActionItemSchema = z.object({
  ref: z.string().regex(/^e\d+$/, 'Ref must be formatted as e1, e2, ...'),
  op: ActionOpSchema,
  value: z.string().optional(),
});

export const ActParamsSchema = z.object({
  actions: z.array(ActionItemSchema).min(1).max(5),
  risk: ActionRiskSchema,
  why: z.string().min(1),
});

export const NavigateParamsSchema = z.object({
  url: z.string().url(),
});

export const FindParamsSchema = z.object({
  query: z.string().min(1),
});

export const ReadParamsSchema = z.object({
  ref: z.string().regex(/^e\d+$/),
});

export const ScreenshotParamsSchema = z.object({
  ref: z.string().regex(/^e\d+$/).optional(),
});

export const AskParamsSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).min(2).max(4).optional(),
});

export const DoneParamsSchema = z.object({
  result: z.string(),
  evidence: z.string(),
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

export const HandoffRecordSchema = z.object({
  handoffId: z.string(),
  question: z.string(),
  options: z.array(z.string()).min(2).max(4).optional(),
  state: z.enum(['waiting_human', 'completed', 'cancelled']),
  answer: z.string().optional(),
  timestamp: z.number().int(),
});

export const PickModeRequestSchema = z.object({
  enabled: z.boolean(),
});

export const PickModeResultSchema = z.object({
  backendNodeId: z.number().int(),
  ref: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
});

export const BridgeConfigSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(32),
});

export const BridgeStatusSchema = z.object({
  type: z.literal('aether.status'),
  state: z.enum(['connected', 'disconnected', 'step', 'waiting_human']),
  label: z.string(),
  timestamp: z.number().int(),
  handoff: HandoffRecordSchema.optional(),
});

export const ReplayEntrySchema = z.object({
  id: z.string(),
  site: z.string(),
  goal: z.string(),
  structureHash: z.string(),
  actions: z.array(ActionItemSchema),
  timestamp: z.number().int(),
  hitCount: z.number().int().default(0),
});

export const HistoryStepSchema = z.object({
  step: z.number().int(),
  actor: z.enum(['agent', 'human']),
  action: z.string(),
  outcome: z.string(),
  timestamp: z.number().int().optional(),
});

export const ViewportFilterSchema = z.object({
  viewportHeight: z.number().default(800),
  viewportWidth: z.number().default(1280),
  enabled: z.boolean().default(true),
});

export const BridgeMessageSchema = z.union([CdpWireMessageSchema, BridgeStatusSchema]);

export type PolicyOutcome = z.infer<typeof PolicyOutcomeSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type HandoffRecord = z.infer<typeof HandoffRecordSchema>;
export type PickModeRequest = z.infer<typeof PickModeRequestSchema>;
export type PickModeResult = z.infer<typeof PickModeResultSchema>;
export type ReplayEntry = z.infer<typeof ReplayEntrySchema>;
export type HistoryStep = z.infer<typeof HistoryStepSchema>;
export type ViewportFilter = z.infer<typeof ViewportFilterSchema>;
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>;
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;
