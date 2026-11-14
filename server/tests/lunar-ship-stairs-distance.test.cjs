// RSPSApp/tsps#5162 item 1 (test-first v2; UNRUN; for review before any job). Run after `yarn build`, from server/:
//   node --test tests/lunar-ship-stairs-distance.test.cjs
//
// Question: on the Lady Zay's main deck (z2), does a click on the up stair (STAIRS_62) from a FAR tile climb from where the player
// stands? Source: LunarDiplomacy.Quest.js routeShipStairs (~2369-2382) claims the route of STAIRS_62 on z2 and sets event.destination
// to the player's own tile, so no walk happens; climbShipStairs (~2334-2348, on "ladders:climb") moves the player to the landing.
//
// REAL CLICK: new ObjectActionPacketListener().executeAction(player, id, x, y, clickType, action) — the same entry the packet case
// calls (NetworkBuilder.ts:763-766, packet "object_option"); the packet decode itself is not exercised (disclosed). The click runs the
// real listener: the boat-deck branch (ObjectActionPacketListener.ts:139-165) or walkToObject (MovementQueue.ts:1742, which emits the
// real route event through PluginManager.emitObjectRoute), then executeInteraction, then "ladders:climb".
// The owner-turn ticks are the #5157 driver: TaskManager.process (non-WALK_TO), mq.beginCycle/processEntityPursuit/process, then
// TaskManager.processWalkTo(index) (Player.ts:536).
//
// MEASUREMENT (not "z after one tick"): every tick records the player's plane and Chebyshev distance to the stair. The defect
// signature is a PLANE CHANGE WHILE THE PLAYER IS FAR (distance >= 4): the claim climbs in place. The correct behaviour (inference,
// not a Wiki source: the Wiki is silent on ship stair distance) is that a far click walks and climbs only when adjacent (distance <= 1).
//
// BRANCH: the test prints whether the player is on a private area that counts as the main world (the boat-deck branch) and whether
// PluginManager.deckReach / usableFromDeck contain the stair. If the deck branch ran, the far click does not reach walkToObject at all
// and the claim analysis changes; the job output must say which branch ran.
//
// FAR TILE: chosen from the loaded map at Chebyshev distance 4-10 from the stair, and REQUIRED to have a real route to a tile beside
// the stair (PathFinder.rsmodRouteFinding.findRoute, success). If no such tile exists the test fails at a precondition (setup).
//
// STAIR DISCOVERY: MapObjects.getObjectsAt on the static map for each tile of the Lunar Isle ship box (SHIP_BOXES[0]). If the ship is
// not on the static map, discovery fails at a precondition (setup); the expected result is printed (coordinates) either way.
//
// Rows: PRECONDITION (setup: stairs and far route found); CONTROL (adjacent click climbs, green on base expected); BEFORE (far click:
// no plane change at distance >= 4; red on base expected); Z3 CONTROL (adjacent STAIRS_64 descends to z2, green on base expected).

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
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const { PathFinder } = require("../dist/game/model/movement/path/PathFinder");
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");
const runtime = require("../plugins/quests/QuestRuntime");

runtime.startTranscript = () => true;

const STAIRS_BOTTOM = ObjectIdentifiers.STAIRS_62; // 16945, z2 deck -> forecastle (LunarDiplomacy.Quest.js:372)
const STAIRS_TOP = ObjectIdentifiers.STAIRS_64; // 16947, z3 forecastle -> deck (LunarDiplomacy.Quest.js:373)
const BOX = { x0: 2130, y0: 3884, x1: 2150, y1: 3920 }; // Lady Zay at Lunar Isle (LunarDiplomacy.Quest.js SHIP_BOXES)
const TICKS = 80; // walk (<= 40 steps at most) plus the interaction; enough for a far walk after the fix
let index = 12000;
let stairs = { bottom: null, top: null };
const report = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
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
  stairs = { bottom: scan(2, STAIRS_BOTTOM), top: scan(3, STAIRS_TOP) };
  const show = (o) => (o ? `${o.getLocation().getX()},${o.getLocation().getY()},${o.getLocation().getZ()}` : "NOT FOUND on the static map");
  console.log(`# S0 discovery STAIRS_62=${show(stairs.bottom)} STAIRS_64=${show(stairs.top)} deckReach62=${PM.deckReach.get(STAIRS_BOTTOM) ?? "none"} usableFromDeck62=${PM.usableFromDeck.has(STAIRS_BOTTOM)} interactions62=${JSON.stringify(ObjectDefinition.forId(STAIRS_BOTTOM)?.getInteractions?.() ?? "absent")} interactions64=${JSON.stringify(ObjectDefinition.forId(STAIRS_TOP)?.getInteractions?.() ?? "absent")}`);
});

after(() => {
  for (const line of report) console.log(line);
  PM.emitServerShutdown({});
});

function actor(tile) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new Location(tile.x, tile.y, tile.z));
  p.setIndex(index++); p.setRegistered(true); p.setUsername("lunar" + index);
  p.setAttribute("bot-skip-persistence", true);
  return p;
}

