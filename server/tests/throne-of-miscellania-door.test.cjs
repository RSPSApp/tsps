// Run after `yarn build`: node --test tests/throne-of-miscellania-door.test.cjs
// The Miscellania throne room doors and their guard (Wiki: Throne of Miscellania; Transcript:
// Throne of Miscellania). Real engine: every plugin loaded, a real Player.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");

const SOUTH_DOOR = [2506, 3857, 1];
const OUTSIDE_SOUTH = [2506, 3856, 1];
const NORTH_DOOR = [2506, 3863, 1];
const OUTSIDE_NORTH = [2506, 3864, 1];
const FACE_NORTH = 1;
const FACE_SOUTH = 3;
const HEROES_GUARD_CONDITION = "QSsVp6";

let core;
let index = 9600;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quests = () => require("../plugins/quests/QuestRuntime");
const at = (p) => [p.getLocation().getX(), p.getLocation().getY(), p.getLocation().getZ()];

function player(t, tile) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel), new core.Location(...tile));
  p.setIndex(index++); p.setUsername("throne" + index); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  t.after(() => { p.getPacketSender().sendInterfaceRemoval(); core.TaskManager.cancelTasks(p); p.setRegistered(false); });
  return p;
}

function open(p, tile, face) {
  const object = new core.GameObject(core.ObjectIdentifiers.THRONE_ROOM_DOOR, new core.Location(...tile), 0, face);
  return PM.emitObjectInteraction({
    player: p, object, objectId: object.getId(), clickType: 1, handled: false,
    location: { x: tile[0], y: tile[1], z: tile[2] },
  });
}

function settle(p) {
  for (let i = 0; i < 6; i++) {
    p.getMovementQueue().process();
    core.TaskManager.process();
  }
}

test("the guard turns away anyone without Heroes' Quest and lets a hero pass", (t) => {
  const p = player(t, OUTSIDE_SOUTH);
  const condition = () => PM.emitNpcDialogueCondition({ player: p, npcId: core.NpcIdentifiers.GUARD_47, stepId: HEROES_GUARD_CONDITION });
  assert.equal(condition(), true);
  quests().questNamed("Heroes' Quest").complete(p, { experience: false });
  assert.equal(condition(), false);
});

test("without the audience the south door has the guard stop the player", (t) => {
  const p = player(t, OUTSIDE_SOUTH);
  assert.equal(open(p, SOUTH_DOOR, FACE_SOUTH), true);
  settle(p);
  assert.deepEqual(at(p), OUTSIDE_SOUTH);
  assert.ok(p.getDialogueManager().getCurrent(), "the guard speaks");
});

test("once the guard has let a hero pass, the doors walk them in and out", (t) => {
  const p = player(t, OUTSIDE_SOUTH);
  quests().questNamed("Heroes' Quest").complete(p, { experience: false });
  open(p, SOUTH_DOOR, FACE_SOUTH); // the guard's "Then you may pass."
  p.getPacketSender().sendInterfaceRemoval();
  open(p, SOUTH_DOOR, FACE_SOUTH);
  settle(p);
  assert.deepEqual(at(p), SOUTH_DOOR);
  open(p, SOUTH_DOOR, FACE_SOUTH);
  settle(p);
  assert.deepEqual(at(p), OUTSIDE_SOUTH);
});

test("leaving through the north door needs no audience", (t) => {
  const p = player(t, NORTH_DOOR);
  open(p, NORTH_DOOR, FACE_NORTH);
  settle(p);
  assert.deepEqual(at(p), OUTSIDE_NORTH);
});
