// Run after `yarn build`: node --test tests/dig-site-tray-teddy.test.cjs
//
// The Dig Site's mud tray keeps its mud when the coin reward can't be added (a stack at the cap), and
// the teddy bush gives no second teddy while one is banked. Real plugins, a real Player, Inventory
// and Bank; the clicks go through PluginManager.emitItemAction / emitObjectInteraction with the
// cache's own Search option. No client ran.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const MAX_STACK = 2147483647;
let core;
let index = 7640;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(3370, 3378, 0));
  p.needsPlacement = false;
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { messages.push(String(text)); return send(text, ...rest); };
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  return { p, messages };
}

const digSite = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_dig_site");

function searchTray(p, slot) {
  const item = p.getInventory().getItems()[slot];
  const action = [2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(item.getId(), op))
    .find((candidate) => candidate?.option?.toLowerCase() === "search");
  assert.ok(action, "the native resolver exposes Search");
  return PM.emitItemAction({ player: p, item, itemId: item.getId(), slot, interfaceId: (149 << 16),
    clickType: action.optionIndex, option: action.option, handled: false });
}

function searchBush(p) {
  const id = core.ObjectIdentifiers.BUSH_10;
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((option) => option?.toLowerCase() === "search") + 1;
  assert.ok(clickType > 0, "the bush has the cache's Search option");
  const at = { x: 3370, y: 3379, z: 0 };
  return PM.emitObjectInteraction({ player: p, object: { getId: () => id, getLocation: () => new core.Location(at.x, at.y, 0) },
    objectId: id, definition, clickType, location: at, sourceLocation: { x: 3370, y: 3378, z: 0 }, handled: false });
}

test("a coin stack at the cap leaves the mud in the tray instead of losing the coins", (t) => {
  const { p } = player(t, "digsitetray1");
  const I = core.ItemIdentifiers;
  const inventory = p.getInventory();
  inventory.setItem(0, new core.Item(I.PANNING_TRAY_3, 1));
  inventory.setItem(1, new core.Item(I.COINS, MAX_STACK));
  t.mock.method(Math, "random", () => 0); // roll 0: coins, then the smallest amount
  assert.equal(searchTray(p, 0), true);
  assert.equal(inventory.getItems()[0].getId(), I.PANNING_TRAY_3, "the mud stays for later");
  assert.equal(inventory.getAmount(I.COINS), MAX_STACK);

  inventory.setItem(1, new core.Item(I.COINS, 100));
  assert.equal(searchTray(p, 0), true);
  assert.equal(inventory.getItems()[0].getId(), I.PANNING_TRAY, "searched once there is room");
  assert.equal(inventory.getAmount(I.COINS), 101);
});

test("the teddy bush gives no second teddy while one is banked, and does once it is gone", (t) => {
  const { p, messages } = player(t, "digsiteteddy1");
  const I = core.ItemIdentifiers;
  digSite().setStage(p, 1);
  p.getBank(0).add(new core.Item(I.TEDDY, 1));
  assert.equal(searchBush(p), true);
  assert.equal(p.getInventory().getAmount(I.TEDDY), 0, "already owned in the bank");
  assert.ok(messages.includes("You find nothing of interest."));

  p.getBank(0).resetItems();
  p.getBank(0).add(new core.Item(I.TEDDY, 0)); // a placeholder is not a teddy
  assert.equal(searchBush(p), true);
  assert.equal(p.getInventory().getAmount(I.TEDDY), 1, "a lost teddy can be found again");
});
