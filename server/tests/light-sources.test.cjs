// Run after `yarn build`: node --test tests/light-sources.test.cjs
//
// Lighting a light source with a tinderbox (#2546; OSRS Wiki: Light sources, and each item's page).
// Unlit -> lit, Firemaking level: unlit torch 1, candle 1, white and black candle lanterns 4, bug lantern 33,
// emerald lantern 49, mining helmet 65 (unlit 5014 -> lit 5013; the Wiki's "Unlit" and "Lit" versions). Item
// ids are the cache's. The oil lamp, oil lantern, bullseye lantern and sapphire lantern already light through
// OilLights.plugin.js and the black candle through Merlin's Crystal; they are controls here.
// Captured (rsprox 70 tick 1626 and 75 tick 11666, rev 227): the torch is lit by the tinderbox (590) on the
// unlit torch (596) with the game message "You light your torch.", the slot becoming 594 in the same tick,
// and no sequence or sound. NO capture of any other item was found (rsprox 1694, 1633, 392 and 2902 decoded:
// braziers and fires only), so the others get no message and no animation, and the level refusal's wording is
// OilLights' (uncaptured).
// Native fixture: the click goes through ClientConnection.dispatch as the decoded "inventory_use_on" packet.
// Native plugin loading excludes PlayerBots and its dependent BountyHunter.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// This fixture does not exercise bots or their writable object-index cache.
const priorBots = process.env.DISABLE_PLAYER_BOTS;
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");
const Diaries = require("../plugins/achievements/diaries/Data.AchievementDiaries");
const DiaryProgress = require("../plugins/achievements/diaries/Progress.AchievementDiaries");

const HOME = [3222, 3218];
const LUMBRIDGE_BASEMENT = [3200, 9600];
const HELMET_TASK = "light-your-mining-helmet-in-the-lumbridge-castle";
let core;
let next = 1000;

let started = false;
before(async () => {
  process.env.DISABLE_PLAYER_BOTS = "1";
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  started = true;
  PM.emitServerStartup({});
});
// The file starts the server's plugins, so it ends them the way the server does.
after(() => {
  try { if (started) PM.emitServerShutdown({}); }
  finally {
    if (priorBots === undefined) delete process.env.DISABLE_PLAYER_BOTS;
    else process.env.DISABLE_PLAYER_BOTS = priorBots;
  }
});

