// Run after `yarn build`: node --test tests/examine-price-routes.test.cjs
//
// Settings rows 234 and 235: every server examine of an item adds the price line after its
// examine text, with the stack's own amount. Packets go through ClientConnection.dispatch into the
// real plugins, as the client sends them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { Bank } = require("../dist/game/model/container/impl/Bank");
const { PlayerStatus } = require("../dist/game/model/PlayerStatus");
const { ItemOnGroundManager } = require("../dist/game/entity/impl/grounditem/ItemOnGroundManager");
const { EXAMINE_PRICE_GE_VARBIT, EXAMINE_PRICE_ALCH_VARBIT } = require("../dist/game/content/ExaminePrice");

const HOME = [3222, 3218];
const FEATHER = 314;
const STEEL_SCIMITAR = 1325;
const WORN_WEAPON = (387 << 16) | 18; // the worn equipment tab's weapon slot
const EXAMINE_OP = 10;

const r = (n) => `<col=ff0000>${n}</col>`;
const FEATHERS_100 = `Price of 100 x Feather: GE ${r(300)} (${r(3)}ea)  HA ${r(100)} (${r(1)}ea)`;
const SCIMITAR = /^Price of Steel scimitar: GE <col=ff0000>[\d,]+<\/col>  HA <col=ff0000>240<\/col>  LA <col=ff0000>160<\/col>$/;

let core;
let next = 4600;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

/** A logged-in player with both price settings on, and every game message they get. */
function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("exprice" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  p.getPacketSender().sendVarbit(EXAMINE_PRICE_GE_VARBIT, 1).sendVarbit(EXAMINE_PRICE_ALCH_VARBIT, 1);
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  return { p, c, messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

const examine = (id) => core.ItemDefinition.forId(id).getExamine();

test("inventory examine: the price line follows, for the whole stack", async (t) => {
  const f = actor(t);
  f.p.getInventory().setItem(0, new core.Item(FEATHER, 100));
  await send(f, { type: "inventory_action", slot: 0, itemId: FEATHER, widgetId: 3214, option: "Examine" });
  assert.deepEqual(f.messages, [examine(FEATHER), FEATHERS_100]);
});

test("ground examine: the price line follows, for the stack on the tile", async (t) => {
  const f = actor(t);
  const tile = new core.Location(HOME[0] + 1, HOME[1], 0);
  ItemOnGroundManager.registerLocation(f.p, new core.Item(FEATHER, 100), tile);
  await send(f, { type: "ground_item_action", itemId: FEATHER, x: tile.getX(), y: tile.getY(), option: "Examine" });
  assert.deepEqual(f.messages, [examine(FEATHER), FEATHERS_100]);
});

test("bank examine (op 11) and the bank's worn-items view (op 10)", async (t) => {
  const f = actor(t);
  f.p.getBank(0).add(new core.Item(FEATHER, 100), false);
  f.p.setStatus(PlayerStatus.BANKING);
  f.p.setInterfaceId(Bank.MAIN_INTERFACE_ID);
  Bank.handleWidgetAction(f.p, {
    groupId: Bank.MAIN_INTERFACE_ID, childId: Bank.ITEMS_CHILD, buttonNum: Bank.EXAMINE_OP, slot: 0, itemId: FEATHER,
  });
  assert.deepEqual(f.messages, [examine(FEATHER), FEATHERS_100]);
  f.messages.length = 0;
  f.p.getInventory().setItem(0, new core.Item(STEEL_SCIMITAR, 1));
  Bank.handleWidgetAction(f.p, {
    groupId: Bank.SIDE_INTERFACE_ID, childId: Bank.SIDE_WORN_CHILD, buttonNum: EXAMINE_OP, slot: 0, itemId: STEEL_SCIMITAR,
  });
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[0], examine(STEEL_SCIMITAR));
  assert.match(f.messages[1], SCIMITAR);
});

test("worn equipment tab examine (op 10): the examine text and the price line", async (t) => {
  const f = actor(t);
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(STEEL_SCIMITAR, 1));
  await send(f, { type: "widget_action", widgetId: WORN_WEAPON, groupId: 387, childId: WORN_WEAPON & 0xffff, buttonNum: EXAMINE_OP, option: "Examine" });
  assert.equal(f.messages.length, 2, f.messages.join(" | "));
  assert.equal(f.messages[0], examine(STEEL_SCIMITAR));
  assert.match(f.messages[1], SCIMITAR);
});

