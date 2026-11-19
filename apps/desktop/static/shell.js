/*
 * Chrome-like shell (plan 3.1, section 10). It draws the snapshot the main
 * process sends and turns clicks and keys into shell commands; it keeps no
 * state of its own. Page text (titles, URLs) is only ever set as
 * textContent or value.
 */
(() => {
  const api = window.aether;
  const $ = (id) => document.getElementById(id);
  const tabsEl = $('tabs');
  const spaceEl = $('space');
  const omnibox = $('omnibox');
  const omniForm = $('omnibox-form');
  const omniIcon = $('omni-icon');
  const agentBar = $('agentbar');
  const agentDot = $('agent-dot');
  const agentLabel = $('agent-label');
  const agentMeta = $('agent-meta');
  const agentActions = $('agent-actions');
  let snapshot;
  let editing = false;

  const notice = $('notice');
  const send = async (command) => {
    const result = await api.send(command);
    notice.textContent = result && result.ok === false ? result.error : '';
    return result;
  };

  const visible = () => snapshot?.spaces.find((entry) => entry.space.id === snapshot.activeSpaceId);
  const activeTab = () => {
    const entry = visible();
    return entry?.tabs.find((tab) => tab.id === entry.activeTabId);
  };
  const shownUrl = (url) => (url === 'about:blank' ? '' : url);
  const hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };

  const FAVICON_COLORS = ['#1a73e8', '#ea4335', '#34a853', '#fbbc04', '#9334e6', '#e8710a', '#12b5cb', '#d93025'];
  const faviconColor = (title) => {
    let hash = 0;
    for (const ch of title || '') hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return FAVICON_COLORS[Math.abs(hash) % FAVICON_COLORS.length];
  };

  function faviconEl(tab) {
    const span = document.createElement('span');
    span.className = 'favicon';
    if (tab.favicon) {
      const img = document.createElement('img');
      img.src = tab.favicon;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        span.textContent = (tab.title || '?').trim().charAt(0).toUpperCase() || '?';
        span.style.background = faviconColor(tab.title);
        img.remove();
      });
      span.append(img);
      span.style.background = '#fff';
    } else {
      span.textContent = (tab.title || hostOf(tab.url) || '?').trim().charAt(0).toUpperCase() || '?';
      span.style.background = faviconColor(tab.title || tab.url);
    }
    return span;
  }

  function render() {
    const entry = visible();
    if (!entry) return;
    const agent = entry.space.kind === 'agent';
    const frame = entry.frame;
    const waiting = Boolean(frame?.pending);
    $('space-dot').className = `dot${agent ? ' agent' : ''}${waiting ? ' wait' : ''}`;
    spaceEl.replaceChildren(
      ...snapshot.spaces.map((space) => {
        const option = document.createElement('option');
        option.value = space.space.id;
        option.textContent = space.space.name;
        option.selected = space.space.id === snapshot.activeSpaceId;
        return option;
      }),
    );

    tabsEl.replaceChildren(
      ...entry.tabs.map((tab) => {
        const button = document.createElement('div');
        button.className = `tab${tab.id === entry.activeTabId ? ' active' : ''}${tab.state === 'hibernated' ? ' sleeping' : ''}${tab.state === 'crashed' ? ' crashed' : ''}`;
        button.setAttribute('role', 'tab');
        button.tabIndex = 0;
        button.setAttribute('aria-selected', String(tab.id === entry.activeTabId));
        const label = tab.title || shownUrl(tab.url) || 'New tab';
        button.title = tab.state === 'hibernated' ? 'Sleeping to save memory. Click to load.' : tab.state === 'crashed' ? 'This tab stopped working. Click to reload.' : label;
        button.append(faviconEl(tab));
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = label;
        button.append(title);
        if (tab.audible && !tab.muted) {
          const mute = document.createElement('span');
          mute.className = 'mute';
          mute.title = 'This tab is playing audio';
          mute.innerHTML = '<svg width="12" height="12"><use href="#i-mute"/></svg>';
          button.append(mute);
        }
        if (tab.state === 'crashed') {
          const warn = document.createElement('span');
          warn.className = 'mute';
          warn.style.color = 'var(--wait)';
          warn.innerHTML = '<svg width="13" height="13"><use href="#i-warning"/></svg>';
          button.append(warn);
        }
        const close = document.createElement('button');
        close.className = 'close';
        close.type = 'button';
        close.setAttribute('aria-label', `Close ${label}`);
        close.innerHTML = '<svg width="12" height="12"><use href="#i-close"/></svg>';
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
        button.append(close);
        return button;
      }),
    );

    const tab = activeTab();
    $('back').disabled = !tab?.canGoBack;
    $('forward').disabled = !tab?.canGoForward;
    if (!editing) omnibox.value = tab ? shownUrl(tab.url) : '';
    const secure = tab?.url?.startsWith('https://');
    omniForm.classList.toggle('secure', Boolean(secure));
    omniIcon.innerHTML = `<svg width="14" height="14"><use href="#${secure ? 'i-lock' : 'i-globe'}"/></svg>`;
    document.title = tab?.title ? `${tab.title} - Aether` : 'Aether';
    renderAgentBar(entry);
  }

  /*
   * The Agent bar (plan 3.2, task 3.3): the Space's run state and the
   * fixed-copy buttons that answer it. Button labels never come from the page.
   */
  function renderAgentBar(entry) {
    const frame = entry.frame;
    const active = frame && frame.state !== 'idle';
    agentBar.hidden = !active;
    if (!active) {
      agentActions.replaceChildren();
      agentMeta.textContent = '';
      return;
    }
    const pending = frame.pending;
    const needsPerson = Boolean(pending);
    agentBar.classList.toggle('waiting', needsPerson);
    agentDot.className = `dot ${needsPerson ? 'need' : 'act'}`;
    const open = entry.tabs.filter((tab) => tab.state !== 'hibernated').length;
    const sleeping = entry.tabs.length - open;
    agentMeta.textContent = `${open} open · ${sleeping} sleeping`;
    const text = needsPerson && pending.prompt ? `Aether needs you: ${pending.prompt}` : frame.label;
    agentLabel.textContent = text.length > 160 ? `${text.slice(0, 159)}…` : text;
    const spaceId = entry.space.id;
    const control = (kind) => () => void send({ type: 'run.control', spaceId, control: { type: 'aether.control', kind } });
    const reply = (kind, replyText) => () => {
      if (!pending) return;
      void send({ type: 'run.reply', spaceId, reply: { type: 'aether.reply', id: pending.id, kind, ...(replyText ? { text: replyText } : {}) } });
    };
    const button = (label, handler, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', handler);
      return b;
    };
    const parts = [];
    if (pending && pending.reason === 'approval') {
      parts.push(button('Approve', reply('approve'), 'primary'), button('Deny', reply('deny')));
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
      parts.push(button("I'm done", reply('done'), 'primary'));
    } else if (pending && pending.reason === 'user_interrupted') {
      parts.push(button('Hand back to Aether', reply('resume'), 'primary'));
    } else {
      parts.push(button('Take over', control('takeover')));
    }
    parts.push(button('Stop task', control('stop'), 'stop'));
    agentActions.replaceChildren(...parts);
  }

  api.onSnapshot((next) => {
    snapshot = next;
    document.body.classList.toggle('win', next.platform === 'win32');
    document.body.classList.toggle('mac', next.platform === 'darwin');
    render();
  });

  spaceEl.addEventListener('change', () => void send({ type: 'space.switch', spaceId: spaceEl.value }));
  $('new-tab').addEventListener('click', () => {
    void send({ type: 'tab.new' }).then(() => omnibox.focus());
  });
  $('back').addEventListener('click', () => void send({ type: 'nav.back' }));
  $('forward').addEventListener('click', () => void send({ type: 'nav.forward' }));
  $('reload').addEventListener('click', () => void send({ type: 'nav.reload' }));
  $('panel').addEventListener('click', () => void send({ type: 'panel.toggle' }));
  omnibox.addEventListener('focus', () => {
    editing = true;
    omnibox.select();
  });
  omnibox.addEventListener('blur', () => {
    editing = false;
    render();
  });
  omniboxForm.addEventListener('submit', (event) => {
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
    else if (mod && event.key === '\\') void send({ type: 'panel.toggle' });
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
