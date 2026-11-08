// Run after `yarn build`: node --test tests/ranging-guild-door.test.cjs
// Wiki (Ranging Guild): 40 Ranged to enter, boostable; the doorman turns the rest away. The door is
// a pass-through gate, so the doorway keeps an inviswall while it stands open and nothing can walk
// or follow through it — the opener is carried across. Real engine: every plugin loaded, the real
// map door 11665 at 2658,3438 through PluginManager.emitObjectInteraction.
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
const { PlayerOptionPacketListener } = require("../dist/net/packet/impl/PlayerOptionPacketListener");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

const DOOR = { x: 2658, y: 3438, z: 0 };
const OUTSIDE = [2657, 3438, 0];
const INSIDE = [2659, 3438, 0];
const INVISWALL = 38848;

let core, next = 9400;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(DOOR.x, DOOR.y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at, ranged) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setUsername("rg" + next++);
  p.setLocation(new core.Location(...at));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  assert.equal(core.World.getPlayers().add(p), true);
  p.needsPlacement = false;
  p.getSkillManager().setCurrentLevel(core.Skill.RANGED, ranged, true);
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (message) => { messages.push(message); return sender; });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.World.getPlayers().remove(p);
  });
  return { p, c, messages };
}

const tick = (e, count = 1) => {
  for (let i = 0; i < count; i++) {
    core.TaskManager.process();
    e.p.getMovementQueue().process();
    e.p.needsPlacement = false;
  }
};

const follow = (follower, leader) =>
  PlayerOptionPacketListener.executeClientOption(follower.p, leader.p.getIndex(), 3);

/** The real Open click on the guild door, through the plugin hooks. */
function openDoor(f) {
  const door = MapObjects.getObjectsAt(new core.Location(DOOR.x, DOOR.y, DOOR.z), null).find((o) => o.getId() === 11665);
  assert.ok(door, "the guild door is on the map");
  const event = {
    player: f.p, object: door, objectId: 11665, definition: ObjectDefinition.forId(11665), clickType: 1,
    location: { x: DOOR.x, y: DOOR.y, z: DOOR.z },
    sourceLocation: { x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), z: f.p.getLocation().getZ() },
    handled: false,
  };
  PM.emitObjectInteraction(event);
  return event;
}

const idsAt = (x, y) => MapObjects.getObjectsAt(new core.Location(x, y, 0), null).map((o) => o.getId());

test("below 40 Ranged the door is refused and never opens", (t) => {
  const f = actor(t, OUTSIDE, 1);
  const event = openDoor(f);
  assert.equal(event.handled, true, "the click is claimed, so the gate never opens");
  assert.equal(idsAt(DOOR.x, DOOR.y).includes(INVISWALL), false, "no gate was opened");
  assert.equal(f.p.getLocation().getX(), OUTSIDE[0], "the player stays outside");
});

test("40 Ranged opens the gate and is carried across", (t) => {
  const f = actor(t, OUTSIDE, 40);
  const event = openDoor(f);
  assert.equal(event.handled, true, "the pass-through gate takes the click");
  assert.ok(idsAt(DOOR.x, DOOR.y).includes(INVISWALL), "the doorway keeps a blocker while it stands open");
  tick(f, 4);
  assert.equal(f.p.getLocation().getX(), INSIDE[0], "the opener is carried to the inside tile");
});

test("a low-level follower cannot cross the open gate", (t) => {
  const leader = actor(t, OUTSIDE, 40);
  const follower = actor(t, [2656, 3438, 0], 1);
  openDoor(leader);
  assert.ok(idsAt(DOOR.x, DOOR.y).includes(INVISWALL), "the gate is open with its blocker in place");
  follow(follower, leader);
  tick(follower, 12);
  assert.ok(follower.p.getLocation().getX() <= OUTSIDE[0],
    `the follower stayed outside: ${follower.p.getLocation()}`);
});

test("inside the guild the door always lets the player out", (t) => {
  const f = actor(t, INSIDE, 1);
  const event = openDoor(f);
  assert.equal(event.handled, true, "the pass-through gate takes the click");
  tick(f, 4);
  assert.equal(f.p.getLocation().getX(), OUTSIDE[0], "a low-level player can still leave");
});

test("the diagonal splits the four clickable tiles the way the fence does", () => {
  const { inside } = require("../plugins/areas/RangingGuild.plugin")._test;
  const at = (x, y) => ({ getLocation: () => ({ getX: () => x, getY: () => y, getZ: () => 0 }) });
  assert.equal(inside(at(2657, 3438)), false, "north-west of the leaf");
  assert.equal(inside(at(2658, 3439)), false, "the doorman's tile, outside");
  assert.equal(inside(at(2659, 3438)), true, "south-east of the leaf");
  assert.equal(inside(at(2658, 3437)), true, "inside the fence");
  assert.equal(inside(at(2700, 3400)), false, "the half-plane is bounded by the guild");
});
