// After yarn build: node --test --test-concurrency=1 tests/enlightened-journey-preferences.test.cjs
// Stage 6, position and fuel are supplied setup. Real dialogue/input, inventory and task phases;
// not a natural quest playthrough, raw packet decoder, client rendering or retail timing proof.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');

const STAGE = 'quest.enlightened_journey.stage';
const STOCK = 'balloon-transport:stored-logs';
const PREFERENCE = 'balloon-transport:log-preference';
const READY = 6, LANDED = 7;
let core, Controls, serial = 0, oldSubmit, oldError, oldWarn, oldLog;
const tasks = new Set(), errors = [];
before(async () => {
  oldError = console.error; oldWarn = console.warn; oldLog = console.log;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); oldError(...args); };
  console.warn = (...args) => { if (/\[plugins\].*hook.*(?:failed|threw)/.test(args.map(String).join(' '))) errors.push(args.map(String).join(' ')); oldWarn(...args); };
  console.log = (...args) => { if (args.some(arg => arg instanceof Error)) errors.push(args.map(String).join(' ')); oldLog(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins')); core = PM.getCoreApi();
  Controls = require('../plugins/world/balloontransport/Controls.BalloonTransport');
  oldSubmit = core.TaskManager.submit;
  core.TaskManager.submit = function(task, ...args) { tasks.add(task); return oldSubmit.call(this, task, ...args); };
  core.RegionManager.init(); core.RegionManager.loadMapFiles(2808, 3354);
  PM.emitServerStartup({});
});
after(() => {
  try {
    PM.emitServerShutdown({});
    for (const task of tasks) if (task.isRunning()) task.stop();
    assert.deepEqual(errors, [], 'no swallowed engine/plugin errors');
  } finally {
    console.error = oldError; console.warn = oldWarn; console.log = oldLog;
    if (core) core.TaskManager.submit = oldSubmit;
  }
});

