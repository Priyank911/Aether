import type { CodeModeHost } from '@aether/codemode';
import { wrapUntrustedOrigins } from '@aether/policy';
import { renderReport, toToolResult, type ToolContent, type ToolOutput } from '@aether/engine';
import {
  AetherDoneParamsSchema,
  AetherExecParamsSchema,
  AetherScreenshotParamsSchema,
  AetherSpacesParamsSchema,
  doneParamsProblem,
  screenshotParamsProblem,
  spaceIdFromName,
  spacesParamsProblem,
  type HostToolName,
  type ToolResult,
} from '@aether/shared';
import type { SpaceManager } from '../space-manager.js';
import type { DesktopSpaceEngine } from './desktop-engine.js';

/*
 * The four host operations (plan 3.2, section 8.1) over the desktop's
 * Spaces. The text is the same both connectors render: engine facts outside
 * the wrapper, page-derived text inside it. `aether mcp` and the `aether`
 * command both land here through the service.
 */

export interface DesktopToolsOptions {
  manager: SpaceManager;
  engine: DesktopSpaceEngine;
  codeMode: CodeModeHost;
  /** One row per call in the run log, as the CLI's MCP server does. */
  onStep?: (tool: string, isError: boolean, tokens: number, ms: number) => void;
}

function result(text: string, isError = false, images?: ToolResult['images']): ToolResult {
  return images && images.length > 0 ? { text, isError, images } : { text, isError };
}

/** An engine output as a wire ToolResult: notes and wrapped page text as one text block, then the image. */
function resultOf(output: ToolOutput): ToolResult {
  const rendered = toToolResult(output);
  const text = rendered.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  const images = rendered.content.flatMap((block) => (block.type === 'image' ? [{ mimeType: 'image/png' as const, data: block.data }] : []));
  return result(text, rendered.isError, images);
}

export class DesktopTools {
  private readonly options: DesktopToolsOptions;

  public constructor(options: DesktopToolsOptions) {
    this.options = options;
  }

  public async call(tool: HostToolName, rawParams: unknown): Promise<ToolResult> {
    const started = Date.now();
    try {
      const finished = await this.dispatch(tool, rawParams);
      this.options.onStep?.(tool, finished.isError, Math.ceil(finished.text.length / 3.5), Date.now() - started);
      return finished;
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.options.onStep?.(tool, true, Math.ceil(text.length / 3.5), Date.now() - started);
      return result(text, true);
    }
  }

  private async dispatch(tool: HostToolName, rawParams: unknown): Promise<ToolResult> {
    switch (tool) {
      case 'aether_exec':
        return this.exec(rawParams);
      case 'aether_screenshot':
        return this.screenshot(rawParams);
      case 'aether_spaces':
        return this.spaces(rawParams);
      case 'aether_done':
        return this.done(rawParams);
    }
  }

  private async exec(rawParams: unknown): Promise<ToolResult> {
    const parsed = AetherExecParamsSchema.safeParse(rawParams);
    if (!parsed.success) return result(`bad aether_exec arguments: ${parsed.error.issues[0]?.message ?? 'invalid'}`, true);
    const rendered = renderReport(await this.options.codeMode.exec(parsed.data));
    const meta: Record<string, unknown> = { ...rendered.meta };
    return { text: rendered.text, isError: rendered.isError, meta };
  }

  private async screenshot(rawParams: unknown): Promise<ToolResult> {
    const parsed = AetherScreenshotParamsSchema.safeParse(rawParams);
    if (!parsed.success) return result(`bad aether_screenshot arguments: ${parsed.error.issues[0]?.message ?? 'invalid'}`, true);
    const problem = screenshotParamsProblem(parsed.data);
    if (problem) return result(problem, true);
    const session = this.sessionOf(parsed.data.space);
    if (!session) return result(`no agent Space named "${parsed.data.space}" is running; aether_exec creates one`, true);
    return resultOf(await session.screenshot({ ref: parsed.data.ref }));
  }

  private async spaces(rawParams: unknown): Promise<ToolResult> {
    const parsed = AetherSpacesParamsSchema.safeParse(rawParams);
    if (!parsed.success) return result(`bad aether_spaces arguments: ${parsed.error.issues[0]?.message ?? 'invalid'}`, true);
    const params = parsed.data;
    const problem = spacesParamsProblem(params);
    if (problem) return result(problem, true);
    if (params.op === 'list') {
      const running = this.options.codeMode.runningSpaces();
      const origins = new Set<string>();
      const lines = this.options.manager
        .list()
        .filter((entry) => entry.record.kind === 'agent' && !entry.record.archived)
        .map((entry) => {
          const state = entry.record.state === 'idle' ? 'idle' : entry.record.state;
          const tabs = entry.tabs.map((tab) => {
            try { const origin = new URL(tab.url).origin; origins.add(origin === 'null' ? 'opaque' : origin); }
            catch { origins.add('opaque'); }
            return `${tab.title || tab.url || 'New tab'} (${tab.state})`;
          }).join('; ');
          return `- ${entry.record.name} [${state}]: ${entry.tabs.length} tabs${tabs ? `: ${tabs}` : ''}`;
        });
      return result([`Agent Spaces:`, ...(lines.length ? [origins.size ? wrapUntrustedOrigins(lines.join('\n'), [...origins]) : lines.join('\n')] : []), running.length > 0 ? `running scripts: ${running.join(', ')}` : 'no script running'].join('\n'));
    }
    const spaceId = spaceIdFromName(params.space ?? '');
    if (params.op === 'focus') {
      const entry = this.options.manager.list().find((candidate) => candidate.record.id === spaceId);
      if (!entry) return result(`no Space named "${params.space}"`, true);
      this.options.manager.showSpace(spaceId);
      return result(`${entry.record.name} is now shown in the window`);
    }
    const entry = this.options.manager.list().find((candidate) => candidate.record.id === spaceId);
    if (!entry) return result(`no Space named "${params.space}"`, true);
    await this.options.manager.closeSpace(spaceId);
    this.options.codeMode.clearState(spaceId);
    return result(`${entry.record.name} closed; its caches were swept and its downloads folder remains until you delete the Space`);
  }

  private async done(rawParams: unknown): Promise<ToolResult> {
    const parsed = AetherDoneParamsSchema.safeParse(rawParams);
    if (!parsed.success) return result(`bad aether_done arguments: ${parsed.error.issues[0]?.message ?? 'invalid'}`, true);
    const params = parsed.data;
    const problem = doneParamsProblem(params);
    if (problem) return result(problem, true);
    const spaceId = spaceIdFromName(params.space);
    if (this.options.codeMode.isRunning(spaceId)) return result(`a script is still running in Space "${params.space}"; wait for it before ending the run`, true);
    const session = this.options.engine.sessionFor(spaceId);
    if (!session) return result(`no agent Space named "${params.space}" has run in this app session`, true);
    this.options.codeMode.clearState(spaceId);
    const output = session.done({ result: params.result, evidence: params.evidence ?? '', success: params.success });
    const label = params.result.split('\n')[0]?.slice(0, 190) || (params.success ? 'Task finished' : 'Stopped without finishing');
    this.options.manager.setRunFrame(spaceId, { state: 'done', step: session.run.frame().step, label, timestamp: Date.now() });
    this.options.manager.addMilestone(spaceId, `Done · ${label}`, 'host', params.success ? 'done' : 'failed');
    return resultOf(output);
  }

  private sessionOf(spaceName: string) {
    return this.options.engine.sessionFor(spaceIdFromName(spaceName));
  }
}

export type { ToolContent };
