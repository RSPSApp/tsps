// Run after `yarn build`: node --test tests/forthos-grubby-door.test.cjs
//
// Forthos Dungeon's grubby gate (#3977): `Grubby Door` 34840 carries Pick-lock and nothing in the
// server implemented it, so the click fell through to nothing.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");

const plugin = require("../plugins/areas/ForthosDungeon.plugin");
const T = plugin._test;

const DOOR_TILE = { x: 1798, y: 9925 };

let core, objects, route;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  objects = new Map();
  plugin.register(new Proxy({
    core,
    onObjectInteraction(name, handlers) { objects.set(name, handlers); },
    onObjectRoute(handler) { route = handler; },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function makePlayer(x, y, { thieving = 99, z = 0 } = {}) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel), new Location(x, y, z));
  player.setIndex(9900 + Math.floor(Math.random() * 50));
  player.setUsername("forthosqa");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.setHitpoints(10);
  const skills = player.getSkillManager();
  skills.setMaxLevels(core.Skill.THIEVING, thieving, true);
  skills.setCurrentLevels(core.Skill.THIEVING, thieving, true);
  return player;
}

const messages = (player) => {
  const sent = [];
  player.sendMessage = (text) => sent.push(text);
  return sent;
};

/** A stand-in for the clicked door at its own tile. */
const door = () => ({ getId: () => T.DOOR, getLocation: () => new Location(DOOR_TILE.x, DOOR_TILE.y) });

test("Pick-lock below 57 Thieving refuses and leaves the player where they stand", () => {
  const player = makePlayer(1799, 9925, { thieving: 56 });
  const sent = messages(player);
  const before = player.getSkillManager().getExperience(core.Skill.THIEVING);
  const pick = objects.get("Grubby Door")["Pick-lock"];
  assert.equal(typeof pick, "function", "Pick-lock is registered for the gate");
  pick({ player, object: door() });
  assert.match(sent.join("\n"), /at least 57 to pick this lock/);
  assert.equal(player.getSkillManager().getExperience(core.Skill.THIEVING), before, "no XP");
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1799, 9925],
    "the player is not moved");
});

test("Pick-lock at 57 pays 10 Thieving XP and hands the player inside", () => {
  const player = makePlayer(1799, 9925, { thieving: 57 });
  const sent = messages(player);
  const before = player.getSkillManager().getExperience(core.Skill.THIEVING);
  objects.get("Grubby Door")["Pick-lock"]({ player, object: door() });
  assert.equal(player.getSkillManager().getExperience(core.Skill.THIEVING), before + 10);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1797, 9925],
    "one tile inside the gateway");
  assert.match(sent.join("\n"), /You pick the lock on the gate\./);
});

test("Pick-lock from inside hands the player back out", () => {
  const player = makePlayer(1797, 9925, { thieving: 99 });
  messages(player);
  objects.get("Grubby Door")["Pick-lock"]({ player, object: door() });
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [1799, 9925],
    "back outside the gateway");
});

test("the chest routes to its walkable east side from inside the gate", () => {
  const chest = { getId: () => T.GRUBBY_CHEST, getLocation: () => new Location(1795, 9925) };
  const inside = makePlayer(1797, 9925);
  const justInside = makePlayer(1796, 9925);
  const outside = makePlayer(1799, 9925);
  assert.equal(typeof route, "function", "the route hook is registered");

  const near = { player: inside, object: chest, objectId: T.GRUBBY_CHEST };
  route(near);
  assert.deepEqual(near.destination, { x: 1796, y: 9925, z: 0 },
    "the alcove tile east of the chest");

  const adjacent = { player: justInside, object: chest, objectId: T.GRUBBY_CHEST };
  route(adjacent);
  assert.deepEqual(adjacent.destination, { x: 1796, y: 9925, z: 0 });

  const blocked = { player: outside, object: chest, objectId: T.GRUBBY_CHEST };
  route(blocked);
  assert.equal(blocked.destination, undefined, "outside the gate the closed door still blocks the try");

  const far = { player: makePlayer(1797, 9930), object: chest, objectId: T.GRUBBY_CHEST };
  route(far);
  assert.equal(far.destination, undefined, "the same X far from the niche is not routed");

  const otherPlane = { player: makePlayer(1797, 9925, { z: 1 }), object: chest, objectId: T.GRUBBY_CHEST };
  route(otherPlane);
  assert.equal(otherPlane.destination, undefined, "the route only applies on the chest's plane");
});
