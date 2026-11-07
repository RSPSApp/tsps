// Run after `yarn build`: node --test tests/ring-of-wealth-death.test.cjs
// A ring of wealth (i) reverts only when lost to a player killer, who gets the imbue's 50,000 coins (an Ironman killer
// doesn't: they go on the floor for the victim). A PvM death put 50,000 new coins on the floor every time. Real engine:
// every plugin loaded, real Players and the real PlayerDeathTask.dropItems.
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

/** The victim dies at `at` to `killer` (null: PvM), skulled so the ring reaches the drop hooks. */
function die(t, victim, killer, at) {
  victim.setLocation(at);
  killer?.setLocation(at);
  core.CombatFactory.skull(victim, core.SkullType.WHITE_SKULL, core.CombatFactory.PVP_SKULL_SECONDS);
  const coins = [];
  const register = core.ItemOnGroundManager.registerLocation;
  t.mock.method(core.ItemOnGroundManager, "registerLocation", (owner, item, location, ...rest) => {
    if (item.getId() === I.COINS) coins.push([owner?.getUsername?.(), item.getAmount()]);
    return register.call(core.ItemOnGroundManager, owner, item, location, ...rest);
  });
  PlayerDeathTask.dropItems(victim, killer, at);
  return coins;
}

const WILDERNESS = () => new core.Location(3100, 3600, 0);

test("a PvM death mints no coins from a ring of wealth (i)", (t) => {
  const victim = actor(t);
  victim.getInventory().setItem(0, new core.Item(20788, 1));
  assert.deepEqual(die(t, victim, null, new core.Location(3222, 3218, 0)), []);
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
  const coins = die(t, victim, killer, WILDERNESS());
  assert.equal(killer.getInventory().getAmount(I.COINS), 0);
  assert.deepEqual(coins, [[victim.getUsername(), 50000]]);
});
