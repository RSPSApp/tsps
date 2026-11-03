// NpcRivalries (issue 1952): lizardmen and Shayzien soldiers fight each other, with real cache
// NPCs ticked through Combat, and a player can still pick off a lizardman busy with a soldier.
//
// Run after `yarn build`: node --test tests/npc-rivalries.test.cjs
const assert = require("node:assert/strict");
const { before, test } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const Rivalries = require("../plugins/npcs/NpcRivalries.plugin");
const { start, addRivalry, track, tick, enemies, rivalSquares, watched } = Rivalries._test;
const core = PluginManager.getCoreApi();

const LIZARDMAN = core.NpcIdentifiers.LIZARDMAN;
const LIZARDMAN_SHAMAN = core.NpcIdentifiers.LIZARDMAN_SHAMAN;
const CANYON_SOLDIER = core.NpcIdentifiers.SOLDIER_9;
/** Lizardman Canyon, east of the canyon soldiers' spawns. Nothing here reads the map. */
const FIELD = { x: 1480, y: 3700 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  const submit = core.TaskManager.submit;
  core.TaskManager.submit = () => {};
  try {
    start({ core });
  } finally {
    core.TaskManager.submit = submit;
  }
});

function spawn(t, id, x, y) {
  const npc = core.NPC.create(id, new core.Location(x, y, 0));
  npc.isRegistered = () => true;
  npc.setNeedsPlacement(false);
  core.World.registerNpcPosition(npc);
  t.after(() => core.World.unregisterNpcPosition(npc));
  return npc;
}

/** Ticks `npcs` in World order with a cycle counter, the plugin's hunt first, as its task runs. */
function world(t, npcs) {
  let cycle = 1000;
  t.mock.method(core.World, "getProcessCycle", () => cycle);
  const tasks = [];
  t.mock.method(core.TaskManager, "submit", (task) => { task.setRunning(true); tasks.push(task); });
  const viewer = { getLocalNpcs: () => npcs };
  watched.add(viewer);
  t.after(() => watched.delete(viewer));
  return (count) => {
    for (let n = 0; n < count; n++) {
      cycle++;
      for (let i = tasks.length - 1; i >= 0; i--) {
        const task = tasks[i];
        if (!(task.isRunning() && task.execute() !== false)) tasks.splice(i, 1);
      }
      tick();
      for (const npc of npcs) {
        npc.process();
        npc.getCombat().getHitQueue().process(cycle);
      }
    }
  };
}

test("lizardmen and Shayzien soldiers are each other's enemies; shamans are no one's", () => {
  assert.equal(enemies.get(LIZARDMAN)?.has(CANYON_SOLDIER), true);
  assert.equal(enemies.get(CANYON_SOLDIER)?.has(LIZARDMAN), true);
  assert.equal(enemies.get(LIZARDMAN)?.has(LIZARDMAN), false);
  assert.equal(enemies.has(LIZARDMAN_SHAMAN), false);
  assert.equal([...enemies.get(CANYON_SOLDIER)].includes(LIZARDMAN_SHAMAN), false);
  assert.equal(rivalSquares.has(`${1449 >> 6},${3699 >> 6},0`), true, "a canyon soldier's square is watched");
});

test("a lizardman beside a soldier picks a fight, and both land real hits", (t) => {
  const lizardman = spawn(t, LIZARDMAN, FIELD.x, FIELD.y);
  const soldier = spawn(t, CANYON_SOLDIER, FIELD.x + 1, FIELD.y);
  // Neither may die before the other has landed a hit.
  const lizardmanHp = 500;
  const soldierHp = 500;
  lizardman.setHitpoints(lizardmanHp);
  soldier.setHitpoints(soldierHp);
  const ticks = world(t, [lizardman, soldier]);
  ticks(1);
  assert.equal(lizardman.getCombat().getTarget(), soldier, "the lizardman hunts the soldier");
  // Hits can roll 0, so tick until both have drawn blood (a few dozen ticks; the cap only
  // bounds an unlucky run).
  for (let i = 0; i < 400 && (soldier.getHitpoints() >= soldierHp || lizardman.getHitpoints() >= lizardmanHp); i++) {
    ticks(1);
  }
  assert.equal(soldier.getCombat().getTarget() === lizardman || soldier.getHitpoints() <= 0, true,
    "the soldier fights back");
  assert.equal(soldier.getHitpoints() < soldierHp, true, "the lizardman hits the soldier");
  assert.equal(lizardman.getHitpoints() < lizardmanHp, true, "the soldier hits the lizardman");
});

