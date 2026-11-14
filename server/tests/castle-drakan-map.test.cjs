// Run after `yarn build`: node --test tests/castle-drakan-map.test.cjs
// Castle Drakan's own map (docs/castle-drakan-map.md), replayed from rsprox.net recording 4288.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals } = require("../dist/game/cache/Gamevals");
const registerCastleMap = require("../plugins/quests/bmr/CastleMap.TheBloodMoonRises");

const FLOATER_UID = (161 << 16) | 18;
const MAP = 967;
const IN_CASTLE = 15498;
const FLOOR = 15489;
const LAST_FLOOR = 15549;
const MYQ6 = 15464;

const handlers = { mapSquare: [], login: [], custom: [], click: [] };
registerCastleMap({
  core: { CacheDefinitions },
  onPlayerMapSquareChange: (handler) => handlers.mapSquare.push(handler),
  onPlayerLogin: (handler) => handlers.login.push(handler),
  onCustomEvent: (name, handler) => name === "player:widget-action" && handlers.custom.push(handler),
  onInterfaceActionClick: (handler) => handlers.click.push(handler),
});

let interfaces;
let orb;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  interfaces = new Gamevals().allInterfaces();
  orb = CacheDefinitions.getComponentId("orbs:worldmap");
});

const at = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z });

/** A player whose sender keeps varbits and sub-interfaces as the client would. */
function player(tile, myq6 = 72) {
  const varbits = new Map([[MYQ6, myq6]]);
  const open = new Map();
  const sent = [];
  let location = tile;
  const sender = {
    getVarbit: (id) => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); sent.push(["varbit", id, value]); return this; },
    sendSubInterface(target, group, type) { open.set(group, target); sent.push(["open", target, group, type]); return this; },
    isSubInterfaceOpen: (group) => open.has(group),
    closeInterface(group) { open.delete(group); sent.push(["close", group]); return this; },
  };
  return {
    varbits, open, sent,
    getLocation: () => location,
    getPacketSender: () => sender,
    moveTo(next) {
      const previous = location;
      location = next;
      for (const handler of handlers.mapSquare) handler({ player: this, previous, location: next });
    },
  };
}

function orbClick(account, buttonNum) {
  const event = { player: account, packet: { widgetId: orb, buttonNum }, handled: false };
  for (const handler of handlers.custom) handler(event);
  return event;
}

function mapClick(account, name) {
  const uid = CacheDefinitions.getComponentId(name);
  const event = { player: account, groupId: uid >>> 16, childId: uid & 0xffff, buttonId: uid, action: 1, handled: false };
  for (const handler of handlers.click) handler(event);
  return event;
}

test("the ids are the cache's: the map, its buttons and the three varbits", () => {
  const map = interfaces.get(MAP);
  assert.equal(map.name, "castle_drakan_world_map");
  assert.deepEqual([7, 8, 9, 10, 14].map((child) => map.components.get(child)),
    ["floor_2", "floor_1", "floor_0", "dungeon", "close"]);
  assert.equal(CacheDefinitions.getVarbitId("in_castle_drakan_instance"), IN_CASTLE);
  assert.equal(CacheDefinitions.getVarbitId("castle_drakan_world_map_floor"), FLOOR);
  assert.equal(CacheDefinitions.getVarbitId("myq6"), MYQ6);
});

test("entering the castle sets in_castle_drakan_instance and the ground floor; leaving clears it", () => {
  // Recording 4288 tick 3124-3126: the Vampyrium arrival at (2327,7361,0).
  const account = player(at(3684, 3176));
  account.moveTo(at(2327, 7361));
  assert.equal(account.varbits.get(IN_CASTLE), 1);
  assert.equal(account.varbits.get(FLOOR), 1);
  // Tick 14572: on to Sangvesti (2584,7776), outside the castle.
  account.moveTo(at(2584, 7776));
  assert.equal(account.varbits.get(IN_CASTLE), 0);
});

test("each floor change sends the floor the player arrives on, as the capture's stairs did", () => {
  const account = player(at(2327, 7361));
  account.moveTo(at(2327, 7361));
  // [from, to, floor]: capture ticks 3438, 3457, 4574, 4579, 5745, 6196, 8257, 8599.
  const steps = [
    [at(2341, 7383), at(2437, 7386), 2],
    [at(2437, 7386), at(2341, 7384), 1],
    [at(2319, 7371), at(2314, 7371, 1), 2],
    [at(2309, 7369, 1), at(2503, 7368), 3],
    [at(2503, 7368), at(2309, 7369, 1), 2],
    [at(2314, 7371, 1), at(2314, 7369), 1],
    [at(2312, 7365), at(2565, 7366), 0],
    [at(2565, 7366), at(2312, 7365), 1],
  ];
  for (const [from, to, floor] of steps) {
    account.moveTo(from);
    account.moveTo(to);
    assert.equal(account.varbits.get(FLOOR), floor, `(${to.getX()},${to.getY()},${to.getZ()})`);
    // Live sends castle_drakan_last_floor on the same tick, with the same value.
    assert.equal(account.varbits.get(LAST_FLOOR), floor, `last floor at (${to.getX()},${to.getY()})`);
    assert.equal(account.varbits.get(IN_CASTLE), 1);
  }
});