function actor(t, firemaking = 99, at = HOME) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  // Register cleanup before the actor is made active, including setup failures.
  t.after(() => {
    if (p.isRegistered()) PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  p.setIndex(next++);
  p.setUsername("light" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  p.getSkillManager().setMaxLevels(core.Skill.FIREMAKING, 99, false).setCurrentLevels(core.Skill.FIREMAKING, firemaking, false);
  const messages = [];
  const animations = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.mock.method(p, "performAnimation", (animation) => { animations.push(animation); });
  const c = new ClientConnection(channel);
  c.player = p;
  return { p, c, inv: p.getInventory(), messages, animations };
}

async function useOn(f, slot, targetSlot) {
  await f.c.dispatch([{
    type: "inventory_use_on", slot, itemId: f.inv.getItems()[slot].getId(),
    target: { kind: "inventory", slot: targetSlot, itemId: f.inv.getItems()[targetSlot].getId() },
  }]);
  f.c.processTurnPackets();
}

const item = (id) => new core.Item(id, 1);
const idAt = (f, slot) => f.inv.getItems()[slot].getId();
/** Everything carried, as ids, in slot order. */
const carried = (f) => f.inv.getItems().filter((held) => held && held.getId() > 0).map((held) => held.getId());

/** [name, unlit id, lit id, Firemaking level]. Built at load from the id table, which needs no running server. */
const LIGHTS = [
  ["unlit torch", I.UNLIT_TORCH, I.LIT_TORCH, 1],
  ["candle", I.CANDLE, I.LIT_CANDLE, 1],
  ["white candle lantern", I.CANDLE_LANTERN, I.CANDLE_LANTERN_3, 4],
  ["black candle lantern", I.CANDLE_LANTERN_4, I.CANDLE_LANTERN_6, 4],
  ["bug lantern", I.UNLIT_BUG_LANTERN, I.LIT_BUG_LANTERN, 33],
  ["emerald lantern", I.EMERALD_LANTERN, I.EMERALD_LANTERN_2, 49],
  ["mining helmet", I.MINING_HELMET_2, I.MINING_HELMET, 65],
];
/** Already lighting before this change; controls. */
const CONTROLS = [
  ["oil lamp", I.OIL_LAMP, I.OIL_LAMP_3, 12],
  ["oil lantern", I.OIL_LANTERN, I.OIL_LANTERN_3, 26],
  ["bullseye lantern", I.BULLSEYE_LANTERN, I.BULLSEYE_LANTERN_3, 49],
  ["sapphire lantern", I.SAPPHIRE_LANTERN_2, I.SAPPHIRE_LANTERN_3, 49],
];

test("the cache agrees which id of each pair is the lit one: a lit torch and a lit candle can be extinguished, the unlit cannot", () => {
  const ops = (id) => core.CacheDefinitions.getItem(id)?.inventoryActions ?? [];
  for (const [label, unlit, lit] of [["torch", I.UNLIT_TORCH, I.LIT_TORCH], ["candle", I.CANDLE, I.LIT_CANDLE]]) {
    assert.ok(ops(lit).includes("Extinguish"), `${label}: the lit id has Extinguish`);
    assert.ok(!ops(unlit).includes("Extinguish"), `${label}: the unlit id has not`);
  }
  // The helmet: only the lit one can be put out (a helmet lit outside the Lumbridge basement must be
  // extinguishable to earn the diary task there).
  assert.ok(ops(I.MINING_HELMET).includes("Extinguish"), "the lit helmet (5013) has Extinguish");
  assert.ok(!ops(I.MINING_HELMET_2).includes("Extinguish"), "the unlit helmet (5014) has not");
  for (const [label, unlit, lit] of [...LIGHTS, ...CONTROLS]) assert.notEqual(unlit, lit, label);
});

for (const [label, unlit, lit, level] of [...LIGHTS, ...CONTROLS]) {
  test(`${label}: a tinderbox lights it at Firemaking ${level}, whichever is used on the other`, async (t) => {
    for (const tinderboxFirst of [true, false]) {
      const f = actor(t, level);
      f.inv.setItem(0, item(unlit));
      f.inv.setItem(1, item(I.TINDERBOX));
      if (tinderboxFirst) await useOn(f, 1, 0); else await useOn(f, 0, 1);
      assert.deepEqual(carried(f), [lit, I.TINDERBOX], `${label}: lit, tinderbox kept (${tinderboxFirst ? "tinderbox on it" : "it on the tinderbox"})`);
    }
  });

  test(`${label}: one level short, nothing is lit and the player is told`, async (t) => {
    if (level === 1) return;
    const f = actor(t, level - 1);
    f.inv.setItem(0, item(unlit));
    f.inv.setItem(1, item(I.TINDERBOX));
    await useOn(f, 1, 0);
    assert.deepEqual(carried(f), [unlit, I.TINDERBOX], "still unlit");
    assert.ok(f.messages.length > 0, "told why");
  });

  test(`${label}: a lit one stays as it is`, async (t) => {
    const f = actor(t, 99);
    f.inv.setItem(0, item(lit));
    f.inv.setItem(1, item(I.TINDERBOX));
    await useOn(f, 1, 0);
    assert.deepEqual(carried(f), [lit, I.TINDERBOX]);
  });
}

test("as captured (rsprox 70, 75): the torch says 'You light your torch.' and plays no animation", async (t) => {
  const f = actor(t, 1);
  f.inv.setItem(0, item(I.UNLIT_TORCH));
  f.inv.setItem(1, item(I.TINDERBOX));
  await useOn(f, 1, 0);
  assert.deepEqual(carried(f), [I.LIT_TORCH, I.TINDERBOX]);
  assert.deepEqual(f.messages, ["You light your torch."]);
  assert.deepEqual(f.animations, [], "no sequence in the capture");
});

test("the other new lights play no animation either (none captured, none invented)", async (t) => {
  for (const [label, unlit, , level] of LIGHTS.slice(1)) {
    const f = actor(t, level);
    f.inv.setItem(0, item(unlit));
    f.inv.setItem(1, item(I.TINDERBOX));
    await useOn(f, 1, 0);
    assert.deepEqual(f.animations, [], label);
  }
});

test("the black candle is lit by Merlin's Crystal's own handler: one candle, one lit candle, its message", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, item(I.BLACK_CANDLE));
  f.inv.setItem(1, item(I.TINDERBOX));
  await useOn(f, 1, 0);
  assert.deepEqual(carried(f), [I.LIT_BLACK_CANDLE, I.TINDERBOX]);
  assert.ok(f.messages.includes("You light the black candle."));
});

