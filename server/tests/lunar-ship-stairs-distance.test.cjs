// RSPSApp/tsps#5162 item 1 (test-first v3; UNRUN; for review before any job). Run after `yarn build`, from server/:
//   node --test tests/lunar-ship-stairs-distance.test.cjs
//
// Question: on the Lady Zay's main deck (z2), does a click on the up stair (STAIRS_62) from a FAR tile climb from where the player
// stands? Source: LunarDiplomacy.Quest.js routeShipStairs (~2369-2382) claims the route of STAIRS_62 on z2 and sets the destination to
// the player's own tile (no walk); climbShipStairs (~2334-2348, on "ladders:climb") moves the player to the landing (moveTo).
//
// REAL CLICK: new ObjectActionPacketListener().executeAction(player, id, x, y, clickType, action) (signature at
// ObjectActionPacketListener.ts:28-34; the same entry the packet case calls, NetworkBuilder.ts:763-766). The packet decode is not
// exercised (disclosed). clickType is resolved from the option name (ts:53-58): the option name is READ from the definition
// (ObjectDefinition.forId(id).getInteractions()), not hard-coded; if no climb option exists the test fails at a precondition (setup).
//
// OWNER-TURN TICKS: the #5157 driver: TaskManager.process (non-WALK_TO), mq.beginCycle/processEntityPursuit/process, then
// TaskManager.processWalkTo(index) (Player.ts:536).
//
// MEASUREMENT: the trace keeps the state BEFORE each tick (start = tick 0). climbFrom = the previous trace entry at the first tick whose
// plane differs from the previous plane. The distance is climbFrom.d (where the player stood when the climb started), never the distance
// after the climb (climbShipStairs moves the player to the landing).
//
// ROWS:
//   PRECONDITION (setup): stairs found on the static map; both climb option names exist on the definitions; a far tile has a real route.
//   CONTROL (base, green expected): an adjacent click climbs; climbFrom.d <= 1.
//   FAR CLICK (one test, BEFORE and AFTER): the far click must climb only from distance <= 1, and must climb within TICKS. On base the
//           claim climbs in place, so climbFrom.d >= 4 and the test is RED at the distance assertion. After a correct fix (walk, then climb
//           at distance <= 1) it is GREEN. INFERENCE: the walk-then-climb expectation is standard object interaction, not a Wiki source
//           (the Wiki is silent on ship stair distance).
//   Z3 CONTROL (base, green expected): an adjacent STAIRS_64 click descends to z2; climbFrom.d <= 1.

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
const TICKS = 80;
let index = 12000;
let stairs = { bottom: null, top: null };
let names = { bottom: null, top: null };
const report = [];

/** The option name for a climb on a stair: the definition's own name containing "climb" (up or down), else null. */
function climbOption(id, wantUp) {
  const list = ObjectDefinition.forId(id)?.getInteractions?.() ?? [];
  const found = list.find((o) => typeof o === "string" && /climb/i.test(o) && (wantUp ? /up/i.test(o) : /down/i.test(o)));
  return found ?? null;
}

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
  names = { bottom: climbOption(STAIRS_BOTTOM, true), top: climbOption(STAIRS_TOP, false) };
  const show = (o) => (o ? `${o.getLocation().getX()},${o.getLocation().getY()},${o.getLocation().getZ()}` : "NOT FOUND on the static map");
  const list = (id) => JSON.stringify(ObjectDefinition.forId(id)?.getInteractions?.() ?? "absent");
  console.log(`# S0 discovery STAIRS_62=${show(stairs.bottom)} option=${names.bottom} interactions62=${list(STAIRS_BOTTOM)} STAIRS_64=${show(stairs.top)} option=${names.top} interactions64=${list(STAIRS_TOP)} deckReach62=${PM.deckReach.get(STAIRS_BOTTOM) ?? "none"}`);
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
const entryOf = (p, tick, stair) => ({ tick, z: p.getLocation().getZ(), d: cheb(p.getLocation(), stair.getLocation()), at: `${p.getLocation().getX()},${p.getLocation().getY()}` });

/**
 * The owner-turn ticks (the #5157 driver), keeping the state BEFORE each tick. climbFrom = the entry before the first tick whose plane
 * differs from the previous plane (the distance where the climb started, not the landing distance after the move).
 */
function run(p, stair, ticks, start) {
  const trace = [start];
  const zAfterClick = p.getLocation().getZ();
  for (let i = 1; i <= ticks; i++) {
    TaskManager.process();
    const mq = p.getMovementQueue();
    mq.beginCycle();
    mq.processEntityPursuit();
    if (mq.hasPendingWork()) mq.process();
    TaskManager.processWalkTo(p.getIndex());
    trace.push(entryOf(p, i, stair));
  }
  // A climb that happened inside the click (synchronous) is attributed to the start entry (climbFrom = start).
  let climbFrom = zAfterClick !== start.z ? start : null;
  for (let i = 1; climbFrom === null && i < trace.length; i++) {
    if (trace[i].z !== trace[i - 1].z) { climbFrom = trace[i - 1]; break; }
  }
  return { trace, climbFrom, final: trace[trace.length - 1], zAfterClick };
}

/** An adjacent walkable tile on the stair's plane: the 4 orthogonal neighbours first, then the diagonals. Null if none. */
function adjacentTile(stair) {
  const s = stair.getLocation();
  const order = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [dx, dy] of order) {
    const t = new Location(s.getX() + dx, s.getY() + dy, s.getZ());
    if (!RegionManager.blocked(t, null)) return t;
  }
  return null;
}

