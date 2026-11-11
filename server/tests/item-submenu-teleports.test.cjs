// Run after `yarn build`: node --test tests/item-submenu-teleports.test.cjs
// Issue 4253: an item's submenu entry (Rub > Xeric's Glade) must go where it says, not reopen the menu.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const Travel = require("../plugins/items/KourendTravelItems.plugin");
const Medallion = require("../plugins/items/DrakansMedallion.plugin");

const MAIN_INVENTORY_WIDGET = (149 << 16) | 0;
const DRAKANS_MEDALLION = 22400;
const CONSTRUCTION_CAPE = 9789;
let core = null;
let api = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  api = PluginManager.createApi("ItemSubmenuTeleportsTest");
  Travel.register(api);
  Medallion.register(api);
});

function actor() {
  const player = new Player(null, new core.Location(3200, 3200, 0));
  player.setIndex(3000 + Math.floor(Math.random() * 1000));
  player.setUsername("item-submenu-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.getHitpoints = () => 10;
  player.isDyingReturn = () => false;
  return player;
}

/** Teleports land at once; prompts and messages are recorded. */
function stub(t, player) {
  const landed = [];
  const prompts = [];
  const messages = [];
  t.mock.method(core.TeleportHandler, "checkReqs", () => true);
  t.mock.method(core.TeleportHandler, "teleport", (_player, target, _type, _warn, onArrival) => {
    landed.push([target.getX(), target.getY()]);
    onArrival?.();
  });
  t.mock.method(api, "sendMultiChatboxPrompt", (_player, title) => prompts.push(title));
  t.mock.method(player, "sendMessage", (message) => messages.push(message));
  return { landed, prompts, messages };
}

/**
 * The event NetworkBuilder emits for an inventory submenu click: the widget op resolved to its
 * option, and subOpId the client's 0-based entry plus one (ClientProtocol IF_BUTTON_SUB).
 */
function submenuClick(player, slot, widgetOp, wireSubop) {
  const item = player.getInventory().getItems()[slot];
  const action = ItemActionPacketListener.resolveInventoryWidgetAction(item.getId(), widgetOp);
  const event = {
    player, interfaceId: MAIN_INVENTORY_WIDGET, item, itemId: item.getId(), slot,
    clickType: action.optionIndex, option: action.option, subOpId: wireSubop + 1, handled: false,
  };
  PluginManager.emitItemAction(event);
  return event;
}

function talismanIn(player, charges) {
  player.getInventory().adds(Travel._test.XERIC_TALISMAN_ID, 1);
  const slot = player.getInventory().getItems().findIndex((entry) => entry?.getId() === Travel._test.XERIC_TALISMAN_ID);
  Travel._test.setXericCharges(player, player.getInventory().getItems()[slot], charges);
  return slot;
}

test("emitItemAction names the submenu entry from the cache, inventory and worn", () => {
  const player = actor();
  const slot = talismanIn(player, 5);
  const rub = submenuClick(player, slot, 4, 1);
  assert.equal(rub.option, "Rub");
  assert.equal(rub.subOption, "Xeric's Glade");

  // Worn submenus are params: the first entry at 661 + op, later ones at 2066 + op + 8n.
  const definition = core.CacheDefinitions.getItem(CONSTRUCTION_CAPE);
  const worn = (subOpId) => PluginManager.itemActionSubOption(definition, {
    interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, clickType: 3, subOpId,
  });
  assert.deepEqual([worn(1), worn(2), worn(10)], ["Home", "Rimmington", "Prifddinas"]);
  assert.equal(worn(11), null, "past the last entry");
  assert.equal(PluginManager.itemActionSubOption(definition, { interfaceId: MAIN_INVENTORY_WIDGET, clickType: 3 }), null,
    "a plain click has no entry");
});

test("each Xeric's talisman Rub entry teleports straight there (rsprox 726: subop 2 to the Inferno)", (t) => {
  const player = actor();
  const slot = talismanIn(player, 10);
  const { landed, prompts } = stub(t, player);
  for (const wireSubop of [0, 1, 2, 3]) {
    const event = submenuClick(player, slot, 4, wireSubop);
    assert.equal(event.handled, true, `Rub entry ${wireSubop} is answered, so the Rub menu never follows`);
  }
  const tiles = Travel._test.XERIC_DESTINATIONS.slice(0, 4).map((destination) => destination.tile.slice(0, 2));
  assert.deepEqual(landed, tiles, "Lookout, Glade, Inferno and Heart in cache order");
  assert.deepEqual(prompts, [], "no destination menu");
  assert.equal(Travel._test.xericCharges(player.getInventory().getItems()[slot]), 6, "one charge each");
});

test("a locked Xeric's Honour entry neither teleports nor opens the Rub menu", (t) => {
  const player = actor();
  const slot = talismanIn(player, 10);
  const { landed, prompts } = stub(t, player);
  const event = submenuClick(player, slot, 4, 4);
  assert.equal(event.subOption, "Xeric's Honour");
  assert.equal(event.handled, true);
  assert.deepEqual(landed, []);
  assert.deepEqual(prompts, []);
  assert.equal(Travel._test.xericCharges(player.getInventory().getItems()[slot]), 10);
});

test("plain Rub still asks where", (t) => {
  const player = actor();
  const slot = talismanIn(player, 10);
  const { landed, prompts } = stub(t, player);
  const item = player.getInventory().getItems()[slot];
  const event = { player, interfaceId: MAIN_INVENTORY_WIDGET, item, itemId: item.getId(), slot, clickType: 3, option: "Rub", handled: false };
  PluginManager.emitItemAction(event);
  assert.equal(event.handled, true);
  assert.equal(prompts.length, 1);
  assert.deepEqual(landed, []);
});

for (const [name, itemId, widgetOp] of [
  // Reminisce is the book's second inventory option (widget op 3, as rsprox 363 sends it) and the memoirs' first.
  ["Book of the Dead", Travel._test.BOOK_OF_THE_DEAD_ID, 3],
  ["Kharedst's memoirs", Travel._test.MEMOIRS_ID, 2],
]) {
  test(`${name} Reminisce entries go to their city (rsprox 363: subops 1-4; 3150: subop 0 to Hosidius)`, (t) => {
    const player = actor();
    player.getInventory().adds(itemId, 1);
    const slot = player.getInventory().getItems().findIndex((entry) => entry?.getId() === itemId);
    for (const page of Travel._test.MEMOIRS_PAGES) {
      player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId(page.varbit), 1);
    }
    Travel._test.setMemoirCharges(player, player.getInventory().getItems()[slot], 50);
    const { landed, prompts } = stub(t, player);
    assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(itemId, widgetOp).option, "Reminisce");
    for (const wireSubop of [0, 1, 2, 3, 4]) assert.equal(submenuClick(player, slot, widgetOp, wireSubop).handled, true);
    assert.deepEqual(landed, Travel._test.MEMOIRS_PAGES.map((page) => page.tile.slice(0, 2)),
      "Hosidius, Piscarilius, Shayzien, Lovakengj, Arceuus");
    assert.deepEqual(prompts, []);
    assert.equal(Travel._test.memoirCharges(player, player.getInventory().getItems()[slot]), 45);
  });
}

test("Drakan's medallion Teleport entries go straight there; a locked one says so (rsprox 4288)", (t) => {
  const player = actor();
  player.getInventory().adds(DRAKANS_MEDALLION, 1);
  const slot = player.getInventory().getItems().findIndex((entry) => entry?.getId() === DRAKANS_MEDALLION);
  const { landed, prompts, messages } = stub(t, player);
  assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(DRAKANS_MEDALLION, 3).option, "Teleport");
  assert.equal(submenuClick(player, slot, 3, 0).handled, true);
  assert.deepEqual(landed, [[3649, 3230]], "Ver Sinhaza (rsprox 4266, 4288: subop 0)");
  assert.equal(submenuClick(player, slot, 3, 2).handled, true);
  assert.deepEqual(landed, [[3649, 3230]], "Slepe is locked without the tablet");
  assert.deepEqual(messages, ["You haven't unlocked that teleport yet."]);
  assert.deepEqual(prompts, [], "no destination menu");
});
