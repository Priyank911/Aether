import { useEffect, useState } from 'react';
import type { ShellCommand, ShellSnapshot } from '@aether/shared';

/*
 * The Shell Overlay (plan 3.1, section 10.3): a transparent layer over the
 * page viewport. It draws the 2px agent frame while an Agent Space acts and
 * hosts future omnibox suggestions, the input shield, the ghost cursor,
 * the reticle and toasts. Root stays click-through; interactive children
 * re-enable input through the 'overlay.layout' command.
 */
export default function Overlay() {
  const [snap, setSnap] = useState<ShellSnapshot | null>(null);

  useEffect(() => {
    window.aether.onSnapshot(setSnap);
    window.aether.send({ type: 'shell.ready' }).catch(() => {});
  }, []);

  const entry = snap?.spaces.find((s) => s.space.id === snap.activeSpaceId);
  const agentActive = Boolean(entry?.space.kind === 'agent' && entry.frame && entry.frame.state !== 'idle');

  return (
    <div className="ovl">
      {agentActive && (
        <div className="agent-frame" aria-hidden="true">
          <i className="edge top" /><i className="edge bottom" /><i className="edge left" /><i className="edge right" />
        </div>
      )}
    </div>
  );
}

export type { ShellCommand };
