import { useEffect, useRef, useState } from 'react';
import type { ShellCommand, ShellSnapshot, ShellSpace } from '@aether/shared';
import { Icon, Tab } from './chrome';

export default function TabStrip({ snapshot, entry, send, onNewTab }: {
  snapshot: ShellSnapshot;
  entry: ShellSpace;
  send: (command: ShellCommand) => void;
  onNewTab(): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const wasMenuOpen = useRef(false);
  const state = entry.space.kind === 'human' ? 'personal' : entry.frame?.state ?? entry.space.state;

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [entry.activeTabId, entry.space.id]);

  useEffect(() => {
    if (wasMenuOpen.current && !snapshot.spaceMenuOpen && document.activeElement?.getAttribute('role') !== 'combobox') chip.current?.focus();
    wasMenuOpen.current = Boolean(snapshot.spaceMenuOpen);
  }, [snapshot.spaceMenuOpen]);

  return (
    <div className="strip">
      <button ref={chip} className={`space-chip state-${state}`} type="button" title={`Switch Space: ${entry.space.name}`}
        aria-label={`Switch Space: ${entry.space.name}`} aria-haspopup="menu" aria-expanded={Boolean(snapshot.spaceMenuOpen)}
        onClick={() => send({ type: 'space.menu' })}>
        <span className="dot" aria-hidden="true" />
        <span className="space-name">{entry.space.name}</span>
        <Icon id="i-chevron" size={14} />
      </button>
      <div ref={list} className="tabs" role="tablist" aria-label={`Tabs in ${entry.space.name}`}
        onWheel={(event) => {
          if (!list.current || list.current.scrollWidth <= list.current.clientWidth) return;
          list.current.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        }}
        onKeyDown={(event) => {
          if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
          const targetId = event.target.getAttribute('data-tab-id');
          const from = entry.tabs.findIndex((tab) => tab.id === targetId);
          const count = entry.tabs.length;
          if (from < 0 || !count) return;
          let index: number;
          if (event.key === 'ArrowRight') index = (from + 1) % count;
          else if (event.key === 'ArrowLeft') index = (from - 1 + count) % count;
          else if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = count - 1;
          else return;
          event.preventDefault();
          const tab = entry.tabs[index];
          send({ type: 'tab.activate', tabId: tab.id });
          list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
        }}>
        {entry.tabs.map((tab, index) => <Tab key={tab.id} tab={tab} active={tab.id === entry.activeTabId} dragging={dragging === tab.id}
          onActivate={() => send({ type: 'tab.activate', tabId: tab.id })}
          onClose={() => send({ type: 'tab.close', tabId: tab.id })}
          onMute={() => send({ type: 'tab.mute', tabId: tab.id, muted: !tab.muted })}
          onDragStart={(event) => {
            if (event.target instanceof HTMLElement && event.target.closest('button')) { event.preventDefault(); return; }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('application/x-aether-tab', tab.id);
            setDragging(tab.id);
          }}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const bounds = list.current?.getBoundingClientRect();
            if (bounds && list.current) {
              if (event.clientX < bounds.left + 28) list.current.scrollLeft -= 28;
              else if (event.clientX > bounds.right - 28) list.current.scrollLeft += 28;
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (!dragging || event.dataTransfer.getData('application/x-aether-tab') !== dragging) return;
            const from = entry.tabs.findIndex((candidate) => candidate.id === dragging);
            if (from < 0) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const after = event.clientX >= bounds.left + bounds.width / 2;
            const destination = index + (after ? 1 : 0) - (from < index || (from === index && after) ? 1 : 0);
            if (destination !== from) send({ type: 'tab.move', tabId: dragging, index: destination });
            setDragging(null);
          }}
          onDragEnd={() => setDragging(null)} />)}
      </div>
      <button className="icon-btn strip-btn" type="button" aria-label="New tab" title="New tab (Ctrl+T)" onClick={onNewTab}>
        <Icon id="i-plus" size={18} />
      </button>
      <span className="strip-drag-space" aria-hidden="true" />
    </div>
  );
}
