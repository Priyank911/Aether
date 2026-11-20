/*
 * The shell page's only door to the main process: send a command, receive
 * snapshots. Nothing else from Electron or Node reaches the page.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('aether', {
  send: (command: unknown): Promise<unknown> => ipcRenderer.invoke('aether:command', command),
  onSnapshot: (listener: (snapshot: unknown) => void): (() => void) => {
    const receive = (_event: Electron.IpcRendererEvent, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on('aether:snapshot', receive);
    return () => ipcRenderer.removeListener('aether:snapshot', receive);
  },
});
