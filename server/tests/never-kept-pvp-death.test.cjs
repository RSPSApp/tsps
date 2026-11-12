// Run after `yarn build`: node --test tests/never-kept-pvp-death.test.cjs
// Wiki (Items Kept on Death, "Items that are never kept"): the rune pouch (on a PvP death), the clue box, the Chronicle,
// League trophies, the degraded amulet of the damned and items with no ground state are lost on an unsafe death, even
// as the most valuable item or with Protect Item: no kept slot, no drop for a killer, no grave, not given back. Real engine: every plugin loaded, real Players and the
// real PlayerDeathTask.dropItems.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

let core, I, Pouch, NeverKept;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Pouch = require("../plugins/items/runepouch/Common.RunePouch");
  NeverKept = require("../plugins/items/NeverKeptOnDeath.plugin");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9900;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("nk" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

const WILDERNESS = () => new core.Location(3100, 3600, 0);
const LUMBRIDGE = () => new core.Location(3222, 3218, 0);

/** The victim dies at `at` to `killer` (null: PvM), skulled unless `kept`. What hit the floor, went to the grave hooks and was kept. */
function die(t, victim, killer, at, { kept = false } = {}) {
  victim.setLocation(at);
  killer?.setLocation(at);
  if (!kept) core.CombatFactory.skull(victim, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const floor = [];
  const register = core.ItemOnGroundManager.registerLocation;
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location, ...rest) => {
    floor.push([item.getId(), item.getAmount()]);
    return register.call(core.ItemOnGroundManager, owner, item, location, ...rest);
  });
  const lost = [];
  const emitDrops = PM.emitPlayerDeathDrops;
  t.mock.method(PM, "emitPlayerDeathDrops", (event) => {
    lost.push(...[...event.items, ...event.untradeables].map((item) => item.getId()));
    return emitDrops.call(PM, event);
  });
  const keptIds = PlayerDeathTask.dropItems(victim, killer, at).map((item) => item.getId());
  return { floor, lost, kept: keptIds };
}

const NEVER_KEPT = () => [I.LUNAR_HELM, I.LUNAR_STAFF, I.TWISTED_DRAGON_TROPHY, I.CHRONICLE, I.RING_OF_CHAROS, I.STEEL_GAUNTLETS, I.FLAMTAER_BAG,
  I.CLUE_BOX, I.AMULET_OF_THE_DAMNED];

test("every never-kept name is an item in the cache, and only the degraded amulet of the damned matches", () => {
  const found = new Set();
  for (let id = 0; id < 40000; id++) {
    const item = new core.Item(id, 1);
    const name = item.getDefinition()?.getName?.();
    if (name && NeverKept._test.NAMES.has(name.toLowerCase())) found.add(name.toLowerCase());
  }
  assert.deepEqual([...NeverKept._test.NAMES].filter((name) => !found.has(name)), []);
  assert.equal(NeverKept._test.isNeverKept(new core.Item(I.AMULET_OF_THE_DAMNED, 1)), true);
  assert.equal(NeverKept._test.isNeverKept(new core.Item(I.AMULET_OF_THE_DAMNED_FULL_, 1)), false, "the full amulet is kept as usual");
});

/** Gone from the death: not kept, not on the floor, not to the grave hooks. */
function assertDestroyed({ floor, lost, kept }, ids) {
  for (const id of ids) {
    assert.ok(!kept.includes(id), `${id} is not given back: ${JSON.stringify(kept)}`);
    assert.ok(!floor.some(([dropped]) => dropped === id), `${id} is not dropped`);
    assert.ok(!lost.includes(id), `${id} does not reach the grave hooks`);
  }
}

test("a PvP death destroys the never-kept untradeables: not dropped for the killer, not given back", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  NEVER_KEPT().forEach((id, slot) => victim.getInventory().setItem(slot, new core.Item(id, 1)));
  assertDestroyed(die(t, victim, killer, WILDERNESS()), NEVER_KEPT());
  assert.equal(victim.getInventory().getValidItems().length, 0);
});

test("a PvP death destroys the rune pouch, and its runes drop for the killer", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.RUNE_POUCH, 1));
  Pouch.setSlots(victim, [{ id: I.DEATH_RUNE, amount: 500 }, null, null]);
  const { floor, kept } = die(t, victim, killer, WILDERNESS());
  assert.ok(!kept.includes(I.RUNE_POUCH), `the pouch is not given back: ${JSON.stringify(kept)}`);
  assert.ok(!floor.some(([id]) => id === I.RUNE_POUCH), "the pouch is not dropped");
  assert.ok(floor.some(([id, amount]) => id === I.DEATH_RUNE && amount === 500), `its runes drop: ${JSON.stringify(floor)}`);
});

