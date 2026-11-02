import { BridgeMessageSchema, BridgeStatusSchema, CdpWireMessageSchema } from '@aether/shared';

const NATIVE_HOST = 'com.aether.browser';
const ROOT_SESSION = 'aether-extension-root';
let nativePort: chrome.runtime.Port | undefined;
let attachedTabId: number | undefined;
let lastStatus: ReturnType<typeof BridgeStatusSchema.parse> = {
  type: 'aether.status', state: 'disconnected', label: 'Waiting for MCP host', timestamp: Date.now(),
};
let recentStatuses: Array<ReturnType<typeof BridgeStatusSchema.parse>> = [];

export default defineBackground(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  connectNativeHost();
  chrome.runtime.onStartup.addListener(connectNativeHost);
  chrome.runtime.onInstalled.addListener(connectNativeHost);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'aether.getStatus') {
      sendResponse({ status: lastStatus, recent: recentStatuses });
    }
  });
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId === undefined) return;
    const sessionId = source.sessionId ?? ROOT_SESSION;
    sendToHost({ method, params: params as Record<string, unknown> | undefined, sessionId });
  });
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId === attachedTabId) attachedTabId = undefined;
    publishStatus('disconnected', `Chrome debugger detached: ${reason}`);
  });
});

function connectNativeHost(): void {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort.onMessage.addListener((raw: unknown) => {
      let parsed: unknown;
      try {
        parsed = BridgeMessageSchema.parse(raw);
      } catch {
        publishStatus('disconnected', 'Rejected an invalid bridge message');
        return;
      }
      if (isCdpRequest(parsed)) void handleCdpRequest(parsed);
      else if (isCdpEvent(parsed)) void handleCdpEvent(parsed);
      else {
        const status = BridgeStatusSchema.safeParse(parsed);
        if (status.success) publishStatus(status.data.state, status.data.label, status.data.handoff);
      }
    });
    nativePort.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message ?? 'Native messaging host disconnected';
      nativePort = undefined;
      attachedTabId = undefined;
      publishStatus('disconnected', message);
      setTimeout(connectNativeHost, 2500);
    });
    publishStatus('connected', 'Connected to Aether MCP host');
  } catch (error) {
    publishStatus('disconnected', error instanceof Error ? error.message : String(error));
    setTimeout(connectNativeHost, 2500);
  }
}

async function handleCdpRequest(request: { id: number; method: string; params?: Record<string, unknown>; sessionId?: string }): Promise<void> {
  try {
    let result: Record<string, unknown>;
    if (request.method === 'Target.getTargets') {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      result = {
        targetInfos: tabs.flatMap((tab) => tab.id === undefined ? [] : [{
          targetId: String(tab.id),
          type: 'page',
          title: tab.title ?? '',
          url: tab.url ?? '',
          attached: attachedTabId === tab.id,
        }]),
      };
    } else if (request.method === 'Target.attachToTarget') {
      const targetId = request.params?.targetId;
      const tabId = Number(targetId);
      if (!Number.isInteger(tabId)) throw new Error('Invalid Chrome tab target');
      if (attachedTabId !== tabId) {
        if (attachedTabId !== undefined) await chrome.debugger.detach({ tabId: attachedTabId }).catch(() => undefined);
        await chrome.debugger.attach({ tabId }, '1.3');
        attachedTabId = tabId;
      }
      result = { sessionId: ROOT_SESSION };
      publishStatus('step', 'Attached to selected Chrome tab');
    } else {
      const tabId = attachedTabId;
      if (tabId === undefined) throw new Error('No Chrome tab is attached');
      const debuggee: chrome.debugger.Debuggee & { sessionId?: string } = { tabId };
      if (request.sessionId && request.sessionId !== ROOT_SESSION) debuggee.sessionId = request.sessionId;
      const label = actionLabel(request.method, request.params);
      if (label) publishStatus('step', label);
      const value = await chrome.debugger.sendCommand(debuggee, request.method, request.params);
      result = isRecord(value) ? value : {};
    }
    sendToHost({ id: request.id, result, ...(request.sessionId ? { sessionId: request.sessionId } : {}) });
  } catch (error) {
    sendToHost({ id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) }, ...(request.sessionId ? { sessionId: request.sessionId } : {}) });
  }
}

async function handleCdpEvent(_event: { method: string; params?: Record<string, unknown>; sessionId?: string }): Promise<void> {
  // CDP events flow from chrome.debugger.onEvent to the native host.
}

function sendToHost(message: unknown): void {
  if (!nativePort) return;
  try {
    const checked = CdpWireMessageSchema.parse(message);
    const encoded = JSON.stringify(checked);
    if (new TextEncoder().encode(encoded).byteLength > 1024 * 1024) {
      if (isRecord(checked) && 'id' in checked && typeof checked.id === 'number') {
        nativePort.postMessage(CdpWireMessageSchema.parse({
          id: checked.id,
          error: { code: -32000, message: 'Bridge response exceeds the 1 MiB Chrome Native Messaging limit' },
          ...('sessionId' in checked && typeof checked.sessionId === 'string' ? { sessionId: checked.sessionId } : {}),
        }));
      }
      return;
    }
    nativePort.postMessage(checked);
  } catch {
    publishStatus('disconnected', 'Unable to send a valid CDP message to native host');
  }
}

function publishStatus(state: ReturnType<typeof BridgeStatusSchema.shape.state.parse>, label: string, handoff?: ReturnType<typeof BridgeStatusSchema.shape.handoff.parse>): void {
  const status = {
    type: 'aether.status' as const,
    state,
    label: label.slice(0, 180),
    timestamp: Date.now(),
    ...(handoff ? { handoff } : {}),
  };
  try {
    const checked = BridgeMessageSchema.parse(status);
    if ('type' in checked && checked.type === 'aether.status') {
      lastStatus = checked;
      recentStatuses = [checked, ...recentStatuses].slice(0, 8);
    }
    nativePort?.postMessage(checked);
    void chrome.runtime.sendMessage(checked).catch(() => undefined);
  } catch {
    // Ignore status updates that fail their shared wire schema.
  }
}

function isCdpRequest(message: unknown): message is { id: number; method: string; params?: Record<string, unknown>; sessionId?: string } {
  return isRecord(message) && 'id' in message && 'method' in message;
}

function isCdpEvent(message: unknown): message is { method: string; params?: Record<string, unknown>; sessionId?: string } {
  return isRecord(message) && 'method' in message && !('id' in message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeHost(value: unknown): string {
  if (typeof value !== 'string') return 'page';
  try { return new URL(value).host; } catch { return 'page'; }
}

function actionLabel(method: string, params?: Record<string, unknown>): string | undefined {
  if (method === 'Page.navigate') return `Navigate to ${safeHost(params?.url)}`;
  if (method === 'Input.insertText') return 'Enter text in the selected field';
  if (method === 'Input.dispatchKeyEvent') return 'Use the keyboard';
  if (method === 'Input.dispatchMouseEvent') return 'Interact with the selected element';
  if (method === 'DOM.scrollIntoViewIfNeeded') return 'Bring the selected element into view';
  if (method === 'Page.captureScreenshot') return 'Capture a page screenshot';
  if (method === 'Accessibility.getFullAXTree') return 'Read the page structure';
  return undefined;
}