const cheb = (a, b) => Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));

/** The owner-turn ticks of the #5157 driver, recording the plane and the distance each tick. */
function run(p, stair, ticks) {
  const trace = [];
  for (let i = 0; i < ticks; i++) {
    TaskManager.process();
    const mq = p.getMovementQueue();
    mq.beginCycle();
    mq.processEntityPursuit();
    if (mq.hasPendingWork()) mq.process();
    TaskManager.processWalkTo(p.getIndex());
    trace.push({ tick: i + 1, z: p.getLocation().getZ(), d: cheb(p.getLocation(), stair.getLocation()), at: `${p.getLocation().getX()},${p.getLocation().getY()}` });
  }
  return trace;
}

/** A walkable z2 tile at Chebyshev 4-10 from the stair that has a REAL route to a tile beside the stair. */
function farTile(stair) {
  const s = stair.getLocation();
  for (let x = BOX.x0; x <= BOX.x1; x++) for (let y = BOX.y0; y <= BOX.y1; y++) {
    const d = Math.max(Math.abs(x - s.getX()), Math.abs(y - s.getY()));
    if (d < 4 || d > 10 || RegionManager.blocked(new Location(x, y, 2), null)) continue;
    const route = PathFinder.rsmodRouteFinding.findRoute({
      level: 2, srcX: x, srcY: y, srcSize: 1, destX: s.getX() - 1, destY: s.getY(), destWidth: 1, destLength: 1,
      locShape: -1, moveNear: true, blockAccessFlags: 0, privateArea: null,
    });
    if (route.success) return new Location(x, y, 2);
  }
  return null;
}

test("PRECONDITION (setup): both stairs are on the static map and a far tile has a real route to the stair", () => {
  assert.ok(stairs.bottom, "precondition (setup): STAIRS_62 found in the Lunar Isle ship box on z2 (not found = setup, not a result)");
  assert.ok(stairs.top, "precondition (setup): STAIRS_64 found in the Lunar Isle ship box on z3 (not found = setup, not a result)");
  const far = farTile(stairs.bottom);
  assert.ok(far, "precondition (setup): a far tile (distance 4-10) with a real route to the stair exists");
  report.push(`# S1 far tile chosen: ${far.getX()},${far.getY()},2 (distance ${cheb(far, stairs.bottom.getLocation())})`);
});

test("CONTROL (base, green expected): an adjacent click on STAIRS_62 climbs to z3", () => {
  const s = stairs.bottom.getLocation();
  const p = actor({ x: s.getX() - 1, y: s.getY(), z: 2 });
  const branch = p.getPrivateArea() ? `private area countsAsMainWorld=${p.getPrivateArea()?.countsAsMainWorld?.()}` : "main map (no private area)";
  new ObjectActionPacketListener().executeAction(p, STAIRS_BOTTOM, s.getX(), s.getY(), 0, "Climb-up");
  const trace = run(p, stairs.bottom, 3);
  report.push(`# C1 adjacent branch=${branch} trace=${JSON.stringify(trace)}`);
  assert.equal(p.getLocation().getZ(), 3, "an adjacent click climbs to z3");
});

test("BEFORE (intended red on base): a FAR click on STAIRS_62 must not change plane while the player is far away", () => {
  const far = farTile(stairs.bottom);
  assert.ok(far, "precondition (setup): far tile");
  const s = stairs.bottom.getLocation();
  const p = actor({ x: far.getX(), y: far.getY(), z: 2 });
  const branch = p.getPrivateArea() ? `private area countsAsMainWorld=${p.getPrivateArea()?.countsAsMainWorld?.()}` : "main map (no private area)";
  new ObjectActionPacketListener().executeAction(p, STAIRS_BOTTOM, s.getX(), s.getY(), 0, "Climb-up");
  const trace = run(p, stairs.bottom, TICKS);
  const climb = trace.find((t) => t.z !== 2);
  report.push(`# B1 far branch=${branch} far=${far.getX()},${far.getY()} firstPlaneChange=${JSON.stringify(climb ?? null)} trace[0..2]=${JSON.stringify(trace.slice(0, 3))}`);
  assert.equal(climb === undefined, true, `defect signature: the plane changed while far away (first change ${JSON.stringify(climb)})`);
});

test("Z3 CONTROL (base, green expected): an adjacent click on STAIRS_64 on z3 descends to z2", () => {
  const s = stairs.top.getLocation();
  const p = actor({ x: s.getX() - 1, y: s.getY(), z: 3 });
  new ObjectActionPacketListener().executeAction(p, STAIRS_TOP, s.getX(), s.getY(), 0, "Climb-down");
  const trace = run(p, stairs.top, 3);
  report.push(`# Z3 adjacent trace=${JSON.stringify(trace)}`);
  assert.equal(p.getLocation().getZ(), 2, "the z3 top stair descends to z2");
});
