// Demonic Pacts' Endless Harvest through the real Woodcutting: a tree the relic keeps standing is
// chopped on, not left mid-swing (docs/leagues.md, Demonic Pacts' relics); without the relic the
// same tree falls after its log and the chopping stops.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { GameConstants } = require("../dist/game/GameConstants");

let core;
let next = 1900;
const AT = [1666, 3136, 0];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  GameConstants.setWorldProfile("league");
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** A new Demonic Pacts character, logged in through the real hooks, its tutorial done, `relics` picked. */
function pactsCharacter(t, relics) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(`harvest${next}`);
  player.setProfile("league");
  player.setRegistered(true);
  player.setLocation(new core.Location(...AT));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  PM.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: true, profile: "league" });
  for (let i = 0; i < 3; i++) core.TaskManager.process();
  player.setAttribute("league:tutorial-stage", 14);
  player.setAttribute("league:relics", relics);
  player.moveTo(new core.Location(...AT));
  player.needsPlacement = false;
  player.getInventory().resetItems();
  player.getPacketSender().sendInterfaceRemoval();
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection };
}

async function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    core.TaskManager.processWalkTo(f.player.getIndex());
    f.player.getMovementQueue().process();
    core.TaskManager.process();
  }
}

/** A normal tree beside the player, chopped with every roll a log (none a nest) for `count` ticks. */
async function chop(t, f, count) {
  const skills = f.player.getSkillManager();
  skills.setMaxLevel(core.Skill.WOODCUTTING, 99);
  skills.setCurrentLevel(core.Skill.WOODCUTTING, 99);
  f.player.getInventory().add(new core.Item(core.ItemIdentifiers.RUNE_AXE), true);
  core.RegionManager.loadMapFiles(AT[0], AT[1]);
  const tree = new core.GameObject(core.ObjectIdentifiers.TREE, new core.Location(AT[0] + 1, AT[1], 0), 10, 0, null);
  core.ObjectManager.register(tree, true);
  t.after(() => core.ObjectManager.deregister(tree, true));
  t.mock.method(Math, "random", () => (new Error().stack.includes("maybeDropBirdNest") ? 0.99 : 0));
  await f.connection.dispatch([{ type: "object_option", id: tree.getId(), x: AT[0] + 1, y: AT[1], action: "Chop down" }]);
  f.connection.processTurnPackets();
  await ticks(f, count);
  return tree;
}

function logs(f) {
  const id = core.ItemIdentifiers.LOGS;
  return f.player.getInventory().getAmount(id) + f.player.getBank(0).getAmount(id);
}

const Woodcutting = () => require("../plugins/skills/Woodcutting.plugin");

test("Endless Harvest: the tree it keeps standing is chopped on, two logs a log", async (t) => {
  const f = pactsCharacter(t, { 0: 1 });
  const tree = await chop(t, f, 20);
  assert.equal(Woodcutting().isWoodcuttingActive(f.player), true, "still chopping");
  assert.ok(core.ObjectManager.objectsAt(tree.getLocation()).some((o) => o.getId() === tree.getId()), "the tree stands, no stump");
  assert.ok(logs(f) >= 6, `logs keep coming: ${logs(f)}`);
  assert.equal(logs(f) % 2, 0, "each log is doubled");
});

test("without the relic: the same tree falls after its log and the chopping stops", async (t) => {
  const f = pactsCharacter(t, {});
  const tree = await chop(t, f, 20);
  assert.equal(Woodcutting().isWoodcuttingActive(f.player), false);
  assert.equal(core.ObjectManager.objectsAt(tree.getLocation()).some((o) => o.getId() === tree.getId()), false, "a stump in its place");
  assert.equal(logs(f), 1);
});
