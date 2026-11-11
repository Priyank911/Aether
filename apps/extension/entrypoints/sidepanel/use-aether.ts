import React from 'react';
import {
  ConnectionStatusSchema,
  PanelSnapshotSchema,
  RunStateFrameSchema,
  type PanelRequest,
  type PanelSnapshot,
} from '@aether/shared';

const EMPTY: PanelSnapshot = {
  connection: { type: 'aether.connection', state: 'no_host', detail: 'Starting' },
  agentTab: { type: 'aether.agent_tab', title: 'No agent tab yet' },
  recent: [],
};

/** The panel renders only what the service worker sends; it keeps no run state of its own. */
export function useAether(): { snapshot: PanelSnapshot; send: (request: PanelRequest) => Promise<unknown> } {
  const [snapshot, setSnapshot] = React.useState<PanelSnapshot>(EMPTY);

  const sync = React.useCallback(() => {
    void chrome.runtime
      .sendMessage({ type: 'aether.panel.sync' })
      .then((response: unknown) => {
        const parsed = PanelSnapshotSchema.safeParse(response);
        if (parsed.success) setSnapshot(parsed.data);
      })
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    sync();
    const onMessage = (raw: unknown): void => {
      const frame = RunStateFrameSchema.safeParse(raw);
      if (frame.success) {
        setSnapshot((current) => {
          const last = current.recent[0];
          const changed = !last || last.step !== frame.data.step || last.label !== frame.data.label || last.state !== frame.data.state;
          return { ...current, frame: frame.data, recent: changed ? [frame.data, ...current.recent].slice(0, 40) : current.recent };
        });
        return;
      }
      const connection = ConnectionStatusSchema.safeParse(raw);
      if (connection.success) setSnapshot((current) => ({ ...current, connection: connection.data }));
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onUpdated.addListener(sync);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(sync);
    };
  }, [sync]);

  const send = React.useCallback(async (request: PanelRequest) => {
    const response: unknown = await chrome.runtime.sendMessage(request).catch(() => undefined);
    sync();
    return response;
  }, [sync]);

  return { snapshot, send };
}
