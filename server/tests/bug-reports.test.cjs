const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const attach = require('../plugins/interface/bugreports/Channel.BugReports');
const { issueBody, issueTitle } = require('../plugins/interface/bugreports/Issue.BugReports');

// Mirrors the client's chunking (client/game/plugins/bugreport/BugReportUpload.ts).
const CHUNK_CHARS = 15_000;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const chunksOf = (report) => {
  const base64 = Buffer.from(JSON.stringify(report), 'utf8').toString('base64');
  const chunks = [];
  for (let i = 0; i < base64.length; i += CHUNK_CHARS) chunks.push(base64.slice(i, i + CHUNK_CHARS));
  return chunks;
};

const clientDiagnostics = {
  capturedAt: '2026-10-21T10:00:00.000Z',
  client: { userAgent: 'Mozilla/5.0 Chrome/141', renderer: 'webgl', fps: 60, mobile: false,
    viewport: { width: 1280, height: 720, devicePixelRatio: 2 } },
  player: { name: 'Zezima', serverId: 3, position: { x: 3222, y: 3219, plane: 0 } },
  varps: { 1: 5 },
  messages: [{ time: 1, text: 'Welcome to <col=ff0000>RSPS</col>.' }, { time: 2, text: 'Nothing interesting happens.' }],
  logs: [
    { time: Date.UTC(2026, 9, 21, 9, 59, 1), level: 'log', text: '[cache] ready' },
    { time: Date.UTC(2026, 9, 21, 9, 59, 2), level: 'warn', text: '[door] no handler ``` for Open' },
    { time: Date.UTC(2026, 9, 21, 9, 59, 3), level: 'error', text: 'TypeError: x is undefined\n    at open (door.ts:3)' },
  ],
};

