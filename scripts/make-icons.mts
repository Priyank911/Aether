/**
 * Render the extension icon SVGs to the PNG sizes Chrome needs, using headless
 * Chrome through Aether's own CDP client. Output: apps/extension/public/icon/<size>.png,
 * which WXT adds to the manifest.
 *
 * Run: pnpm exec tsx scripts/make-icons.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDPClient, ChromeLauncher } from '../packages/cdp/src/index.js';

const SIZES: Array<[number, string]> = [
  [16, 'icon-small.svg'],
  [32, 'icon-small.svg'],
  [48, 'icon.svg'],
  [128, 'icon.svg'],
];
const ASSETS = path.resolve('apps/extension/assets');
const OUT = path.resolve('apps/extension/public/icon');

const browser = await ChromeLauncher.launch({ headless: true });
const client = await CDPClient.connect(browser.wsEndpoint);
try {
  const { targetInfos } = await client.sendCommand<{ targetInfos: Array<{ targetId: string; type: string }> }>('Target.getTargets');
  const page = targetInfos.find((target) => target.type === 'page');
  if (!page) throw new Error('no page');
  const session = await client.attachToTarget(page.targetId);
  await session.send('Page.enable');
  await session.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const [size, file] of SIZES) {
    const svg = readFileSync(path.join(ASSETS, file), 'utf8');
    await session.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
    const { frameTree } = await session.send<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
    await session.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const shot = await session.send<{ data: string }>('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
    writeFileSync(path.join(OUT, `${size}.png`), Buffer.from(shot.data, 'base64'));
    console.log(`wrote ${size}.png`);
  }
} finally {
  await client.close();
  await browser.kill();
}