/** A walkable z2 tile at Chebyshev 4-10 from the stair with a REAL route to a tile beside it. */
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

test("PRECONDITION (setup): stairs on the static map, both climb option names read from the definitions, and a far tile with a real route", () => {
  assert.ok(stairs.bottom, "precondition (setup): STAIRS_62 found in the Lunar Isle ship box on z2");
  assert.ok(stairs.top, "precondition (setup): STAIRS_64 found in the Lunar Isle ship box on z3");
  assert.ok(names.bottom, `precondition (setup): a climb-up option exists on STAIRS_62 (interactions printed in S0): ${JSON.stringify(ObjectDefinition.forId(STAIRS_BOTTOM)?.getInteractions?.())}`);
  assert.ok(names.top, `precondition (setup): a climb-down option exists on STAIRS_64: ${JSON.stringify(ObjectDefinition.forId(STAIRS_TOP)?.getInteractions?.())}`);
  const far = farTile(stairs.bottom);
  assert.ok(far, "precondition (setup): a far tile (distance 4-10) with a real route to the stair exists");
  const adjBottom = adjacentTile(stairs.bottom);
  const adjTop = adjacentTile(stairs.top);
  assert.ok(adjBottom, "precondition (setup): an adjacent walkable tile beside STAIRS_62 on z2 exists");
  assert.ok(adjTop, "precondition (setup): an adjacent walkable tile beside STAIRS_64 on z3 exists");
  report.push(`# S1 far tile ${far.getX()},${far.getY()},2 distance ${cheb(far, stairs.bottom.getLocation())} adjBottom=${adjBottom.getX()},${adjBottom.getY()},${adjBottom.getZ()} adjTop=${adjTop.getX()},${adjTop.getY()},${adjTop.getZ()}`);
});

test("CONTROL (base, green expected): an adjacent click on STAIRS_62 climbs; the climb starts from distance <= 1", () => {
  const s = stairs.bottom.getLocation();
  const adj = adjacentTile(stairs.bottom);
  const p = actor({ x: adj.getX(), y: adj.getY(), z: 2 });
  const branch = p.getPrivateArea() ? "private area" : "main map (no private area)";
  const start = entryOf(p, 0, stairs.bottom);
  new ObjectActionPacketListener().executeAction(p, STAIRS_BOTTOM, s.getX(), s.getY(), 0, names.bottom);
  const r = run(p, stairs.bottom, 3, start);
  report.push(`# C1 adjacent at=${adj.getX()},${adj.getY()} option=${names.bottom} branch=${branch} start=${JSON.stringify(start)} zAfterClick=${r.zAfterClick} climbFrom=${JSON.stringify(r.climbFrom)} final=${JSON.stringify(r.final)}`);
  assert.ok(r.climbFrom, "the adjacent click climbs");
  assert.ok(r.climbFrom.d <= 1, `the adjacent climb starts from distance <= 1 (got ${r.climbFrom.d})`);
});

test("FAR CLICK (BEFORE red on base; AFTER green expected): a far click climbs only from distance <= 1, and does climb within 80 ticks", () => {
  const far = farTile(stairs.bottom);
  assert.ok(far, "precondition (setup): far tile");
  const s = stairs.bottom.getLocation();
  const p = actor({ x: far.getX(), y: far.getY(), z: 2 });
  const branch = p.getPrivateArea() ? "private area" : "main map (no private area)";
  const start = entryOf(p, 0, stairs.bottom);
  new ObjectActionPacketListener().executeAction(p, STAIRS_BOTTOM, s.getX(), s.getY(), 0, names.bottom);
  const r = run(p, stairs.bottom, TICKS, start);
  report.push(`# B1 far option=${names.bottom} branch=${branch} far=${far.getX()},${far.getY()} start=${JSON.stringify(start)} zAfterClick=${r.zAfterClick} climbFrom=${JSON.stringify(r.climbFrom)} final=${JSON.stringify(r.final)} trace[0..2]=${JSON.stringify(r.trace.slice(0, 3))}`);
  assert.ok(r.climbFrom, `the far click must climb within ${TICKS} ticks (no climb at all)`);
  assert.ok(r.climbFrom.d <= 1, `defect signature: the climb started from distance ${r.climbFrom?.d} (must be <= 1: walk first, then climb)`);
  assert.equal(r.final.z, 3, "after the walk and the climb the player is on z3");
});

test("Z3 CONTROL (base, green expected): an adjacent STAIRS_64 click descends to z2; the descent starts from distance <= 1", () => {
  const s = stairs.top.getLocation();
  const adj = adjacentTile(stairs.top);
  const p = actor({ x: adj.getX(), y: adj.getY(), z: 3 });
  const start = entryOf(p, 0, stairs.top);
  new ObjectActionPacketListener().executeAction(p, STAIRS_TOP, s.getX(), s.getY(), 0, names.top);
  const r = run(p, stairs.top, 3, start);
  report.push(`# Z3 adjacent at=${adj.getX()},${adj.getY()} option=${names.top} start=${JSON.stringify(start)} zAfterClick=${r.zAfterClick} climbFrom=${JSON.stringify(r.climbFrom)} final=${JSON.stringify(r.final)}`);
  assert.ok(r.climbFrom, "the adjacent click descends");
  assert.ok(r.climbFrom.d <= 1, `the descent starts from distance <= 1 (got ${r.climbFrom.d})`);
  assert.equal(r.final.z, 2, "the z3 top stair descends to z2");
});
