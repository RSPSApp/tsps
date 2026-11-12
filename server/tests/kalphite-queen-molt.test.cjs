// Run after `yarn build`: node --test tests/kalphite-queen-molt.test.cjs
// #4548: a burn ticking when the Queen's first form dies used to take her last hitpoint while she
// molted, killing the airborne form before it took over. rsprox captures (recordings 95, 96, 545,
// 1757, 1864, 3276): no hitsplat lands on her in the 12 ticks after any molt.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { World } = require("../dist/game/World");
const { HitDamage } = require("../dist/game/content/combat/hit/HitDamage");
const { HitMask } = require("../dist/game/content/combat/hit/HitMask");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
const TRANSFORMATION_TICKS = 20;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});
after(() => PM.emitServerShutdown({}));

function fight(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(7700);
  player.setUsername("kqmolt");
  player.setRegistered(true);
  player.setLocation(new core.Location(3478, 9495, 0));
  const queen = core.NPC.create(core.NpcIdentifiers.KALPHITE_QUEEN_2, new core.Location(3474, 9496, 0));
  queen.setRegistered(true);
  t.after(() => {
    player.setRegistered(false);
    queen.setRegistered(false);
    core.TaskManager.cancelTasks(queen);
    core.TaskManager.cancelTasks(player);
  });
  return { player, queen };
}

function tick(queen) {
  World.processCycle += 1;
  core.TaskManager.process();
  queen.getCombat().getHitQueue().process(World.getProcessCycle());
}

function burnRemaining(target) {
  const query = { target, remaining: 0 };
  PM.emitCustomEvent("combat:burn-remaining", query);
  return query.remaining;
}

for (const [label, inflict] of [
  ["a burn", (player, queen) => PM.emitCustomEvent("combat:burn", { attacker: player, target: queen, damage: 10 })],
  ["poison", (_player, queen) => queen.getCombat().getHitQueue().addPendingDamage([new HitDamage(6, HitMask.GREEN)])],
]) test(`${label} cannot kill the Queen while she molts (#4548)`, (t) => {
  const { player, queen } = fight(t);
  inflict(player, queen);
  queen.decrementHealth(new HitDamage(queen.getHitpoints(), HitMask.RED));
  assert.equal(queen.getId(), core.NpcIdentifiers.KALPHITE_QUEEN_3, "the first form's death starts the molt");
  assert.equal(queen.getHitpoints(), 1);
  assert.ok(!queen.isDyingFunction());
  for (let i = 1; i < TRANSFORMATION_TICKS; i++) {
    if (label === "poison" && i % 4 === 0) inflict(player, queen);
    tick(queen);
    assert.equal(queen.getHitpoints(), 1, `still molting on tick ${i}`);
    assert.ok(!queen.isDyingFunction(), `not dying on tick ${i}`);
  }
  tick(queen);
  assert.equal(queen.getId(), core.NpcIdentifiers.KALPHITE_QUEEN_3);
  assert.ok(queen.getHitpoints() >= 254, "the airborne form takes over at full health (less a burn tick due that tick)");
  assert.equal(queen.isUntargetable(), false);
});

test("the burn keeps running through the molt and hurts the airborne form", (t) => {
  const { player, queen } = fight(t);
  PM.emitCustomEvent("combat:burn", { attacker: player, target: queen, damage: 10 });
  queen.decrementHealth(new HitDamage(queen.getHitpoints(), HitMask.RED));
  for (let i = 0; i < TRANSFORMATION_TICKS; i++) tick(queen);
  assert.ok(burnRemaining(queen) > 0, "stacks left after the molt");
  const landed = queen.getHitpoints();
  for (let i = 0; i < 4; i++) tick(queen);
  assert.equal(queen.getHitpoints(), landed - 1, "the next burn tick lands on the airborne form");
});

test("other monsters still take burn damage at 1 hitpoint", (t) => {
  const { player } = fight(t);
  const guard = core.NPC.create(core.NpcIdentifiers.KALPHITE_WORKER_3, new core.Location(3480, 9500, 0));
  guard.setRegistered(true);
  t.after(() => { guard.setRegistered(false); core.TaskManager.cancelTasks(guard); });
  guard.setHitpoints(1);
  PM.emitCustomEvent("combat:burn", { attacker: player, target: guard, damage: 10 });
  for (let i = 0; i < 4; i++) tick(guard);
  assert.equal(guard.getHitpoints(), 0);
});
