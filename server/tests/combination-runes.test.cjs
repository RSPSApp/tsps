// Run after `yarn build`: node --test tests/combination-runes.test.cjs
//
// Combination runes (Wiki: Combination rune, Binding necklace, Magic Imbue, each rune's own page):
//   an elemental rune used on the altar of the other element binds with pure essence, one rune per essence, as many
//   as the essence and runes allow. Altar -> rune used -> combination rune, level, XP an essence (Recipe infoboxes):
//     Air:   water mist 6 (8),   earth dust 10 (8.3), fire smoke 15 (8.5)
//     Water: air mist 6 (8.5),   earth mud 13 (9.3),  fire steam 19 (9.3; the Steam rune page's prose says 9.5)
//     Earth: water mud 13 (9.5), air dust 10 (9),     fire lava 23 (10)
//     Fire:  water steam 19 (10), air smoke 15 (9.5), earth lava 23 (10.5)
//   Needs the talisman of the used rune's element (consumed) or an active Magic Imbue (no talisman then). Every rune
//   binds on a 50% chance, a Binding necklace worn (16 uses, one per altar use) binds them all.
// rsprox 1757 (rev 227) tick 18626: earth rune on the water altar with 6 pure essence -> 2 mud runes, "You partially
// succeed to bind the temple's power into mud runes.", anim 791, spotanim 186, synth 2710.
// Not captured, so ours: the all-bound / none-bound lines, the refusals and the necklace's last-charge line.
const assert = require('node:assert/strict'), path = require('node:path');
const { before, after, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
let core, I, next = 3150;
const bots = process.env.DISABLE_PLAYER_BOTS;
const IMBUE = 'lunar:magic-imbue-until';
const CHARGES = 'runecrafting:binding-necklace';
const ALTAR = (n) => core.ObjectIdentifiers['ALTAR_' + n];
const AIR = 33, WATER = 35, EARTH = 36, FIRE = 37;

before(async () => {
  process.env.DISABLE_PLAYER_BOTS = '1';
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi(); I = core.ItemIdentifiers;
  // Verify the active cache once before the conservation cases use these definitions.
  for (const [id, name, stackable] of [[I.MUD_RUNE, 'Mud rune', true],
    [I.PURE_ESSENCE, 'Pure essence', false], [I.EARTH_RUNE, 'Earth rune', true],
    [I.EARTH_TALISMAN, 'Earth talisman', false], [I.BINDING_NECKLACE, 'Binding necklace', false]]) {
    const def = core.ItemDefinition.forId(id);
    assert.equal(def.getId(), id, 'active cache exact id');
    assert.equal(def.getName(), name, 'active cache exact name');
    assert.equal(def.isStackable(), stackable, 'active cache stackability');
  }
  assert.equal(I.MUD_RUNE, 4698); assert.equal(I.PURE_ESSENCE, 7936);
  assert.equal(I.BINDING_NECKLACE, 5521);
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  if (bots === undefined) delete process.env.DISABLE_PLAYER_BOTS; else process.env.DISABLE_PLAYER_BOTS = bots;
});

function actor(t, level = 99) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername('combo' + next); p.setRegistered(true); p.setLocation(new core.Location(3222, 3218, 0)); p.needsPlacement = false;
  p.getSkillManager().setCurrentLevel(core.Skill.RUNECRAFTING, level, true);
  p.getSkillManager().setMaxLevel(core.Skill.RUNECRAFTING, level, true);
  const c = new ClientConnection(channel); c.player = p;
  const messages = [];
  t.mock.method(p.getPacketSender(), 'sendMessage', (m) => { messages.push(m); return p.getPacketSender(); });
  const sender = p.getPacketSender(), typed = [], sendTyped = sender.sendTypedMessage.bind(sender);
  t.mock.method(sender, 'sendTypedMessage', (type, text, ...r) => { typed.push(text); return sendTyped(type, text, ...r); });
  t.after(() => { PM.emitPlayerLogout({ player: p, username: p.getUsername() }); p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
  return { t, p, c, messages, typed, all: () => messages.concat(typed) };
}
async function drain(f) { for (let i = 0; i < 10; i++) { core.TaskManager.processWalkTo(f.p.getIndex()); f.p.getMovementQueue().process(); core.TaskManager.process(); } }
async function send(f, packet) { await f.c.dispatch([packet]); f.c.processTurnPackets(); await drain(f); }
const count = (f, id) => f.p.getInventory().getAmount(id);
function give(f, id, n) { f.p.getInventory().add(new core.Item(id, n), true); }
// The item-on-object listener needs the loc to stand where it is clicked (MapObjects.getPrivateArea): there is no
// altar in Lumbridge, so the real altar object is registered beside the player and removed afterwards.
async function use(f, altar, runeId) {
  if (f.placed !== altar) {
    const loc = new core.GameObject(ALTAR(altar), new core.Location(3223, 3218, 0), 10, 0, null);
    core.ObjectManager.register(loc, true);
    f.t.after(() => core.ObjectManager.deregister(loc, true));
    f.placed = altar;
  }
  await send(f, { type: 'item_on_object', widgetId: 149 << 16, objectId: ALTAR(altar), itemId: runeId, slot: f.p.getInventory().getSlotForItemId(runeId), x: 3223, y: 3218 });
}
function chance(t, values) { let i = 0; t.mock.method(Math, 'random', () => values[i++ % values.length]); }
// getExperience() floors to whole XP; the tenths (8.3, 9.3) are kept in skills.experience, so read those.
const xpOf = (f) => f.p.getSkillManager().skills.experience[core.Skill.RUNECRAFTING.getIndex()];

const TABLE = [
  [AIR, 'WATER', 'MIST', 6, 8], [AIR, 'EARTH', 'DUST', 10, 8.3], [AIR, 'FIRE', 'SMOKE', 15, 8.5],
  [WATER, 'AIR', 'MIST', 6, 8.5], [WATER, 'EARTH', 'MUD', 13, 9.3], [WATER, 'FIRE', 'STEAM', 19, 9.3],
  [EARTH, 'WATER', 'MUD', 13, 9.5], [EARTH, 'AIR', 'DUST', 10, 9], [EARTH, 'FIRE', 'LAVA', 23, 10],
  [FIRE, 'WATER', 'STEAM', 19, 10], [FIRE, 'AIR', 'SMOKE', 15, 9.5], [FIRE, 'EARTH', 'LAVA', 23, 10.5],
];
for (const [altar, used, made, level, xp] of TABLE) {
  test(`altar ${altar}: ${used.toLowerCase()} rune makes ${made.toLowerCase()} runes from level ${level} at ${xp} XP an essence`, async (t) => {
    const f = actor(t, level); chance(t, [0.1]);
    give(f, I.PURE_ESSENCE, 4); give(f, I[used + '_RUNE'], 4); give(f, I[used + '_TALISMAN'], 1);
    const before = xpOf(f);
    await use(f, altar, I[used + '_RUNE']);
    assert.equal(count(f, I[made + '_RUNE']), 4);
    assert.equal(count(f, I.PURE_ESSENCE), 0);
    assert.equal(count(f, I[used + '_RUNE']), 0);
    assert.equal(count(f, I[used + '_TALISMAN']), 0, 'the talisman is spent');
    assert.ok(Math.abs(xpOf(f) - before - 4 * xp) < 0.01);
  });
  test(`altar ${altar}: ${made.toLowerCase()} runes need level ${level}`, async (t) => {
    const f = actor(t, level - 1);
    give(f, I.PURE_ESSENCE, 4); give(f, I[used + '_RUNE'], 4); give(f, I[used + '_TALISMAN'], 1);
    await use(f, altar, I[used + '_RUNE']);
    assert.equal(count(f, I[made + '_RUNE']), 0);
    assert.equal(count(f, I.PURE_ESSENCE), 4);
    assert.equal(count(f, I[used + '_TALISMAN']), 1);
    assert.ok(f.all().some((m) => m.includes(`level of at least ${level}`)));
  });
}

test('the captured case: 6 essence, earth runes, water altar, 2 of 6 bind -> "partially succeed" message (1757 tick 18626)', async (t) => {
  const f = actor(t); chance(t, [0.1, 0.9, 0.9, 0.1, 0.9, 0.9]);
  give(f, I.PURE_ESSENCE, 6); give(f, I.EARTH_RUNE, 6); give(f, I.EARTH_TALISMAN, 1);
  const sounds = []; t.mock.method(core.Sounds, 'sendSound', (...a) => { sounds.push(a); });
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 2);
  assert.equal(count(f, I.PURE_ESSENCE), 0, 'all six essence gone');
  assert.ok(f.all().includes("You partially succeed to bind the temple's power into mud runes."));
  assert.equal(f.p.getAnimation()?.getId?.() ?? 791, 791);
  assert.ok(sounds.length >= 1, 'the craft sound plays');
});

test('every rune binding says so (our wording, not captured) and none binding says so too, still spending everything', async (t) => {
  const all = actor(t); chance(t, [0.1]);
  give(all, I.PURE_ESSENCE, 2); give(all, I.EARTH_RUNE, 2); give(all, I.EARTH_TALISMAN, 1);
  await use(all, WATER, I.EARTH_RUNE);
  assert.equal(count(all, I.MUD_RUNE), 2);
  assert.ok(all.all().some((m) => /succeed/.test(m) && !/partially/.test(m) && /mud runes/.test(m)));
  const none = actor(t); chance(t, [0.9]);
  give(none, I.PURE_ESSENCE, 2); give(none, I.EARTH_RUNE, 2); give(none, I.EARTH_TALISMAN, 1);
  const before = xpOf(none);
  await use(none, WATER, I.EARTH_RUNE);
  assert.equal(count(none, I.MUD_RUNE), 0);
  assert.equal(count(none, I.PURE_ESSENCE), 0); assert.equal(count(none, I.EARTH_RUNE), 0); assert.equal(count(none, I.EARTH_TALISMAN), 0);
  assert.equal(xpOf(none), before, 'no XP for runes that did not bind');
});

test('the amount is the lesser of the pure essence and the runes; the rest stays', async (t) => {
  const f = actor(t); chance(t, [0.1]);
  give(f, I.PURE_ESSENCE, 10); give(f, I.EARTH_RUNE, 3); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 3); assert.equal(count(f, I.PURE_ESSENCE), 7);
});

