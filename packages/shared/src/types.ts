import type { z } from 'zod';
import type { ActionItemSchema, ActionOpSchema, ActionRiskSchema, ActParamsSchema } from './schemas.js';

export type ActionOp = z.infer<typeof ActionOpSchema>;
export type ActionRisk = z.infer<typeof ActionRiskSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type ActParams = z.infer<typeof ActParamsSchema>;
