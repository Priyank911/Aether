/**
 * Spike S1 (docs/PLAN.md sections 4.2 and 13): does the extension service
 * worker's WebSocket to the engine survive a 10 minute run with no tool calls,
 * kept alive only by the engine's keepalive pings?
 *
 * Uses the real built extension in headless Chrome. The test-side debugger
 * session on the service worker is detached first, because an attached
 * debugger keeps a worker alive and would hide the answer.
 *
 * Run: pnpm extension:build && pnpm exec tsx scripts/spikes/s1-sw-socket.mts [minutes]
 */
import { startExtensionHarness } from '../../apps/cli/tests/extension-harness.js';

const minutes = Number(process.argv[2] ?? '10');
const harness = await startExtensionHarness();
let disconnects = 0;
let reconnects = 0;
harness.bridge.on('disconnected', (reason: string) => {
  disconnects++;
  console.log(`${new Date().toISOString()} disconnected: ${reason}`);
});
harness.bridge.on('connected', () => {
  reconnects++;
  console.log(`${new Date().toISOString()} reconnected`);
});

await harness.serviceWorker.detach();
const started = Date.now();
console.log(`watching for ${minutes} minutes with no tool calls; engine pings every 15 s`);
while (Date.now() - started < minutes * 60000) {
  await new Promise((resolve) => setTimeout(resolve, 30000));
  console.log(`${Math.round((Date.now() - started) / 1000)} s: connected=${harness.bridge.connected}`);
}

let callWorks = false;
try {
  const engine = (harness.session as unknown as { client: { sendCommand: (method: string) => Promise<unknown> } }).client;
  await engine.sendCommand('Target.getTargets');
  callWorks = true;
} catch (error) {
  console.log(`final call failed: ${error instanceof Error ? error.message : String(error)}`);
}
console.log(`\nresult: ${disconnects} disconnects, ${reconnects} reconnects, connected at end=${harness.bridge.connected}, CDP call at end works=${callWorks}`);
await harness.close();
process.exit(0);