const directories = [];
after(() => directories.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

function setup({ env = {}, fetch } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bug-reports-'));
  directories.push(directory);
  const handlers = {};
  const clock = { now: Date.UTC(2026, 9, 21, 10, 0, 0) };
  const item = (id, amount) => ({ getId: () => id, getAmount: () => amount });
  const core = {
    encodePluginMessage: (channel, data) => ({ channel, data }),
    ItemDefinition: { forId: (id) => ({ getName: () => ({ 1351: 'Bronze axe', 1277: 'Bronze sword', 995: 'Coins' })[id] }) },
    Skill: { values: () => [{ getName: () => 'Attack' }, { getName: () => 'Hitpoints' }] },
    CachePipeline: { getActive: () => ({ name: 'osrs-241_2026-09-30' }) },
    Server: { PRODUCTION: false },
    WorldDefinition: { isMembersWorld: () => true },
    GameConstants: { EXPERIENCE_MULTIPLIER: 10 },
    World: { getNetworkPlayerCount: () => 4, getProcessCycle: () => 1234 },
  };
  const player = (username = 'Zezima') => ({
    packets: [],
    getUsername: () => username,
    getSession() { return { sendClientPacket: (packet) => this.packets.push(packet) }; },
    getLocation: () => ({ getX: () => 3222, getY: () => 3218, getZ: () => 0 }),
    getArea: () => ({ getName: () => 'Lumbridge' }),
    getPrivateArea: () => null,
    getSkillManager: () => ({ getCurrentLevel: () => 10, getMaxLevel: () => 10, getExperience: () => 1154, getCombatLevel: () => 13 }),
    getRights: () => ({ getId: () => 0 }),
    getInterfaceId: () => -1,
    getWildernessLevel: () => 0,
    getHitpoints: () => 10,
    getInventory: () => ({ getItems: () => [item(1351, 1), item(-1, 0), item(995, 250)] }),
    getEquipment: () => ({ getItems: () => [null, null, null, item(1277, 1)] }),
  });
  attach({
    core,
    onCustomEvent: (name, handler) => { handlers[name] = handler; },
    onPlayerLogout: (handler) => { handlers.logout = handler; },
    onPlayerDisconnect: (handler) => { handlers.disconnect = handler; },
  }, { env, fetch, directory, now: () => clock.now });
  const send = (who, data) => {
    const event = { player: who, channel: 'bug-report', data, handled: false };
    handlers['network:plugin-message'](event);
    assert.equal(event.handled, true);
    return who.packets.at(-1)?.data;
  };
  const upload = async (who, report, id = 'report-0001', skip = []) => {
    const chunks = chunksOf(report);
    const ready = send(who, { type: 'begin', id, chunks: chunks.length, chars: chunks.join('').length });
    if (ready.type !== 'ready') return ready;
    chunks.forEach((data, index) => skip.includes(index) || send(who, { type: 'chunk', id, index, data }));
    let answer = send(who, { type: 'end', id });
    if (answer.type === 'missing') return answer;
    await attach.settled();
    return who.packets.at(-1).data;
  };
  return { directory, handlers, clock, player, send, upload };
}

const report = (extra = {}) => ({
  description: 'The door in Lumbridge castle won\'t open\n@Bandit-HaxUnit see #12, ![x](http://evil.example)',
  screenshot: `data:image/jpeg;base64,${JPEG.toString('base64')}`,
  diagnostics: clientDiagnostics,
  ...extra,
});

test('the plugin answers on its own channel and says where reports go', () => {
  const local = setup();
  const zezima = local.player();
  assert.deepEqual(local.send(zezima, { type: 'status' }), { type: 'status', destination: null });
  const other = { player: zezima, channel: 'voice', data: { type: 'status' }, handled: false };
  local.handlers['network:plugin-message'](other);
  assert.equal(other.handled, false, 'other channels are left to their plugins');
  const github = setup({ env: { BUG_REPORT_GITHUB_REPO: 'RSPSApp/bug-reports', BUG_REPORT_GITHUB_TOKEN: 'token' } });
  assert.deepEqual(github.send(github.player(), { type: 'status' }), { type: 'status', destination: 'github.com/RSPSApp/bug-reports' });
});

test('a report in chunks, with a lost chunk sent again, is saved locally without GitHub', async () => {
  const world = setup();
  const zezima = world.player();
  const missing = await world.upload(zezima, report(), 'report-0001', [0]);
  assert.deepEqual(missing, { type: 'missing', id: 'report-0001', chunks: [0] });
  world.send(zezima, { type: 'chunk', id: 'report-0001', index: 0, data: chunksOf(report())[0] });
  world.send(zezima, { type: 'end', id: 'report-0001' });
  await attach.settled();
  assert.deepEqual(zezima.packets.at(-1).data, { type: 'sent', id: 'report-0001', issueUrl: undefined, issueNumber: undefined });

  const [folder] = fs.readdirSync(world.directory);
  assert.equal(folder, '2026-10-21T10-00-00-Zezima-report-0');
  const saved = path.join(world.directory, folder);
  assert.deepEqual(fs.readFileSync(path.join(saved, 'screenshot.jpg')), JPEG);
  const diagnostics = JSON.parse(fs.readFileSync(path.join(saved, 'diagnostics.json'), 'utf8'));
  assert.equal(diagnostics.username, 'Zezima');
  assert.equal(diagnostics.screenshot, 'screenshot.jpg');
  assert.deepEqual(diagnostics.client.varps, { 1: 5 });
  assert.deepEqual(diagnostics.server.player.position, { x: 3222, y: 3218, z: 0 });
  assert.deepEqual(diagnostics.server.player.inventory, [
    { slot: 0, id: 1351, name: 'Bronze axe', amount: 1 }, { slot: 2, id: 995, name: 'Coins', amount: 250 }]);
  assert.deepEqual(diagnostics.server.player.skills.Attack, { level: 10, max: 10, xp: 1154 });
  assert.equal(diagnostics.server.world.cache, 'osrs-241_2026-09-30');
  const markdown = fs.readFileSync(path.join(saved, 'report.md'), 'utf8');
  assert.ok(markdown.startsWith("# The door in Lumbridge castle won't open\n"));
  assert.ok(markdown.includes('![Screenshot](screenshot.jpg)'));
  assert.ok(markdown.includes('[diagnostics.json](diagnostics.json)'));
});

test('the issue: the description made inert, the context, and the long tails folded away', () => {
  const body = issueBody({
    id: 'report-0001', reportedAt: '2026-10-21T10:00:00.000Z', username: 'Zezima', description: report().description,
    client: clientDiagnostics,
    server: { world: { cache: 'osrs-241_2026-09-30', commit: 'abc123def456', members: true, experienceMultiplier: 10,
      playersOnline: 4, uptimeSeconds: 7380 },
    player: { rights: 4, position: { x: 3222, y: 3218, z: 0 }, area: { name: 'Lumbridge', plugin: null, instance: false },
      interfaceId: -1, inventory: [{ slot: 0, id: 1351, name: 'Bronze axe', amount: 1 }], equipment: [] } },
  }, { screenshot: 'https://github.com/o/r/blob/main/s.jpg?raw=true', diagnostics: 'https://github.com/o/r/blob/main/d.json' });
  assert.ok(body.startsWith("> The door in Lumbridge castle won't open\n> @\u200bBandit-HaxUnit see \\#\u200b12, !\\[x\\](http://evil.example)"),
    'no mention, no issue link, no image: the player\'s text renders as typed');
  assert.ok(body.includes('![Screenshot](https://github.com/o/r/blob/main/s.jpg?raw=true)'));
  assert.ok(body.includes('| Player | Zezima (developer) |'));
  assert.ok(body.includes('| Position | 3222, 3218, 0 (region 12850); the client showed 3222, 3219, 0 |'), 'a desync shows');
  assert.ok(body.includes('| Client | webgl · 1280×720 (DPR 2) · 60 fps |'));
  assert.ok(body.includes('| Browser | Mozilla/5.0 Chrome/141 |'));
  assert.ok(body.includes('| World | osrs-241_2026-09-30 · commit abc123def456 · 10x XP · 4 online · up 2h 3m |'));
  assert.ok(body.includes('| Reported | 2026-10-21 10:00:00 UTC |'));
  assert.ok(!body.includes('| Interface |'), 'no interface open');
  assert.ok(body.includes('<summary>Client warnings and errors, last 5 minutes (2; 3 lines in all)</summary>'));
  assert.ok(body.includes('````text\n09:59:02.000 WARN  [door] no handler ``` for Open\n'), 'a longer fence than any backtick run');
  assert.ok(body.includes('ERROR TypeError: x is undefined ⏎ at open (door.ts:3)'));
  assert.ok(body.includes('Welcome to RSPS.\nNothing interesting happens.'), 'colour tags dropped');
  assert.ok(body.includes(' 0: Bronze axe (1351)'));
  assert.ok(body.includes('Equipment (0)\n\n```text\n(empty)\n```'));
  assert.ok(body.includes('[diagnostics.json](https://github.com/o/r/blob/main/d.json)'));
  assert.equal(issueTitle({ description: `\n  ${'a'.repeat(100)}\nmore` }), `${'a'.repeat(79)}…`);
  assert.equal(issueTitle({ description: 'ping @someone' }), 'ping @​someone');
});

test('cuts count characters, so none leaves half an emoji (GitHub stores the half as "?")', () => {
  assert.equal(issueTitle({ description: `${'a'.repeat(78)}🐛🐛 and more` }), `${'a'.repeat(78)}🐛…`);
  assert.equal(issueTitle({ description: '🐛'.repeat(80) }), '🐛'.repeat(80), 'eighty emoji are eighty characters');
  const body = issueBody({
    id: 'report-0001', reportedAt: '2026-10-21T10:00:00.000Z', username: 'Zezima', description: 'Emoji',
    client: {
      logs: [{ time: Date.UTC(2026, 9, 21, 9, 59, 2), level: 'warn', text: `${'x'.repeat(398)}🐛🐛 and more` }],
      messages: [{ time: 1, text: `${'m'.repeat(299)}🐛 and more` }],
    },
  }, {});
  assert.ok(body.includes(`WARN  ${'x'.repeat(398)}🐛…\n`), 'a console line');
  assert.ok(body.includes(`\n${'m'.repeat(299)}🐛\n`), 'a game message');
  assert.ok(body.isWellFormed());
});

test('GitHub: the screenshot and diagnostics are committed, then the issue links them', async () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: JSON.parse(init.body) });
    const html = (file) => `https://github.com/RSPSApp/bug-reports/blob/main/${file}`;
    if (init.method === 'PUT') {
      const file = decodeURIComponent(url.split('/contents/')[1]);
      return new Response(JSON.stringify({ content: { html_url: html(file) } }), { status: 201 });
    }
    return new Response(JSON.stringify({ number: 41, html_url: 'https://github.com/RSPSApp/bug-reports/issues/41' }), { status: 201 });
  };
  const world = setup({ env: { BUG_REPORT_GITHUB_REPO: 'RSPSApp/bug-reports', BUG_REPORT_GITHUB_TOKEN: 'secret-token' }, fetch });
  const answer = await world.upload(world.player(), report());
  assert.deepEqual(answer, { type: 'sent', id: 'report-0001', issueUrl: 'https://github.com/RSPSApp/bug-reports/issues/41', issueNumber: 41 });
  assert.deepEqual(requests.map((request) => `${request.method} ${request.url}`), [
    'PUT https://api.github.com/repos/RSPSApp/bug-reports/contents/reports/2026-10-21/report-0001/screenshot.jpg',
    'PUT https://api.github.com/repos/RSPSApp/bug-reports/contents/reports/2026-10-21/report-0001/diagnostics.json',
    'POST https://api.github.com/repos/RSPSApp/bug-reports/issues',
  ]);
  assert.equal(requests[0].headers.authorization, 'Bearer secret-token');
  assert.deepEqual(Buffer.from(requests[0].body.content, 'base64'), JPEG);
  const diagnostics = JSON.parse(Buffer.from(requests[1].body.content, 'base64').toString('utf8'));
  assert.equal(diagnostics.description, report().description);
  assert.ok(!JSON.stringify(diagnostics).includes('secret-token'));
  assert.equal(requests[2].body.title, "The door in Lumbridge castle won't open");
  assert.ok(requests[2].body.body.includes(
    '![Screenshot](https://github.com/RSPSApp/bug-reports/blob/main/reports/2026-10-21/report-0001/screenshot.jpg?raw=true)'));
  assert.equal(fs.readdirSync(world.directory).length, 0, 'nothing saved locally');
});

