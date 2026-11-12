// The Grand Tree's quest trapdoor is a multi-loc: object 2444 on the map, whose stage-130
// transform (varp 150) is 26243 with Climb-down. A click that names either the map object or the
// transformed loc must start Glough's cutscene, not fall through to the generic ladder link that
// drops the player in the cave beside an already-present demon (#4395).
//
// Run after `yarn build`: node --test tests/grand-tree-demon-cutscene.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const TRAPDOOR_BASE = 2444;
const TRAPDOOR_DISPLAY = 26243;
const TRAPDOOR_TILE = { x: 2487, y: 3464, z: 2 };
const SCENE_ENTRANCE = { x: 2492, y: 9863, z: 0 };
const STAGE_TRAPDOOR = 130;

let core;
let nextIndex = 4600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PM.getCoreApi();
  core.RegionManager.init();
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function grandTree() {
  const quest = require("../plugins/quests/QuestRuntime")
    .getRegisteredQuests()
    .find((candidate) => candidate.key === "grand_tree");
  assert.ok(quest, "Grand Tree is registered");
  return quest;
}

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextIndex++);
  player.setUsername(`demoncut${player.getIndex()}`);
  player.setAttribute("bot-skip-persistence", true);
  player.setRegistered(true);
  player.setLocation(new core.Location(TRAPDOOR_TILE.x, TRAPDOOR_TILE.y + 1, TRAPDOOR_TILE.z));
  player.setNeedsPlacement(false);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PM.emitPlayerLogout({ player, username: player.getUsername() });
    player.closeInterruptibleInterfaces();
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return { player, connection };
}

function mapTrapdoor() {
  core.RegionManager.loadMapFiles(TRAPDOOR_TILE.x, TRAPDOOR_TILE.y);
  const object = core.MapObjects.get(TRAPDOOR_BASE, new core.Location(TRAPDOOR_TILE.x, TRAPDOOR_TILE.y, TRAPDOOR_TILE.z), null);
  assert.ok(object, "the trapdoor is placed on the Grand Tree's top floor");
  return object;
}

function clickTrapdoor(player, objectId, object) {
  const definition = core.ObjectDefinition.forPlayer(objectId, player);
  assert.equal(definition?.getName?.(), "Trapdoor");
  assert.ok(definition.getInteractions().includes("Climb-down"));
  return PM.emitObjectInteraction({
    player,
    object,
    definition,
    objectId,
    location: TRAPDOOR_TILE,
    clickType: 1,
    handled: false,
  });
}

function npcNear(player, id) {
  return core.World.getNpcsNear(player.getLocation(), 15, player.getPrivateArea()).find((npc) => npc.getId() === id);
}

function assertSceneStarted(f, label) {
  assert.ok(f.player.getLocation().equals(new core.Location(SCENE_ENTRANCE.x, SCENE_ENTRANCE.y, SCENE_ENTRANCE.z)),
    `${label}: the scene entrance, not the generic ladder landing`);
  assert.ok(npcNear(f.player, core.NpcIdentifiers.GLOUGH), `${label}: Glough is staged for the cutscene`);
  assert.equal(npcNear(f.player, core.NpcIdentifiers.BLACK_DEMON_2), undefined,
    `${label}: the demon is not there before the reveal`);
}

test("the map trapdoor's stage-130 click starts the demon cutscene", (t) => {
  const f = actor(t);
  grandTree().setStage(f.player, STAGE_TRAPDOOR);
  assert.equal(clickTrapdoor(f.player, TRAPDOOR_BASE, mapTrapdoor()), true);
  assertSceneStarted(f, "base id");
});

test("a click naming the transformed Climb-down loc starts the same cutscene", (t) => {
  const f = actor(t);
  grandTree().setStage(f.player, STAGE_TRAPDOOR);
  const object = new core.GameObject(TRAPDOOR_DISPLAY,
    new core.Location(TRAPDOOR_TILE.x, TRAPDOOR_TILE.y, TRAPDOOR_TILE.z), 22, 2, null);
  assert.equal(clickTrapdoor(f.player, TRAPDOOR_DISPLAY, object), true);
  assertSceneStarted(f, "transformed id");
});
