// RSPSApp/tsps#5162 item 1 (test-first; UNRUN, for review before any job). Run after `yarn build`, from server/:
//   node --test tests/lunar-ship-stairs-distance.test.cjs
//
// Question: on the Lady Zay's main deck (z2), does a click on the up stair from a FAR tile climb from where the player stands?
// Source (LunarDiplomacy.Quest.js): routeShipStairs (~2369-2382) claims the route of STAIRS_62 (SHIP_STAIRS_BOTTOM) when it is on
// z2 and sets event.destination to the player's OWN tile, so MovementQueue.walkToObject (MovementQueue.ts:1742) never walks.
// The comment above routeShipStairs says the claim exists because the forecastle's walls make walkToObject end on the player's
// own tile (a reach failure); that is a z3 concern, so the z2 claim has no stated purpose in the comment or in commit 18d4f218c.
//
// REAL ROUTE: PluginManager.loadFromDirectory (the production plugin set, as #5221/#5322), RegionManager.init + loadMapFiles at the
// Lunar Isle ship box (SHIP_BOXES[0]: x 2130-2150, y 3884-3920), the real stair objects found on the loaded map (MapObjects),
// the real player.getMovementQueue().walkToObject (the route event goes through PluginManager.emitObjectRoute), and the owner-turn
// ticks: TaskManager.process (non-WALK_TO), mq.beginCycle/process, TaskManager.processWalkTo(index) (Player.ts:536), as the
// #5157 driver. Nothing is stubbed on the route. The stair and the walkable far tile are DISCOVERED at run time; if discovery
// fails the test fails at a precondition (setup), not at the plane assertion.
//
// EXPECTED (inference, NOT a Wiki source): a click on a stair walks to it first and climbs when adjacent. The Wiki is silent on
// ship stair distance (Lunar Diplomacy oldid 15400334 mentions stairs only for the galley route). So the expected-rule assertion is
// labelled INFERENCE in the result.
//
// ASSUMED MAPPING: STAIRS_62 on z2 is the main deck's up stair (deck -> forecastle), per the quest comment at ~370-373. Which compass
// side that is (SW in the reporter's words) is ASSUMED: the object coordinates are discovered at run time, not read from the quest.
//
// Rows:
//   BEFORE (base, far click): after the first owner tick the player is still on z2 (no climb from a distance). Expected red at the
//           plane assertion on base (the claim climbs in place).
//   CONTROL (base, adjacent click): standing next to STAIRS_62 on z2, the click climbs to z3 (green on base).
//   Z3 CONTROL (base): standing next to STAIRS_64 on z3, the click descends to z2 (green on base; z3 must stay unchanged).
// A fix candidate (not written): keep the claim only when the player is within reach of the stair; otherwise the normal walk runs.

const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");
const runtime = require("../plugins/quests/QuestRuntime");

runtime.startTranscript = () => true;

const STAIRS_BOTTOM = ObjectIdentifiers.STAIRS_62; // 16945, z2 deck -> forecastle (LunarDiplomacy.Quest.js:372)
const STAIRS_TOP = ObjectIdentifiers.STAIRS_64; // 16947, z3 forecastle -> deck (LunarDiplomacy.Quest.js:373)
const BOX = { x0: 2130, y0: 3884, x1: 2150, y1: 3920 }; // Lady Zay at Lunar Isle (LunarDiplomacy.Quest.js SHIP_BOXES)
let index = 12000;
let objects = { bottom: null, top: null };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  const core = PM.getCoreApi();
  RegionManager.init();
  RegionManager.loadMapFiles(2140, 3900);
  ObjectDefinition.init();
  PM.emitServerStartup({});
  const scan = (z, id) => {
    for (let x = BOX.x0; x <= BOX.x1; x++) for (let y = BOX.y0; y <= BOX.y1; y++) {
      const hit = MapObjects.getObjectsAt(new Location(x, y, z), null).find((o) => o.getId() === id);
      if (hit) return hit;
    }
    return null;
  };
  objects = { bottom: scan(2, STAIRS_BOTTOM), top: scan(3, STAIRS_TOP) };
  assert.ok(core, "the core api loads");
});

after(() => {
  PM.emitServerShutdown({});
});

/** A real player on a tile, with the real session; the route runs on the real movement queue. */
function actor(tile) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(tile.x, tile.y, tile.z));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("lunar" + index);
  p.setAttribute("bot-skip-persistence", true);
  return p;
}

