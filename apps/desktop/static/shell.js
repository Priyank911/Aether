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
  const agentBar = $('agentbar');
  const agentDot = $('agent-dot');
  const agentLabel = $('agent-label');
  const agentActions = $('agent-actions');
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
    renderAgentBar(entry);
  }

  /*
   * The interim Agent bar (plan 3.2, task 3.3): the Space's run state and the
   * fixed-copy buttons that answer it. Button labels never come from the page.
   */
  function renderAgentBar(entry) {
    const frame = entry.frame;
    const active = frame && frame.state !== 'idle';
    agentBar.hidden = !active;
    if (!active) {
      agentActions.replaceChildren();
      return;
    }
    const pending = frame.pending;
    const needsPerson = Boolean(pending);
    agentBar.classList.toggle('waiting', needsPerson);
    agentDot.className = `dot ${needsPerson ? 'need' : 'act'}`;
    const text = needsPerson && pending.prompt ? `Aether needs you: ${pending.prompt}` : frame.label;
    agentLabel.textContent = text.length > 160 ? `${text.slice(0, 159)}…` : text;
    const spaceId = entry.space.id;
    const control = (kind) => () => void send({ type: 'run.control', spaceId, control: { type: 'aether.control', kind } });
    const reply = (kind, replyText) => () => {
      if (!pending) return;
      void send({ type: 'run.reply', spaceId, reply: { type: 'aether.reply', id: pending.id, kind, ...(replyText ? { text: replyText } : {}) } });
    };
    const button = (label, handler, stop) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (stop) b.className = 'stop';
      b.addEventListener('click', handler);
      return b;
    };
    const parts = [];
    if (pending && pending.reason === 'approval') {
      parts.push(button('Approve', reply('approve')), button('Deny', reply('deny')));
    } else if (pending && pending.reason === 'question') {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Type your answer';
      input.setAttribute('aria-label', 'Your answer');
      const answer = () => {
        if (!input.value.trim()) return;
        reply('answer', input.value.trim())();
        input.value = '';
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') answer();
      });
      parts.push(input, button('Send', answer));
    } else if (pending && (pending.reason === 'must_perform' || pending.reason === 'captcha')) {
      parts.push(button("I'm done", reply('done')));
    } else if (pending && pending.reason === 'user_interrupted') {
      parts.push(button('Hand back to Aether', reply('resume')));
    } else {
      parts.push(button('Take over', control('takeover')));
    }
    parts.push(button('Stop task', control('stop'), true));
    agentActions.replaceChildren(...parts);
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
