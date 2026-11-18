'use strict';
/*
 * Spikes S7 and S8 (docs/PLAN.md section 14), run in Electron 45.
 *
 * S7: does webContents.debugger behave like Chrome's CDP for what the engine
 *     needs (cross-origin iframe auto-attach with flat sessions, the AX tree,
 *     DOMSnapshot)? Do pages in views that are not shown still lazy-load,
 *     run timers and animation frames? How much memory does a page take, and
 *     how much comes back when its view is closed?
 * S8: does a transparent overlay view above a tab view take the person's
 *     clicks and keys, while CDP input from the engine still reaches the page?
 *     Is the overlay absent from capturePage of the tab? Does input reach the
 *     page again once the overlay is removed?
 *
 * The person's input is simulated by posting Windows mouse and key messages
 * to this app's own window handle, so the real cursor is never moved and no
 * other window is touched. The window is shown without taking focus.
 *
 * Run: <electron.exe> scripts/spikes/s7-s8-electron.cjs
 */
const { app, BaseWindow, WebContentsView } = require('electron');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { appendFileSync, writeFileSync } = require('node:fs');

/** Electron on Windows is a GUI program and may not write to a piped stdout, so the report goes to a file. */
const REPORT_FILE = process.env.AETHER_SPIKE_REPORT || path.resolve('s7-s8-report.txt');
writeFileSync(REPORT_FILE, '');
const report = [];
const log = (line) => {
  report.push(line);
  appendFileSync(REPORT_FILE, `${line}\n`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const html = (body) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><title>spike</title></head><body style="margin:0">${body}</body></html>`)}`;

/** Post mouse or key messages to a window handle (client coordinates). */
function postToWindow(hwnd, actions) {
  const lines = [
    'Add-Type -TypeDefinition @"',
    'using System; using System.Runtime.InteropServices;',
    'public static class W { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }',
    '"@',
    `$h = [IntPtr]::new(${hwnd})`,
  ];
  for (const action of actions) {
    if (action.click) {
      const [x, y] = action.click;
      const l = (y << 16) | x;
      lines.push(`[W]::PostMessage($h, 0x0200, [IntPtr]::Zero, [IntPtr]::new(${l})) | Out-Null`);
      lines.push(`[W]::PostMessage($h, 0x0201, [IntPtr]::new(1), [IntPtr]::new(${l})) | Out-Null`);
      lines.push('Start-Sleep -Milliseconds 40');
      lines.push(`[W]::PostMessage($h, 0x0202, [IntPtr]::Zero, [IntPtr]::new(${l})) | Out-Null`);
    }
    if (action.key) {
      const vk = action.key.toUpperCase().charCodeAt(0);
      lines.push(`[W]::PostMessage($h, 0x0100, [IntPtr]::new(${vk}), [IntPtr]::new(1)) | Out-Null`);
      lines.push(`[W]::PostMessage($h, 0x0102, [IntPtr]::new(${action.key.charCodeAt(0)}), [IntPtr]::new(1)) | Out-Null`);
      lines.push(`[W]::PostMessage($h, 0x0101, [IntPtr]::new(${vk}), [IntPtr]::new(0xC0000001)) | Out-Null`);
    }
    lines.push('Start-Sleep -Milliseconds 60');
  }
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', lines.join('\n')], { stdio: 'ignore' });
}

function attach(contents) {
  contents.debugger.attach('1.3');
  return (method, params = {}, sessionId) => contents.debugger.sendCommand(method, params, sessionId);
}

async function loaded(view, url) {
  await view.webContents.loadURL(url);
  await wait(300);
}

async function s7Cdp(fixtures) {
  log('## S7a: webContents.debugger and the CDP the engine uses');
  const view = new WebContentsView();
  view.setBounds({ x: 0, y: 0, width: 1000, height: 650 });
  const send = attach(view.webContents);
  const attached = [];
  view.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Target.attachedToTarget') attached.push(params);
  });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await loaded(view, `${fixtures.mainBaseUrl}/cross-origin.html`);
  await wait(500);
  const frames = attached.filter((entry) => entry.targetInfo.type === 'iframe');
  log(`- auto-attach: ${frames.length} cross-origin iframe session(s): ${frames.map((entry) => entry.targetInfo.url).join(', ')}`);
  if (frames[0]) {
    const inside = await send('Runtime.evaluate', { expression: 'document.title + " | " + location.origin', returnByValue: true }, frames[0].sessionId);
    log(`- command on the iframe's flat session: ${JSON.stringify(inside.result.value)}`);
    const ax = await send('Accessibility.getFullAXTree', {}, frames[0].sessionId);
    log(`- AX tree in the iframe: ${ax.nodes.length} nodes`);
  }
  const top = await send('Accessibility.getFullAXTree');
  const snapshot = await send('DOMSnapshot.captureSnapshot', { computedStyles: ['display'], includeDOMRects: true, includePaintOrder: true });
  log(`- main frame: AX ${top.nodes.length} nodes, DOMSnapshot ${snapshot.documents.length} document(s), ${snapshot.documents[0].layout.nodeIndex.length} layout boxes`);
  const detachedShot = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), wait(4000).then(() => undefined)]);
  log(`- Page.captureScreenshot on a view never attached to a window: ${detachedShot ? `${Math.round(detachedShot.data.length / 1024)} KB` : 'no answer within 4 s'}`);
  const host = new BaseWindow({ x: -3000, y: 60, width: 1000, height: 650, useContentSize: true, show: false });
  host.contentView.addChildView(view);
  host.showInactive();
  await wait(400);
  const attachedShot = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), wait(4000).then(() => undefined)]);
  log(`- the same view attached to a window placed off screen: ${attachedShot ? `${Math.round(attachedShot.data.length / 1024)} KB` : 'no answer within 4 s'}`);
  host.contentView.removeChildView(view);
  host.destroy();
  view.webContents.debugger.detach();
  view.webContents.close();
}