test('when GitHub fails the report is saved locally, and the player still gets a thank-you', async () => {
  const fetch = async () => new Response('{"message":"Bad credentials"}', { status: 401 });
  const world = setup({ env: { BUG_REPORT_GITHUB_REPO: 'RSPSApp/bug-reports', BUG_REPORT_GITHUB_TOKEN: 'expired' }, fetch });
  const answer = await world.upload(world.player(), report());
  assert.equal(answer.type, 'sent');
  assert.equal(answer.issueUrl, undefined);
  assert.equal(fs.readdirSync(world.directory).length, 1);
});

test('without diagnostics the server keeps the character out of it too', async () => {
  const world = setup();
  const answer = await world.upload(world.player(), report({ diagnostics: undefined, screenshot: undefined }));
  assert.equal(answer.type, 'sent');
  const [folder] = fs.readdirSync(world.directory);
  const diagnostics = JSON.parse(fs.readFileSync(path.join(world.directory, folder, 'diagnostics.json'), 'utf8'));
  assert.equal(diagnostics.server.player, undefined);
  assert.equal(diagnostics.client, undefined);
  assert.equal(diagnostics.screenshot, null);
  const markdown = fs.readFileSync(path.join(world.directory, folder, 'report.md'), 'utf8');
  assert.ok(markdown.includes('The player sent this report without diagnostics.'));
  assert.ok(!markdown.includes('Position'));
});