test("a floor picked on the map stays while the player walks about the same floor", () => {
  // Ticks 6249-6259: the map opened on the ground floor and Dungeon picked; it stayed 0
  // until the player next changed floor (tick 8247).
  const account = player(at(3684, 3176));
  account.moveTo(at(2344, 7370));
  assert.equal(account.varbits.get(FLOOR), 1);
  assert.equal(mapClick(account, "castle_drakan_world_map:dungeon").handled, true);
  assert.equal(account.varbits.get(FLOOR), 0);
  assert.equal(account.varbits.get(LAST_FLOOR), 1, "the map's buttons leave the last floor alone");
  account.moveTo(at(2386, 7405)); // square 37, still the ground floor
  assert.equal(account.varbits.get(FLOOR), 0);
  account.moveTo(at(2437, 7386)); // up to the first floor
  assert.equal(account.varbits.get(FLOOR), 2);
});

test("the orb's op1 opens the castle map in the floater on the floor the player stands on", () => {
  // Tick 13465: the map last showed the ground floor; opening on (2312,7369,1) sent 2 first.
  const account = player(at(2312, 7369, 1));
  account.moveTo(at(2312, 7369, 1));
  account.varbits.set(FLOOR, 1);
  account.sent.length = 0;
  assert.equal(orbClick(account, 1).handled, true);
  assert.deepEqual(account.sent, [["varbit", FLOOR, 2], ["open", FLOATER_UID, MAP, 1]]);
  // Tick 8455: already right, so only the open.
  account.sent.length = 0;
  orbClick(account, 1);
  assert.deepEqual(account.sent, [["open", FLOATER_UID, MAP, 1]]);
});

test("op1 is the castle map only where the cache's orbs_worldmap_op1 offers it", () => {
  const outside = player(at(3222, 3218));
  assert.equal(orbClick(outside, 1).handled, false);
  assert.equal(outside.open.has(MAP), false);
  // myq6 past 82: the orb no longer offers "View Castle Map", though the castle varbit is set.
  const later = player(at(2503, 7382), 84);
  later.moveTo(at(2503, 7382));
  assert.equal(later.varbits.get(IN_CASTLE), 1);
  assert.equal(orbClick(later, 1).handled, false);
  assert.equal(later.open.has(MAP), false);
});

test("op2 closes the castle map while it is open, and toggles the world map otherwise", () => {
  // Tick 13466: op2 the tick after the map opened closed it.
  const account = player(at(2312, 7369, 1));
  account.moveTo(at(2312, 7369, 1));
  orbClick(account, 1);
  assert.equal(orbClick(account, 2).handled, true);
  assert.equal(account.open.has(MAP), false);
  assert.equal(orbClick(account, 2).handled, false, "the world map's own toggle takes it");
});

test("Close shuts the map; the floor buttons set the floor it shows", () => {
  const account = player(at(2503, 7382));
  account.moveTo(at(2503, 7382));
  orbClick(account, 1);
  // Ticks 13450 and 13453: Dungeon then Ground floor.
  for (const [name, floor] of [["castle_drakan_world_map:dungeon", 0], ["castle_drakan_world_map:floor_0", 1],
    ["castle_drakan_world_map:floor_1", 2], ["castle_drakan_world_map:floor_2", 3]]) {
    assert.equal(mapClick(account, name).handled, true);
    assert.equal(account.varbits.get(FLOOR), floor, name);
  }
  assert.equal(mapClick(account, "castle_drakan_world_map:drag").handled, false);
  assert.equal(mapClick(account, "castle_drakan_world_map:close").handled, true);
  assert.equal(account.open.has(MAP), false);
});

test("logging in inside the castle restores the castle varbit and the floor", () => {
  const account = player(at(2503, 7368));
  for (const handler of handlers.login) handler({ player: account });
  assert.equal(account.varbits.get(IN_CASTLE), 1);
  assert.equal(account.varbits.get(FLOOR), 3);
  assert.equal(account.varbits.get(LAST_FLOOR), 3);
  const outside = player(at(3222, 3218));
  for (const handler of handlers.login) handler({ player: outside });
  assert.equal(outside.sent.length, 0);
});

test("the quest's room landings in squares 38-40 get matching floor and last-floor values", () => {
  // The room graph's own castle-floor counts these as 1, 2 and 1. The map's room highlight
  // needs castle_drakan_last_floor to equal castle_drakan_world_map_floor.
  for (const [landing, floor] of [[at(2439, 7394), 2], [at(2475, 7397), 2], [at(2554, 7364), 3], [at(2588, 7381), 0]]) {
    const account = player(at(3684, 3176));
    account.moveTo(at(2327, 7361));
    account.moveTo(landing);
    assert.equal(account.varbits.get(FLOOR), floor, `(${landing.getX()},${landing.getY()})`);
    assert.equal(account.varbits.get(LAST_FLOOR), floor, `(${landing.getX()},${landing.getY()})`);
  }
});
