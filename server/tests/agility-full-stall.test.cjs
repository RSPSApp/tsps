// Run after `yarn build`: node --test tests/agility-full-stall.test.cjs
// Issue 6237: an agility obstacle is a full stall (Wiki: Animation stall, "most agility actions,
// such as the log balance in the Wilderness agility course"). The player can't act until they land:
// clicks wait (the last one runs on the landing) and the hits coming in are queued until then.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { World } = require("../dist/game/World");
const { ObjectIds } = require("../dist/util/IdEnums");

let core;
let nextIndex = 1900;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const channel = () => ({ kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} });

function actor(t, x, y) {
  const player = new Player(new PlayerSession(channel()));
  player.setIndex(nextIndex++);
  player.setUsername(`stall${nextIndex}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.getSkillManager().setMaxLevel(core.Skill.AGILITY, 99).setCurrentLevel(core.Skill.AGILITY, 99);
  t.after(() => { PM.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); });
  return player;
}

/** One game tick: the cycle moves on, the obstacle task runs, then the player's hits come due. */
function tick(player) {
  World.processCycle++;
  TaskManager.process();
  player.getCombat().getHitQueue().process(World.getProcessCycle());
}

/** Clicks the Wilderness log balance from its start tile, as the object packet would. */
function walkOnLog(player) {
  const log = new core.GameObject(ObjectIds.LOG_BALANCE_23, new core.Location(3001, 3945, 0), 10, 0, null);
  const handled = PM.emitObjectInteraction({
    player, object: log, objectId: log.getId(), clickType: 1, location: { x: 3001, y: 3945, z: 0 }, handled: false,
  });
  assert.equal(handled, true, "the Agility plugin takes the log");
  assert.notEqual(player.getAttribute("agility.obstacle"), null, "the crossing has started");
}

test("crossing the Wilderness log holds clicks, and an Attack click waits for the landing (#6237)", async (t) => {
  const previousCycle = World.processCycle;
  t.after(() => { World.processCycle = previousCycle; });
  const random = Math.random;
  t.after(() => { Math.random = random; });
  Math.random = () => 0; // a success
  const player = actor(t, 3002, 3945);
  const target = actor(t, 2996, 3946);
  // The Attack click names the target by its world index.
  t.mock.method(World.getPlayers(), "get", (index) => (index === target.getIndex() ? target : undefined));
  const attacks = [];
  t.mock.method(player.getCombat(), "attack", (other) => attacks.push(other));
  const connection = new ClientConnection(channel());
  connection.player = player;
  async function send(packets) {
    connection.inject(packets);
    await connection.idle();
    connection.processTurnPackets();
  }

  walkOnLog(player);
  tick(player);
  tick(player);
  assert.equal(player.getCombat().isAnimationStalled(), true, "the crossing is a full stall");
  await send([{ type: "player_option", index: target.getIndex(), option: 1 }]);
  assert.deepEqual(attacks, [], "no attack starts on the log");
  for (let ticks = 0; player.getAttribute("agility.obstacle") != null; ticks++) {
    assert.ok(ticks < 20, "the crossing ends");
    tick(player);
    connection.processTurnPackets();
    if (player.getAttribute("agility.obstacle") != null) assert.deepEqual(attacks, [], "still crossing");
  }
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2994, 3945], "landed across the log");
  assert.equal(player.getCombat().isAnimationStalled(), false, "free once landed");
  connection.processTurnPackets();
  assert.deepEqual(attacks, [target], "the held Attack click runs once the player is across");
});

test("hits coming in during the crossing are queued until the player lands; the obstacle's own fall still hurts", (t) => {
  const previousCycle = World.processCycle;
  t.after(() => { World.processCycle = previousCycle; });
  const random = Math.random;
  t.after(() => { Math.random = random; });
  Math.random = () => 0;
  const player = actor(t, 3002, 3945);
  const attacker = actor(t, 3003, 3945);
  const hitpoints = player.getHitpoints();

  walkOnLog(player);
  tick(player);
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(7, core.HitMask.RED).setSource(attacker)]);
  tick(player);
  assert.equal(player.getHitpoints(), hitpoints, "the hit waits while crossing");
  for (let ticks = 0; player.getAttribute("agility.obstacle") != null; ticks++) {
    assert.ok(ticks < 20, "the crossing ends");
    tick(player);
    if (player.getAttribute("agility.obstacle") != null) assert.equal(player.getHitpoints(), hitpoints, "still held");
  }
  tick(player);
  assert.equal(player.getHitpoints(), hitpoints - 7, "the queued hit lands once across");

  // A failed attempt: the spikes' damage (no source) lands, and the stall ends with the fall.
  Math.random = () => 0.999;
  player.setLocation(new core.Location(3002, 3945, 0));
  const before = player.getHitpoints();
  walkOnLog(player);
  for (let ticks = 0; player.getAttribute("agility.obstacle") != null; ticks++) {
    assert.ok(ticks < 30, "the fall ends");
    tick(player);
  }
  tick(player);
  assert.ok(player.getHitpoints() < before, "the fall hurts");
  assert.equal(player.getCombat().isAnimationStalled(), false, "the stall ends with the fall");
});
