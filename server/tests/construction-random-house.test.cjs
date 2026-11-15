// Run after `yarn build`: node --test tests/construction-random-house.test.cjs
// The Rotten potato's Setup POH: "construction:random-house" (MaxHouse.Construction.js).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");

const root = path.resolve(__dirname, "..");
require(root + "/dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require(root + "/dist/game/cache/CachePipeline");
const { PluginManager: PM } = require(root + "/dist/plugins/PluginManager");
const { Player } = require(root + "/dist/game/entity/impl/player/Player");
const { PlayerSession } = require(root + "/dist/net/PlayerSession");

let core;
let House;
let MaxHouse;
let Data;
let next = 1650;
const players = [];

before(async () => {
  await CachePipeline.initialize(root);
  PM.loadFromDirectory(root + "/plugins");
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
  House = require(root + "/plugins/skills/construction/House.Construction");
  MaxHouse = require(root + "/plugins/skills/construction/MaxHouse.Construction");
  Data = require(root + "/plugins/skills/construction/Data.Construction");
});

after(() => {
  for (const player of players) {
    House.releaseHouse(player, true);
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
  }
});

function newPlayer(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`randomhouse${next}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (text) => { messages.push(text); return player.getPacketSender(); });
  player.messages = messages;
  players.push(player);
  return player;
}

/** A seeded Math.random stand-in, so each layout is repeatable. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const roomsOf = (player) => player.getAttribute(Data.HOUSE_ATTRIBUTE).rooms.flat(2).filter(Boolean);

test("construction:random-house builds a random house and keeps the old one for ::restorehouse", (t) => {
  const player = newPlayer(t);
  const before = JSON.stringify(House.houseStateFor(player));
  const request = { player, handled: false };
  MaxHouse.randomHouse(request, seeded(7));
  assert.equal(request.handled, true);
  const rooms = roomsOf(player);
  assert.ok(rooms.some((room) => room.roomKey === "GARDEN"), "the garden with its exit portal is always there");
  assert.ok(rooms.length >= 2, `a garden and at least one room: ${rooms.length}`);
  assert.match(player.messages.at(-1), /^Your house has been set up with \d+ rooms\. ::restorehouse brings the old one back\.$/);
  assert.ok(House.houseFor(player), "the player is taken into the new house");
  MaxHouse.restoreHouse({ player });
  assert.equal(JSON.stringify(player.getAttribute(Data.HOUSE_ATTRIBUTE)), before);
});

test("different draws give different houses, and every room is a real, furnished room", (t) => {
  const shapes = new Set();
  for (const seed of [1, 2, 3, 4]) {
    const player = newPlayer(t);
    MaxHouse.randomHouse({ player, handled: false }, seeded(seed));
    const rooms = roomsOf(player);
    for (const room of rooms) {
      assert.ok(Data.ROOM_BY_KEY.has(room.roomKey), room.roomKey);
      if (room.roomKey !== "GARDEN") assert.ok(room.furniture && typeof room.furniture === "object");
    }
    shapes.add(rooms.map((room) => room.roomKey).sort().join(","));
  }
  assert.ok(shapes.size > 1, "the layouts differ between draws");
});
