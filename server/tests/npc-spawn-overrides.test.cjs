// Run after `yarn build`: node --test tests/npc-spawn-overrides.test.cjs
// The map editor saves NPC spawn changes as a patch file merged over npc-spawns.json:
// a later source replaces a spawn at the same tile (wander range, facing) and a
// `remove` record drops it without disturbing every other spawn.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { DefinitionLoader } = require("../dist/game/definition/loader/DefinitionLoader");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcSpawnDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader");
const { NpcSpawnDefinition } = require("../dist/game/definition/NpcSpawnDefinition");

const MAN = 3106;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  new NpcDefinitionLoader().load();
  const canonical = [
    { id: MAN, x: 3200, y: 3200, level: 0, wanderRadius: 5 },
    { id: MAN, x: 3210, y: 3210, level: 0 },
    { id: MAN, x: 3220, y: 3220, level: 1 },
    { id: MAN, x: 3240, y: 3240, level: 0, wanderRadius: 4 },
    { id: MAN, x: 3250, y: 3250, level: 0 },
    // Two of the same NPC stacked on one tile (npc-spawns.json has 36 such tiles).
    { id: MAN, x: 3270, y: 3270, level: 0, wanderRadius: 3 },
    { id: MAN, x: 3270, y: 3270, level: 0, wanderRadius: 3 },
    { id: MAN, x: 3280, y: 3280, level: 0, wanderRadius: 3 },
    { id: MAN, x: 3280, y: 3280, level: 0, wanderRadius: 3 },
  ];
  const patch = [
    { id: MAN, x: 3200, y: 3200, level: 0, wanderRadius: 0 },
    { id: MAN, x: 3210, y: 3210, level: 0, remove: true },
    { id: MAN, x: 3230, y: 3230, level: 0, wanderRadius: 2 },
    // A spawn moved away and then back onto its original tile: the removal
    // comes first, so the later addition must survive.
    { id: MAN, x: 3240, y: 3240, level: 0, remove: true },
    { id: MAN, x: 3240, y: 3240, level: 0, wanderRadius: 6 },
    // An addition followed by its removal is gone.
    { id: MAN, x: 3260, y: 3260, level: 0, wanderRadius: 2 },
    { id: MAN, x: 3260, y: 3260, level: 0, remove: true },
    // An editor wander patch for one stacked spawn, and a removal of one of the other pair.
    { id: MAN, x: 3270, y: 3270, level: 0, wanderRadius: 0 },
    { id: MAN, x: 3280, y: 3280, level: 0, remove: true },
  ];
  DefinitionLoader.registerSource("npc_spawns", "test", {
    name: "canonical",
    priority: 100,
    load: () => canonical,
  });
  DefinitionLoader.registerSource("npc_spawns", "test", {
    name: "editor",
    priority: 200,
    load: () => patch,
  });
  new NpcSpawnDefinitionLoader().load();
});

function spawnAt(x, y, level) {
  return NpcSpawnDefinition.all().find((spawn) => {
    const position = spawn.getPosition();
    return position.getX() === x && position.getY() === y && position.getZ() === level;
  });
}

test("a patch replaces the wander range at the same spawn tile", () => {
  assert.equal(spawnAt(3200, 3200, 0)?.getRadius(), 0, "0 anchors the NPC");
});

test("a remove record drops only the matching spawn", () => {
  assert.equal(spawnAt(3210, 3210, 0), undefined, "the removed spawn is gone");
  assert.ok(spawnAt(3200, 3200, 0), "a different tile keeps its spawn");
  assert.ok(spawnAt(3220, 3220, 1), "a different plane keeps its spawn");
});

test("a patch adds new spawns alongside the canonical ones", () => {
  assert.equal(spawnAt(3230, 3230, 0)?.getRadius(), 2);
});

test("a spawn moved back onto its original tile survives the removal", () => {
  assert.equal(spawnAt(3240, 3240, 0)?.getRadius(), 6, "the later addition replaces the removed original");
});

test("a removal after an addition in the same patch still drops it", () => {
  assert.equal(spawnAt(3260, 3260, 0), undefined);
  assert.ok(spawnAt(3250, 3250, 0), "an untouched canonical spawn stays");
  assert.equal(NpcSpawnDefinition.all().length, 8);
});

function spawnsAt(x, y, level) {
  return NpcSpawnDefinition.all().filter((spawn) => {
    const position = spawn.getPosition();
    return position.getX() === x && position.getY() === y && position.getZ() === level;
  });
}

test("a patch for one of two stacked spawns replaces only that one, and a removal drops only one", () => {
  assert.deepEqual(spawnsAt(3270, 3270, 0).map((spawn) => spawn.getRadius()).sort(), [0, 3], "the other keeps its wander");
  assert.equal(spawnsAt(3280, 3280, 0).length, 1, "one of the pair is removed");
});