test("the same instance is lit, so a preset torch stays preset", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, item(I.UNLIT_TORCH).setMetaValue(core.Item.PRESET_META, true));
  f.inv.setItem(1, item(I.TINDERBOX));
  await useOn(f, 1, 0);
  assert.equal(idAt(f, 0), I.LIT_TORCH);
  assert.equal(f.inv.getItems()[0].isPresetItem(), true, "the marks came along");
});

test("a preset mining helmet stays preset when lit, and only the clicked of two is lit", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, item(I.MINING_HELMET_2));
  f.inv.setItem(1, item(I.MINING_HELMET_2).setMetaValue(core.Item.PRESET_META, true));
  f.inv.setItem(2, item(I.TINDERBOX));
  await useOn(f, 2, 1);
  assert.deepEqual([idAt(f, 0), idAt(f, 1)], [I.MINING_HELMET_2, I.MINING_HELMET], "the second, the clicked one");
  assert.equal(f.inv.getItems()[1].isPresetItem(), true);
});

test("only the clicked item is lit when several unlit ones are carried", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, item(I.UNLIT_TORCH));
  f.inv.setItem(1, item(I.UNLIT_TORCH));
  f.inv.setItem(2, item(I.TINDERBOX));
  await useOn(f, 2, 1);
  assert.deepEqual([idAt(f, 0), idAt(f, 1)], [I.UNLIT_TORCH, I.LIT_TORCH]);
});

test("things that are not light sources are left alone: an empty candle lantern, an empty oil lamp", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, item(I.EMPTY_CANDLE_LANTERN));
  f.inv.setItem(1, item(I.TINDERBOX));
  await useOn(f, 1, 0);
  assert.deepEqual(carried(f), [I.EMPTY_CANDLE_LANTERN, I.TINDERBOX], "no candle in it");
  f.inv.setItem(0, item(I.EMPTY_OIL_LAMP));
  await useOn(f, 1, 0);
  assert.deepEqual(carried(f), [I.EMPTY_OIL_LAMP, I.TINDERBOX], "no oil in it");
});

test("Lumbridge diary: lighting the unlit mining helmet in the castle basement credits the task", async (t) => {
  const f = actor(t, 65, LUMBRIDGE_BASEMENT);
  const diary = Diaries.BY_KEY.get("lumbridge");
  f.inv.setItem(0, item(I.MINING_HELMET_2));
  f.inv.setItem(1, item(I.TINDERBOX));
  assert.equal(DiaryProgress.doneTasks(f.p, diary).has(HELMET_TASK), false, "not yet");
  await useOn(f, 1, 0);
  assert.equal(idAt(f, 0), I.MINING_HELMET, "lit");
  assert.equal(DiaryProgress.doneTasks(f.p, diary).has(HELMET_TASK), true);
  assert.ok(f.messages.includes("You light your mining helmet."), "the handler's own line");
});

