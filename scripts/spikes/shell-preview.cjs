/* Render the real shell.html in Electron with a stubbed `aether` API and a
 * realistic snapshot, then save a PNG. Dev tool for UI checks. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const STATIC = path.resolve(__dirname, '..', '..', 'apps', 'desktop', 'static');
const OUT = process.argv[2] || path.resolve(__dirname, 'shell-preview.png');

const space = (id, name, kind, state) => ({
  id, name, kind, partition: 'persist', state, createdAt: Date.now() - 3600_000, archived: false,
});
const tab = (id, url, title, state = 'live', extra = {}) => ({
  id, spaceId: 'personal', url, title, scrollY: 0, state, lastViewedAt: Date.now(),
  loading: false, canGoBack: true, canGoForward: false, audible: false, muted: false, zoomPercent: 100,
  ...extra,
});

const SNAPSHOT = {
  type: 'shell.snapshot',
  platform: 'win32',
  panelOpen: false,
  activeSpaceId: 'personal',
  spaces: [
    {
      space: space('personal', 'Personal', 'human', 'idle'),
      frame: { type: 'aether.space', spaceId: 'personal', state: 'idle', step: 0, label: '', timestamp: Date.now() },
      tabs: [
        tab('t1', 'https://www.wikipedia.org/', 'Wikipedia', 'live'),
        tab('t2', 'https://github.com/', 'GitHub - Where the world builds software', 'loading'),
        tab('t3', 'https://news.ycombinator.com/', 'Hacker News', 'hibernated'),
      ],
      activeTabId: 't1',
      milestones: [],
    },
    {
      space: space('shoe-hunt', 'Shoe hunt', 'agent', 'acting'),
      frame: { type: 'aether.space', spaceId: 'shoe-hunt', state: 'acting', step: 3, label: 'Comparing 12 listings on page 2', startedAt: Date.now() - 42_000, timestamp: Date.now() },
      tabs: [tab('a1', 'https://shop.example/search?q=shoes', 'Running shoes under $120', 'live', { spaceId: 'shoe-hunt' })],
      activeTabId: 'a1',
      milestones: [],
    },
  ],
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 860, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  // Intercept the shell page and inject the stub before shell.js runs.
  const html = fs.readFileSync(path.join(STATIC, 'shell.html'), 'utf8');
  const stub = `<script>
    window.aether = {
      send: async (command) => ({ ok: true, command }),
      onSnapshot: (listener) => { listener(${JSON.stringify(SNAPSHOT)}); },
    };
  </script>`;
  const preview = html.replace('<script src="shell.js"></script>', `${stub}<script src="shell.js"></script>`);
  win.webContents.on('console-message', (event) => console.log('console:', event.message));
  const previewPath = path.join(STATIC, '_preview.html');
  fs.writeFileSync(previewPath, preview);
  await win.loadFile(previewPath);
  await new Promise((r) => setTimeout(r, 800));
  const rects = await win.webContents.executeJavaScript(`(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return s + ':MISSING'; const b = e.getBoundingClientRect(); return s + ' ' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height); };
    return [r('.strip'), r('.toolbar'), r('.agentbar'), r('#tabs .tab'), r('#omnibox'), 'body ' + document.body.clientHeight + 'px', 'tabs=' + document.querySelectorAll('#tabs .tab').length].join(' | ');
  })()`);
  console.log(rects);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(OUT, image.toPNG());
  fs.rmSync(previewPath, { force: true });
  console.log(`saved ${OUT}`);
  app.exit(0);
});
