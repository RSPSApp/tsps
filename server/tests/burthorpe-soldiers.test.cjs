// Run after `yarn build`: node --test tests/burthorpe-soldiers.test.cjs
//
// Burthorpe's soldiers train as captured (rsprox 1445, 3252): the sergeant's drill every 5 ticks,
// copied by his soldiers, and the soldiers beside it on their own counts.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");

const realCore = PluginManager.getCoreApi();
const N = realCore.NpcIdentifiers;
let npcs = [];
const tasks = [];
const startup = [];
const core = {
  ...realCore,
  World: { getNpcsNear: () => npcs },
  TaskManager: { submit: (task) => tasks.push(task) },
};
const plugin = require("../plugins/areas/Burthorpe.plugin");
plugin.register({ core, onServerStartup: (handler) => startup.push(handler) });
startup.forEach((handler) => handler());

function fakeNpc(id, x, y, { target = null } = {}) {
  const npc = {
    anims: [],
    faced: [],
    getId: () => id,
    getLocation: () => new core.Location(x, y, 0),
    getCombat: () => ({ getTarget: () => target }),
    performAnimation: (animation) => npc.anims.push([animation.getId(), animation.getDelay()]),
    setPositionToFace: (location) => npc.faced.push([location.getX(), location.getY()]),
  };
  return npc;
}

const runTicks = (count) => {
  for (let i = 0; i < count; i++) tasks[0].execute();
};

test("one tick task trains the square", () => {
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].getDelay(), 1);
});

test("drill moves follow the captured mix of punch, kick, block and defend", () => {
  assert.equal(plugin._test.pickDrillMove(0), 422);
  assert.equal(plugin._test.pickDrillMove(0.4), 423);
  assert.equal(plugin._test.pickDrillMove(0.6), 424);
  assert.equal(plugin._test.pickDrillMove(0.99), 425);
});

test("every 5 ticks the soldiers copy the sergeant's move 40 cycles later, facing him", () => {
  const sergeant = fakeNpc(N.SERGEANT, 2893, 3541);
  const soldiers = [fakeNpc(N.SOLDIER_2, 2891, 3539), fakeNpc(N.SOLDIER_2, 2895, 3537)];
  const fighting = fakeNpc(N.SOLDIER_2, 2892, 3537, { target: {} });
  npcs = [sergeant, ...soldiers, fighting];
  runTicks(10);
  assert.equal(sergeant.anims.length, 2);
  assert.deepEqual(sergeant.faced[0], [2893, 3540]);
  for (const soldier of soldiers) {
    assert.deepEqual(soldier.anims, sergeant.anims.map(([id]) => [id, 40]));
    assert.equal(soldier.faced[0][1], soldier.getLocation().getY() + 1);
  }
  assert.deepEqual(fighting.anims, []);
});

test("the sparring soldiers punch or kick east and the soldiers at the table eat, each every few ticks", () => {
  const sparring = fakeNpc(N.SOLDIER_3, 2900, 3531);
  const eating = fakeNpc(N.SOLDIER_6, 2893, 3533);
  npcs = [sparring, eating];
  runTicks(30);
  assert.ok(sparring.anims.length >= 4 && sparring.anims.length <= 8, `${sparring.anims.length} sparring moves`);
  assert.ok(sparring.anims.every(([id]) => id === 422 || id === 423));
  assert.deepEqual(sparring.faced[0], [2901, 3531]);
  assert.ok(eating.anims.length >= 3 && eating.anims.length <= 8, `${eating.anims.length} eating moves`);
  assert.ok(eating.anims.every(([id]) => id === 1145));
  assert.deepEqual(eating.faced[0], [2893, 3532]);
});
