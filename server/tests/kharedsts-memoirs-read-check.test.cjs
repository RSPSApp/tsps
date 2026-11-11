// Run after `yarn build`: node --test tests/kharedsts-memoirs-read-check.test.cjs
// Issue 4463: Kharedst's memoirs and the Book of the Dead answer Read and Check, inventory and worn.
// Check is the objectbox with the book and its "memories remain" line (rsprox 363 ticks 37, 3595);
// Read plays human_readbook and opens book 392 on the first captured spread (rsprox 363 tick 494).
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const Travel = require("../plugins/items/KourendTravelItems.plugin");

const MAIN_INVENTORY_WIDGET = (149 << 16) | 0;
const MEMOIRS = 21760;
const BOOK_OF_THE_DEAD = 25818;
const OBJECTBOX_TEXT = (193 << 16) | 2;
const OBJECTBOX_ITEM = (193 << 16) | 1;
const BOOK = 392;
let core = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  Travel.register(PluginManager.createApi("KharedstsMemoirsReadCheckTest"));
});

function actor(t) {
  const player = new Player(null, new core.Location(1640, 3670, 0));
  player.setIndex(4000 + Math.floor(Math.random() * 1000));
  player.setUsername("memoirs-test");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  const sent = { strings: new Map(), interfaces: [], items: [] };
  const sender = player.getPacketSender();
  const wrap = (name, record) => {
    const original = sender[name].bind(sender);
    t.mock.method(sender, name, (...args) => { record(...args); return original(...args); });
  };
  wrap("sendString", (text, uid) => sent.strings.set(uid, text));
  wrap("sendInterface", (id) => sent.interfaces.push(id));
  wrap("sendItemOnInterfaces", (uid, itemId) => sent.items.push([uid, itemId]));
  return { player, sent };
}

function inventoryClick(player, itemId, option) {
  player.getInventory().setItem(0, new core.Item(itemId, 1));
  const ops = CacheDefinitions.getItem(itemId).inventoryActions;
  const widgetOp = [2, 3, 4, 6, 7][ops.indexOf(option)];
  const action = ItemActionPacketListener.resolveInventoryWidgetAction(itemId, widgetOp);
  assert.equal(action.option, option);
  const event = {
    player, interfaceId: MAIN_INVENTORY_WIDGET, item: player.getInventory().getItems()[0], itemId, slot: 0,
    clickType: action.optionIndex, option: action.option, handled: false,
  };
  PluginManager.emitItemAction(event);
  return event;
}

/** The worn Check: the sixth worn option (param 456), clicked through the equipment tab. */
function wornCheck(player, itemId) {
  const item = new core.Item(itemId, 1);
  const event = {
    player, interfaceId: core.Equipment.INVENTORY_INTERFACE_ID, item, itemId, slot: 3, clickType: 7, handled: false,
  };
  PluginManager.emitItemAction(event);
  return event;
}

const checkLine = (charges, max) => "On the inside of the cover a message is displayed in<br>dark ink. It reads: "
  + `<col=800080>${charges}/${max} memories remain.<col=800080>`;

test("Check on the Book of the Dead shows the captured line with its charges", (t) => {
  const { player, sent } = actor(t);
  Travel._test.setMemoirCharges(player, new core.Item(BOOK_OF_THE_DEAD, 1), 33);
  const event = inventoryClick(player, BOOK_OF_THE_DEAD, "Check");
  assert.equal(event.handled, true);
  assert.equal(sent.strings.get(OBJECTBOX_TEXT), checkLine(33, 250));
  assert.deepEqual(sent.items, [[OBJECTBOX_ITEM, BOOK_OF_THE_DEAD]]);
});

test("Check on Kharedst's memoirs counts out of 100, inventory and worn", (t) => {
  const { player, sent } = actor(t);
  Travel._test.setMemoirCharges(player, new core.Item(MEMOIRS, 1), 40);
  assert.equal(inventoryClick(player, MEMOIRS, "Check").handled, true);
  assert.equal(sent.strings.get(OBJECTBOX_TEXT), checkLine(40, 100));
  sent.strings.clear();
  player.getDialogueManager().reset();
  assert.equal(wornCheck(player, MEMOIRS).handled, true);
  assert.equal(sent.strings.get(OBJECTBOX_TEXT), checkLine(40, 100));
});

test("Read plays human_readbook and opens the book on the captured first spread", (t) => {
  for (const [itemId, title] of [[BOOK_OF_THE_DEAD, "The Book of the Dead"], [MEMOIRS, "Kharedst's Memoirs"]]) {
    const { player, sent } = actor(t);
    const event = inventoryClick(player, itemId, "Read");
    assert.equal(event.handled, true);
    assert.equal(player.getAnimation()?.getId(), CacheDefinitions.getSeqId("human_readbook"));
    assert.deepEqual(sent.interfaces, [BOOK]);
    assert.equal(sent.strings.get((BOOK << 16) | 6), title);
    assert.equal(sent.strings.get((BOOK << 16) | 44), "A gift for Rose.");
    assert.equal(sent.strings.get((BOOK << 16) | 60), "'Lunch by the Lancalliums'");
    assert.equal(sent.strings.get((BOOK << 16) | 56), "Queen over this great land.");
  }
});

test("the book data holds the 16 captured spreads, ending with Tread Carefully", () => {
  const { pages } = require("../plugins/items/data/kharedsts-memoirs-pages.json");
  assert.equal(pages.length, 16);
  assert.equal(pages[15]["44"], "Tread Carefully", "page 31 opens the last entry");
});
