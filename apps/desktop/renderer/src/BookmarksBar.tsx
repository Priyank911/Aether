import type { ShellCommand, ShellSnapshot } from '@aether/shared';

export default function BookmarksBar({ snapshot, send }: { snapshot: ShellSnapshot; send: (command: ShellCommand) => void }) {
  if (!snapshot.bookmarksVisible) return null;
  return <nav className="bookmarks-bar" aria-label="Bookmarks">
    {snapshot.bookmarks?.length ? snapshot.bookmarks.map((bookmark) => <button key={bookmark.url} type="button" title={bookmark.url} onClick={() => send({ type: 'nav.go', input: bookmark.url })}><span aria-hidden="true">☆</span><span>{bookmark.title || new URL(bookmark.url).host}</span></button>) : <span className="bookmarks-empty">Press Ctrl+D to bookmark a page in this Space.</span>}
  </nav>;
}
