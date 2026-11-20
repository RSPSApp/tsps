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
const { before, after, test } = require("node:test");
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

after(() => {
  for (const player of players) {
    core.TaskManager.cancelTasks(player);
    core.TaskManager.cancelTasks(player.getIndex());
    core.World.unregisterPlayerPosition(player);
    player.setRegistered(false);
  }
  PluginManager.emitServerShutdown({});
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
  const target = new core.Location(3210, 3424, 0);
  assert.equal(core.TeleportHandler.checkReqs(player, target), true);
  core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false);
  for (let i = 0; i < 9; i++) { core.World.processCycle++; tick(); }
  assert.ok(player.getLocation().equals(target));
  assert.equal(rum(player), 0, "the bottle actually retrieved from Wydin also breaks on mainland teleport");
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

test("real landed teleports spill only carried Karamjan rum, including after Port Sarim retrieval", async (t) => {
  for (const [label, from, to] of [
    ["mainland after Wydin", [3010, 3207], [3210, 3424]],
    ["within Karamja", [2926, 3143], [2930, 3150]],
    ["off Karamja", [2926, 3143], [3210, 3424]],
  ]) {
    await t.test(label, (t) => {
      const { player, messages } = worker(t, ...from);
      player.getInventory().adds(core.ItemIdentifiers.KARAMJAN_RUM, 2);
      player.getInventory().adds(core.ItemIdentifiers.KARAMJAN_RUM_2, 1);
      player.getBank(0).adds(core.ItemIdentifiers.KARAMJAN_RUM, 3);
      const target = new core.Location(...to, 0);
      assert.equal(core.TeleportHandler.checkReqs(player, target), true);
      core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false);
      assert.equal(rum(player), 2, "the cast has not landed yet");
      for (let i = 0; i < 9; i++) { core.World.processCycle++; tick(); }
      assert.ok(player.getLocation().equals(target), "actual TeleportTask landed");
      assert.equal(rum(player), 0, "all carried bottles431 break on landing");
      assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.KARAMJAN_RUM_2), 1, "other rum item untouched");
      assert.equal(player.getBank(0).getAmount(core.ItemIdentifiers.KARAMJAN_RUM), 3, "bank cargo untouched");
      assert.equal(player.getAttribute("pirates-treasure.rum"), 2, "shipped crate cargo untouched");
      assert.equal(messages.filter((message) => message === "Your Karamjan rum gets broken and spilled.").length, 1);
    });
  }
});

test("refused or cancelled teleports preserve rum, and an empty inventory does not spill banked cargo", (t) => {
  const { player, messages } = worker(t, 3010, 3207);
  const target = new core.Location(3210, 3424, 0);
  player.getInventory().adds(core.ItemIdentifiers.KARAMJAN_RUM, 2);
  player.getMovementQueue().setBlockMovement(true);
  assert.equal(core.TeleportHandler.checkReqs(player, target), false, "locked movement refuses the cast");
  for (let i = 0; i < 9; i++) { core.World.processCycle++; tick(); }
  assert.equal(rum(player), 2);
  assert.deepEqual(at(player), [3010, 3207]);
  player.getMovementQueue().setBlockMovement(false);
  assert.equal(core.TeleportHandler.checkReqs(player, target), true);
  core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false);
  core.TaskManager.cancelTasks(player); // an accepted cast interrupted before landing
  for (let i = 0; i < 9; i++) { core.World.processCycle++; tick(); }
  assert.equal(rum(player), 2);
  assert.deepEqual(at(player), [3010, 3207]);
  player.getInventory().deleteNumber(core.ItemIdentifiers.KARAMJAN_RUM, 2);
  player.getBank(0).adds(core.ItemIdentifiers.KARAMJAN_RUM, 3);
  assert.equal(core.TeleportHandler.checkReqs(player, target), true);
  core.TeleportHandler.teleport(player, target, core.TeleportType.NORMAL, false);
  for (let i = 0; i < 9; i++) { core.World.processCycle++; tick(); }
  assert.ok(player.getLocation().equals(target));
  assert.equal(player.getBank(0).getAmount(core.ItemIdentifiers.KARAMJAN_RUM), 3);
  assert.equal(messages.includes("Your Karamjan rum gets broken and spilled."), false);
});