/** The owner-turn ticks of the #5157 driver: non-WALK_TO tasks, movement, then the walk-to reach check for this player. */
function ticks(p, n) {
  for (let i = 0; i < n; i++) {
    TaskManager.process();
    const mq = p.getMovementQueue();
    mq.beginCycle();
    mq.processEntityPursuit();
    if (mq.hasPendingWork()) mq.process();
    TaskManager.processWalkTo(p.getIndex());
  }
}

/** A walkable z2 tile in the box at least `far` tiles (Chebyshev) from the stair. Discovered on the loaded map. */
function farTile(stair, far) {
  for (let x = BOX.x0; x <= BOX.x1; x++) for (let y = BOX.y0; y <= BOX.y1; y++) {
    const t = new Location(x, y, 2);
    const d = Math.max(Math.abs(x - stair.getLocation().getX()), Math.abs(y - stair.getLocation().getY()));
    if (d >= far && !RegionManager.blocked(t, null)) return t;
  }
  return null;
}

test("PRECONDITION (setup): the z2 bottom stair (STAIRS_62) and the z3 top stair (STAIRS_64) are on the loaded map", () => {
  assert.ok(objects.bottom, `precondition: STAIRS_62 is on z2 inside the Lunar Isle ship box (discovery failed: setup, not a result)`);
  assert.ok(objects.top, `precondition: STAIRS_64 is on z3 inside the Lunar Isle ship box (discovery failed: setup, not a result)`);
  console.log(`# S1 stairs bottom=${objects.bottom.getLocation().getX()},${objects.bottom.getLocation().getY()},2 top=${objects.top.getLocation().getX()},${objects.top.getLocation().getY()},3`);
});

test("CONTROL (base, green): an adjacent click on STAIRS_62 on z2 climbs to z3", () => {
  const stair = objects.bottom;
  const near = new Location(stair.getLocation().getX() - 1, stair.getLocation().getY(), 2);
  const p = actor({ x: near.getX(), y: near.getY(), z: 2 });
  const action = { execute() {} };
  p.getMovementQueue().walkToObject(stair, action, 1);
  ticks(p, 3);
  console.log(`# C1 adjacent z=${p.getLocation().getZ()} at ${p.getLocation().getX()},${p.getLocation().getY()}`);
  assert.equal(p.getLocation().getZ(), 3, "an adjacent click climbs to z3");
});

test("BEFORE (intended red on base): a FAR click on STAIRS_62 must not climb from where the player stands", () => {
  const stair = objects.bottom;
  const far = farTile(stair, 4);
  assert.ok(far, "precondition (setup): a walkable z2 tile at least 4 tiles from the stair exists in the box");
  const p = actor({ x: far.getX(), y: far.getY(), z: 2 });
  const action = { execute() {} };
  p.getMovementQueue().walkToObject(stair, action, 1);
  ticks(p, 1);
  console.log(`# B1 far start=${far.getX()},${far.getY()},2 after 1 tick z=${p.getLocation().getZ()} at ${p.getLocation().getX()},${p.getLocation().getY()}`);
  assert.equal(p.getLocation().getZ(), 2, "a far click must not climb from where the player stands (the z2 claim climbs in place today)");
});

test("REAL WALK (INFERENCE, not a Wiki source): from a far tile the player walks to the stair and then climbs (run after the fix)", () => {
  const stair = objects.bottom;
  const far = farTile(stair, 4);
  assert.ok(far, "precondition (setup): a far walkable tile exists");
  const p = actor({ x: far.getX(), y: far.getY(), z: 2 });
  p.getMovementQueue().walkToObject(stair, { execute() {} }, 1);
  ticks(p, 80);
  console.log(`# W1 far walk ends z=${p.getLocation().getZ()} at ${p.getLocation().getX()},${p.getLocation().getY()}`);
  assert.equal(p.getLocation().getZ(), 3, "the walk reaches the stair and climbs (inference)");
});

test("Z3 CONTROL (base, green): an adjacent click on STAIRS_64 on z3 descends to z2 (z3 must stay unchanged)", () => {
  const stair = objects.top;
  const near = new Location(stair.getLocation().getX() - 1, stair.getLocation().getY(), 3);
  const p = actor({ x: near.getX(), y: near.getY(), z: 3 });
  p.getMovementQueue().walkToObject(stair, { execute() {} }, 1);
  ticks(p, 3);
  console.log(`# Z3 adjacent z=${p.getLocation().getZ()} at ${p.getLocation().getX()},${p.getLocation().getY()}`);
  assert.equal(p.getLocation().getZ(), 2, "the z3 top stair descends to z2");
});