function tick(n = 1) { for (let i = 0; i < n; i++) core.World.process(); }
function actor(t, { logs = 0, stored = 12, tinderbox = true, preference = 'storage', stage = READY } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel), p = new Player(session), c = new ClientConnection(channel);
  c.player = p; session.setPlayer(p); session.setTurnPacketProcessor(() => c.processTurnPackets());
  p.setUsername(`ejpref${++serial}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(p), true);
  p.moveTo(new core.Location(2808, 3354, 0));
  for (let n = 0; n < 4 && p.isNeedsPlacement(); n++) tick();
  assert.equal(p.isNeedsPlacement(), false); assert.equal(p.isRegistered(), true); assert.ok(p.getHitpoints() > 0);
  p.setAttribute(STAGE, stage); p.setAttribute(STOCK, { logs: stored }); p.setAttribute(PREFERENCE, preference);
  if (logs) p.getInventory().adds(core.ItemIdentifiers.LOGS, logs);
  if (tinderbox) p.getInventory().adds(core.ItemIdentifiers.TINDERBOX, 1);
  const messages = [], interfaces = [];
  const send = p.sendMessage.bind(p); p.sendMessage = (...args) => { messages.push(String(args[0])); return send(...args); };
  const sender = p.getPacketSender(), sendInterface = sender.sendInterface.bind(sender);
  sender.sendInterface = (...args) => { interfaces.push(args[0]); return sendInterface(...args); };
  t.after(() => {
    const index = p.getIndex();
    PM.emitPlayerDisconnect({ player: p, username: p.getUsername() }); PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.closeInterruptibleInterfaces(); p.getMovementQueue().reset(); p.getMovementQueue().walkToReset();
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(index); core.World.getPlayers().remove(p);
    assert.equal(p.isRegistered(), false); assert.equal(Controls.inFlight(p), false);
    assert.equal(core.TaskManager.hasActiveTask(p), false); assert.equal(core.TaskManager.hasActiveTask(index), false);
    tick(); // drain invalidated null-key launch callbacks
  });
  return { p, c, messages, interfaces, seen: [] };
}
const logs = f => f.p.getInventory().getAmount(core.ItemIdentifiers.LOGS);
const stored = f => f.p.getAttribute(STOCK).logs;
const prompt = f => MultiChatboxPrompt.getPending(f.p);
const text = f => String(f.p.getDialogueManager().getCurrent()?.getText?.() ?? '').replace(/\s+/g, ' ');
async function input(f, packet) { await f.c.dispatch([packet]); tick(); }
async function choose(f, option) {
  const pending = prompt(f); assert.ok(pending, `expected menu for ${option}; dialogue=${text(f)}`);
  const index = pending.options.indexOf(option); assert.ok(index >= 0, `${option} in ${JSON.stringify(pending.options)}`);
  await input(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: index + 1 });
}
async function resume(f) {
  const current = f.p.getDialogueManager().getCurrent();
  assert.ok(current, 'a native dialogue must own Continue');
  const uid = { NpcDialogue: (231 << 16) | 5, PlayerDialogue: (217 << 16) | 5, StatementDialogue: (229 << 16) | 4 }[current.constructor.name];
  assert.ok(uid, `known native dialogue type ${current.constructor.name}`);
  f.seen.push(text(f));
  await input(f, { type: 'dialogue_continue', widgetId: uid, childIndex: -1 });
}
async function settleDialogue(f) {
  for (let i = 0; i < 16; i++) {
    if (prompt(f) || !f.p.getDialogueManager().isActive()) return;
    await resume(f);
  }
  assert.fail(`dialogue did not settle: ${text(f)}`);
}
async function offer(f) {
  PM.emitCustomEvent('npc-dialogue:start', { player: f.p, npcId: core.NpcIdentifiers.AUGUSTE });
  assert.equal(text(f), "Well, let's get going!");
  await settleDialogue(f); await choose(f, 'Okay.'); await settleDialogue(f);
}
async function selectFuel(f, option = 'Take logs from storage first.') {
  await offer(f);
  assert.ok(prompt(f)?.options.includes(option), `fuel choice must be reachable; seen=${f.seen.join(' / ')}`);
  await choose(f, option);
}
function assertPending(f, inv, stock) {
  assert.equal(Controls.inFlight(f.p), false, 'conversation ends before the flight');
  assert.equal(f.interfaces.includes(core.CacheDefinitions.getInterfaceId('zep_interface')), false);
  assert.equal(logs(f), inv); assert.equal(stored(f), stock); assert.equal(f.p.getAttribute(STAGE), READY);
}
function assertFlying(f, inv, stock) {
  tick(); assert.equal(Controls.inFlight(f.p), true, 'next task phase starts controls');
  assert.equal(logs(f), inv); assert.equal(stored(f), stock); assert.equal(f.p.getAttribute(STAGE), READY);
  assert.equal(f.interfaces.filter(id => id === core.CacheDefinitions.getInterfaceId('zep_interface')).length, 1);
}

test('inventory-only positive reaches the real source menu and pays ten at the next task phase', async t => {
  const f = actor(t, { logs: 10, stored: 0, preference: 'ask' });
  await selectFuel(f, 'Take logs from my inventory first.'); assertPending(f, 10, 0); assertFlying(f, 0, 0);
});

test('stored-only fuel reaches Auguste with storage preference and lands the quest without inventory logs', async t => {
  const f = actor(t);
  const xp = f.p.getSkillManager().getExperience(core.Skill.FIREMAKING);
  await selectFuel(f); assertPending(f, 0, 12); assertFlying(f, 0, 2);
  const buttons = { S: 'zep_btn_sandbags', L: 'zep_btn_logs', R: 'zep_btn_relax', N: 'zep_btn_tug', E: 'zep_btn_tug_emerg' };
  for (const move of 'S1 L1 R9 E1 R2 N1 R5 L1 R1 L1 R10 L1 R5 R7 E1 N1 R3 L1 R4 N1'.split(' ')) {
    for (let i = 0; i < Number(move.slice(1)); i++) {
      const uid = core.CacheDefinitions.getComponentId(`zep_interface_side:${buttons[move[0]]}`);
      await input(f, { type: 'widget_action', widgetId: uid, groupId: uid >>> 16, childId: uid & 0xffff, buttonNum: 1, slot: -1, itemId: -1 });
      tick();
    }
  }
  tick(8);
  assert.equal(Controls.inFlight(f.p), false); assert.equal(f.p.getAttribute(STAGE), LANDED);
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], [2941, 3420]);
  assert.equal(logs(f), 0); assert.equal(stored(f), 2);
  assert.equal(Number(f.p.getAttribute('balloon-transport:routes')) || 0, 0);
  assert.equal(f.p.getSkillManager().getExperience(core.Skill.FIREMAKING), xp);
});

test('both complete sources and both ask choices pay only the selected source', async t => {
  for (const [outer, inner, inv, stock] of [
    ['Take logs from storage first.', null, 10, 2],
    ['Take logs from my inventory first.', null, 0, 12],
    ['Ask me what logs to use every time.', 'Use logs from inventory', 0, 12],
    ['Ask me what logs to use every time.', 'Use logs from storage', 10, 2],
  ]) {
    const f = actor(t, { logs: 10 });
    await selectFuel(f, outer);
    if (inner) await choose(f, inner);
    assertPending(f, 10, 12); assertFlying(f, inv, stock);
  }
});

test('less than ten in each source is refused without pooling or taking fuel', async t => {
  const f = actor(t, { logs: 9, stored: 9 });
  await offer(f);
  assert.ok(f.seen.includes("You don't have enough logs. You need ten normal logs."), f.seen.join(' / '));
  assert.equal(prompt(f), null); assert.equal(Controls.inFlight(f.p), false);
  assert.equal(logs(f), 9); assert.equal(stored(f), 9);
});

test('stored logs do not bypass the tinderbox refusal', async t => {
  const f = actor(t, { tinderbox: false }); await offer(f);
  assert.ok(f.seen.includes('You need a tinderbox.'), f.seen.join(' / '));
  assert.equal(Controls.inFlight(f.p), false); assert.equal(stored(f), 12);
});

test('noted inventory logs do not pay a flight until deposited', async t => {
  const f = actor(t, { stored: 0 });
  const noted = core.ItemDefinition.forId(core.ItemIdentifiers.LOGS).getNoteId();
  assert.ok(noted > 0 && noted !== core.ItemIdentifiers.LOGS);
  f.p.getInventory().adds(noted, 10); await offer(f);
  assert.ok(f.seen.includes("You don't have enough logs. You need ten normal logs."));
  assert.equal(f.p.getInventory().getAmount(noted), 10); assert.equal(Controls.inFlight(f.p), false);
});

test('weight is still refused with stored-only fuel, including a change before commit', async t => {
  const offered = actor(t); offered.p.getInventory().adds(core.ItemIdentifiers.RUNE_PLATEBODY, 6);
  await offer(offered);
  assert.ok(offered.seen.includes('You have too much weight in your bag. You may only bring 40kg of weight.'));
  assert.equal(stored(offered), 12); assert.equal(Controls.inFlight(offered.p), false);
  const selected = actor(t); await selectFuel(selected); assertPending(selected, 0, 12);
  selected.p.getInventory().adds(core.ItemIdentifiers.RUNE_PLATEBODY, 6); tick();
  assert.equal(stored(selected), 12); assert.equal(Controls.inFlight(selected.p), false);
  assert.ok(selected.messages.includes('You have too much weight in your bag. You may only bring 40kg of weight.'));
});

test('repeated native option input starts one flight and consumes one fare', async t => {
  const f = actor(t); await offer(f);
  const index = prompt(f).options.indexOf('Take logs from storage first.'); assert.ok(index >= 0);
  const packet = { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: index + 1 };
  await f.c.dispatch([packet, packet]); tick(); assertPending(f, 0, 12); assertFlying(f, 0, 2);
  tick(2); assert.equal(stored(f), 2);
});

test('fuel queries are read-only and reject invalid counts and unknown stations', t => {
  const f = actor(t, { logs: 9, stored: 9 });
  for (const [station, count] of [['taverley', 10], ['missing', 10], ['taverley', 0], ['taverley', -10], ['taverley', 1.5]]) {
    const request = { player: f.p, station, logs: count, canPay: null };
    PM.emitCustomEvent('balloon-transport:can-pay', request); assert.equal(request.canPay, false);
  }
  assert.equal(logs(f), 9); assert.equal(stored(f), 9); assert.equal(f.p.getAttribute(PREFERENCE), 'storage');
  assert.equal(prompt(f), null); assert.equal(Controls.inFlight(f.p), false);
});

test('fuel lost after selection falls back to a complete inventory source exactly once', async t => {
  const f = actor(t, { logs: 10 }); await selectFuel(f);
  assertPending(f, 10, 12); f.p.setAttribute(STOCK, { logs: 3 });
  assertFlying(f, 0, 3);
});

test('fuel or tinderbox lost after selection refuses before debit with feedback', async t => {
  for (const missing of ['fuel', 'tinderbox']) {
    const f = actor(t); await selectFuel(f); assertPending(f, 0, 12);
    if (missing === 'fuel') f.p.setAttribute(STOCK, { logs: 9 });
    else f.p.getInventory().delete(core.ItemIdentifiers.TINDERBOX, 1);
    tick(); assert.equal(Controls.inFlight(f.p), false); assert.equal(logs(f), 0);
    assert.equal(stored(f), missing === 'fuel' ? 9 : 12);
    assert.ok(f.messages.includes(missing === 'fuel' ? "You don't have enough logs. You need ten normal logs." : 'You need a tinderbox.'));
  }
});

test('logout invalidates the pending attempt even if the player is registered again before the callback', async t => {
  const f = actor(t); await selectFuel(f); assertPending(f, 0, 12);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });
  f.p.setRegistered(false); f.p.setRegistered(true); tick();
  assert.equal(Controls.inFlight(f.p), false); assert.equal(stored(f), 12);
});

test('stage change or movement after selection cannot launch a stale quest flight', async t => {
  for (const change of ['stage', 'position']) {
    const f = actor(t); await selectFuel(f); assertPending(f, 0, 12);
    if (change === 'stage') f.p.setAttribute(STAGE, LANDED);
    else f.p.moveTo(new core.Location(2809, 3354, 0));
    tick(); assert.equal(Controls.inFlight(f.p), false); assert.equal(stored(f), 12);
  }
});