const LAZY_PAGE = html(`
  <div style="height:4000px;background:linear-gradient(#fff,#eef)">tall</div>
  <div id="sentinel" style="height:10px"></div>
  <img id="lazy" loading="lazy" width="10" height="10" src="__IMG__">
  <script>
    window.ioFired = false; window.frames_ = 0; window.ticks = 0;
    new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) window.ioFired = true; }).observe(document.getElementById('sentinel'));
    const loop = () => { window.frames_++; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
    setInterval(() => { window.ticks++; }, 100);
  </script>`);

async function s7Hidden(win, fixtures) {
  log('## S7b: views that are not on screen');
  const page = LAZY_PAGE.replace(encodeURIComponent('__IMG__'), encodeURIComponent(`${fixtures.mainBaseUrl}/favicon-${Date.now()}.png`));
  const offscreen = new BaseWindow({ x: -3000, y: 60, width: 1000, height: 650, useContentSize: true, show: false });
  offscreen.showInactive();
  const cases = [
    { name: 'shown (attached, visible)', host: win, visible: true, throttle: true },
    { name: 'attached, setVisible(false)', host: win, visible: false, throttle: true },
    { name: 'attached to a window placed off screen, backgroundThrottling false', host: offscreen, visible: true, throttle: false },
    { name: 'never attached, backgroundThrottling false', host: undefined, visible: true, throttle: false },
    { name: 'never attached, backgroundThrottling true', host: undefined, visible: true, throttle: true },
  ];
  const bounded = (promise, ms) => Promise.race([promise.then((value) => ({ value }), (error) => ({ error: error.message })), wait(ms).then(() => ({ timeout: true }))]);
  for (const entry of cases) {
    const view = new WebContentsView({ webPreferences: { backgroundThrottling: entry.throttle } });
    view.setBounds({ x: 0, y: 0, width: 1000, height: 650 });
    if (entry.host) entry.host.contentView.addChildView(view);
    view.setVisible(entry.visible);
    const send = attach(view.webContents);
    const load = await bounded(loaded(view, page), 8000);
    if (load.timeout) {
      log(`- ${entry.name}: page did not finish loading within 8 s`);
    } else {
      const before = await bounded(view.webContents.executeJavaScript('({ frames: window.frames_, ticks: window.ticks })'), 3000);
      let wheel = 'ok';
      for (let i = 0; i < 5; i++) {
        const sent = await bounded(send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 500, y: 300, deltaX: 0, deltaY: 1200 }), 2000);
        if (sent.timeout) wheel = 'trusted wheel input got no answer within 2 s';
        if (sent.error) wheel = `trusted wheel input failed: ${sent.error}`;
        if (wheel !== 'ok') break;
        await wait(150);
      }
      await wait(400);
      const after = await bounded(
        view.webContents.executeJavaScript('({ frames: window.frames_, ticks: window.ticks, scrollY: Math.round(scrollY), io: window.ioFired, img: !!document.getElementById("lazy").currentSrc })'),
        3000,
      );
      if (after.value && before.value) {
        const a = after.value;
        log(`- ${entry.name}: wheel ${wheel}; scrollY=${a.scrollY}, IntersectionObserver fired=${a.io}, lazy image requested=${a.img}, animation frames=${a.frames - before.value.frames}, timer ticks=${a.ticks - before.value.ticks} (100 ms timer, ~1.2 s)`);
      } else {
        log(`- ${entry.name}: wheel ${wheel}; page script did not answer (${JSON.stringify(after)})`);
      }
    }
    view.webContents.debugger.detach();
    if (entry.host) entry.host.contentView.removeChildView(view);
    view.webContents.close();
  }
  offscreen.destroy();
}

