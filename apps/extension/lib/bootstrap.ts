import { BridgeConfigSchema, NativeBootstrapSchema } from '@aether/shared';
import type { BridgeAddress } from './engine-socket.js';

const NATIVE_HOST = 'com.aether.browser';
const STORAGE_KEY = 'aether.bridge';
const NATIVE_RETRY_MS = 30000;

/**
 * Learn where the engine listens. The native host reads ~/.aether/bridge.json
 * and reports it; the address is kept in session storage so a restarted service
 * worker reconnects at once. Only this extension can write its own storage.
 */
export function startBootstrap(onAddress: (address: BridgeAddress | undefined) => void, onNoHost: (detail: string) => void): void {
  const read = async (): Promise<void> => {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const parsed = BridgeConfigSchema.safeParse(stored[STORAGE_KEY]);
    onAddress(parsed.success ? parsed.data : undefined);
  };
  void read();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && STORAGE_KEY in changes) void read();
  });

  const connect = (): void => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (error) {
      onNoHost(error instanceof Error ? error.message : String(error));
      setTimeout(connect, NATIVE_RETRY_MS);
      return;
    }
    port.onMessage.addListener((raw: unknown) => {
      const message = NativeBootstrapSchema.safeParse(raw);
      if (!message.success) return;
      if (message.data.type === 'aether.bridge') {
        void chrome.storage.session.set({ [STORAGE_KEY]: { port: message.data.port, token: message.data.token } });
      } else {
        void chrome.storage.session.remove(STORAGE_KEY);
      }
    });
    port.onDisconnect.addListener(() => {
      const detail = chrome.runtime.lastError?.message ?? 'the native host exited';
      onNoHost(`Native host unavailable (${detail}). Run apps/native-host/install.ps1 with this extension's ID.`);
      setTimeout(connect, NATIVE_RETRY_MS);
    });
  };
  connect();
}