test('one report a minute per player, thirty an hour per world', async () => {
  const world = setup();
  const zezima = world.player();
  assert.equal((await world.upload(zezima, report())).type, 'sent');
  world.clock.now += 20_000;
  assert.deepEqual(await world.upload(zezima, report(), 'report-0002'),
    { type: 'rejected', id: 'report-0002', reason: 'Please wait 40 seconds before sending another report.' });
  world.clock.now += 40_000;
  assert.equal((await world.upload(zezima, report(), 'report-0003')).type, 'sent');
  for (let i = 0; i < 28; i++) assert.equal((await world.upload(world.player(`player${i}`), report())).type, 'sent');
  assert.equal((await world.upload(world.player('late'), report())).reason,
    'This world has taken a lot of reports this hour. Please try again later.');
  world.clock.now += 3_600_001;
  assert.equal((await world.upload(world.player('late'), report())).type, 'sent', 'the hour moves on');
});

test('bad reports are refused with a reason, and junk is ignored', async () => {
  const world = setup();
  const zezima = world.player();
  assert.equal((await world.upload(zezima, report({ description: '   ' }))).reason, 'A report needs a description.');
  assert.equal((await world.upload(zezima, report({ description: 'x'.repeat(4001) }))).reason,
    'Keep the description under 4000 characters.');
  assert.equal((await world.upload(zezima, report({ screenshot: 'data:image/gif;base64,R0lG' }))).reason,
    'The screenshot couldn\'t be read.');
  assert.deepEqual(world.send(zezima, { type: 'begin', id: 'report-big', chunks: 201, chars: 3_000_001 }),
    { type: 'rejected', id: 'report-big', reason: 'The report is too large to send.' });
  const packets = zezima.packets.length;
  world.send(zezima, { type: 'begin', id: '../../etc', chunks: 1, chars: 4 });
  assert.equal(zezima.packets.length, packets, 'a bad id gets no answer');

  // Chunks that aren't base64 or don't add up to the announced size never become a report.
  assert.equal(world.send(zezima, { type: 'begin', id: 'report-0009', chunks: 1, chars: 8 }).type, 'ready');
  world.send(zezima, { type: 'chunk', id: 'report-0009', index: 0, data: '<script>' });
  assert.deepEqual(world.send(zezima, { type: 'end', id: 'report-0009' }), { type: 'missing', id: 'report-0009', chunks: [0] });
  world.send(zezima, { type: 'chunk', id: 'report-0009', index: 0, data: 'e30=' });
  assert.deepEqual(world.send(zezima, { type: 'end', id: 'report-0009' }),
    { type: 'failed', id: 'report-0009', reason: 'The report arrived damaged.' });
});

test('an upload dies with its player, and after a minute of silence', () => {
  const world = setup();
  const zezima = world.player();
  assert.equal(world.send(zezima, { type: 'begin', id: 'report-0001', chunks: 2, chars: 8 }).type, 'ready');
  world.handlers.logout({ player: zezima });
  assert.equal(world.send(zezima, { type: 'end', id: 'report-0001' }).reason, 'The server lost the report. Please send it again.');
  assert.equal(world.send(zezima, { type: 'begin', id: 'report-0002', chunks: 2, chars: 8 }).type, 'ready');
  world.clock.now += 60_001;
  assert.equal(world.send(zezima, { type: 'end', id: 'report-0002' }).reason, 'The server lost the report. Please send it again.');
});

test('the plugin registers the channel and a world can switch it off by name', () => {
  const plugin = require('../plugins/interface/BugReports.plugin');
  assert.equal(plugin.name, 'BugReports');
  const events = [];
  plugin.register({ core: {}, onCustomEvent: (name) => events.push(name), onPlayerLogout() {}, onPlayerDisconnect() {} });
  assert.deepEqual(events, ['network:plugin-message']);
});