test("Lumbridge diary: lighting it elsewhere, or touching the lit helmet in the basement, credits nothing", async (t) => {
  const diary = Diaries.BY_KEY.get("lumbridge");
  const away = actor(t, 65, HOME);
  away.inv.setItem(0, item(I.MINING_HELMET_2));
  away.inv.setItem(1, item(I.TINDERBOX));
  await useOn(away, 1, 0);
  assert.equal(idAt(away, 0), I.MINING_HELMET);
  assert.equal(DiaryProgress.doneTasks(away.p, diary).has(HELMET_TASK), false, "not in the basement");
  const lit = actor(t, 99, LUMBRIDGE_BASEMENT);
  lit.inv.setItem(0, item(I.MINING_HELMET));
  lit.inv.setItem(1, item(I.TINDERBOX));
  await useOn(lit, 1, 0);
  assert.equal(idAt(lit, 0), I.MINING_HELMET, "a lit helmet is not put out by a tinderbox");
  assert.equal(DiaryProgress.doneTasks(lit.p, diary).has(HELMET_TASK), false, "nothing was lit");
});

const extinguish = async (f, slot) => {
  await f.c.dispatch([{ type: "inventory_action", slot, itemId: f.inv.getItems()[slot].getId(), widgetId: 3214, option: "Extinguish" }]);
  f.c.processTurnPackets();
};

test("a lit mining helmet can be put out: Extinguish makes the unlit one, marks kept", async (t) => {
  const f = actor(t);
  f.inv.setItem(0, item(I.MINING_HELMET).setMetaValue(core.Item.PRESET_META, true));
  await extinguish(f, 0);
  assert.equal(idAt(f, 0), I.MINING_HELMET_2);
  assert.equal(f.inv.getItems()[0].isPresetItem(), true);
});

test("a helmet lit away from the basement, put out and lit in the basement, credits the Lumbridge task", async (t) => {
  const diary = Diaries.BY_KEY.get("lumbridge");
  const f = actor(t, 65, HOME);
  f.inv.setItem(0, item(I.MINING_HELMET_2));
  f.inv.setItem(1, item(I.TINDERBOX));
  await useOn(f, 1, 0);
  assert.equal(idAt(f, 0), I.MINING_HELMET, "lit outside");
  assert.equal(DiaryProgress.doneTasks(f.p, diary).has(HELMET_TASK), false);
  await extinguish(f, 0);
  assert.equal(idAt(f, 0), I.MINING_HELMET_2, "put out");
  f.p.setLocation(new core.Location(LUMBRIDGE_BASEMENT[0], LUMBRIDGE_BASEMENT[1], 0));
  await useOn(f, 1, 0);
  assert.equal(DiaryProgress.doneTasks(f.p, diary).has(HELMET_TASK), true);
});

test("the Lost Tribe brooch gives Mistag's unlit mining helmet (5014), as the shop and the drop do", async (t) => {
  const f = actor(t);
  QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "the_lost_tribe").complete(f.p, { experience: false });
  f.inv.setItem(0, item(I.BROOCH));
  const npc = core.NPC.create(7299, new core.Location(HOME[0], HOME[1] + 1, 0));
  PM.emitItemOnNpc({
    player: f.p, target: npc, definition: npc.getDefinition(), npcId: 7299, targetIndex: npc.getIndex(),
    item: f.inv.getItems()[0], itemId: I.BROOCH, slot: 0, handled: false,
  });
  assert.equal(carried(f).includes(I.MINING_HELMET_2), true, "the unlit helmet");
  assert.equal(carried(f).includes(I.MINING_HELMET), false, "not the lit one");
});

// The Wiki's other way to light a torch: "may be used with a tinderbox or dry sticks, or used on a
// fire or range". Dry sticks are NOT a tool here — the Dry sticks page says "Unlike a tinderbox,
// clicking to use the sticks on an unlit torch has no effect"; they light it through their own
// Rub-together option, which Sea Slug owns (30 Firemaking, can fail, uses the sticks, moves the
// quest on). The object path needs its own handler because Cooking registers a `fallback` that
// answers "You can't cook that." for any item used on a range.
test("dry sticks used on the torch do nothing: that is Rub-together's job, not a use-on", async (t) => {
  const f = actor(t, 99);
  f.inv.setItem(0, item(I.UNLIT_TORCH));
  f.inv.setItem(1, item(I.DRY_STICKS));
  await useOn(f, 1, 0);
  assert.deepEqual(carried(f), [I.UNLIT_TORCH, I.DRY_STICKS], "the torch stays unlit and the sticks are kept");
  assert.deepEqual(f.messages, []);
});

