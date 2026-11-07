// Run after `yarn build`: node --test tests/heroes-guild-door.test.cjs
// Wiki (Heroes' Guild): "The guild is only accessible to members who have completed the Heroes' Quest." Its door
// opened for anyone (the generic Doors plugin). Now refused from outside without the quest; leaving always works.
// Real engine: every plugin loaded, the real map door 2624 at 2902,3510 through PluginManager.emitObjectInteraction.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MapObjects } = require("../dist/game/entity/impl/object/MapObjects");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

const REFUSAL = "You need to complete the Heroes' Quest before you can enter the Heroes' Guild.";
let core, next = 9320;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2902, 3510);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function visitor(t, at, done) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++); p.setUsername("hero" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(...at)); p.needsPlacement = false;
  t.after(() => { core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  const q = require("../plugins/quests/QuestRuntime").getRegisteredQuests().find((x) => x.key === "heroes_quest");
  assert.ok(q); q.setStage(p, done ? q.completionValue : 0);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (m) => { messages.push(m); return p.getPacketSender(); });
  return { p, messages };
}

function open(f) {
  const door = MapObjects.getObjectsAt(new core.Location(2902, 3510, 0), null).find((o) => o.getId() === 2624);
  assert.ok(door, "the guild door is on the map");
  const definition = ObjectDefinition.forId(2624);
  const event = { player: f.p, object: door, objectId: 2624, definition, clickType: 1,
    location: { x: 2902, y: 3510, z: 0 }, sourceLocation: { x: f.p.getLocation().getX(), y: f.p.getLocation().getY(), z: 0 }, handled: false };
  PM.emitObjectInteraction(event);
  return event;
}

test("outside the guild without Heroes' Quest the door is refused", (t) => {
  const f = visitor(t, [2903, 3510, 0], false);
  const event = open(f);
  assert.equal(event.handled, true);
  assert.ok(f.messages.includes(REFUSAL), f.messages.join(" | "));
});

/** The Doors plugin's own door:toggle request: unhandled means the door opens as any door. */
function toggle(f) {
  const request = { player: f.p, objectId: 2624, location: { x: 2902, y: 3510, z: 0 }, clickType: 1, handled: false };
  PM.emitCustomEvent("door:toggle", request);
  return request;
}

test("with Heroes' Quest the door opens as any door", (t) => {
  const f = visitor(t, [2903, 3510, 0], true);
  assert.equal(toggle(f).handled, false, "left to the Doors plugin");
  assert.equal(f.messages.includes(REFUSAL), false);
});

test("inside the guild the door always lets the player out", (t) => {
  const f = visitor(t, [2901, 3510, 0], false);
  assert.equal(toggle(f).handled, false, "left to the Doors plugin");
  assert.equal(f.messages.includes(REFUSAL), false);
});
