import type { OmniboxState } from '@aether/shared';

const sources = { history: 'History', bookmark: 'Bookmark', navigate: 'Open address', search: 'Google search' };

/** The accessible listbox lives with the input; this native overlay is its visual pointer surface. */
export default function OmniboxSuggestions({ state }: { state: OmniboxState }) {
  return (
    <div className="suggestions-backdrop" data-query={state.query} aria-hidden="true">
      <button type="button" className="space-menu-dismiss" tabIndex={-1} onMouseDown={() => { void window.aether.send({ type: 'omnibox.close' }); }} />
      {state.items.length > 0 && <div className="suggestions" style={{ left: state.left, width: state.width }}>
        {state.items.map((item, index) => <button key={`${item.kind}:${item.input}`} type="button" tabIndex={-1}
          className={`suggestion${state.selected === index ? ' selected' : ''}`} data-suggestion-index={index}
          onMouseDown={(event) => { event.preventDefault(); void window.aether.send({ type: 'omnibox.accept', index, query: state.query, input: item.input }); }}>
          <span className="suggestion-copy"><span className="suggestion-label">{item.label}</span>{item.url && item.kind !== 'search' && <span className="suggestion-url">{item.url}</span>}</span>
          <span className="suggestion-source">{sources[item.kind]}</span>
        </button>)}
      </div>}
    </div>
  );
}
