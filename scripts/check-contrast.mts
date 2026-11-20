import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../apps/desktop/renderer/src/tokens.css', import.meta.url), 'utf8');
const roots = [...css.matchAll(/:root\s*\{([^}]+)\}/g)];
if (roots.length !== 2) throw new Error('Expected light and dark :root token blocks');

function luminance(hex: string): number {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected opaque RGB token, got ${hex}`);
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

const light = Object.fromEntries([...roots[0][1].matchAll(/(--[\w-]+):\s*(#[\da-f]+)/gi)].map((match) => [match[1], match[2]]));
let failed = false;
for (const [index, root] of roots.entries()) {
  const tokens = { ...light, ...Object.fromEntries([...root[1].matchAll(/(--[\w-]+):\s*(#[\da-f]+)/gi)].map((match) => [match[1], match[2]])) };
  const pairs: Array<[string, string, number]> = [];
  for (const surface of ['--surface', '--field', '--frame']) {
    for (const text of ['--text', '--text-muted']) pairs.push([text, surface, 4.5]);
  }
  for (const text of ['--agent-text', '--wait-text', '--danger']) pairs.push([text, '--surface', 4.5]);
  for (const control of ['--focus', '--agent', '--wait']) pairs.push([control, '--surface', 3]);
  for (const [foreground, background, minimum] of pairs) {
    const a = luminance(tokens[foreground]);
    const b = luminance(tokens[background]);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const ok = ratio >= minimum;
    failed ||= !ok;
    console.log(`${index === 0 ? 'light' : 'dark'} ${foreground}/${background}: ${ratio.toFixed(2)}:1 (>= ${minimum}) ${ok ? 'PASS' : 'FAIL'}`);
  }
}
if (failed) process.exitCode = 1;
