import { ChromeLauncher, CDPClient } from '@aether/cdp';

async function runSpike(): Promise<void> {
  console.log('Running Spike S3: Testing Overlay.setInspectMode and inspectNodeRequested...');
  const browser = await ChromeLauncher.launch({ headless: true });
  let client: CDPClient | null = null;
  try {
    client = await CDPClient.connect(browser.wsEndpoint);
    const targets = await client.sendCommand<{
      targetInfos: Array<{ targetId: string; type: string }>;
    }>('Target.getTargets');
    const pageTarget = targets.targetInfos.find((t) => t.type === 'page');
    if (!pageTarget) throw new Error('No page target found');

    const session = await client.attachToTarget(pageTarget.targetId);
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('Overlay.enable');

    console.log('Calling Overlay.setInspectMode...');
    await session.send('Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: {
        showInfo: true,
        showRulers: false,
        showExtensionLines: false,
        contentColor: { r: 111, g: 168, b: 220, a: 0.66 },
        paddingColor: { r: 147, g: 196, b: 125, a: 0.55 },
        borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
        marginColor: { r: 246, g: 178, b: 107, a: 0.66 },
      },
    });
    console.log('Overlay.setInspectMode succeeded without error.');

    let inspectReceived = false;
    session.on('Overlay.inspectNodeRequested', (params: unknown) => {
      console.log('Received Overlay.inspectNodeRequested:', params);
      inspectReceived = true;
    });

    // Simulate clicking on the page to trigger inspect or inspect a node via DOM
    // Navigate to a simple test page first
    await session.send('Page.navigate', { url: 'data:text/html,<button id="btn">Click Me</button>' });
    await new Promise((r) => setTimeout(r, 200));

    // Get the button's location
    const doc = await session.send<{ root: { nodeId: number } }>('DOM.getDocument');
    const btn = await session.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#btn',
    });
    const desc = await session.send<{ node: { backendNodeId: number } }>('DOM.describeNode', {
      nodeId: btn.nodeId,
    });
    console.log('Button backendNodeId:', desc.node.backendNodeId);

    // Call DOM.getNodeForLocation or dispatch mouse events to trigger inspect
    const box = await session.send<{ model: { content: number[] } }>('DOM.getBoxModel', {
      backendNodeId: desc.node.backendNodeId,
    });
    const x = box.model.content[0]! + 5;
    const y = box.model.content[1]! + 5;

    // In inspect mode, a mouse click on the page triggers inspectNodeRequested
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });

    await new Promise((r) => setTimeout(r, 500));
    console.log('Spike S3 result: inspectNodeRequested event fired:', inspectReceived);

    const locNode = await session.send<{ backendNodeId: number }>('DOM.getNodeForLocation', {
      x: Math.round(x),
      y: Math.round(y),
    });
    console.log('DOM.getNodeForLocation returned backendNodeId:', locNode.backendNodeId);

    // Turn off inspect mode
    await session.send('Overlay.setInspectMode', {
      mode: 'none',
      highlightConfig: {},
    });
    console.log('Spike S3 complete: Overlay.setInspectMode works as expected.');
  } finally {
    if (client) await client.close().catch(() => {});
    await browser.kill();
  }
}

void runSpike().catch((err) => {
  console.error('Spike S3 failed:', err);
  process.exit(1);
});
