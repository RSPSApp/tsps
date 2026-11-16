// Seeded quest completion/materials; actual registered players, map, packets and containers.
// node --test tests/elemental-helmet-smithing-native.test.cjs
const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { Bank } = require('../dist/game/model/container/impl/Bank');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const Runtime = require('../plugins/quests/QuestRuntime');
let core, I, O, quest, next = 1;
const errors = [], oldError = console.error;
before(async () => {
  console.error = (...args) => { errors.push(args.map(String).join(' ')); oldError(...args); };
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi(); I = core.ItemIdentifiers; O = core.ObjectIdentifiers;
  core.RegionManager.init(); core.RegionManager.loadMapFiles(2717, 9887);
  // The cache/plugins are already initialized in ordinary server mode. Only suppress
  // the unrelated WorldAdmin HTTP startup (and disabled CacheEditor HTTP startup).
  const browserHost = process.env.BROWSER_HOST;
  try { process.env.BROWSER_HOST = '1'; PM.emitServerStartup({}); }
  finally {
    if (browserHost === undefined) delete process.env.BROWSER_HOST;
    else process.env.BROWSER_HOST = browserHost;
  }
  quest = Runtime.getRegisteredQuests().find(q => q.key === 'elemental_workshop_ii');
  assert.ok(quest);
  for (const [id, name] of [[I.ELEMENTAL_METAL, 'elemental metal'], [I.ELEMENTAL_HELMET, 'elemental helmet'],
    [I.BEATEN_BOOK, 'beaten book'], [I.HAMMER, 'hammer']]) {
    const def = core.ItemDefinition.forId(id);
    assert.equal(def.getName().toLowerCase(), name); assert.equal(def.isNoted(), false);
    assert.equal(def.isStackable(), false);
  }
  assert.equal(O.WORKBENCH_5, 3402);
  assert.equal(core.CacheDefinitions.getObject(3402).name, 'Workbench');
});
after(() => { PM.emitServerShutdown({}); console.error = oldError; assert.deepEqual(errors, []); });

