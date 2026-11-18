import { z } from 'zod';
import { PendingSchema } from './schemas.js';

/*
 * Spaces and tab records (plan 3.1, sections 4.3, 5.1, 5.2). The Human Space
 * has the fixed id `personal`; Agent Space ids are slugs made from the name
 * the host gives.
 */

export const HUMAN_SPACE_ID = 'personal';

export const SpaceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'Space ids are lowercase slugs up to 48 characters');

export const SpaceKindSchema = z.enum(['human', 'agent']);

/** `persist` shares the person's logins; `ephemeral` starts clean and is discarded with the Space. */
export const SpacePartitionSchema = z.enum(['persist', 'ephemeral']);

export const SpaceRunStateSchema = z.enum(['idle', 'acting', 'waiting_human', 'resuming', 'done']);

export const SpaceSchema = z.object({
  id: SpaceIdSchema,
  name: z.string().min(1).max(60),
  kind: SpaceKindSchema,
  partition: SpacePartitionSchema,
  state: SpaceRunStateSchema,
  createdAt: z.number().int(),
  archived: z.boolean(),
});

export const TabStateSchema = z.enum(['live', 'loading', 'hibernated', 'crashed']);

/** About 300 bytes per tab in SQLite; never DOM, heap or image data. */
export const TabRecordSchema = z.object({
  id: z.string().min(1).max(40),
  spaceId: SpaceIdSchema,
  url: z.string().max(4096),
  title: z.string().max(300),
  favicon: z.string().max(2048).optional(),
  scrollY: z.number().min(0),
  state: TabStateSchema,
  lastViewedAt: z.number().int(),
});

/** The single state of one Space; every view renders this and nothing else. */
export const SpaceFrameSchema = z.object({
  type: z.literal('aether.space'),
  spaceId: SpaceIdSchema,
  state: SpaceRunStateSchema,
  step: z.number().int().min(0),
  label: z.string().max(200),
  pending: PendingSchema.optional(),
  startedAt: z.number().int().optional(),
  timestamp: z.number().int(),
});

export const MilestoneStatusSchema = z.enum(['running', 'done', 'held', 'failed']);

/** One line in the Activity panel. Text from scripts or pages is shown as text, never as markup. */
export const MilestoneSchema = z.object({
  id: z.string().min(1),
  spaceId: SpaceIdSchema,
  text: z.string().min(1).max(200),
  status: MilestoneStatusSchema,
  source: z.enum(['host', 'engine', 'script']),
  startedAt: z.number().int(),
  endedAt: z.number().int().optional(),
});

/** Make a Space id from a host-given name: "Shoe hunt" becomes `shoe-hunt`. */
export function spaceIdFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug.length > 0 && slug !== HUMAN_SPACE_ID ? slug : 'task';
}

export type SpaceKind = z.infer<typeof SpaceKindSchema>;
export type SpacePartition = z.infer<typeof SpacePartitionSchema>;
export type SpaceRunState = z.infer<typeof SpaceRunStateSchema>;
export type Space = z.infer<typeof SpaceSchema>;
export type TabState = z.infer<typeof TabStateSchema>;
export type TabRecord = z.infer<typeof TabRecordSchema>;
export type SpaceFrame = z.infer<typeof SpaceFrameSchema>;
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
