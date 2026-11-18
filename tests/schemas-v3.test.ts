import { describe, expect, it } from 'vitest';
import {
  AetherExecParamsSchema,
  AetherSpacesParamsSchema,
  CodeModeCallSchema,
  CodeModeDoneSchema,
  CodeModeReplySchema,
  DaemonClientFrameSchema,
  DaemonConfigSchema,
  DaemonServerFrameSchema,
  ExecOutcomeSchema,
  HUMAN_SPACE_ID,
  MilestoneSchema,
  ShellCommandSchema,
  ShellSnapshotSchema,
  parseSpaceCall,
  SpaceFrameSchema,
  TabRecordSchema,
  execParamsProblem,
  spaceIdFromName,
  spacesParamsProblem,
} from '@aether/shared';

const TOKEN = 'a'.repeat(48);

/** Parse, serialize, parse again: the value must survive unchanged. */
function roundTrip<T>(schema: { parse: (value: unknown) => T }, value: unknown): T {
  const first = schema.parse(value);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  expect(second).toEqual(first);
  return second;
}

describe('v3 schemas: Spaces and tabs', () => {
  it('makes stable slugs from host names and never collides with the Human Space', () => {
    expect(spaceIdFromName('Shoe hunt')).toBe('shoe-hunt');
    expect(spaceIdFromName('  Flight Check: BLR → DEL  ')).toBe('flight-check-blr-del');
    expect(spaceIdFromName('Café Søk')).toBe('cafe-s-k');
    expect(spaceIdFromName('!!!')).toBe('task');
    expect(spaceIdFromName('Personal')).toBe('task');
    expect(spaceIdFromName('x'.repeat(80))).toHaveLength(48);
    expect(HUMAN_SPACE_ID).toBe('personal');
  });

  it('round-trips a tab record and a Space frame with a pending approval', () => {
    roundTrip(TabRecordSchema, {
      id: 't1', spaceId: 'shoe-hunt', url: 'https://shop.example/', title: 'Shop', scrollY: 0, state: 'hibernated', lastViewedAt: 1,
    });
    roundTrip(SpaceFrameSchema, {
      type: 'aether.space', spaceId: 'shoe-hunt', state: 'waiting_human', step: 3, label: 'Placing the order',
      pending: { id: 'p1', reason: 'approval', prompt: 'Place order?', createdAt: 2 }, timestamp: 3,
    });
  });

  it('rejects bad ids, unknown tab states and empty milestones', () => {
    expect(TabRecordSchema.safeParse({ id: 't', spaceId: 'Shoe Hunt', url: '', title: '', scrollY: 0, state: 'live', lastViewedAt: 0 }).success).toBe(false);
    expect(TabRecordSchema.safeParse({ id: 't', spaceId: 'a', url: '', title: '', scrollY: 0, state: 'asleep', lastViewedAt: 0 }).success).toBe(false);
    expect(MilestoneSchema.safeParse({ id: 'm', spaceId: 'a', text: '', status: 'done', source: 'engine', startedAt: 0 }).success).toBe(false);
  });
});