function skill(p, base, current = base) {
  p.getSkillManager().setMaxLevels(core.Skill.SMITHING, base, false)
    .setExperience(core.Skill.SMITHING, SkillManager.getExperienceForLevel(base))
    .setCurrentLevels(core.Skill.SMITHING, current, false);
}
function actor(t, { stage = 12, base = 20, current = base, book = true, hammer = true, schematic = false } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername(`helmqa${next++}`); p.setLongUsername(core.Misc.stringToLongBigInt(p.getUsername()));
  p.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(p), true);
  p.setLocation(new core.Location(2717, 9888, 0)); p.setNeedsPlacement(false);
  skill(p, base, current); quest.setStage(p, stage);
  if (book) p.getInventory().adds(I.BEATEN_BOOK, 1);
  if (hammer) p.getInventory().adds(I.HAMMER, 1);
  p.getInventory().adds(I.ELEMENTAL_METAL, 1);
  if (schematic) {
    p.getInventory().adds(I.CRANE_SCHEMATIC, 1);
    p.setAttribute('quest.elemental_workshop_ii.flags', 1 << 5);
  }
  const connection = new ClientConnection(channel); connection.player = p;
  p.getSession().setPlayer(p); p.getSession().setTurnPacketProcessor(() => connection.processTurnPackets());
  t.after(() => {
    p.getPacketSender().sendInterfaceRemoval();
    core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
    if (p.isRegistered()) core.World.getPlayers().remove(p);
    assert.equal(core.MultiChatboxPrompt.getPending(p), null);
    assert.equal(core.TaskManager.hasActiveTask(p), false);
    assert.equal(core.TaskManager.hasActiveTask(p.getIndex()), false);
  });
  return { p, connection };
}
function held(p, id = I.ELEMENTAL_METAL) {
  const slot = p.getInventory().getItems().findIndex(x => x.getId() === id);
  assert.ok(slot >= 0, `carried material ${id}`);
  return { slot, item: p.getInventory().getItems()[slot] };
}
function bench(p) {
  const location = new core.Location(2717, 9887, 0);
  const object = MapObjects.getObjectsAt(location, p.getPrivateArea()).find(o => o.getId() === O.WORKBENCH_5);
  assert.ok(object, 'actual workshop bench'); return object;
}
async function use(f, id = I.ELEMENTAL_METAL) {
  const h = held(f.p, id), object = bench(f.p);
  let arrived = 0;
  const emit = PM.emitItemOnObject;
  PM.emitItemOnObject = function(event) {
    if (event.player === f.p) { arrived++; assert.equal(event.object, object); assert.equal(event.item, h.item); }
    return emit.call(this, event);
  };
  try {
    await f.connection.dispatch([{ type: 'item_on_object', widgetId: Inventory.INTERFACE_ID,
      objectId: O.WORKBENCH_5, itemId: id, slot: h.slot, x: 2717, y: 9887 }]);
    for (let n = 0; n < 15 && !arrived; n++) core.World.process();
    assert.equal(arrived, 1, 'decoded native use reaches registered handler');
  } finally { PM.emitItemOnObject = emit; }
  return h;
}
const ticks = n => { for (let i = 0; i < n; i++) core.TaskManager.process(); };
function xp(p) { return p.getSkillManager().getExperience(core.Skill.SMITHING); }
function expectedXp(p) {
  const gate = PM.emitCanGainExperience(p, core.Skill.SMITHING, 20);
  assert.notEqual(gate.allow, false);
  return Math.floor(20 * core.GameConstants.EXPERIENCE_MULTIPLIER * gate.multiplier * 10 + 1e-6) / 10;
}
function noOutput(p, startXp) {
  assert.equal(p.getInventory().getAmount(I.ELEMENTAL_HELMET), 0);
  assert.equal(p.getInventory().getAmount(I.ELEMENTAL_SHIELD), 0);
  assert.equal(p.getInventory().getAmount(I.CRANE_CLAW), 0);
  assert.equal(xp(p), startXp);
}
async function input(f, packet) {
  await f.connection.dispatch([packet]);
  f.connection.processTurnPackets();
}
async function choose(f, label) {
  const prompt = core.MultiChatboxPrompt.getPending(f.p);
  assert.ok(prompt, 'native workbench prompt');
  const n = prompt.options.indexOf(label);
  assert.ok(n >= 0, label);
  await input(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: n + 1 });
}
test('completed native metal use makes exactly one helmet on tick four in a full bag', async t => {
  const f = actor(t), p = f.p, inv = p.getInventory();
  while (inv.getFreeSlots()) inv.adds(I.ROPE, 1);
  const startXp = xp(p), points = p.getAttribute('quest.points'), startStage = quest.getStage(p);
  const input = await use(f);
  noOutput(p, startXp); ticks(3); noOutput(p, startXp);
  ticks(1);
  assert.equal(inv.getItems()[input.slot].getId(), I.ELEMENTAL_HELMET);
  assert.equal(inv.getAmount(I.ELEMENTAL_METAL), 0); assert.equal(inv.getFreeSlots(), 0);
  assert.equal(inv.getAmount(I.BEATEN_BOOK), 1); assert.equal(inv.getAmount(I.HAMMER), 1);
  assert.equal(xp(p) - startXp, expectedXp(p));
  assert.equal(quest.getStage(p), startStage); assert.equal(p.getAttribute('quest.points'), points);
});

test('boosted Smithing 19 to20 is sufficient and both books keep the metal helmet route', async t => {
  const f = actor(t, { base: 19, current: 20 });
  f.p.getInventory().adds(I.SLASHED_BOOK, 1);
  f.p.setAttribute('quest.elemental_workshop_ii.jig', 1 << 7); // repaired crane must not block post-quest smithing
  const before = xp(f.p);
  await use(f); ticks(4);
  assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1);
  assert.equal(xp(f.p) - before, expectedXp(f.p));
});

for (const [label, options] of [
  ['Smithing19', { base: 19 }], ['missing hammer', { hammer: false }],
  ['missing book', { book: false }], ['unfinished durable mind-bar stage11', { stage: 11 }],
]) test(`${label} conserves the material and awards no XP`, async t => {
  const f = actor(t, options), before = xp(f.p);
  await use(f); ticks(4); noOutput(f.p, before);
  assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_METAL), 1);
  assert.equal(quest.getStage(f.p), options.stage ?? 12);
});

