// Run after `yarn build`: node --test tests/npc-death-timing.test.cjs
// How long a dead NPC stays before its drops and removal (docs/npc-death-timing.md, issue #5507).
// rsprox captures: the killing hit on T, the death animation on T+1, drops and removal on T+1+n,
// with n per NPC (cow 4, man 2, moss giant 6).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { World } = require("../dist/game/World");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { PluginManager } = require("../dist/plugins/PluginManager");

const CAPTURED = require("../data/definitions/npc-captured-death-ticks.json").npcs;
const COMBAT_DEFS = require("../data/definitions/npc-combat-defs.json").npcs;

const COW = 2790;
const MAN = 3106;
const MOSS_GIANT = 2090;
const VORKATH = 8061;
const DAGANNOTH_KINGS = [2265, 2266, 2267];
/** Uncaptured; shares the wolves' dog_update_wolf_death (6558), which every captured wolf waits 5 ticks on. */
const WHITE_WOLF = 107;
const WOLF_DEATH = 6558;
/** giant_update_basic_death: War Guild cyclopes wait 2 ticks on it, other giants 4. */
const GIANT_BASIC_DEATH = 4653;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

test("captured NPCs wait their own captured ticks", () => {
  assert.equal(NpcDefinition.forId(COW).getDeathTicks(), 4);
  assert.equal(NpcDefinition.forId(MAN).getDeathTicks(), 2);
  assert.equal(NpcDefinition.forId(MOSS_GIANT).getDeathTicks(), 6);
  assert.deepEqual(
    [CAPTURED[COW].ticks, CAPTURED[MAN].ticks, CAPTURED[MOSS_GIANT].ticks],
    [4, 2, 6],
    "the captured file is where they come from",
  );
});

test("a hand-set deathTicks wins over the captures", () => {
  assert.equal(COMBAT_DEFS[VORKATH].deathTicks, 6);
  assert.equal(NpcDefinition.forId(VORKATH).getDeathTicks(), 6);
  for (const id of DAGANNOTH_KINGS) {
    assert.equal(CAPTURED[id].ticks, 2, `captured king ${id}`);
    assert.equal(NpcDefinition.forId(id).getDeathTicks(), 2, `king ${id}`);
  }
});

test("an uncaptured NPC takes the ticks every captured NPC with its death animation shares", () => {
  assert.equal(CAPTURED[WHITE_WOLF], undefined, "the white wolf has no capture of its own");
  const wolves = Object.values(CAPTURED).filter((row) => row.seq === WOLF_DEATH);
  assert.ok(wolves.length >= 2);
  assert.ok(wolves.every((row) => row.ticks === 5));
  assert.equal(NpcDefinition.forId(WHITE_WOLF).getDeathAnim(), WOLF_DEATH);
  assert.equal(NpcDefinition.forId(WHITE_WOLF).getDeathTicks(), 5);
});

test("a death animation captured NPCs disagree on lends nothing", () => {
  const timings = new Set(Object.values(CAPTURED).filter((row) => row.seq === GIANT_BASIC_DEATH).map((row) => row.ticks));
  assert.deepEqual([...timings].sort(), [2, 4]);
  const uncaptured = [...NpcDefinition.definitions].filter(
    ([id, definition]) => !CAPTURED[id] && !COMBAT_DEFS[id]?.deathTicks && definition.getDeathAnim() === GIANT_BASIC_DEATH,
  );
  assert.ok(uncaptured.length > 0, "an uncaptured NPC plays giant_update_basic_death");
  for (const [id, definition] of uncaptured) assert.equal(definition.getDeathTicks(), 2, `npc ${id}`);
});

test("a cow killed on tick T animates on T+1 and drops and leaves on T+5", (t) => {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(9800);
  player.setUsername("cowkiller");
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new Location(3202, 3287, 0));
  t.after(() => player.setRegistered(false));

  const cow = new NPC(COW, new Location(3202, 3288, 0));
  cow.getCombat().addDamage(player, 8);
  const deaths = [];
  t.mock.method(PluginManager, "emitNpcDeath", (event) => deaths.push(event));
  const removals = World.getRemoveNPCQueue();
  const queued = removals.length;
  t.after(() => removals.splice(queued));

  // Tick T: the killing blow.
  cow.appendDeath();
  const seen = [];
  for (let tick = 1; tick <= 6; tick++) {
    TaskManager.process();
    seen.push({
      tick,
      animation: cow.getAnimation()?.getId() ?? null,
      dropped: deaths.length,
      removed: removals.includes(cow),
    });
  }
  const animatedOn = seen.find((s) => s.animation === NpcDefinition.forId(COW).getDeathAnim())?.tick;
  const droppedOn = seen.find((s) => s.dropped > 0)?.tick;
  const removedOn = seen.find((s) => s.removed)?.tick;
  assert.equal(animatedOn, 1, "death animation the tick after the hit");
  assert.equal(droppedOn, 5, "drops 4 ticks after the animation");
  assert.equal(removedOn, 5, "removed with the drops");
  assert.equal(deaths[0].killer, player);
});
