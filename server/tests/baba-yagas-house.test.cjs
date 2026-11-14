// Run after `yarn build`: node --test tests/baba-yagas-house.test.cjs
//
// Baba Yaga's house on Lunar Isle (docs/baba-yagas-house.md; rsprox local 1000456/1000463/1000480 rev 227,
// 1000763 rev 228): the House's Go-inside moves the player to (2451, 4645, 0) a tick after they reach it, then
// shakes the camera (1, 0, 10, 25) with sound 1692 a tick later. The door inside (16774) puts them back two ticks
// after the click, diagonally off the house's south-west corner wherever it has walked, with sound 85 and a
// camera reset.
//
// Real packets: npc_option and object_option go through the connection to the real plugins (the door through
// Doors.plugin's door:toggle). Fixture seams: Math.random is held for the exit tile's pick.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const BabaYagasHouse = require("../plugins/areas/BabaYagasHouse.plugin");

const HOUSE_ID = 3836;
const DOOR_ID = 16774;
const DOOR = [2451, 4644];
const INSIDE = [2451, 4645];
const HOUSE_AT = [2082, 3928];

let core;
let next = 9700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(HOUSE_AT[0], HOUSE_AT[1]);
  core.RegionManager.loadMapFiles(INSIDE[0], INSIDE[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("babaqa" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(at[0], at[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const sender = p.getPacketSender();
  const events = [];
  let cycle = 0;
  const sendSound = sender.sendSound.bind(sender);
  t.mock.method(sender, "sendSound", (id, ...rest) => { events.push([cycle, "sound", id]); return sendSound(id, ...rest); });
  const sendCameraShake = sender.sendCameraShake.bind(sender);
  t.mock.method(sender, "sendCameraShake", (...shake) => { events.push([cycle, "shake", ...shake]); return sendCameraShake(...shake); });
  const sendCameraReset = sender.sendCameraReset.bind(sender);
  t.mock.method(sender, "sendCameraReset", (...args) => { events.push([cycle, "reset"]); return sendCameraReset(...args); });
  const moveTo = p.moveTo.bind(p);
  t.mock.method(p, "moveTo", (to) => { events.push([cycle, "move", to.getX(), to.getY(), to.getZ()]); return moveTo(to); });
  core.World.getPlayers().add(p);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    if (core.World.getPlayers().contains?.(p)) core.World.getPlayers().remove(p);
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  const f = { p, c, events };
  f.tick = (count = 1) => {
    for (let i = 0; i < count; i++) {
      cycle++;
      core.World.processCycle++;
      core.TaskManager.process();
      c.processTurnPackets();
      p.getMovementQueue().process();
      core.TaskManager.processWalkTo(p.getIndex());
      p.resetUpdating();
    }
  };
  f.send = async (packet) => {
    await c.dispatch([packet]);
    c.processTurnPackets();
  };
  return f;
}

function house(t, at = HOUSE_AT) {
  const npc = core.NPC.create(HOUSE_ID, new core.Location(at[0], at[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => {
    core.TaskManager.cancelTasks(npc);
    if (npc.isRegistered()) core.World.getNpcs().remove(npc);
  });
  return npc;
}

const moves = (f) => f.events.filter((e) => e[1] === "move");

test("Go-inside moves the player into the house a tick later, then shakes the camera with sound 1692", async (t) => {
  const npc = house(t);
  // Beside the size-5 house's east side, as the captures stand when it starts.
  const f = actor(t, [HOUSE_AT[0] + 5, HOUSE_AT[1]]);
  await f.send({ type: "npc_option", index: npc.getIndex(), clickType: 1 });
  assert.deepEqual(moves(f), [], "not inside on the click's tick");
  f.tick(4);
  const move = moves(f)[0];
  assert.deepEqual(move?.slice(2), [...INSIDE, 0], "inside the house");
  const shake = f.events.find((e) => e[1] === "shake");
  const sound = f.events.find((e) => e[1] === "sound" && e[2] === 1692);
  assert.deepEqual(shake?.slice(2), [1, 0, 10, 25], "the captured cam_shake");
  assert.ok(sound, "sound 1692");
  assert.equal(shake[0], move[0] + 1, "the shake comes a tick after the move");
  assert.equal(sound[0], move[0] + 1, "the sound comes with the shake");
  assert.deepEqual([f.p.getLocation().getX(), f.p.getLocation().getY()], INSIDE);
});

test("Go-inside belongs to the House only", (t) => {
  const f = actor(t, [HOUSE_AT[0] + 5, HOUSE_AT[1]]);
  const other = { getId: () => core.NpcIdentifiers.BABA_YAGA };
  assert.equal(BabaYagasHouse._test.goInside({ player: f.p, npc: other }), false);
});

test("the door puts the player outside beside the house two ticks after the click, with sound 85 and a camera reset", async (t) => {
  const walked = [HOUSE_AT[0] + 2, HOUSE_AT[1] + 1];
  house(t, walked);
  const f = actor(t, INSIDE);
  f.p.setAttribute(BabaYagasHouse._test.SHAKING_ATTRIBUTE, true);
  t.mock.method(Math, "random", () => 0.99);
  await f.send({ type: "object_option", id: DOOR_ID, x: DOOR[0], y: DOOR[1], action: "Open" });
  Math.random.mock.restore();
  f.tick(1);
  assert.deepEqual(moves(f), [], "still inside a tick after the click");
  f.tick(1);
  const move = moves(f)[0];
  assert.ok(move, "outside two ticks after the click");
  const offset = [move[2] - walked[0], move[3] - walked[1]];
  assert.ok(BabaYagasHouse._test.EXIT_OFFSETS.some(([dx, dy]) => dx === offset[0] && dy === offset[1]),
    `a captured exit offset from where the house now stands, got ${offset}`);
  assert.ok(f.events.some((e) => e[0] === move[0] && e[1] === "sound" && e[2] === 85), "sound 85 on the move");
  assert.ok(f.events.some((e) => e[0] === move[0] && e[1] === "reset"), "the camera reset ends the shake");
});

test("the exit tiles are the captured three, and a blocked one is skipped", (t) => {
  const corner = { x: 2084, y: 3928, z: 0 };
  const seen = new Set();
  for (const value of [0, 0.3, 0.6, 0.99]) {
    t.mock.method(Math, "random", () => value);
    const tile = BabaYagasHouse._test.exitTile(corner);
    Math.random.mock.restore();
    seen.add(`${tile.getX() - corner.x},${tile.getY() - corner.y}`);
  }
  for (const key of seen) assert.ok(["1,-1", "-1,1", "-1,-1"].includes(key), `captured offset, got ${key}`);
  const blocked = t.mock.method(core.RegionManager, "blocked", (tile) => !(tile.getX() === corner.x - 1 && tile.getY() === corner.y - 1));
  const tile = BabaYagasHouse._test.exitTile(corner);
  blocked.mock.restore();
  assert.deepEqual([tile.getX(), tile.getY()], [corner.x - 1, corner.y - 1], "the only open tile");
});

test("with no house in the world, the exit lands beside its spawn", () => {
  assert.deepEqual(BabaYagasHouse._test.houseCorner(), BabaYagasHouse._test.HOUSE_SPAWN);
});

test("leaving the house another way (a spell out) ends the shake once; a logout sends nothing", (t) => {
  const f = actor(t, INSIDE);
  const area = BabaYagasHouse._test.createInterior();
  const { SHAKING_ATTRIBUTE } = BabaYagasHouse._test;
  f.p.setAttribute(SHAKING_ATTRIBUTE, true);
  area.postLeave(f.p, false);
  area.postLeave(f.p, false);
  assert.equal(f.events.filter((e) => e[1] === "reset").length, 1, "one camera reset");
  f.p.setAttribute(SHAKING_ATTRIBUTE, true);
  area.postLeave(f.p, true);
  assert.equal(f.events.filter((e) => e[1] === "reset").length, 1, "no reset to a player logging out");
});

test("the door exit sends one camera reset even as the interior Area also sees the player leave", async (t) => {
  house(t);
  const f = actor(t, INSIDE);
  f.p.setAttribute(BabaYagasHouse._test.SHAKING_ATTRIBUTE, true);
  await f.send({ type: "object_option", id: DOOR_ID, x: DOOR[0], y: DOOR[1], action: "Open" });
  f.tick(2);
  BabaYagasHouse._test.createInterior().postLeave(f.p, false);
  assert.equal(f.events.filter((e) => e[1] === "reset").length, 1);
});
