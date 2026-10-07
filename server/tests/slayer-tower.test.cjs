// Run after `yarn build`: node --test tests/slayer-tower.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");

const SlayerTower = require("../plugins/areas/SlayerTower.plugin");
const { SHORTCUTS } = require("../plugins/skills/agility/shortcuts");

const T = SlayerTower._test;
let core;
let emitted = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3428, 3535);
  core.RegionManager.loadMapFiles(3412, 9932);
  T.attach({ core, emitCustomEvent: (name, payload) => emitted.push([name, payload]) });
});

const idsAt = (x, y, z = 0) => (MapObjects.mapObjects.get(MapObjects.getHash(x, y, z)) ?? []).map((o) => o.getId());

function player() {
  const log = [];
  const sender = new Proxy({}, {
    get: (target, key) => (...args) => (log.push(`${key} ${args.filter((a) => typeof a !== "object").join(",")}`), sender),
  });
  return { log, getPacketSender: () => sender };
}

test("the captured objects are where the capture saw them, in this cache's map", () => {
  const O = core.ObjectIdentifiers;
  assert.ok(idsAt(3428, 3535).includes(O.DOOR_63) && idsAt(3429, 3535).includes(O.DOOR_64), "the entrance leaves");
  assert.ok(idsAt(3426, 3534).includes(O.STATUE_14) && idsAt(3430, 3534).includes(O.STATUE_14), "the gargoyle statues");
  assert.ok(idsAt(3417, 3535).includes(O.LADDER_352) && idsAt(3412, 9931, 3).includes(O.LADDER_353), "the basement ladder");
  assert.ok(idsAt(3418, 3533).includes(O.IVY) && idsAt(3419, 3533, 2).includes(O.BROKEN_WINDOW_2) && idsAt(3443, 3532).includes(O.BROKEN_WINDOW_3));
});

test("the entrance: either leaf opens both, with both statues; either open leaf closes it all (captured)", () => {
  const O = core.ObjectIdentifiers;
  const p = player();
  assert.equal(T.openEntrance({ player: p, objectId: O.DOOR_64, location: { x: 3429, y: 3535, z: 0 } }), true);
  assert.ok(idsAt(3428, 3536).includes(O.DOOR_65) && idsAt(3429, 3536).includes(O.DOOR_66), "open a tile north");
  assert.equal(idsAt(3428, 3535).includes(O.DOOR_63), false, "the doorway is clear");
  assert.ok(idsAt(3426, 3534).includes(O.STATUE_15) && idsAt(3430, 3534).includes(O.STATUE_15), "the statues' open pose");
  assert.deepEqual(p.log.filter((l) => l.startsWith("sendSound")), ["sendSound 46,1,0", "sendSound 2717,1,0", "sendSound 2717,1,0"]);
  const q = player();
  assert.equal(T.closeEntrance({ player: q, objectId: O.DOOR_65, location: { x: 3428, y: 3536, z: 0 } }), true);
  assert.ok(idsAt(3428, 3535).includes(O.DOOR_63) && idsAt(3429, 3535).includes(O.DOOR_64));
  assert.equal(idsAt(3428, 3536).includes(O.DOOR_65), false);
  assert.ok(idsAt(3426, 3534).includes(O.STATUE_14));
  assert.deepEqual(q.log.filter((l) => l.startsWith("sendSound")), ["sendSound 60,1,0", "sendSound 2718,1,0", "sendSound 2718,1,0"]);
  assert.equal(T.openEntrance({ player: p, objectId: O.DOOR_63, location: { x: 3200, y: 3200, z: 0 } }), false, "other doors fall through");
});

test("the basement ladder: claimed from the generic ladders, to the captured landing tiles", () => {
  const O = core.ObjectIdentifiers;
  emitted = [];
  const down = { player: player(), objectId: O.LADDER_352, handled: false };
  T.claimBasementLadder(down);
  const up = { player: player(), objectId: O.LADDER_353, handled: false };
  T.claimBasementLadder(up);
  assert.equal(down.handled && up.handled, true);
  const tiles = emitted.map(([name, { destination }]) => `${name} ${destination.getX()},${destination.getY()},${destination.getZ()}`);
  assert.deepEqual(tiles, ["ladders:climbUp 3412,9932,3", "ladders:climbUp 3417,3536,0"]);
  for (const [x, y, z] of [T.BASEMENT.landing, T.BASEMENT.exit]) assert.equal(core.RegionManager.blocked(new core.Location(x, y, z), null), false);
  const other = { player: player(), objectId: O.LADDER_353 + 100, handled: false };
  T.claimBasementLadder(other);
  assert.equal(other.handled, false);
});

test("the basement is dark: varbit 278 and the darkness overlay (97) while inside", () => {
  const p = player();
  T.showDarkness(p, true);
  assert.ok(p.log.includes("sendVarbit 278,1"));
  assert.ok(p.log.includes(`sendSubInterface ${(161 << 16) | 1},97,1`));
  T.showDarkness(p, false);
  assert.ok(p.log.includes("sendVarbit 278,0") && p.log.some((l) => l.startsWith("closeSubInterface")));
  const area = T.basementArea();
  assert.ok(area.getBoundaries()[0].inside(new core.Location(3412, 9932, 3)));
});

test("the ivy and windows are agility shortcuts with the captured steps and the Wiki's levels", () => {
  const O = core.ObjectIdentifiers;
  const find = (id, z) => SHORTCUTS.find((s) => [].concat(s.object).includes(id) && (!s.at || s.at[2] === z));
  const anims = (steps) => steps.map((s) => s.anim).filter((a) => a != null);
  const ivy = find(O.IVY, 0);
  assert.deepEqual([ivy.level, ivy.xp], [81, 0], "81 (Wiki); no XP (captured)");
  assert.deepEqual(anims(ivy.steps), [828, 4435, 2757, 2588]);
  const down = find(O.BROKEN_WINDOW_2, 2);
  assert.deepEqual([down.level, down.xp], [81, 0]);
  assert.deepEqual(anims(down.steps), [741, 7142, 740, -1]);
  const window = find(O.BROKEN_WINDOW_3, 0);
  assert.deepEqual([window.level, window.xp], [18, 3]);
  const context = { pos: { x: 3442, y: 3531, z: 0 }, obj: { x: 3443, y: 3532, z: 0 } };
  assert.deepEqual(window.route(context), [3442, 3531, 0]);
  assert.deepEqual(window.steps(context), [{ move: [3444, 3533, 0], anim: 839, speed: [0, 94], ticks: 3 }]);
});