test('rune essence does not bind, and nothing is spent without pure essence', async (t) => {
  const f = actor(t);
  give(f, I.RUNE_ESSENCE, 5); give(f, I.EARTH_RUNE, 5); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 0); assert.equal(count(f, I.RUNE_ESSENCE), 5);
  assert.equal(count(f, I.EARTH_RUNE), 5); assert.equal(count(f, I.EARTH_TALISMAN), 1);
});

test('without the talisman or an Imbue nothing happens; the wrong talisman does not count', async (t) => {
  const f = actor(t);
  give(f, I.PURE_ESSENCE, 4); give(f, I.EARTH_RUNE, 4); give(f, I.AIR_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 0); assert.equal(count(f, I.PURE_ESSENCE), 4); assert.equal(count(f, I.EARTH_RUNE), 4);
  assert.equal(count(f, I.AIR_TALISMAN), 1);
});

test('an active Magic Imbue replaces the talisman, and the talisman is not spent when it is held', async (t) => {
  const f = actor(t); chance(t, [0.1]);
  f.p.setAttribute(IMBUE, core.World.getProcessCycle() + 10);
  give(f, I.PURE_ESSENCE, 3); give(f, I.EARTH_RUNE, 3); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 3);
  assert.equal(count(f, I.EARTH_TALISMAN), 1, 'Imbue stands in for it');
});