test("a rival out of hunt range is left alone", (t) => {
  const lizardman = spawn(t, LIZARDMAN, FIELD.x, FIELD.y);
  const soldier = spawn(t, CANYON_SOLDIER, FIELD.x + 20, FIELD.y);
  world(t, [lizardman, soldier])(3);
  assert.equal(lizardman.getCombat().getTarget(), null);
  assert.equal(soldier.getCombat().getTarget(), null);
});

test("a player may attack a lizardman busy with a soldier, and it turns on them", (t) => {
  const lizardman = spawn(t, LIZARDMAN, FIELD.x, FIELD.y);
  const soldier = spawn(t, CANYON_SOLDIER, FIELD.x + 1, FIELD.y);
  const ticks = world(t, [lizardman, soldier]);
  ticks(12);
  assert.ok(lizardman.getCombat().getAttacker(), "the soldier has hit the lizardman");

  const player = new Player(null);
  player.setUsername("npc-rivalries");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.setLocation(new core.Location(FIELD.x - 1, FIELD.y, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  t.after(() => core.World.unregisterPlayerPosition(player));
  assert.equal(core.CombatFactory.multiCombatBetween(player, lizardman), false,
    "single combat, where a fight ties its fighters up");
  const method = core.CombatFactory.getMethod(player);
  assert.equal(core.CombatFactory.canAttack(player, method, lizardman), core.CanAttackResponse.CAN_ATTACK);

  core.CombatFactory.handleRetaliation(player, lizardman);
  ticks(2);
  assert.equal(lizardman.getCombat().getTarget(), player, "a player's hit draws it off the soldier");
});

test("a soldier fighting an owned npc still ties it up", (t) => {
  // Only free npcs brawl without locking: a thrall, say, keeps its target to its owner.
  const lizardman = spawn(t, LIZARDMAN, FIELD.x, FIELD.y);
  const ally = spawn(t, CANYON_SOLDIER, FIELD.x + 1, FIELD.y);
  const owner = new Player(null);
  ally.setOwner(owner);
  ally.getCombat().attack(lizardman);
  lizardman.getCombat().setUnderAttack(ally);
  const player = new Player(null);
  player.setLocation(new core.Location(FIELD.x - 1, FIELD.y, 0));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  t.after(() => core.World.unregisterPlayerPosition(player));
  assert.equal(core.CombatFactory.canAttackPermission(player, lizardman), core.CanAttackResponse.TARGET_IN_COMBAT);
});

test("other plugins add rivalries by event, every side against every other", () => {
  addRivalry({ name: "test armies", sides: [[90001, 90002], [90003], [90004]] });
  assert.deepEqual([...enemies.get(90001)].sort(), [90003, 90004]);
  assert.deepEqual([...enemies.get(90003)].sort(), [90001, 90002, 90004]);
  assert.equal(enemies.get(90001).has(90002), false, "a side never fights itself");
  for (const id of [90001, 90002, 90003, 90004]) enemies.delete(id);
});

test("a player is watched only in a rival square", () => {
  const at = (x, y) => ({ getLocalNpcs: () => [], getLocation: () => new core.Location(x, y, 0) });
  const inCanyon = at(1449, 3699);
  const inLumbridge = at(3222, 3218);
  track({ player: inCanyon });
  track({ player: inLumbridge });
  assert.equal(watched.has(inCanyon), true);
  assert.equal(watched.has(inLumbridge), false);
  watched.delete(inCanyon);
});
