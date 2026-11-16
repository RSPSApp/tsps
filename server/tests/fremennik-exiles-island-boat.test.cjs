// Run after `yarn build`: node --test tests/fremennik-exiles-island-boat.test.cjs
//
// The Fremennik Exiles: the boat to the Island of Stone fades out, lands two ticks later at the recorded tile and fades
// back in (rsprox_transcripts/227/01768.txt ticks 3700-3706). A death already under way when the boat is boarded stays
// at the dock: the bones and dropped items land there, not on the island, and the trip does not release the dying
// player. Real Player, Inventory, TaskManager and death task; World.process runs each tick; only the network is stubbed.
// No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const DOCK = [2621, 3690, 0];
const ISLAND = [2472, 3994, 0];
const STAGE_BOAT = 85;
let core;
let next = 9800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(DOCK[0], DOCK[1]);
  core.RegionManager.loadMapFiles(ISLAND[0], ISLAND[1]);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.getSession().setPlayer(player);
  const username = `exilesboat${next++}`;
  player.setUsername(username);
  player.setLongUsername(core.Misc.stringToLongBigInt(username));
  player.setAttribute("bot-skip-persistence", true);
  player.setLocation(new core.Location(...DOCK));
  player.needsPlacement = false;
  assert.equal(core.World.getPlayers().add(player), true);
  for (let i = 0; i < 3 && player.isNeedsPlacement(); i++) core.World.process();
  player.setLocation(new core.Location(...DOCK));
  const messages = [];
  const send = player.sendMessage.bind(player);
  player.sendMessage = (text, ...rest) => { messages.push(text); return send(text, ...rest); };
  t.after(() => {
    PM.emitPlayerLogout({ player, username });
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    for (const item of [...core.World.getItems()]) if (item.getOwner() === username) core.ItemOnGroundManager.deregister(item);
    if (player.isRegistered()) core.World.getPlayers().remove(player);
  });
  QuestRuntime.getRegisteredQuests().findLast((q) => q.key === "the_fremennik_exiles").setStage(player, STAGE_BOAT);
  return { player, messages };
}

function board(player) {
  const object = new core.GameObject(core.ObjectIdentifiers.FREMENNIK_BOAT_6, new core.Location(2620, 3692, 0), 10, 0, null);
  return PM.emitObjectInteraction({ player, object, objectId: object.getId(), location: { x: 2620, y: 3692, z: 0 }, clickType: 1, handled: false });
}

const xy = (location) => [location.getX(), location.getY(), location.getZ()];
const ticks = (count) => { for (let i = 0; i < count; i++) core.World.process(); };
const groundItems = (player) => core.World.getItems().filter((item) => item.getOwner() === player.getUsername());

test("the boat lands at the recorded tile two ticks after the click and releases the player on the fade in", (t) => {
  const { player, messages } = actor(t);
  assert.equal(board(player), true);
  assert.equal(player.getMovementQueue().isMovementBlocked(), true, "held for the trip");
  ticks(2);
  assert.deepEqual(xy(player.getLocation()), ISLAND);
  assert.ok(messages.includes("You board the boat and travel to the Island of Stone."));
  ticks(2);
  assert.equal(player.getMovementQueue().isMovementBlocked(), false, "released on the fade in");
});

test("a death under way when the boat is boarded drops at the dock and is not moved to the island", (t) => {
  const { player, messages } = actor(t);
  player.getInventory().adds(core.ItemIdentifiers.LOBSTER, 5);
  player.getInventory().adds(core.ItemIdentifiers.COINS, 1000);
  assert.equal(board(player), true);
  ticks(1);
  player.setHitpoints(0);
  player.appendDeath();
  ticks(12);
  assert.notDeepEqual(xy(player.getLocation()).slice(0, 2), ISLAND.slice(0, 2), "the respawn is not the island");
  const dropped = groundItems(player);
  assert.ok(dropped.length > 0, "the death dropped something");
  for (const item of dropped) {
    const at = xy(item.getPosition?.() ?? item.getLocation());
    assert.notDeepEqual([at[0], at[1]], [ISLAND[0], ISLAND[1]], `ground item ${item.getItem().getId()} is not on the island`);
    assert.ok(Math.abs(at[0] - DOCK[0]) <= 2 && Math.abs(at[1] - DOCK[1]) <= 2, `ground item ${item.getItem().getId()} lies at the dock (${at})`);
  }
  assert.ok(!messages.includes("You board the boat and travel to the Island of Stone."), "no arrival for a dying player");
});