test('existing native helmet choice refuses unfinished quests then a fresh claw choice still works', async t => {
  const f = actor(t, { stage: 5, schematic: true }), before = xp(f.p);
  await use(f); await choose(f, 'An elemental helm.'); ticks(4);
  noOutput(f.p, before); assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_METAL), 1);
  await use(f); await choose(f, 'An elemental claw.');
  assert.equal(f.p.getInventory().getAmount(I.CRANE_CLAW), 1);
  assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_METAL), 0);
});

test('accepted helmet choice uses the same material context and four-tick recipe when now eligible', async t => {
  // Controlled eligibility transition while the existing menu is open, not a quest playthrough.
  const f = actor(t, { stage: 5, schematic: true }), before = xp(f.p);
  await use(f); quest.setStage(f.p, 12);
  await choose(f, 'An elemental helm.');
  ticks(3); noOutput(f.p, before); ticks(1);
  assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1);
  assert.equal(xp(f.p) - before, expectedXp(f.p));
});

test('closing the old helmet prompt prevents a later native resume from crafting', async t => {
  const f = actor(t, { stage: 5, schematic: true }), before = xp(f.p);
  await use(f); quest.setStage(f.p, 12);
  await input(f, { type: 'interface_close' });
  await input(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: 2 });
  ticks(4); noOutput(f.p, before);
  await use(f); ticks(4);
  assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1, 'new legitimate use works');
});

function bankReturn(p, id, { open = true } = {}) {
  if (open) p.getBank(0).open();
  const old = held(p, id);
  Bank.deposit(p, id, old.slot, 1, !open);
  assert.equal(p.getInventory().getAmount(id), 0, 'real Bank transfer removes the input');
  // Withdrawal requires a real open bank. Ignore-deposit tests deliberately open only after removal.
  if (!open) p.getBank(0).open();
  const tab = Bank.getTabForItem(p, id), slot = p.getBank(tab).getSlotForItemId(id);
  Bank.withdraw(p, id, slot, 1, tab);
  assert.equal(p.getInventory().getAmount(id), 1);
  assert.notEqual(held(p, id).item, old.item, 'real withdrawal creates a new owned item');
  p.getPacketSender().sendInterfaceRemoval();
  return old;
}

test('real bank removal while helmet choice waits rejects the replacement, then a fresh use succeeds', async t => {
  const f = actor(t, { stage: 5, schematic: true }), before = xp(f.p);
  await use(f);
  bankReturn(f.p, I.ELEMENTAL_METAL);
  quest.setStage(f.p, 12);
  await input(f, { type: 'dialogue_continue', widgetId: (219 << 16) | 1, childIndex: 2 });
  ticks(4); noOutput(f.p, before);
  await use(f); ticks(4); assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1);
});

for (const [label, change] of [
  ['drained level', f => skill(f.p, 20, 19)],
  ['hammer removed', f => f.p.getInventory().deleteNumber(I.HAMMER, 1)],
  ['book removed', f => f.p.getInventory().deleteNumber(I.BEATEN_BOOK, 1)],
  ['walk away', f => input(f, { type: 'move', worldX: 2717, worldY: 9889, modifierFlags: 0 })],
  ['teleport out and back', f => { const at = f.p.getLocation().clone(); f.p.moveTo(new core.Location(2720, 9888, 0)); f.p.moveTo(at); f.p.setNeedsPlacement(false); }],
  ['close input', f => input(f, { type: 'interface_close' })],
  ['new modal', f => f.p.getPacketSender().sendInterface(12)],
  ['death', f => f.p.setHitpoints(0)],
  ['logout', f => core.World.getPlayers().remove(f.p)],
  ['disconnect', f => PM.emitPlayerDisconnect({ player: f.p, username: f.p.getUsername() })],
]) test(`pending helmet cancels on ${label}`, async t => {
  const f = actor(t), before = xp(f.p);
  await use(f); ticks(1); await change(f); ticks(4);
  noOutput(f.p, before); assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_METAL), 1);
});

