// Run after `yarn build`: node --test tests/ground-take-own-stack.test.cjs
// Since #1614 different owners' stacks of one item stay apart on a tile. A native Take (no stack id) took the first
// visible one, so an Ironman's drop on a main's public pile was skipped for the main's, which Ironman loot rules refuse:
// the Ironman could not pick up their own coins. Real Players, the real native packet and the Ironman plugin.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { World } = require("../dist/game/World");
const { ItemOnGround, State } = require("../dist/game/entity/impl/grounditem/ItemOnGround");

let core;
let next = 9300;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PluginManager.emitServerStartup({});
});
after(() => PluginManager.emitServerShutdown({}));

function actor(t, name) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername(name);
  player.setRegistered(true);
  player.setLocation(new core.Location(3222, 3218, 0));
  player.needsPlacement = false;
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => { PluginManager.emitPlayerLogout({ player, username: player.getUsername() }); player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, connection };
}

const nativeTake = (itemId, x = 3222, y = 3218) =>
  Buffer.from([103, itemId & 255, itemId >>> 8, (x & 255) + 128 & 255, x >>> 8, y >>> 8, (y & 255) + 128 & 255, 128]);

test("an Ironman's native Take picks up their own coins beside a main's public pile", async (t) => {
  const COINS = core.ItemIdentifiers.COINS;
  const main = actor(t, "mainplayer");
  const iron = actor(t, "ironplayer");
  iron.player.setAttribute("ironman:mode", "ironman");
  const tile = new core.Location(3222, 3218, 0);
  ItemOnGroundManager.registerGlobal(main.player, new core.Item(COINS, 7));
  ItemOnGroundManager.registerLocation(iron.player, new core.Item(COINS, 3), tile);
  t.after(() => { for (const item of [...World.getItems()]) if (item.getItem().getId() === COINS) ItemOnGroundManager.deregister(item); });
  const before = World.getItems().filter((item) => item.getItem().getId() === COINS).length;
  assert.equal(before, 2, "two stacks, one per owner");
  await iron.connection.dispatch(decodeClientPackets(nativeTake(COINS)), true);
  for (let i = 0; i < 3; i++) { iron.connection.processTurnPackets(); core.TaskManager.process?.(); }
  assert.equal(iron.player.getInventory().getAmount(COINS), 3, "the Ironman's own 3 coins");
  const left = World.getItems().filter((item) => item.getItem().getId() === COINS && !item.isPendingRemoval());
  assert.deepEqual(left.map((item) => item.getItem().getAmount()), [7], "the main's 7 stay");
});

test("an Ironman's native Take picks an unowned stack before a main's public pile listed ahead of it", async (t) => {
  const COINS = core.ItemIdentifiers.COINS;
  const main = actor(t, "mainplayer");
  const iron = actor(t, "ironplayer");
  iron.player.setAttribute("ironman:mode", "ironman");
  const tile = new core.Location(3222, 3218, 0);
  ItemOnGroundManager.registerGlobal(main.player, new core.Item(COINS, 7));
  ItemOnGroundManager.register(new ItemOnGround(State.SEEN_BY_EVERYONE, null, tile, new core.Item(COINS, 4), false, -1, iron.player.getPrivateArea()));
  t.after(() => { for (const item of [...World.getItems()]) if (item.getItem().getId() === COINS) ItemOnGroundManager.deregister(item); });
  const live = World.getItems().filter((item) => item.getItem().getId() === COINS && !item.isPendingRemoval());
  assert.deepEqual(live.map((item) => [item.getOwner() ?? null, item.getItem().getAmount()]), [["mainplayer", 7], [null, 4]], "the main's pile, then an unowned one");
  await iron.connection.dispatch(decodeClientPackets(nativeTake(COINS)), true);
  for (let i = 0; i < 3; i++) { iron.connection.processTurnPackets(); core.TaskManager.process?.(); }
  assert.equal(iron.player.getInventory().getAmount(COINS), 4, "the unowned 4 coins");
  const left = World.getItems().filter((item) => item.getItem().getId() === COINS && !item.isPendingRemoval());
  assert.deepEqual(left.map((item) => item.getItem().getAmount()), [7], "the main's 7 stay");
});