/** The torch used on `name`, through the real hook chain (so Cooking's fallback is in play). */
function useTorchOn(f, name) {
  // Keep the controlled name, but supply the real object's id/location surface
  // to the other registered item-on-object hooks that see an unhandled event.
  const object = new core.GameObject(114, new core.Location(3210, 3215, 0), 10, 0, null);
  const definition = object.getDefinition();
  assert.ok(definition, "fixture object has a cache definition");
  const controlledDefinition = Object.create(definition);
  controlledDefinition.getName = () => name;
  controlledDefinition.getInteractions = () => [];
  object.getDefinition = () => controlledDefinition;
  return PM.emitItemOnObject({
    player: f.p,
    object,
    objectId: 114, item: f.inv.getItems()[0], itemId: I.UNLIT_TORCH, itemSlot: 0,
    interfaceType: 149, location: { x: 3210, y: 3215, z: 0 }, handled: false,
  });
}

test("the torch used on a range lights it, where the cooking fallback would refuse it", (t) => {
  const f = actor(t, 1);
  f.inv.setItem(0, item(I.UNLIT_TORCH));
  assert.equal(useTorchOn(f, "Cooking range"), true, "the light source claims the use");
  assert.equal(idAt(f, 0), I.LIT_TORCH);
  assert.deepEqual(f.messages, ["You light your torch."]);
});

test("the torch used on something that is not a fire or range is left alone", (t) => {
  const f = actor(t, 1);
  f.inv.setItem(0, item(I.UNLIT_TORCH));
  useTorchOn(f, "Tree");
  assert.equal(idAt(f, 0), I.UNLIT_TORCH);
  assert.deepEqual(f.messages, []);
});


// The cache-defined action is delivered through decoded inventory_action, the
// actual selected Item instance and PluginManager's named action registration.
const DARK_CAVE = [3200, 9550];
const Darkness = require('../plugins/world/Darkness.plugin');
function assertInModelledDarkness(f) {
  assert.ok(Darkness.LUMBRIDGE_SWAMP_CAVES_BOUNDS.some(bounds => bounds.inside(f.p.getLocation())));
}

test('active cache identifies the lit torch and its Extinguish option', () => {
  const lit = core.CacheDefinitions.getItem(I.LIT_TORCH);
  const unlit = core.CacheDefinitions.getItem(I.UNLIT_TORCH);
  assert.equal(I.LIT_TORCH, 594);
  assert.equal(I.UNLIT_TORCH, 596);
  assert.equal(lit.name, 'Lit torch');
  assert.equal(unlit.name, 'Unlit torch');
  assert.equal(lit.inventoryActions[3], 'Extinguish');
  assert.ok(!unlit.inventoryActions.includes('Extinguish'));
});

test('outside darkness Extinguish replaces only the clicked torch and keeps its identity', async t => {
  const f = actor(t), selected = item(I.LIT_TORCH).setMetaValue(core.Item.PRESET_META, true);
  f.inv.setItem(0, item(I.LIT_TORCH));
  f.inv.setItem(1, selected);
  assert.ok(!Darkness.LUMBRIDGE_SWAMP_CAVES_BOUNDS.some(b => b.inside(f.p.getLocation())));
  await extinguish(f, 1);
  assert.deepEqual([idAt(f, 0), idAt(f, 1)], [I.LIT_TORCH, I.UNLIT_TORCH]);
  assert.equal(f.inv.getItems()[1], selected);
  assert.equal(selected.isPresetItem(), true);
});

test('the sole carried torch cannot be extinguished in the modelled dark cave', async t => {
  const f = actor(t, 99, DARK_CAVE), selected = item(I.LIT_TORCH).setMetaValue(core.Item.PRESET_META, true);
  f.inv.setItem(0, selected);
  assertInModelledDarkness(f);
  assert.equal(Darkness.hasLightSource(f.p), true);
  const setId = t.mock.method(selected, 'setId');
  await extinguish(f, 0);
  assert.equal(f.inv.getItems()[0], selected);
  assert.equal(idAt(f, 0), I.LIT_TORCH);
  assert.equal(selected.isPresetItem(), true);
  assert.equal(setId.mock.callCount(), 0, 'the guard does not temporarily mutate the item');
});