test("equipment stats screen examine (op 10): the examine text and the price line, once", async (t) => {
  const f = actor(t);
  f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(STEEL_SCIMITAR, 1));
  f.p.setInterfaceId(84);
  const weapon = (84 << 16) | 13;
  await send(f, { type: "widget_action", widgetId: weapon, groupId: 84, childId: 13, buttonNum: EXAMINE_OP, option: "Examine" });
  assert.equal(f.messages.length, 2, f.messages.join(" | "));
  assert.equal(f.messages[0], examine(STEEL_SCIMITAR));
  assert.match(f.messages[1], SCIMITAR);
});

test("shop examine: the shop's side inventory (op 10)", async (t) => {
  const f = actor(t);
  f.p.setStatus(PlayerStatus.SHOPPING);
  f.p.setInterfaceId(300);
  f.p.getInventory().setItem(0, new core.Item(FEATHER, 100));
  await send(f, { type: "widget_action", widgetId: 301 << 16, groupId: 301, childId: 0, buttonNum: EXAMINE_OP, slot: 0, itemId: FEATHER });
  assert.deepEqual(f.messages, [examine(FEATHER), FEATHERS_100]);
});

test("both settings off: the examine text alone", async (t) => {
  const f = actor(t);
  f.p.getPacketSender().sendVarbit(EXAMINE_PRICE_GE_VARBIT, 0).sendVarbit(EXAMINE_PRICE_ALCH_VARBIT, 0);
  f.p.getInventory().setItem(0, new core.Item(FEATHER, 100));
  await send(f, { type: "inventory_action", slot: 0, itemId: FEATHER, widgetId: 3214, option: "Examine" });
  assert.deepEqual(f.messages, [examine(FEATHER)]);
});

// Item interfaces that plugins handle themselves.
const OPEN_LOOTING_BAG = 22586;
const BAG_ITEMS = (81 << 16) | 5; // wilderness_lootingbag:items
const WILDERNESS = [3090, 3530];

async function widget(f, widgetId, buttonNum, slot, itemId) {
  await send(f, { type: "widget_action", widgetId, groupId: widgetId >>> 16, childId: widgetId & 0xffff, buttonNum, slot, itemId });
}

test("looting bag Check view examine (op 10): the stored stack's price line", async (t) => {
  const f = actor(t);
  const bag = new core.Item(OPEN_LOOTING_BAG, 1);
  f.p.getInventory().setItem(0, bag);
  require("../plugins/items/LootingBag.plugin")._test.store(bag, new core.Item(FEATHER, 100));
  await send(f, { type: "inventory_action", slot: 0, itemId: OPEN_LOOTING_BAG, widgetId: 3214, option: "Check" });
  f.messages.length = 0;
  await widget(f, BAG_ITEMS, EXAMINE_OP, 0, FEATHER);
  assert.deepEqual(f.messages, [examine(FEATHER), FEATHERS_100]);
});

test("looting bag Deposit view examine (op 9): the inventory stack's price line", async (t) => {
  const f = actor(t);
  f.p.setLocation(new core.Location(...WILDERNESS, 0));
  f.p.getInventory().setItem(0, new core.Item(OPEN_LOOTING_BAG, 1));
  f.p.getInventory().setItem(1, new core.Item(FEATHER, 100));
  await send(f, { type: "inventory_action", slot: 0, itemId: OPEN_LOOTING_BAG, widgetId: 3214, option: "Deposit" });
  f.messages.length = 0;
  await widget(f, BAG_ITEMS, 9, 1, FEATHER);
  assert.deepEqual(f.messages, [examine(FEATHER), FEATHERS_100]);
  assert.equal(f.p.getInventory().getItems()[1].getAmount(), 100, "examining stores nothing");
});

test("Death's office examine (op 10): the stored stack's price line", async (t) => {
  const f = actor(t);
  require("../plugins/world/gravestones/Storage.Gravestones").setOffice(f.p, [{ id: FEATHER, amount: 100, meta: null }]);
  require("../plugins/areas/deathsoffice/Retrieval.DeathsOffice").open(f.p);
  f.messages.length = 0;
  await widget(f, core.CacheDefinitions.getComponentId("death_office:items"), EXAMINE_OP, 0, FEATHER);
  assert.deepEqual(f.messages, [examine(FEATHER), FEATHERS_100]);
});
