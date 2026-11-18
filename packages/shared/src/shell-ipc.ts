import { z } from 'zod';
import { HumanReplySchema, MemoryCommandSchema, MemoryListingSchema, RunControlSchema } from './schemas.js';
import { MilestoneSchema, SpaceFrameSchema, SpaceIdSchema, SpaceSchema, TabRecordSchema } from './spaces.js';

/*
 * Browser shell IPC (plan 3.1, section 10). The renderer only draws the
 * snapshot it receives and sends commands back; the main process validates
 * every command before acting on it.
 */

const TabId = z.string().min(1).max(40);

export const ShellCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tab.new'), spaceId: SpaceIdSchema.optional(), url: z.string().max(4096).optional() }),
  z.object({ type: z.literal('tab.close'), tabId: TabId }),
  z.object({ type: z.literal('tab.reopen') }),
  z.object({ type: z.literal('tab.activate'), tabId: TabId }),
  z.object({ type: z.literal('tab.move'), tabId: TabId, index: z.number().int().min(0) }),
  z.object({ type: z.literal('tab.mute'), tabId: TabId, muted: z.boolean() }),
  z.object({ type: z.literal('tab.sendToAgent'), tabId: TabId, spaceId: SpaceIdSchema.optional() }),
  /** What the person typed in the omnibox: a URL, a host, or search words. */
  z.object({ type: z.literal('nav.go'), input: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('nav.back') }),
  z.object({ type: z.literal('nav.forward') }),
  z.object({ type: z.literal('nav.reload'), hard: z.boolean().optional() }),
  z.object({ type: z.literal('nav.stop') }),
  z.object({ type: z.literal('space.switch'), spaceId: SpaceIdSchema }),
  z.object({ type: z.literal('space.close'), spaceId: SpaceIdSchema, deleteFiles: z.boolean() }),
  z.object({ type: z.literal('find.start'), text: z.string().max(500), forward: z.boolean() }),
  z.object({ type: z.literal('find.stop') }),
  z.object({ type: z.literal('zoom'), delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  z.object({ type: z.literal('panel.toggle'), open: z.boolean().optional() }),
  z.object({ type: z.literal('overlay.layout'), open: z.boolean() }),
  z.object({ type: z.literal('run.control'), control: RunControlSchema, spaceId: SpaceIdSchema }),
  z.object({ type: z.literal('run.reply'), reply: HumanReplySchema, spaceId: SpaceIdSchema }),
  z.object({ type: z.literal('memory'), command: MemoryCommandSchema }),
  z.object({ type: z.literal('shell.ready') }),
]);

export const ShellTabSchema = TabRecordSchema.extend({
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  audible: z.boolean(),
  muted: z.boolean(),
  zoomPercent: z.number().int().min(25).max(500),
});

export const ShellSpaceSchema = z.object({
  space: SpaceSchema,
  frame: SpaceFrameSchema.optional(),
  tabs: z.array(ShellTabSchema),
  activeTabId: TabId.optional(),
  milestones: z.array(MilestoneSchema),
});

/** Everything the renderer draws. Sent whole on change; it is small (metadata only). */
export const ShellSnapshotSchema = z.object({
  type: z.literal('shell.snapshot'),
  spaces: z.array(ShellSpaceSchema),
  activeSpaceId: SpaceIdSchema,
  panelOpen: z.boolean(),
  find: z.object({ text: z.string(), active: z.number().int(), total: z.number().int() }).optional(),
  platform: z.enum(['win32', 'darwin', 'linux']),
});

export const ShellEventSchema = z.union([ShellSnapshotSchema, MemoryListingSchema]);

export type ShellCommand = z.infer<typeof ShellCommandSchema>;
export type ShellTab = z.infer<typeof ShellTabSchema>;
export type ShellSpace = z.infer<typeof ShellSpaceSchema>;
export type ShellSnapshot = z.infer<typeof ShellSnapshotSchema>;
export type ShellEvent = z.infer<typeof ShellEventSchema>;
