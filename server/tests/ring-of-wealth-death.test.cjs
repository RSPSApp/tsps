// Run after `yarn build`: node --test tests/ring-of-wealth-death.test.cjs
// Wiki (Ring of wealth (i); Items Kept on Death): a ring of wealth (i) always loses its imbue on death, kept or not,
// and the imbue becomes 50,000 coins. To a player killer they are the killer's (an Ironman killer's go on the floor for
// the victim); any other death puts them with what it loses, the grave (or the floor without one). A PvM death used
// to put them straight on the floor every time. Real engine: every plugin loaded, real Players and the real
// PlayerDeathTask.dropItems.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");

let core, I;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

let next = 9850;
function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("row" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.needsPlacement = false;
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}

/**
 * The victim dies at `at` to `killer` (null: PvM); skulled unless `kept`, so the ring is lost, else carried alone so
 * it is kept. Returns the coins put on the floor directly, what the death passed on to the grave hooks, and what it kept.
 */
function die(t, victim, killer, at, { kept = false } = {}) {
  victim.setLocation(at);
  killer?.setLocation(at);
  if (!kept) core.CombatFactory.skull(victim, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const coins = [];
  const register = core.ItemOnGroundManager.registerLocation;
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location, ...rest) => {
    if (item.getId() === I.COINS) coins.push([owner?.getUsername?.(), item.getAmount()]);
    return register.call(core.ItemOnGroundManager, owner, item, location, ...rest);
  });
  const lost = [];
  const emitDrops = PM.emitPlayerDeathDrops;
  t.mock.method(PM, "emitPlayerDeathDrops", (event) => {
    // Both lists the grave hooks get: the cache has the charged ring of wealth (3) untradeable, so it is in the second.
    lost.push(...[...event.items, ...event.untradeables].map((item) => [item.getId(), item.getAmount()]));
    return emitDrops.call(PM, event);
  });
  const keptItems = PlayerDeathTask.dropItems(victim, killer, at).map((item) => [item.getId(), item.getAmount()]);
  return { coins, lost, kept: keptItems };
}

const WILDERNESS = () => new core.Location(3100, 3600, 0);

const LUMBRIDGE = () => new core.Location(3222, 3218, 0);
const RING_I = 20788, RING_3 = 11984; // ring of wealth (i) (3) and its unimbued ring of wealth (3)

test("a PvM death loses the ring's imbue: its 50,000 coins go with what the death loses, not straight on the floor", (t) => {
  const victim = actor(t);
  victim.getInventory().setItem(0, new core.Item(RING_I, 1));
  const { coins, lost } = die(t, victim, null, LUMBRIDGE());
  assert.ok(lost.some(([id]) => id === RING_3), `the ring is lost unimbued, to the grave: ${JSON.stringify(lost)}`);
  assert.ok(lost.some(([id, amount]) => id === I.COINS && amount === 50000), "and the coins go with it, to the grave");
  assert.ok(!coins.some(([owner, amount]) => amount === 50000 && owner === undefined), "no ownerless coins");
});

test("a kept ring still loses its imbue on a PvM death, and the coins go with what the death loses", (t) => {
  const victim = actor(t);
  victim.getInventory().setItem(0, new core.Item(RING_I, 1));
  const { lost, kept } = die(t, victim, null, LUMBRIDGE(), { kept: true });
  assert.deepEqual(kept, [[RING_3, 1]], "kept, but unimbued");
  assert.deepEqual(lost, [[I.COINS, 50000]], "the imbue's coins are lost with the death");
});

test("a kept ring still loses its imbue to a player killer, who gets the 50,000 coins", (t) => {
  const victim = actor(t), killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(RING_I, 1));
  const { kept } = die(t, victim, killer, WILDERNESS(), { kept: true });
  assert.deepEqual(kept, [[RING_3, 1]]);
  assert.equal(killer.getInventory().getAmount(I.COINS), 50000);
});

test("lost to a player killer, the ring reverts and the killer gets 50,000 coins", (t) => {
  const victim = actor(t), killer = actor(t);
  victim.getInventory().setItem(0, new core.Item(20788, 1));
  die(t, victim, killer, WILDERNESS());
  assert.equal(killer.getInventory().getAmount(I.COINS), 50000);
});

test("an Ironman killer gets no coins; they go on the floor for the victim", (t) => {
  const victim = actor(t), killer = actor(t);
  killer.setAttribute("ironman:mode", "ironman");
  victim.getInventory().setItem(0, new core.Item(20788, 1));
  const { coins } = die(t, victim, killer, WILDERNESS());
  assert.equal(killer.getInventory().getAmount(I.COINS), 0);
  assert.deepEqual(coins, [[victim.getUsername(), 50000]]);
});