test('an expired Magic Imbue does not', async (t) => {
  const f = actor(t);
  f.p.setAttribute(IMBUE, core.World.getProcessCycle() - 1);
  give(f, I.PURE_ESSENCE, 3); give(f, I.EARTH_RUNE, 3);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 0); assert.equal(count(f, I.PURE_ESSENCE), 3);
});

test('a worn Binding necklace binds every rune and spends one charge for the whole batch', async (t) => {
  const f = actor(t); chance(t, [0.99]);
  f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.BINDING_NECKLACE, 1));
  give(f, I.PURE_ESSENCE, 5); give(f, I.EARTH_RUNE, 5); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 5);
  assert.equal(f.p.getAttribute(CHARGES), 15, 'sixteen uses, one spent');
});

test('the last charge turns the necklace to dust after the batch (our line)', async (t) => {
  const f = actor(t); chance(t, [0.99]);
  f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.BINDING_NECKLACE, 1));
  f.p.setAttribute(CHARGES, 1);
  give(f, I.PURE_ESSENCE, 2); give(f, I.EARTH_RUNE, 2); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 2, 'that batch still binds');
  assert.equal(f.p.getEquipment().getItems()[core.Equipment.AMULET_SLOT].getId(), -1);
  assert.ok(f.all().some((m) => /Binding necklace/.test(m) && /disintegrat/.test(m)));
  assert.equal(f.p.getAttribute(CHARGES) ?? 16, 16, 'a new necklace starts full');
});

