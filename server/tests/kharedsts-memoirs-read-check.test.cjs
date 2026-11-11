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

test("Check on memoirs with no page reads live's 0/0 (rsprox 20261111T231757-5ab63b4)", (t) => {
  const { player, sent } = actor(t);
  assert.equal(inventoryClick(player, MEMOIRS, "Check").handled, true);
  assert.equal(sent.strings.get(OBJECTBOX_TEXT), checkLine(0, 0));
  assert.deepEqual(sent.items, [[OBJECTBOX_ITEM, MEMOIRS]]);
});

test("Check on Kharedst's memoirs counts 20 per attached page, inventory and worn", (t) => {
  const { player, sent } = actor(t);
  player.setAttribute("kharedst-memoirs:added-pages", { piscarilius: true, shayzien: true });
  Travel._test.setMemoirCharges(player, new core.Item(MEMOIRS, 1), 25);
  assert.equal(inventoryClick(player, MEMOIRS, "Check").handled, true);
  assert.equal(sent.strings.get(OBJECTBOX_TEXT), checkLine(25, 40));
  sent.strings.clear();
  player.getDialogueManager().reset();
  assert.equal(wornCheck(player, MEMOIRS).handled, true);
  assert.equal(sent.strings.get(OBJECTBOX_TEXT), checkLine(25, 40));
});

test("Read plays human_readbook and opens the book on its first spread", (t) => {
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

test("memoirs with no page attached read as live's three spreads (rsprox 20261111T231757-5ab63b4)", (t) => {
  const { player } = actor(t);
  const spreads = Travel._test.bookSpreads(player, new core.Item(MEMOIRS, 1));
  const lines = (spread) => Object.fromEntries(Object.entries(spread).filter(([, text]) => text));
  assert.equal(spreads.length, 3);
  assert.deepEqual(lines(spreads[1]), {
    44: "'The Fisher's Flute'", 46: "...", 48: "<col=ff0000> This entry seems to be", 49: "<col=ff0000>missing.<col=ff0000>",
    60: "History and Hearsay", 62: "...", 64: "<col=ff0000> This entry seems to be", 65: "<col=ff0000>missing.<col=000000>",
  });
  assert.deepEqual(lines(spreads[2]), {
    44: "Jewellery of Jubilation", 46: "...", 48: "<col=ff0000> This entry seems to be", 49: "<col=ff0000>missing.<col=000000>",
    60: "A Dark Disposition", 62: "...", 64: "<col=ff0000> This entry seems to be", 65: "<col=ff0000>missing.<col=000000>",
  });
});

test("the Book of the Dead reads in full, 32 pages ending with Tread Carefully (rsprox 363)", (t) => {
  const { player } = actor(t);
  const spreads = Travel._test.bookSpreads(player, new core.Item(BOOK_OF_THE_DEAD, 1));
  assert.equal(spreads.length, 16);
  assert.equal(spreads[2][44], "The Fisher's Flute");
  assert.equal(spreads[15][44], "Tread Carefully");
});

test("an attached page reads in full in the memoirs, the rest stay missing", (t) => {
  const { player } = actor(t);
  player.setAttribute("kharedst-memoirs:added-pages", { piscarilius: true });
  const spreads = Travel._test.bookSpreads(player, new core.Item(MEMOIRS, 1));
  // Dedication, Lunch (missing), then The Fisher's Flute's four pages, then three missing pages.
  assert.equal(spreads.length, 5);
  assert.equal(spreads[1][44], "The Fisher's Flute");
  assert.equal(spreads[3][44], "History and Hearsay");
  assert.equal(spreads[3][60], "Jewellery of Jubilation");
});

test("Reminisce on an empty book opens live's no-charge messagebox", (t) => {
  const { player, sent } = actor(t);
  Travel._test.setMemoirCharges(player, new core.Item(MEMOIRS, 1), 0);
  player.getInventory().setItem(0, new core.Item(MEMOIRS, 1));
  const event = { player, interfaceId: MAIN_INVENTORY_WIDGET, item: player.getInventory().getItems()[0], itemId: MEMOIRS, slot: 0,
    clickType: 1, option: "Reminisce", subOption: "Lunch by the Lancalliums", handled: false };
  PluginManager.emitItemAction(event);
  assert.equal(event.handled, true);
  assert.equal(sent.strings.get((229 << 16) | 3), "Kharedst's Memoirs holds no charge.");
});
