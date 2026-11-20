import { z } from 'zod';
import { AetherConfigSchema } from './config.js';
import { HumanReplySchema, MemoryCommandSchema, MemoryListingSchema, RunControlSchema, RunStateFrameSchema } from './schemas.js';
import { MilestoneSchema, SpaceFrameSchema, SpaceIdSchema, SpaceSchema, SpaceRunStateSchema, TabRecordSchema } from './spaces.js';

/*
 * Browser shell IPC (plan 3.1, section 10). The renderer only draws the
 * snapshot it receives and sends commands back; the main process validates
 * every command before acting on it.
 */

const TabId = z.string().min(1).max(40);
export const DesktopRunFrameSchema = RunStateFrameSchema.extend({ state: SpaceRunStateSchema });

export const OmniboxItemSchema = z.object({
  kind: z.enum(['history', 'bookmark', 'navigate', 'search']),
  label: z.string().max(4096),
  input: z.string().min(1).max(4096),
  url: z.string().max(4096).optional(),
});

export const OmniboxStateSchema = z.object({
  query: z.string().max(4096),
  selected: z.number().int().min(-1).max(7),
  left: z.number().finite().min(0),
  width: z.number().finite().positive(),
  items: z.array(OmniboxItemSchema).max(8),
});

/** Local navigation metadata; never included in service or model-facing schemas. */
export const NavigationEntrySchema = z.object({
  spaceId: SpaceIdSchema,
  url: z.string().max(4096).url().refine((value) => /^https?:\/\//i.test(value), 'expected an HTTP(S) URL'),
  title: z.string().max(512).default(''),
  at: z.number().int().nonnegative().optional(),
});

export const NavigationSeedSchema = NavigationEntrySchema.extend({ kind: z.enum(['history', 'bookmark']) });

export const ShellSettingsSchema = AetherConfigSchema.extend({ memoryEnabled: z.boolean() });

export const BrowserPromptSchema = z.object({
  id: z.number().int().positive(),
  tabId: TabId,
  kind: z.enum(['permission', 'auth', 'external']),
  origin: z.string().max(4096),
  detail: z.string().max(4096),
});

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
  z.object({
    type: z.literal('omnibox.update'),
    query: z.string().max(4096),
    selected: z.number().int().min(-1).max(7),
    left: z.number().finite().min(0),
    width: z.number().finite().positive(),
  }),
  z.object({ type: z.literal('omnibox.close') }),
  z.object({ type: z.literal('omnibox.move'), query: z.string().max(4096), direction: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ type: z.literal('omnibox.submit'), query: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('omnibox.accept'), index: z.number().int().min(0).max(7), query: z.string().max(4096), input: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('menu.open') }),
  z.object({ type: z.literal('nav.back') }),
  z.object({ type: z.literal('nav.forward') }),
  z.object({ type: z.literal('nav.reload'), hard: z.boolean().optional() }),
  z.object({ type: z.literal('nav.stop') }),
  z.object({ type: z.literal('page.print') }),
  z.object({ type: z.literal('browser.reply'), id: z.number().int().positive(), allow: z.boolean(), username: z.string().max(256).optional(), password: z.string().max(4096).optional() }),
  z.object({ type: z.literal('history.open') }),
  z.object({ type: z.literal('settings.open') }),
  z.object({ type: z.literal('settings.save'), settings: ShellSettingsSchema }),
  z.object({ type: z.literal('bookmark.toggle') }),
  z.object({ type: z.literal('bookmarks.toggle') }),
  z.object({ type: z.literal('space.switch'), spaceId: SpaceIdSchema }),
  z.object({ type: z.literal('space.menu'), open: z.boolean().optional() }),
  z.object({ type: z.literal('space.close'), spaceId: SpaceIdSchema, deleteFiles: z.boolean() }),
  z.object({ type: z.literal('find.open') }),
  z.object({ type: z.literal('find.start'), text: z.string().max(500), forward: z.boolean() }),
  z.object({ type: z.literal('find.stop') }),
  z.object({ type: z.literal('zoom'), delta: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  z.object({ type: z.literal('panel.toggle'), open: z.boolean().optional() }),
  z.object({ type: z.literal('panel.resize'), width: z.number().int().min(280).max(480) }),
  z.object({ type: z.literal('overlay.layout'), open: z.boolean() }),
  z.object({ type: z.literal('run.control'), control: RunControlSchema, spaceId: SpaceIdSchema }),
  z.object({ type: z.literal('run.reply'), reply: HumanReplySchema, spaceId: SpaceIdSchema }),
  z.object({ type: z.literal('memory'), command: MemoryCommandSchema }),
  z.object({ type: z.literal('toast.dismiss'), id: z.number().int().nonnegative() }),
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
  panelWidth: z.number().nonnegative().optional(),
  memory: MemoryListingSchema.optional(),
  focusOmnibox: z.number().int().nonnegative().optional(),
  agentBarVisible: z.boolean().optional(),
  chromeHeight: z.number().nonnegative().optional(),
  bookmarksVisible: z.boolean().optional(),
  bookmarks: z.array(NavigationEntrySchema).optional(),
  spaceMenuOpen: z.boolean().optional(),
  archivedSpaces: z.array(SpaceSchema).optional(),
  omnibox: OmniboxStateSchema.optional(),
  find: z.object({ text: z.string(), active: z.number().int(), total: z.number().int(), focus: z.number().int().nonnegative() }).optional(),
  settings: ShellSettingsSchema.optional(),
  browserPrompt: BrowserPromptSchema.optional(),
  actionTarget: z.object({ tabId: TabId, x: z.number().finite(), y: z.number().finite(), timestamp: z.number().nonnegative() }).optional(),
  toast: z.object({ id: z.number().int().nonnegative(), text: z.string().max(500) }).optional(),
  platform: z.enum(['win32', 'darwin', 'linux']),
});

export const ShellEventSchema = z.union([ShellSnapshotSchema, MemoryListingSchema]);

/** Available only through the opt-in local Electron test control channel. */
export const ShellTestInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('char'), keyCode: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('keyDown'), keyCode: z.string().min(1).max(40), modifiers: z.array(z.enum(['control', 'shift', 'alt', 'meta'])).optional() }),
  z.object({ type: z.literal('keyUp'), keyCode: z.string().min(1).max(40), modifiers: z.array(z.enum(['control', 'shift', 'alt', 'meta'])).optional() }),
  z.object({ type: z.literal('mouseDown'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), button: z.literal('left'), clickCount: z.literal(1) }),
  z.object({ type: z.literal('mouseUp'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), button: z.literal('left'), clickCount: z.literal(1) }),
]);

export type ShellSettings = z.infer<typeof ShellSettingsSchema>;
export type BrowserPrompt = z.infer<typeof BrowserPromptSchema>;
export type OmniboxItem = z.infer<typeof OmniboxItemSchema>;
export type OmniboxState = z.infer<typeof OmniboxStateSchema>;
export type NavigationEntry = z.infer<typeof NavigationEntrySchema>;
export type NavigationSeed = z.infer<typeof NavigationSeedSchema>;
export type ShellCommand = z.infer<typeof ShellCommandSchema>;
export type ShellTab = z.infer<typeof ShellTabSchema>;
export type ShellSpace = z.infer<typeof ShellSpaceSchema>;
export type ShellSnapshot = z.infer<typeof ShellSnapshotSchema>;
export type ShellEvent = z.infer<typeof ShellEventSchema>;
