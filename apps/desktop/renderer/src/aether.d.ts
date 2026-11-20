import type { ShellCommand, ShellSnapshot } from '@aether/shared';

declare global {
  interface Window {
    aether: {
      send(command: ShellCommand): Promise<unknown>;
      onSnapshot(listener: (snapshot: ShellSnapshot) => void): () => void;
    };
  }
}
