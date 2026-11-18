/*
 * The engine both the CLI and the desktop app run: the browser session over
 * CDP, the agent tab it drives, the run state machine it reports, Smart
 * Landing, the space.* SDK adapter and the aether_exec report renderer.
 * Moved from apps/cli in Phase 3.1 unchanged; see docs/PLAN.md section 13.
 */
export { MCPBrowserSession } from './browser-session.js';
export type { Guarded, MCPBrowserSessionOptions, ToolOutput } from './browser-session.js';
export { CdpTabController } from './tab-controller.js';
export type { SessionTabController, SessionTabInfo } from './tab-controller.js';
export { AgentTab, NAVIGATION_TIMEOUT_MS } from './agent-tab.js';
export { smartLanding } from './landing/smart-landing.js';
export type { LandingResult } from './landing/smart-landing.js';
export { SessionSpaceEngine } from './codemode/session-engine.js';
export { renderReport } from './codemode/render-report.js';
export type { RenderedReport } from './codemode/render-report.js';
export { RunState, HOLD_TIMEOUT_MS } from './run/run-state.js';
export { ActionLog } from './run/action-log.js';
export { approvalDetail, asPolicyTarget, enclosingFormFields, inCaptchaFrame } from './run/approval.js';
export { toToolResult, wrapUntrustedPageText } from './tool-output.js';
export type { ToolContent } from './tool-output.js';