describe('v3 schemas: Code Mode', () => {
  it('validates every space method argument tuple', () => {
    expect(parseSpaceCall('open', ['https://a.example/']).ok).toBe(true);
    expect(parseSpaceCall('open', ['https://a.example/', { newTab: true }]).ok).toBe(true);
    expect(parseSpaceCall('open', ['not a url']).ok).toBe(false);
    expect(parseSpaceCall('open', ['https://a.example/', { evil: 1 }]).ok).toBe(false);
    expect(parseSpaceCall('act', [[{ op: 'click', ref: 'e3' }], { risk: 'read', why: 'Open the item' }]).ok).toBe(true);
    expect(parseSpaceCall('act', [[{ op: 'click', ref: 'e3' }], { risk: 'whatever', why: 'x' }]).ok).toBe(false);
    expect(parseSpaceCall('act', [[], { risk: 'read', why: 'x' }]).ok).toBe(false);
    expect(parseSpaceCall('survey', [{ query: 'running shoes', budget: 120, minRating: 4.3, maxPages: 3 }]).ok).toBe(true);
    expect(parseSpaceCall('survey', [{ query: 'shoes', maxPages: 50 }]).ok).toBe(false);
    expect(parseSpaceCall('focus', ['e12', { after: 't40' }]).ok).toBe(true);
    expect(parseSpaceCall('focus', ['12']).ok).toBe(false);
    expect(parseSpaceCall('tabs', ['extra']).ok).toBe(false);
    expect(parseSpaceCall('stateSet', ['shortlist', [{ a: 1 }]]).ok).toBe(true);
  });

  it('names the argument and the problem when a call is wrong', () => {
    const wrong = parseSpaceCall('open', ['not a url']);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.message).toBe('space.open: Invalid url (argument 1)');
    const extra = parseSpaceCall('skim', [1]);
    expect(extra).toEqual({ ok: false, message: 'space.skim takes at most 0 arguments, got 1' });
  });

  it('round-trips calls, replies and the end-of-script message', () => {
    roundTrip(CodeModeCallSchema, { type: 'call', id: 1, method: 'survey', args: [{ query: 'shoes' }] });
    roundTrip(CodeModeReplySchema, { type: 'reply', id: 1, ok: true, value: { items: [] } });
    roundTrip(CodeModeReplySchema, { type: 'reply', id: 2, ok: false, error: { code: 'denied', message: 'You denied this step.' } });
    roundTrip(CodeModeDoneSchema, { type: 'done', ok: false, message: 'x is not defined', line: 4, column: 9 });
    expect(CodeModeCallSchema.safeParse({ type: 'call', id: 1, method: 'eval', args: [] }).success).toBe(false);
  });

  it('round-trips every run outcome', () => {
    roundTrip(ExecOutcomeSchema, { status: 'complete', json: '{"a":1}', untrusted: true, origins: ['https://shop.example'], durationMs: 1200 });
    roundTrip(ExecOutcomeSchema, { status: 'held', token: 'h'.repeat(24), reason: 'approval', prompt: 'Place order?' });
    roundTrip(ExecOutcomeSchema, { status: 'error', message: 'boom', untrusted: false, origins: [] });
    roundTrip(ExecOutcomeSchema, { status: 'stopped', by: 'stall', message: 'no progress for 30 s' });
  });
});

describe('v3 schemas: host tools', () => {
  it('needs exactly one of code or wait', () => {
    const base = { thought: 'Survey shoes' };
    expect(execParamsProblem(AetherExecParamsSchema.parse({ ...base, code: 'return 1' }))).toBeUndefined();
    expect(execParamsProblem(AetherExecParamsSchema.parse({ ...base, wait: 'a1'.repeat(12) }))).toBeUndefined();
    expect(execParamsProblem(AetherExecParamsSchema.parse({ ...base, wait: 'not-a-token' }))).toMatch(/token a held run returned/);
    expect(execParamsProblem(AetherExecParamsSchema.parse(base))).toMatch(/send code/);
    expect(execParamsProblem(AetherExecParamsSchema.parse({ ...base, code: '   ' }))).toMatch(/send code/);
    expect(execParamsProblem(AetherExecParamsSchema.parse({ ...base, code: 'x', wait: 'a1'.repeat(12) }))).toMatch(/not both/);
    expect(execParamsProblem({ thought: '', code: 'x' })).toMatch(/one line of 1 to 200/);
    expect(execParamsProblem({ thought: 'two\nlines', code: 'x' })).toMatch(/one line/);
    expect(execParamsProblem({ space: 'x'.repeat(61), thought: 't', code: 'x' })).toMatch(/at most 60/);
  });

  it('needs a space for focus and close', () => {
    expect(spacesParamsProblem(AetherSpacesParamsSchema.parse({ op: 'list' }))).toBeUndefined();
    expect(spacesParamsProblem(AetherSpacesParamsSchema.parse({ op: 'close' }))).toBe('op=close needs space');
  });
});

