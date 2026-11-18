/*
 * Interim shell (plan 3.1, Step 2). It draws the snapshot the main process
 * sends and turns clicks and keys into shell commands; it keeps no state of
 * its own. Page text (titles, URLs) is only ever set as textContent or value.
 */
(() => {
  const api = window.aether;
  const $ = (id) => document.getElementById(id);
  const tabsEl = $('tabs');
  const spaceEl = $('space');
  const omnibox = $('omnibox');
  const notice = $('notice');
  let snapshot;
  let editing = false;

  const send = async (command) => {
    const result = await api.send(command);
    notice.textContent = result && result.ok === false ? result.error : '';
  };

  const visible = () => snapshot?.spaces.find((entry) => entry.space.id === snapshot.activeSpaceId);
  const activeTab = () => {
    const entry = visible();
    return entry?.tabs.find((tab) => tab.id === entry.activeTabId);
  };

  const shownUrl = (url) => (url === 'about:blank' ? '' : url);

  function render() {
    const entry = visible();
    if (!entry) return;
    spaceEl.replaceChildren(
      ...snapshot.spaces.map((space) => {
        const option = document.createElement('option');
        option.value = space.space.id;
        option.textContent = space.space.name;
        option.selected = space.space.id === snapshot.activeSpaceId;
        return option;
      }),
    );
    $('space-dot').className = `dot${entry.space.kind === 'agent' ? ' agent' : ''}`;
    tabsEl.replaceChildren(
      ...entry.tabs.map((tab) => {
        const button = document.createElement('div');
        button.className = `tab${tab.state === 'hibernated' ? ' sleeping' : ''}`;
        button.setAttribute('role', 'tab');
        button.tabIndex = 0;
        button.setAttribute('aria-selected', String(tab.id === entry.activeTabId));
        button.title = tab.state === 'hibernated' ? 'Sleeping to save memory. Click to load.' : tab.title || tab.url;
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = tab.title || shownUrl(tab.url) || 'New tab';
        const close = document.createElement('button');
        close.className = 'close';
        close.type = 'button';
        close.textContent = '×';
        close.setAttribute('aria-label', `Close ${title.textContent}`);
        close.addEventListener('click', (event) => {
          event.stopPropagation();
          void send({ type: 'tab.close', tabId: tab.id });
        });
        button.addEventListener('click', () => void send({ type: 'tab.activate', tabId: tab.id }));
        button.addEventListener('auxclick', (event) => {
          if (event.button === 1) void send({ type: 'tab.close', tabId: tab.id });
        });
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') void send({ type: 'tab.activate', tabId: tab.id });
        });
        button.append(title, close);
        return button;
      }),
    );
    const tab = activeTab();
    $('back').disabled = !tab?.canGoBack;
    $('forward').disabled = !tab?.canGoForward;
    if (!editing) omnibox.value = tab ? shownUrl(tab.url) : '';
    document.title = tab?.title ? `${tab.title} - Aether` : 'Aether';
  }

  api.onSnapshot((next) => {
    snapshot = next;
    render();
  });

  spaceEl.addEventListener('change', () => void send({ type: 'space.switch', spaceId: spaceEl.value }));
  $('new-tab').addEventListener('click', () => {
    void send({ type: 'tab.new' }).then(() => omnibox.focus());
  });
  $('back').addEventListener('click', () => void send({ type: 'nav.back' }));
  $('forward').addEventListener('click', () => void send({ type: 'nav.forward' }));
  $('reload').addEventListener('click', () => void send({ type: 'nav.reload' }));
  omnibox.addEventListener('focus', () => {
    editing = true;
    omnibox.select();
  });
  omnibox.addEventListener('blur', () => {
    editing = false;
    render();
  });
  $('omnibox-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = omnibox.value.trim();
    if (!input) return;
    editing = false;
    omnibox.blur();
    void send({ type: 'nav.go', input });
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    const tab = activeTab();
    if (mod && event.key.toLowerCase() === 't' && !event.shiftKey) send({ type: 'tab.new' }).then(() => omnibox.focus());
    else if (mod && event.shiftKey && event.key.toLowerCase() === 't') void send({ type: 'tab.reopen' });
    else if (mod && event.key.toLowerCase() === 'w' && tab) void send({ type: 'tab.close', tabId: tab.id });
    else if ((mod && event.key.toLowerCase() === 'l') || event.key === 'F6') omnibox.focus();
    else if ((mod && event.key.toLowerCase() === 'r') || event.key === 'F5') void send({ type: 'nav.reload', hard: event.shiftKey });
    else if (event.altKey && event.key === 'ArrowLeft') void send({ type: 'nav.back' });
    else if (event.altKey && event.key === 'ArrowRight') void send({ type: 'nav.forward' });
    else if (mod && (event.key === '=' || event.key === '+')) void send({ type: 'zoom', delta: 1 });
    else if (mod && event.key === '-') void send({ type: 'zoom', delta: -1 });
    else if (mod && event.key === '0') void send({ type: 'zoom', delta: 0 });
    else return;
    event.preventDefault();
  });

  void send({ type: 'shell.ready' });
})();
