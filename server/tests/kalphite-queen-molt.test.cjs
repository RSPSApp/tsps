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
// The molt starts 8 ticks after the first form's death and she is targetable 12 ticks into it
// (rsprox gap of 7 or 8 ticks from her last hitsplat to the molt; Wiki: 20 ticks from the kill).
const MOLT_START_TICK = 8;
const UNLOCK_TICK = 20;
const DEATH_ANIMATION = 6242; // kalphite_update_queen_death

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
  assert.equal(queen.getId(), core.NpcIdentifiers.KALPHITE_QUEEN_2, "she stands in the first form until the molt starts");
  assert.equal(queen.getHitpoints(), 1);
  assert.ok(!queen.isDyingFunction());
  assert.equal(queen.isUntargetable(), true, "untargetable from the first form's death");
  for (let i = 1; i < UNLOCK_TICK; i++) {
    if (label === "poison" && i % 4 === 0) inflict(player, queen);
    tick(queen);
    assert.equal(queen.getHitpoints(), 1, `still molting on tick ${i}`);
    assert.ok(!queen.isDyingFunction(), `not dying on tick ${i}`);
    assert.equal(queen.isUntargetable(), true, `untargetable on tick ${i}`);
    assert.equal(
      queen.getId(),
      i < MOLT_START_TICK ? core.NpcIdentifiers.KALPHITE_QUEEN_2 : core.NpcIdentifiers.KALPHITE_QUEEN_3,
      `form on tick ${i}: the molt starts on tick ${MOLT_START_TICK}`,
    );
  }
  tick(queen);
  assert.equal(queen.getId(), core.NpcIdentifiers.KALPHITE_QUEEN_3);
  assert.ok(queen.getHitpoints() >= 254, "the airborne form takes over at full health (less a burn tick due that tick)");
  assert.equal(queen.isUntargetable(), false, "targetable on tick 20 (8 before the molt plus 12 into it), the Wiki's 20 from the kill");
});

test("the burn keeps running through the molt and hurts the airborne form", (t) => {
  const { player, queen } = fight(t);
  PM.emitCustomEvent("combat:burn", { attacker: player, target: queen, damage: 10 });
  queen.decrementHealth(new HitDamage(queen.getHitpoints(), HitMask.RED));
  for (let i = 0; i < UNLOCK_TICK; i++) tick(queen);
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

test("she plays her death animation 4 ticks before the molt, not before (rsprox: 6242 at molt -4 in 154 molts)", (t) => {
  const { queen } = fight(t);
  const played = [];
  const perform = queen.performAnimation.bind(queen);
  queen.performAnimation = (animation) => { played.push({ tick: ticks, id: animation.getId() }); return perform(animation); };
  let ticks = 0;
  queen.decrementHealth(new HitDamage(queen.getHitpoints(), HitMask.RED));
  for (ticks = 1; ticks <= MOLT_START_TICK; ticks++) tick(queen);
  const death = played.filter((entry) => entry.id === DEATH_ANIMATION);
  assert.deepEqual(death, [{ tick: MOLT_START_TICK - 4, id: DEATH_ANIMATION }], "6242 once, 4 ticks before the molt");
  const molt = played.find((entry) => entry.id === 6270);
  assert.equal(molt?.tick, MOLT_START_TICK, "the molt sequence follows on tick 8");
  assert.equal(queen.getId(), core.NpcIdentifiers.KALPHITE_QUEEN_3);
});