describe('v3 schemas: daemon', () => {
  it('round-trips config, hello, request and every server frame', () => {
    roundTrip(DaemonConfigSchema, { version: 1, pid: 42, endpoint: '\\\\.\\pipe\\aether-user', token: TOKEN, appVersion: '0.3.0', startedAt: 1 });
    roundTrip(DaemonClientFrameSchema, { type: 'hello', protocol: 1, token: TOKEN, client: { kind: 'cli', name: 'aether', version: '0.3.0' } });
    roundTrip(DaemonClientFrameSchema, { type: 'request', id: 7, tool: 'aether_exec', params: { thought: 't', code: 'return 1' } });
    roundTrip(DaemonServerFrameSchema, { type: 'welcome', session: 's1', appVersion: '0.3.0' });
    roundTrip(DaemonServerFrameSchema, { type: 'response', id: 7, result: { text: 'ok', isError: false, meta: { durationMs: 5 } } });
    roundTrip(DaemonServerFrameSchema, { type: 'fatal', code: 'bad_token', message: 'The token does not match.' });
  });

  it('rejects short tokens, other protocol versions and unknown tools', () => {
    expect(DaemonClientFrameSchema.safeParse({ type: 'hello', protocol: 1, token: 'short', client: { kind: 'cli', name: 'a', version: '1' } }).success).toBe(false);
    expect(DaemonClientFrameSchema.safeParse({ type: 'hello', protocol: 2, token: TOKEN, client: { kind: 'cli', name: 'a', version: '1' } }).success).toBe(false);
    expect(DaemonClientFrameSchema.safeParse({ type: 'request', id: 1, tool: 'look', params: {} }).success).toBe(false);
  });
});

describe('v3 schemas: shell IPC', () => {
  it('accepts every shell command and rejects malformed ones', () => {
    const commands = [
      { type: 'tab.new' }, { type: 'tab.close', tabId: 't1' }, { type: 'tab.reopen' }, { type: 'tab.activate', tabId: 't1' },
      { type: 'tab.move', tabId: 't1', index: 2 }, { type: 'tab.mute', tabId: 't1', muted: true },
      { type: 'tab.sendToAgent', tabId: 't1' }, { type: 'nav.go', input: 'example.com' }, { type: 'nav.back' }, { type: 'nav.forward' },
      { type: 'nav.reload', hard: true }, { type: 'nav.stop' }, { type: 'space.switch', spaceId: 'shoe-hunt' },
      { type: 'space.close', spaceId: 'shoe-hunt', deleteFiles: false }, { type: 'find.start', text: 'price', forward: true }, { type: 'find.stop' },
      { type: 'zoom', delta: 1 }, { type: 'panel.toggle' }, { type: 'overlay.layout', open: true },
      { type: 'run.control', spaceId: 'shoe-hunt', control: { type: 'aether.control', kind: 'takeover' } },
      { type: 'run.reply', spaceId: 'shoe-hunt', reply: { type: 'aether.reply', id: 'p1', kind: 'approve' } },
      { type: 'memory', command: { type: 'aether.memory', op: 'list' } }, { type: 'shell.ready' },
    ];
    for (const command of commands) roundTrip(ShellCommandSchema, command);
    expect(ShellCommandSchema.safeParse({ type: 'nav.go', input: '' }).success).toBe(false);
    expect(ShellCommandSchema.safeParse({ type: 'zoom', delta: 5 }).success).toBe(false);
    expect(ShellCommandSchema.safeParse({ type: 'exec', code: 'x' }).success).toBe(false);
  });

  it('round-trips a snapshot with a Human Space and an acting Agent Space', () => {
    const tab = { id: 't1', spaceId: 'shoe-hunt', url: 'https://shop.example/', title: 'Shop', scrollY: 0, state: 'live', lastViewedAt: 1,
      loading: false, canGoBack: true, canGoForward: false, audible: false, muted: false, zoomPercent: 100 };
    roundTrip(ShellSnapshotSchema, {
      type: 'shell.snapshot', activeSpaceId: 'shoe-hunt', panelOpen: true, platform: 'win32',
      spaces: [
        { space: { id: 'personal', name: 'Personal', kind: 'human', partition: 'persist', state: 'idle', createdAt: 0, archived: false }, tabs: [], milestones: [] },
        {
          space: { id: 'shoe-hunt', name: 'Shoe hunt', kind: 'agent', partition: 'persist', state: 'acting', createdAt: 1, archived: false },
          frame: { type: 'aether.space', spaceId: 'shoe-hunt', state: 'acting', step: 1, label: 'Surveying', timestamp: 2 },
          tabs: [tab], activeTabId: 't1',
          milestones: [{ id: 'm1', spaceId: 'shoe-hunt', text: 'Closed cookie banner', status: 'done', source: 'engine', startedAt: 1, endedAt: 2 }],
        },
      ],
    });
  });
});
