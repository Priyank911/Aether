import { PanelRequestSchema, type EngineMessage } from '@aether/shared';
import { AgentTabs } from '../lib/agent-tabs.js';
import { startBootstrap } from '../lib/bootstrap.js';
import { CdpProxy, type CdpRequest } from '../lib/cdp-proxy.js';
import { EngineSocket } from '../lib/engine-socket.js';
import { StateHub } from '../lib/state-hub.js';

function isCdpRequest(message: EngineMessage): message is EngineMessage & CdpRequest {
  return 'id' in message && typeof message.id === 'number' && 'method' in message;
}

export default defineBackground(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const tabs = new AgentTabs();
  const hub = new StateHub(tabs);
  const socket: EngineSocket = new EngineSocket({
    onMessage: (message) => {
      if ('type' in message && message.type === 'aether.state') hub.publish(message);
      else if ('type' in message && message.type === 'aether.memory.listing') void chrome.runtime.sendMessage(message).catch(() => undefined);
      else if (isCdpRequest(message)) void proxy.handle(message);
    },
    onState: (state, detail) => hub.setConnection(state, detail),
  });
  const proxy = new CdpProxy(tabs, (message) => socket.send(message));
  proxy.start();

  startBootstrap(
    (address) => socket.setAddress(address),
    (detail) => hub.setConnection('no_host', detail),
  );

  // The side panel and the overlay pill send requests here; replies and controls go to the engine.
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    const parsed = PanelRequestSchema.safeParse(raw);
    if (!parsed.success) return false;
    const request = parsed.data;
    switch (request.type) {
      case 'aether.panel.sync': {
        // The panel is an extension page even when it is open in a tab; a content script runs on a web page.
        const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) ?? false;
        if (!fromExtensionPage && sender.tab) sendResponse({ frame: hub.frameFor(sender.tab.id) });
        else void hub.snapshot().then(sendResponse);
        return true;
      }
      case 'aether.adopt_tab':
        void chrome.tabs
          .query({ active: true, lastFocusedWindow: true })
          .then(async ([tab]) => {
            if (tab?.id === undefined) throw new Error('no active tab');
            await tabs.adopt(tab.id);
            sendResponse({ ok: true });
          })
          .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
        return true;
      default:
        sendResponse({ sent: socket.send(request) });
        return false;
    }
  });
});
