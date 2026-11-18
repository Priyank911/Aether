import type { CDPClient } from '@aether/cdp';
import type { RunContext, SpaceEngine } from '@aether/codemode';
import { MCPBrowserSession, SessionSpaceEngine } from '@aether/engine';
import type { ConfigSource, DatabaseHandle, Logger } from '@aether/memory';
import type { ExecOutcome, SpaceMethod, WaitReason } from '@aether/shared';
import type { SpaceManager } from '../space-manager.js';
import { SpaceTabController } from './engine-tabs.js';

/*
 * The space.* SDK over the desktop's Spaces (plan 3.2, task 3.2). Each Agent
 * Space gets its own MCPBrowserSession over the shared Electron CDP client,
 * so run state, provenance and memory context stay per Space, while the
 * per-call perception and action code is the engine's own, unchanged. The
 * engine session is created with the first call on that Space.
 */

export interface DesktopSpaceEngineOptions {
  manager: SpaceManager;
  client: CDPClient;
  database: DatabaseHandle;
  config: ConfigSource;
  logger?: Logger;
  /** One line of script or engine progress, for the Activity panel. */
  onMilestone?: (spaceId: string, text: string, source: 'host' | 'engine' | 'script') => void;
}

export class DesktopSpaceEngine implements SpaceEngine {
  private readonly options: DesktopSpaceEngineOptions;
  private readonly engines = new Map<string, SessionSpaceEngine>();

  public constructor(options: DesktopSpaceEngineOptions) {
    this.options = options;
  }

  public async call(method: SpaceMethod, args: unknown[], run: RunContext): Promise<unknown> {
    return this.engineFor(run.spaceId, run.spaceName).call(method, args, run);
  }

  public pendingHuman(spaceId: string): { reason: WaitReason; prompt: string } | undefined {
    return this.engines.get(spaceId)?.pendingHuman();
  }

  public runStarted(run: RunContext, thought: string): void {
    this.options.onMilestone?.(run.spaceId, thought, 'host');
    this.engineFor(run.spaceId, run.spaceName).runStarted(run, thought);
  }

  public runEnded(run: RunContext, outcome: ExecOutcome): void {
    this.engines.get(run.spaceId)?.runEnded(run, outcome);
  }

  /** The person answered a pending request of this Space (plan 3.2, task 3.3). Returns false when nothing waits on it. */
  public reply(spaceId: string, reply: { id: string; kind: 'answer' | 'approve' | 'deny' | 'done' | 'resume'; text?: string }): boolean {
    return this.engines.get(spaceId)?.session.run.receive({ type: 'aether.reply', ...reply }) ?? false;
  }

  /** The person pressed Stop or Take over on this Space: it acts at once, not at the script's next call. */
  public control(spaceId: string, kind: 'stop' | 'takeover'): void {
    this.engines.get(spaceId)?.session.run.control({ type: 'aether.control', kind });
  }

  /** The session behind a Space, for the service and tests. Created with the Space's first call. */
  public sessionFor(spaceId: string): MCPBrowserSession | undefined {
    if (!this.engines.has(spaceId)) return undefined;
    return this.engineFor(spaceId).session;
  }

  private engineFor(spaceId: string, spaceName?: string): SessionSpaceEngine {
    let engine = this.engines.get(spaceId);
    if (!engine) {
      // A host names the Space; the manager creates it (or reuses it) on first use.
      this.options.manager.agentSpace(spaceName?.trim() || spaceId);
      const session = MCPBrowserSession.overSync(this.options.client, {
        database: this.options.database,
        config: this.options.config,
        logger: this.options.logger,
        onMilestone: (text, source) => this.options.onMilestone?.(spaceId, text, source),
      }, new SpaceTabController(spaceId, this.options.manager, this.options.client));
      engine = new SessionSpaceEngine(session);
      this.engines.set(spaceId, engine);
      // One state machine per Space drives the record, the Agent bar and the side panel.
      session.run.onFrame((frame) => this.options.manager.setRunFrame(spaceId, frame));
    }
    return engine;
  }
}
