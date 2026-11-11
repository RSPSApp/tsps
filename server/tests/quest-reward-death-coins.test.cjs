// Run after `yarn build`: node --test tests/quest-reward-death-coins.test.cjs
// Wiki (Items Kept on Death; Barrows gloves; Barrelchest anchor): untradeable quest rewards with combat stats that are
// bought from an NPC turn into coins for the killer on a PvP death: barrows gloves 78,000, the barrelchest anchor
// 230,000. A PvP death used to give them back. Real engine: every plugin loaded, real Players and the real
// PlayerDeathTask.dropItems.
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

let core, I, Plugin;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  Plugin = require("../plugins/items/QuestRewardDeathCoins.plugin");
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9800;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("qr" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

const WILDERNESS = () => new core.Location(3100, 3600, 0);
const LUMBRIDGE = () => new core.Location(3222, 3218, 0);

/** The victim dies at `at` to `killer` (null: PvM), skulled unless `kept`. What hit the floor (and for whom), went to the grave hooks and was kept. */
function die(t, victim, killer, at, { kept = false } = {}) {
  victim.setLocation(at);
  killer?.setLocation(at);
  if (!kept) core.CombatFactory.skull(victim, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const floor = [];
  const register = core.ItemOnGroundManager.registerLocation;
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location, ...rest) => {
    floor.push({ owner, id: item.getId(), amount: item.getAmount() });
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

const coinsFor = (floor, owner) => floor.filter((drop) => drop.id === I.COINS && drop.owner === owner).map((drop) => drop.amount);

test("the listed items are untradeable items in the cache", () => {
  assert.equal(Plugin._test.deathCoins(new core.Item(I.BARROWS_GLOVES, 1)), 78000);
  assert.equal(Plugin._test.deathCoins(new core.Item(I.BARRELCHEST_ANCHOR, 1)), 230000);
  assert.equal(Plugin._test.deathCoins(new core.Item(I.GHOSTSPEAK_AMULET, 1)), 0);
});

test("a PvP death turns barrows gloves and the barrelchest anchor into coins for the killer", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.getEquipment().setItem(core.Equipment.HANDS_SLOT, new core.Item(I.BARROWS_GLOVES, 1));
  victim.getInventory().setItem(0, new core.Item(I.BARRELCHEST_ANCHOR, 1));
  const { floor, lost, kept } = die(t, victim, killer, WILDERNESS());
  assert.deepEqual(coinsFor(floor, killer).sort((a, b) => a - b), [78000, 230000], JSON.stringify(floor.map(({ id, amount }) => [id, amount])));
  for (const id of [I.BARROWS_GLOVES, I.BARRELCHEST_ANCHOR]) {
    assert.ok(!kept.includes(id), `${id} is not given back: ${JSON.stringify(kept)}`);
    assert.ok(!floor.some((drop) => drop.id === id), `${id} is not dropped`);
    assert.ok(!lost.includes(id), `${id} does not reach the grave hooks`);
  }
});

test("kept on a PvP death, they stay with the player and give no coins", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.BARROWS_GLOVES, 1));
  const { floor, kept } = die(t, victim, killer, WILDERNESS(), { kept: true });
  assert.ok(kept.includes(I.BARROWS_GLOVES), `kept: ${JSON.stringify(kept)}`);
  assert.deepEqual(coinsFor(floor, killer), []);
});

test("a preset copy gives the killer no coins", (t) => {
  const victim = actor(t);
  const killer = actor(t);
  const gloves = new core.Item(I.BARROWS_GLOVES, 1);
  t.mock.method(gloves, "isPresetItem", () => true);
  victim.getInventory().setItem(0, gloves);
  const { floor } = die(t, victim, killer, WILDERNESS());
  assert.deepEqual(coinsFor(floor, killer), []);
});

test("a PvM death leaves them to the grave hooks, with no coins", (t) => {
  const victim = actor(t);
  victim.getInventory().setItem(0, new core.Item(I.BARRELCHEST_ANCHOR, 1));
  const { floor, lost } = die(t, victim, null, LUMBRIDGE());
  assert.ok(lost.includes(I.BARRELCHEST_ANCHOR), `to the grave: ${JSON.stringify(lost)}`);
  assert.ok(!floor.some((drop) => drop.id === I.COINS));
});
