// Run after `yarn build`: node --test tests/archery-targets-native.test.cjs
// Real Target locs, ClientConnection object_option packets and the loaded ArcheryCompetition plugin.
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
const Session = require("../plugins/minigames/archerycompetition/Session.ArcheryCompetition");

const TARGET = 11663;
const SHOOTING_TILE = [2681, 3426, 0];
let core, nextIndex = 9960;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...SHOOTING_TILE);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, at) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername(`archtarget${player.getIndex()}`);
  player.setRegistered(true);
  player.setAttribute("bot-skip-persistence", true);
  player.getSkillManager().setMaxLevel(core.Skill.RANGED, 60).setCurrentLevel(core.Skill.RANGED, 60);
  player.setLocation(new core.Location(...at));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  const messages = [];
  const packetSender = player.getPacketSender();
  t.mock.method(packetSender, "sendMessage", (text) => { messages.push(String(text)); return packetSender; });
  t.mock.method(packetSender, "sendTypedMessage", (_type, text) => { messages.push(String(text)); return packetSender; });
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection, messages };
}

function tick(f, count = 1) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    f.connection.processTurnPackets();
    f.player.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getSession().flushClient(core.World.processCycle);
    f.player.resetUpdating();
  }
}

async function fire(f, object) {
  await f.connection.dispatch([{ type: "object_option", id: TARGET,
    x: object.getLocation().getX(), y: object.getLocation().getY(), action: "Fire-at" }]);
  tick(f, 25);
}

function targetAt(x, y) {
  const object = core.MapObjects.get(TARGET, new core.Location(x, y, 0), null);
  assert.ok(object, `stock target ${TARGET} at ${x},${y}`);
  return object;
}

test("a native Fire-at click outside a round answers in place", async (t) => {
  const f = actor(t, [2671, 3418, 0]);
  const target = targetAt(2679, 3426);
  const before = [f.player.getLocation().getX(), f.player.getLocation().getY()];
  await fire(f, target);
  assert.ok(f.messages.includes("You need to enter the competition before you can use the targets."),
    `the existing refusal ran; messages=${JSON.stringify(f.messages)}`);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], before,
    "the click doesn't walk toward the target");
});

test("native Fire-at still takes a shot during an active round", async (t) => {
  const f = actor(t, SHOOTING_TILE);
  const target = targetAt(2681, 3425);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.COINS, 200), false);
  f.player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(841, 1));
  assert.equal(Session.startRound(f.player), true);
  await fire(f, target);
  assert.equal(f.player.getInventory().getAmount(core.ItemIdentifiers.BRONZE_ARROW), 9,
    "the reachable target consumes exactly one provided arrow");
  assert.equal(Session.sessionOf(f.player).shots, 1);
  assert.ok(f.messages.some((text) => ["You missed!", "Hit Black!", "Hit Blue!", "Hit Red!", "Hit Yellow!", "Bulls-Eye!"].includes(text)),
    "the target reports the shot result");
});