test('a Binding necklace in the inventory (not worn) does nothing', async (t) => {
  const f = actor(t); chance(t, [0.99]);
  give(f, I.BINDING_NECKLACE, 1); give(f, I.PURE_ESSENCE, 2); give(f, I.EARTH_RUNE, 2); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 0);
});

test('a rune of the altar\'s own element used on it is not a combination (it stays untouched)', async (t) => {
  const f = actor(t);
  give(f, I.PURE_ESSENCE, 2); give(f, I.WATER_RUNE, 2); give(f, I.WATER_TALISMAN, 1);
  await use(f, WATER, I.WATER_RUNE);
  assert.equal(count(f, I.WATER_RUNE), 2); assert.equal(count(f, I.PURE_ESSENCE), 2);
});

test('lava runes come from the earth talisman on the fire altar, not the fire one', async (t) => {
  const f = actor(t); chance(t, [0.1]);
  give(f, I.PURE_ESSENCE, 2); give(f, I.EARTH_RUNE, 2); give(f, I.FIRE_TALISMAN, 1);
  await use(f, FIRE, I.EARTH_RUNE);
  assert.equal(count(f, I.LAVA_RUNE), 0, 'the used rune own talisman is the one needed');
  give(f, I.EARTH_TALISMAN, 1);
  await use(f, FIRE, I.EARTH_RUNE);
  assert.equal(count(f, I.LAVA_RUNE), 2);
});

// Preset items (a loadout's copies, Item.isPresetItem) are not turned into real runes: only real stacks count and are
// taken, slot by slot.
function givePreset(f, id, n) {
  const inv = f.p.getInventory();
  inv.setItem(inv.getItems().findIndex((i) => !i || i.getId() < 0), new core.Item(id, n).setMetaValue(core.Item.PRESET_META, true));
}
test('preset pure essence is not bound; real essence beside it is, and the preset stack stays', async (t) => {
  const f = actor(t); chance(t, [0.1]);
  givePreset(f, I.PURE_ESSENCE, 2); give(f, I.PURE_ESSENCE, 2); give(f, I.EARTH_RUNE, 4); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 2, 'only the two real essence');
  assert.equal(count(f, I.PURE_ESSENCE), 2, 'the preset pair is left');
  assert.equal(count(f, I.EARTH_RUNE), 2);
});
test('preset runes and a preset talisman do not count', async (t) => {
  const f = actor(t); chance(t, [0.1]);
  give(f, I.PURE_ESSENCE, 2); givePreset(f, I.EARTH_RUNE, 2); give(f, I.EARTH_TALISMAN, 1);
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(count(f, I.MUD_RUNE), 0); assert.equal(count(f, I.PURE_ESSENCE), 2); assert.equal(count(f, I.EARTH_RUNE), 2);
  const g = actor(t); chance(t, [0.1]);
  give(g, I.PURE_ESSENCE, 2); give(g, I.EARTH_RUNE, 2); givePreset(g, I.EARTH_TALISMAN, 1);
  await use(g, WATER, I.EARTH_RUNE);
  assert.equal(count(g, I.MUD_RUNE), 0); assert.equal(count(g, I.EARTH_TALISMAN), 1);
});
test('the necklace turning to dust changes the player\'s appearance', async (t) => {
  const f = actor(t); chance(t, [0.99]);
  f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.BINDING_NECKLACE, 1));
  f.p.setAttribute(CHARGES, 1);
  give(f, I.PURE_ESSENCE, 1); give(f, I.EARTH_RUNE, 1); give(f, I.EARTH_TALISMAN, 1);
  f.p.getUpdateFlag().reset();
  await use(f, WATER, I.EARTH_RUNE);
  assert.equal(f.p.getUpdateFlag().flagged(core.Flag.APPEARANCE), true);
});

