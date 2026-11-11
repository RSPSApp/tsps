// Run after `yarn build`: node --test tests/never-kept-pvp-death.test.cjs
// Wiki (Items Kept on Death, "Items that are never kept"): the rune pouch (on a PvP death), the Chronicle, League
// trophies and items with no ground state are lost: a PvP death neither drops them for the killer nor gives them
// back. A PvP death used to give every unkept untradeable back. Real engine: every plugin loaded, real Players and the
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

const NEVER_KEPT = () => [I.LUNAR_HELM, I.TWISTED_DRAGON_TROPHY, I.CHRONICLE, I.RING_OF_CHAROS, I.STEEL_GAUNTLETS, I.FLAMTAER_BAG];

test("every never-kept name is an untradeable item in the cache", () => {
  const found = new Set();
  for (let id = 0; id < 32000; id++) {
    const item = new core.Item(id, 1);
    const name = item.getDefinition()?.getName?.();
    if (name && NeverKept._test.NAMES.has(name.toLowerCase()) && !item.isTradeable()) found.add(name.toLowerCase());
  }
  assert.deepEqual([...NeverKept._test.NAMES].filter((name) => !found.has(name)), []);
});

test("a PvP death destroys the never-kept untradeables: not dropped for the killer, not given back", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  NEVER_KEPT().forEach((id, slot) => victim.getInventory().setItem(slot, new core.Item(id, 1)));
  const { floor, lost, kept } = die(t, victim, killer, WILDERNESS());
  for (const id of NEVER_KEPT()) {
    assert.ok(!kept.includes(id), `${id} is not given back: ${JSON.stringify(kept)}`);
    assert.ok(!floor.some(([dropped]) => dropped === id), `${id} is not dropped`);
    assert.ok(!lost.includes(id), `${id} does not reach the grave hooks`);
  }
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

test("a kept rune pouch and never-kept item stay with the player on a PvP death", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.RUNE_POUCH, 1));
  victim.getInventory().setItem(1, new core.Item(I.LUNAR_HELM, 1));
  const { kept } = die(t, victim, killer, WILDERNESS(), { kept: true });
  assert.ok(kept.includes(I.RUNE_POUCH) && kept.includes(I.LUNAR_HELM), `both kept: ${JSON.stringify(kept)}`);
});

test("a PvM death still sends them to the grave hooks", (t) => {
  const victim = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.RUNE_POUCH, 1));
  victim.getInventory().setItem(1, new core.Item(I.LUNAR_HELM, 1));
  const { lost } = die(t, victim, null, LUMBRIDGE());
  assert.ok(lost.includes(I.RUNE_POUCH) && lost.includes(I.LUNAR_HELM), `to the grave: ${JSON.stringify(lost)}`);
});

test("other unkept untradeables are still given back on a PvP death", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.GHOSTSPEAK_AMULET, 1));
  const { kept } = die(t, victim, killer, WILDERNESS());
  assert.ok(kept.includes(I.GHOSTSPEAK_AMULET), `kept: ${JSON.stringify(kept)}`);
});