test('two identical torches count separately; only the selected second one goes out', async t => {
  const f = actor(t, 99, DARK_CAVE), first = item(I.LIT_TORCH), second = item(I.LIT_TORCH).setMetaValue(core.Item.PRESET_META, true);
  f.inv.setItem(0, first); f.inv.setItem(1, second);
  assertInModelledDarkness(f);
  assert.equal(Darkness.hasLightSource(f.p), true);
  await extinguish(f, 1);
  assert.deepEqual([idAt(f, 0), idAt(f, 1)], [I.LIT_TORCH, I.UNLIT_TORCH]);
  assert.equal(f.inv.getItems()[0], first);
  assert.equal(f.inv.getItems()[1], second);
  assert.equal(second.isPresetItem(), true);
  const setId = t.mock.method(first, 'setId');
  await extinguish(f, 0);
  assert.deepEqual([idAt(f, 0), idAt(f, 1)], [I.LIT_TORCH, I.UNLIT_TORCH], 'remaining light is protected');
  assert.equal(setId.mock.callCount(), 0);
});

for (const [label, alternative, worn] of [
  ['a lit candle', I.LIT_CANDLE, false],
  ['an equipped mining helmet', I.MINING_HELMET, true],
  ['a carried Firemaking cape', I.FIREMAKING_CAPE, false],
]) {
  test(`in the cave ${label} permits putting out the torch`, async t => {
    const f = actor(t, 99, DARK_CAVE);
    if (worn) f.p.getEquipment().setItem(core.Equipment.HEAD_SLOT, item(alternative));
    else f.inv.setItem(1, item(alternative));
    assertInModelledDarkness(f);
    assert.equal(Darkness.hasLightSource(f.p), true, 'the alternative is an independently recognised light');
    const selected = item(I.LIT_TORCH); f.inv.setItem(0, selected);
    await extinguish(f, 0);
    assert.equal(idAt(f, 0), I.UNLIT_TORCH);
    assert.equal(f.inv.getItems()[0], selected);
    assert.equal(Darkness.hasLightSource(f.p), true, 'the alternative remains available');
  });
}

test('a carried but unworn mining helmet is not a second light', async t => {
  const f = actor(t, 99, DARK_CAVE);
  f.inv.setItem(1, item(I.MINING_HELMET));
  assertInModelledDarkness(f);
  assert.equal(Darkness.hasLightSource(f.p), false);
  f.inv.setItem(0, item(I.LIT_TORCH));
  await extinguish(f, 0);
  assert.deepEqual([idAt(f, 0), idAt(f, 1)], [I.LIT_TORCH, I.MINING_HELMET]);
});

test('unlit, unrelated and stale selected-slot actions leave the inventory alone', async t => {
  const f = actor(t);
  f.inv.setItem(0, item(I.UNLIT_TORCH)); f.inv.setItem(1, item(I.CANDLE));
  const first = f.inv.getItems()[0], second = f.inv.getItems()[1];
  await extinguish(f, 0); await extinguish(f, 1);
  await f.c.dispatch([{ type:'inventory_action', slot:0, itemId:I.LIT_TORCH, widgetId:3214, option:'Extinguish' }]);
  f.c.processTurnPackets();
  assert.deepEqual([idAt(f, 0), idAt(f, 1)], [I.UNLIT_TORCH, I.CANDLE]);
  assert.equal(f.inv.getItems()[0], first); assert.equal(f.inv.getItems()[1], second);
});

// Existing oil-light action remains registered alongside the new torch action.
test('the existing lit oil lamp Extinguish action is unchanged', async t => {
  const f = actor(t), selected = item(I.OIL_LAMP_3);
  f.inv.setItem(0, selected);
  const definition = core.CacheDefinitions.getItem(I.OIL_LAMP_3);
  assert.equal(definition.name, 'Oil lamp');
  assert.ok(definition.inventoryActions.includes('Extinguish'));
  await extinguish(f, 0);
  assert.equal(idAt(f, 0), I.OIL_LAMP);
  assert.equal(f.inv.getItems()[0], selected);
});
