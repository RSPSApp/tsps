// Run after `yarn build`: node --test tests/tower-of-life-door.test.cjs
//
// Tower of Life's entrance (21814 at 2649,3225, a south-edge wall; the tower is south). The Wiki: the
// builder's outfit is needed to enter the tower at any time during the quest. The door lets only the
// checked player through and shuts behind them, so nobody can follow them in. Real engine: every
// plugin, real Players, the quest's own stage, worn items, and clicks sent through
// ObjectActionPacketListener.executeAction, so the route, movement queue, hooks and tick tasks run.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const DOOR = [21814, 2649, 3225];
const OUTSIDE = [2649, 3225];
const INSIDE = [2649, 3224];
const STAGE_ADMITTED = 4;

let core;
let next = 4400;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2649, 3225);
  PluginManager.emitServerStartup({});
});

function actor(t, { stage = 0, outfit = false } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("tolDoor" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(...OUTSIDE, 0));
  player.needsPlacement = false;
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => { messages.push(message); return player.getPacketSender(); });
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "tower_of_life");
  assert.ok(quest, "Tower of Life is registered");
  quest.setStage(player, stage);
  if (outfit) {
    const I = core.ItemIdentifiers, E = core.Equipment;
    for (const [slot, id] of [[E.HEAD_SLOT, I.HARD_HAT], [E.BODY_SLOT, I.BUILDERS_SHIRT], [E.LEG_SLOT, I.BUILDERS_TROUSERS], [E.FEET_SLOT, I.BUILDERS_BOOTS]]) {
      player.getEquipment().setItem(slot, new core.Item(id, 1));
    }
  }
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, messages };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
  }
}

function until(condition, limit = 12) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
}

const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const doorClosed = () => core.MapObjects.get(DOOR[0], new core.Location(DOOR[1], DOOR[2], 0), null) != null;
const click = (player) => new ObjectActionPacketListener().executeAction(player, DOOR[0], DOOR[1], DOOR[2], 1);

test("an admitted player in the builder's outfit is let in, and the door shuts behind them", (t) => {
  tick(12);
  assert.ok(doorClosed(), "the map's closed door is in place");
  const { player } = actor(t, { stage: STAGE_ADMITTED, outfit: true });
  click(player);
  assert.ok(until(() => at(player)[1] === INSIDE[1]), `the player ends inside, at ${at(player)}`);
  assert.ok(until(doorClosed), "the door is closed again");
});

test("nobody can follow the builder in while the door is open", (t) => {
  tick(12);
  const builder = actor(t, { stage: STAGE_ADMITTED, outfit: true }).player;
  const stranger = actor(t).player;
  click(builder);
  assert.ok(until(() => !doorClosed()), "the door opens for the builder");
  stranger.getMovementQueue().walkToTile(new core.Location(...INSIDE, 0), () => {});
  tick(8);
  assert.deepEqual(at(stranger), OUTSIDE, "the stranger is still outside");
  assert.ok(until(doorClosed), "the door shuts");
});

test("without the outfit the door stays shut and the player is told why", (t) => {
  tick(12);
  const { player, messages } = actor(t, { stage: STAGE_ADMITTED });
  click(player);
  tick(6);
  assert.match(messages.join("\n"), /hard hat/);
  assert.ok(doorClosed());
  assert.deepEqual(at(player), OUTSIDE);
});