test("unskulled, a rune pouch is kept but a never-kept item takes no kept slot", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.RUNE_POUCH, 1));
  victim.getInventory().setItem(1, new core.Item(I.LUNAR_HELM, 1));
  victim.getInventory().setItem(2, new core.Item(I.CLUE_BOX, 1));
  const result = die(t, victim, killer, WILDERNESS(), { kept: true });
  assert.ok(result.kept.includes(I.RUNE_POUCH), `the pouch is kept: ${JSON.stringify(result.kept)}`);
  assertDestroyed(result, [I.LUNAR_HELM, I.CLUE_BOX]);
});

test("a PvM death destroys them too; a rune pouch still goes to the grave", (t) => {
  for (const kept of [false, true]) {
    const victim = actor(t);
    victim.getInventory().setItem(0, new core.Item(I.RUNE_POUCH, 1));
    NEVER_KEPT().forEach((id, slot) => victim.getInventory().setItem(slot + 1, new core.Item(id, 1)));
    const result = die(t, victim, null, LUMBRIDGE(), { kept });
    assertDestroyed(result, NEVER_KEPT());
    assert.ok(result.lost.includes(I.RUNE_POUCH) || result.kept.includes(I.RUNE_POUCH), `the pouch is not destroyed: ${JSON.stringify(result)}`);
  }
});

test("other unkept untradeables are still given back on a PvP death", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.GHOSTSPEAK_AMULET, 1));
  const { kept } = die(t, victim, killer, WILDERNESS());
  assert.ok(kept.includes(I.GHOSTSPEAK_AMULET), `kept: ${JSON.stringify(kept)}`);
});

test("a noted clue box is a tradeable stack: it drops for the killer like any other", (t) => {
  const NOTED_CLUE_BOX = 12790;
  assert.equal(new core.Item(NOTED_CLUE_BOX, 1).getDefinition().isNoted(), true);
  assert.equal(NeverKept._test.isNeverKept(new core.Item(NOTED_CLUE_BOX, 100)), false);
  const victim = actor(t);
  const killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(NOTED_CLUE_BOX, 100));
  victim.getInventory().setItem(1, new core.Item(I.BRONZE_DAGGER, 1));
  const { floor } = die(t, victim, killer, WILDERNESS());
  assert.ok(floor.some(([id, amount]) => id === NOTED_CLUE_BOX && amount === 100), `the noted boxes drop: ${JSON.stringify(floor)}`);
  assert.ok(floor.some(([id]) => id === I.BRONZE_DAGGER), "and the dagger");
});

test("the Items Kept on Death screen marks never-kept items deleted, not to the grave", (t) => {
  // The real interface plugin, on the real custom events (NeverKeptOnDeath and the gravestones answer them).
  const buttons = new Map();
  const api = {
    core, getPrayerHandler: () => ({ isActivated: () => false, PROTECT_ITEM: 0 }),
    onInterfaceActionButton: (uid, handler) => buttons.set(uid, handler),
    emitCustomEvent: (name, query) => PM.emitCustomEvent(name, query),
  };
  require("../plugins/interface/ItemsKeptOnDeath.plugin").register(api);
  const player = actor(t);
  player.setLocation(LUMBRIDGE());
  core.CombatFactory.skull(player, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const ids = [I.LUNAR_HELM, I.CHRONICLE, I.AMULET_OF_THE_DAMNED, I.CLUE_BOX, I.GHOSTSPEAK_AMULET, I.ABYSSAL_WHIP];
  ids.forEach((id, slot) => player.getInventory().setItem(slot, new core.Item(id, 1)));
  let sent;
  t.mock.method(player.getPacketSender(), "sendInterfaceScript", function (_id, _args, _varps, _varbits, inventories) { sent = inventories; return this; });
  buttons.get((387 << 16) | 5)({ player });
  const marker = Object.fromEntries(sent[584].slots.map((slot) => [slot.itemId, sent[468].slots[slot.slot].itemId]));
  for (const id of [I.LUNAR_HELM, I.CHRONICLE, I.AMULET_OF_THE_DAMNED, I.CLUE_BOX]) assert.equal(marker[id], 368, `${id} is deleted`);
  for (const id of [I.GHOSTSPEAK_AMULET, I.ABYSSAL_WHIP]) assert.equal(marker[id], 367, `${id} goes to the grave`);
});