test('real Bank deposit/withdraw during smithing conserves replacement and permits retry', async t => {
  const f = actor(t), before = xp(f.p);
  await use(f); ticks(1); bankReturn(f.p, I.ELEMENTAL_METAL); ticks(4);
  noOutput(f.p, before);
  await use(f); ticks(4); assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1);
});

test('real inventory replacement after a direct ignored Bank deposit is also rejected', async t => {
  const f = actor(t), before = xp(f.p);
  await use(f); ticks(1);
  const old = held(f.p);
  Bank.deposit(f.p, I.ELEMENTAL_METAL, old.slot, 1, true);
  f.p.getInventory().adds(I.ELEMENTAL_METAL, 1);
  assert.notEqual(held(f.p).item, old.item);
  ticks(4); noOutput(f.p, before);
  await use(f); ticks(4); assert.equal(f.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1);
});

test('native queued walk retains its original material and rejects a real removed/refilled slot', async t => {
  const f = actor(t), p = f.p, before = xp(p), old = held(p);
  p.setLocation(new core.Location(2717, 9890, 0)); p.setNeedsPlacement(false);
  await input(f, { type: 'item_on_object', widgetId: Inventory.INTERFACE_ID,
    objectId: O.WORKBENCH_5, itemId: I.ELEMENTAL_METAL, slot: old.slot, x: 2717, y: 9887 });
  Bank.deposit(p, I.ELEMENTAL_METAL, old.slot, 1, true);
  p.getInventory().adds(I.ELEMENTAL_METAL, 1);
  assert.notEqual(held(p).item, old.item);
  const emit = PM.emitItemOnObject;
  let arrived = 0;
  PM.emitItemOnObject = function(event) {
    if (event.player === p) { arrived++; assert.equal(event.item, old.item); }
    return emit.call(this, event);
  };
  try {
    for (let n = 0; n < 15 && !arrived; n++) core.World.process();
    assert.equal(arrived, 1, 'real walk arrives with the original selected reference');
  } finally { PM.emitItemOnObject = emit; }
  ticks(4); noOutput(p, before);
  assert.equal(p.getInventory().getAmount(I.ELEMENTAL_METAL), 1);
  await use(f); ticks(4); assert.equal(p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1);
});

test('rapid uses consume one bar and repeated legitimate crafts survive an actual save round trip', async t => {
  const f = actor(t), p = f.p, inv = p.getInventory(), before = xp(p);
  inv.adds(I.ELEMENTAL_METAL, 1);
  await use(f); await use(f); ticks(4);
  assert.equal(inv.getAmount(I.ELEMENTAL_HELMET), 1); assert.equal(inv.getAmount(I.ELEMENTAL_METAL), 1);
  assert.equal(xp(p) - before, expectedXp(p));
  const save = PlayerSave.fromPlayer(p);
  const restored = actor(t); save.applyToPlayer(restored.p); restored.p.setNeedsPlacement(false);
  assert.equal(restored.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1);
  assert.equal(restored.p.getInventory().getAmount(I.ELEMENTAL_METAL), 1);
  assert.equal(xp(restored.p), xp(p)); assert.equal(quest.getStage(restored.p), 12);
  ticks(4); assert.equal(restored.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 1, 'no saved pending task');
  const freshBefore = xp(restored.p); await use(restored); ticks(4);
  assert.equal(restored.p.getInventory().getAmount(I.ELEMENTAL_HELMET), 2);
  assert.equal(restored.p.getInventory().getAmount(I.ELEMENTAL_METAL), 0);
  assert.equal(xp(restored.p) - freshBefore, expectedXp(restored.p));
});

for (const [label, replace] of [
  ['metadata', item => item.setMeta({ protected: true })],
  ['malformed amount', item => item.setAmount(2)],
]) test(`${label} input is preserved`, async t => {
  const f = actor(t), before = xp(f.p), h = held(f.p);
  replace(h.item); await use(f); ticks(4); noOutput(f.p, before);
  assert.equal(f.p.getInventory().getItems()[h.slot], h.item);
});
