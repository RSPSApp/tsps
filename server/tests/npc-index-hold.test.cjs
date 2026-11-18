// Run after `yarn build`: node --test tests/npc-index-hold.test.cjs
// A removed NPC's index is held until the cycle's updates are sent (issue 6113: the RuneLite gateway reads one
// index removed and added in one frame as the same NPC changing, so Mudfoot kept the dead warrior's pose). An add
// that finds only held indices waits on the add queue for them instead of being dropped (PR 6123 review).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before, after } = require("node:test");

process.env.DISABLE_PLAYER_BOTS = "1";
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { MobileList } = require("../dist/game/entity/impl/MobileList");
const { World } = require("../dist/game/World");
const { Task } = require("../dist/game/task/Task");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { PluginManager } = require("../dist/plugins/PluginManager");

const MAN = 3106;
let worldList;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  worldList = World.npcs;
});

after(() => {
  World.npcs = worldList;
  World.getAddNPCQueue().length = 0;
  World.getRemoveNPCQueue().length = 0;
});

/** The world's own NPC list with its hooks and slot holding, cut down to `slots` indices so it can be filled. */
function smallWorldList(slots) {
  World.npcs = new MobileList(slots, worldList.onAdded, worldList.onRemoved, { holdFreedSlots: true });
  World.getAddNPCQueue().length = 0;
  World.getRemoveNPCQueue().length = 0;
}

test("the world's NPC list holds a removed NPC's index until the end of the cycle", () => {
  smallWorldList(8);
  const gone = PluginManager.spawnNpc({ id: MAN, x: 3222, y: 3218 }, "Index hold test");
  const index = gone.getIndex();
  let replacement;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, {}, true); }
    execute() {
      this.stop();
      PluginManager.removeNpc(gone);
      replacement = PluginManager.spawnNpc({ id: MAN, x: 3223, y: 3218 }, "Index hold test");
    }
  })());
  World.process();
  assert.ok(replacement.isRegistered());
  assert.notEqual(replacement.getIndex(), index, "not the index removed this cycle");
  const later = PluginManager.spawnNpc({ id: MAN, x: 3224, y: 3218 }, "Index hold test");
  assert.equal(later.getIndex(), index, "released at the end of the cycle, the lowest free index again");
});

test("a full list: a task's replacement for a removed NPC waits on the queue and joins next cycle", () => {
  smallWorldList(2);
  const first = PluginManager.spawnNpc({ id: MAN, x: 3222, y: 3218 }, "Index hold test");
  const second = PluginManager.spawnNpc({ id: MAN, x: 3223, y: 3218 }, "Index hold test");
  assert.ok(first.isRegistered() && second.isRegistered());
  const index = first.getIndex();
  let replacement;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, {}, true); }
    execute() {
      this.stop();
      PluginManager.removeNpc(first);
      replacement = PluginManager.spawnNpc({ id: MAN, x: 3224, y: 3218 }, "Index hold test");
    }
  })());
  World.process();
  assert.notEqual(replacement.isRegistered(), true, "its only index is held this cycle");
  assert.ok(World.getAddNPCQueue().includes(replacement), "still queued, not dropped");
  World.process();
  assert.equal(replacement.isRegistered(), true);
  assert.equal(replacement.getIndex(), index);
  assert.equal(World.getAddNPCQueue().includes(replacement), false);
});