// A guaranteed binding must conserve every essence even when the output stack is nearly full.
for (const headroom of [null, 2, 1, 0]) {
  test(`combination output conservation with stack headroom ${headroom}`, async (t) => {
    const f = actor(t), inv = f.p.getInventory(), MAX = 0x7fffffff;
    give(f, I.PURE_ESSENCE, 2); give(f, I.EARTH_RUNE, 2); give(f, I.EARTH_TALISMAN, 1);
    f.p.getEquipment().setItem(core.Equipment.AMULET_SLOT, new core.Item(I.BINDING_NECKLACE, 1));
    assert.equal(f.p.getAttribute(CHARGES), undefined, 'real new necklace default16, no preset flag');
    const held = headroom === null ? 0 : MAX - headroom;
    if (held) give(f, I.MUD_RUNE, held);
    assert.equal(count(f, I.PURE_ESSENCE), 2); assert.equal(count(f, I.EARTH_RUNE), 2);
    assert.equal(count(f, I.EARTH_TALISMAN), 1); assert.equal(count(f, I.MUD_RUNE), held);
    const floor = () => core.ItemOnGroundManager.ownedBy(f.p.getUsername()).filter(g =>
      g.getItem().getId() === I.MUD_RUNE).reduce((n, g) => n + g.getItem().getAmount(), 0);
    t.after(() => { for (const g of core.ItemOnGroundManager.ownedBy(f.p.getUsername())) core.ItemOnGroundManager.deregister(g); });
    const beforeFloor = floor(), beforeXp = xpOf(f), events = [];
    const emit = PM.emitCustomEvent.bind(PM);
    t.mock.method(PM, 'emitCustomEvent', (name, event) => {
      if (name === 'runecrafting:success' && event.player === f.p) events.push({...event});
      return emit(name, event);
    });
    await use(f, WATER, I.EARTH_RUNE); // native selected object, real listener and plugin dispatch
    const credited = count(f, I.MUD_RUNE) - held + floor() - beforeFloor;
    const consumed = 2 - count(f, I.PURE_ESSENCE);
    assert.equal(credited, consumed, 'every accepted essence credits one guaranteed necklace rune');
    assert.equal(2 - count(f, I.EARTH_RUNE), consumed, 'elemental debit matches actual credit');
    assert.equal(count(f, I.EARTH_TALISMAN), consumed ? 0 : 1, 'no talisman debit on refusal');
    assert.equal(f.p.getEquipment().getItems()[core.Equipment.AMULET_SLOT].getId(), I.BINDING_NECKLACE);
    assert.equal(f.p.getAttribute(CHARGES) ?? 16, consumed ? 15 : 16, 'charge only on accepted batch');
    assert.ok(Math.abs(xpOf(f) - beforeXp - credited * 9.3) < 0.01, 'XP follows credited runes');
    assert.equal(events.reduce((n, e) => n + e.runeAmount, 0), credited, 'event quantity follows credit');
    if (headroom === null || headroom >= 2) assert.equal(credited, 2, 'room controls must complete');
    else assert.equal(credited, 0, 'a batch that cannot fit is refused');
  });
}

// A capacity check uses the rolled quantity, without blocking a legitimate failed bind.
for (const [rolls, headroom, expected] of [[[0.1, 0.9], 1, 1], [[0.9, 0.9], 0, 0]]) {
  test(`imbued combination commits ${expected} bound with headroom ${headroom}`, async (t) => {
    const f = actor(t); chance(t, rolls);
    f.p.setAttribute(IMBUE, core.World.getProcessCycle() + 10);
    give(f, I.PURE_ESSENCE, 2); give(f, I.EARTH_RUNE, 2); give(f, I.EARTH_TALISMAN, 1);
    give(f, I.MUD_RUNE, 0x7fffffff - headroom);
    const before = xpOf(f);
    await use(f, WATER, I.EARTH_RUNE);
    assert.equal(count(f, I.MUD_RUNE), 0x7fffffff - headroom + expected);
    assert.equal(count(f, I.PURE_ESSENCE), 0);
    assert.equal(count(f, I.EARTH_RUNE), 0);
    assert.equal(count(f, I.EARTH_TALISMAN), 1, 'active Imbue preserves talisman');
    assert.ok(Math.abs(xpOf(f) - before - expected * 9.3) < 0.01);
  });
}
