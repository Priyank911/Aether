/*
 * The shell page's only door to the main process: send a command, receive
 * snapshots. Nothing else from Electron or Node reaches the page.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aether', {
  send: (command: unknown): Promise<unknown> => ipcRenderer.invoke('aether:command', command),
  onSnapshot: (listener: (snapshot: unknown) => void): void => {
    ipcRenderer.on('aether:snapshot', (_event, snapshot: unknown) => listener(snapshot));
  },
});
