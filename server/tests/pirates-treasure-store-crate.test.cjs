// Run after `yarn build`: node --test tests/pirates-treasure-store-crate.test.cjs
//
// Pirate's Treasure: Wydin's stock-room crate (2071 at 3009,3207, Port Sarim) searched from the shop
// floor. The closed stock-room door (3012,3204) breaks the crate's route, so the route hook steps the
// player through the door with moveTo. That step is a placement, and while it is pending getMobility()
// is INVALID, so walkToTile dropped the route destination set in the same tick: the first Search only
// moved the player into the stock room and a second click was needed. One click now steps through,
// walks to the crate and searches it, so the rum comes back.
//
// Real engine, as farming-guild-door.test.cjs: every plugin loaded, a real Player, every click through
// ObjectActionPacketListener.executeAction, and the movement queue and tick tasks running.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectActionPacketListener } = require("../dist/net/packet/impl/ObjectActionPacketListener");

const CRATE = 2071, CRATE_X = 3009, CRATE_Y = 3207;

let core;
let next = 5750;
const players = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(CRATE_X, CRATE_Y);
  PluginManager.emitServerStartup({});
});

function worker(t, x, y) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("wydin" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(x, y, 0));
  player.needsPlacement = false;
  // Employed by Wydin (bit 2), white apron on, and the rum shipped in the banana crate.
  player.setAttribute("pirates-treasure.employment", 3);
  player.setAttribute("pirates-treasure.rum", 2);
  player.getEquipment().setItem(core.Equipment.BODY_SLOT, new core.Item(core.ItemIdentifiers.WHITE_APRON, 1));
  players.push(player);
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const player of players) {
      if (player.isNeedsPlacement()) player.needsPlacement = false;
      player.getMovementQueue().process();
      core.TaskManager.processWalkTo(player.getIndex());
    }
    core.TaskManager.process();
    for (const player of players) player.resetUpdating();
  }
}

function until(condition, limit = 20) {
  for (let i = 0; i < limit && !condition(); i++) tick();
  return condition();
}

const rum = (player) => player.getInventory().getAmount(core.ItemIdentifiers.KARAMJAN_RUM);
const at = (player) => [player.getLocation().getX(), player.getLocation().getY()];
const search = (player) => new ObjectActionPacketListener().executeAction(player, CRATE, CRATE_X, CRATE_Y, 1);

test("one Search from the shop floor steps into the stock room, walks to the crate and finds the rum", (t) => {
  const { player, messages } = worker(t, 3014, 3204);
  search(player);
  assert.ok(until(() => rum(player) === 1), `the rum comes back from one click (at ${at(player)}, messages ${JSON.stringify(messages)})`);
  assert.deepEqual(at(player), [CRATE_X + 1, CRATE_Y], "beside the crate");
  assert.ok(messages.includes("You find your bottle of rum in amongst the bananas."));
  assert.equal(player.getAttribute("pirates-treasure.rum"), 0);
});

test("a walk elsewhere once through the door replaces the search, as any new click does", (t) => {
  const { player } = worker(t, 3014, 3204);
  search(player);
  tick();
  player.getMovementQueue().walkToTile(new core.Location(3011, 3205, 0), () => {});
  tick(20);
  assert.equal(rum(player), 0, "no search happened");
  assert.deepEqual(at(player), [3011, 3205]);
});