async function s7Memory() {
  log('## S7c: memory per page (private bytes of the page process) and release on close');
  const sites = ['https://books.toscrape.com/catalogue/category/books/mystery_3/index.html', 'https://webscraper.io/test-sites/e-commerce/allinone/computers/laptops', 'https://en.wikipedia.org/wiki/Watch'];
  const views = [];
  const total = () => app.getAppMetrics().reduce((sum, metric) => sum + (metric.memory.privateBytes ?? metric.memory.workingSetSize), 0);
  const baseline = total();
  for (const site of sites) {
    const view = new WebContentsView({ webPreferences: { backgroundThrottling: false } });
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
    try {
      await Promise.race([view.webContents.loadURL(site), wait(15000)]);
    } catch (error) {
      log(`- ${site}: did not load (${error.message})`);
    }
    await wait(1500);
    const pid = view.webContents.getOSProcessId();
    const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
    log(`- ${new URL(site).host}: page process ${pid}, private ${Math.round((metric?.memory.privateBytes ?? 0) / 1024)} MB, working set ${Math.round((metric?.memory.workingSetSize ?? 0) / 1024)} MB`);
    views.push(view);
  }
  const loadedTotal = total();
  for (const view of views) view.webContents.close();
  await wait(2500);
  const closedTotal = total();
  log(`- app total private KB: baseline ${Math.round(baseline / 1024)} MB, with 3 pages ${Math.round(loadedTotal / 1024)} MB, 2.5 s after closing them ${Math.round(closedTotal / 1024)} MB`);
}

const BUTTON_PAGE = html(`
  <button id="buy" style="position:absolute;left:100px;top:100px;width:200px;height:60px">Buy</button>
  <input id="field" style="position:absolute;left:100px;top:220px;width:200px">
  <script>window.clicks = 0; document.getElementById('buy').addEventListener('click', () => window.clicks++);</script>`);

const OVERLAY_PAGE = html(`
  <div id="hint" style="position:absolute;left:400px;top:400px;width:120px;height:60px;background:rgb(255,0,0)">Aether is working</div>
  <script>document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
    window.downs = 0; window.keys = ''; addEventListener('mousedown', () => window.downs++); addEventListener('keydown', (e) => { window.keys += e.key; });</script>`);

async function s8(win) {
  log('## S8: transparent overlay view as an input shield');
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const tab = new WebContentsView();
  tab.setBounds({ x: 0, y: 0, width: 1000, height: 650 });
  win.contentView.addChildView(tab);
  await loaded(tab, BUTTON_PAGE);
  const send = attach(tab.webContents);
  const clicks = () => tab.webContents.executeJavaScript('window.clicks');
  const field = () => tab.webContents.executeJavaScript('document.getElementById("field").value');

  postToWindow(hwnd, [{ click: [200, 130] }]);
  await wait(300);
  log(`- no overlay: posted person click reaches the page: clicks=${await clicks()}`);

  const overlay = new WebContentsView();
  overlay.setBackgroundColor('#00000000');
  overlay.setBounds({ x: 0, y: 0, width: 1000, height: 650 });
  win.contentView.addChildView(overlay);
  await loaded(overlay, OVERLAY_PAGE);
  const before = await clicks();
  postToWindow(hwnd, [{ click: [200, 130] }, { click: [210, 135] }]);
  await wait(300);
  const overlayDowns = await overlay.webContents.executeJavaScript('window.downs');
  log(`- overlay on: two person clicks on the button -> page clicks +${(await clicks()) - before}, overlay received ${overlayDowns} mousedown(s)`);

  await tab.webContents.executeJavaScript('document.getElementById("field").focus()');
  overlay.webContents.focus();
  postToWindow(hwnd, [{ key: 'x' }, { key: 'y' }]);
  await wait(300);
  log(`- overlay on and focused: person keys -> page field "${await field()}", overlay saw "${await overlay.webContents.executeJavaScript('window.keys')}"`);

  const agentBefore = await clicks();
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 200, y: 130, button: 'left', clickCount: 1 });
  await wait(200);
  log(`- overlay on: engine CDP click -> page clicks +${(await clicks()) - agentBefore}`);

  const image = await tab.webContents.capturePage();
  const bitmap = image.toBitmap();
  const size = image.getSize();
  const scale = size.width / 1000;
  const at = (x, y) => {
    const index = (Math.round(y * scale) * size.width + Math.round(x * scale)) * 4;
    return `rgb(${bitmap[index + 2]},${bitmap[index + 1]},${bitmap[index]})`;
  };
  log(`- capturePage of the tab where the overlay draws red: ${at(450, 420)} (red would be rgb(255,0,0))`);

  win.contentView.removeChildView(overlay);
  overlay.webContents.close();
  await wait(200);
  const afterRemove = await clicks();
  tab.webContents.focus();
  postToWindow(hwnd, [{ click: [200, 130] }]);
  await wait(300);
  log(`- overlay removed: person click reaches the page again: clicks +${(await clicks()) - afterRemove}`);
  tab.webContents.debugger.detach();
  win.contentView.removeChildView(tab);
  tab.webContents.close();
}

app.whenReady().then(async () => {
  let fixtures;
  try {
    const module = await import(pathToFileURL(path.resolve(__dirname, '../../fixtures/dist/index.js')).href);
    fixtures = await module.startFixtureServers(4181, 4182);
    log(`Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, Node ${process.versions.node}`);
    const win = new BaseWindow({ x: 60, y: 60, width: 1000, height: 650, useContentSize: true, show: false, title: 'Aether spike S7 S8' });
    win.showInactive();
    await wait(500);
    await s7Cdp(fixtures);
    await s7Hidden(win, fixtures);
    await s8(win);
    await s7Memory();
    win.destroy();
  } catch (error) {
    log(`SPIKE FAILED: ${error?.stack ?? error}`);
  } finally {
    await fixtures?.close();
    console.log(report.join('\n'));
    app.quit();
  }
});
app.on('window-all-closed', () => undefined);
