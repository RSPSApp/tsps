// Run after `yarn build`: node --test tests/myreque-library-books.test.cjs
//
// In Aid of the Myreque: the Paterdomus library books. Read opens each in book 392 with the text live
// sent (rsprox.net recording 365), and the two bookcases hand out their books with "You search the
// bookcase..." and one objectbox per book, as recording 365 ticks 2918-2928 and 3876-3886 show. Real
// plugins, a real Player and Inventory; the clicks go through PluginManager.emitItemAction /
// emitObjectInteraction with the cache's own options. No client ran.
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

const STAGE = "quest.in_aid_of_the_myreque.stage";
const LIBRARY_OPEN = 360, BOOK_READ = 370;
const BOOK = 392;
const uid = (child) => (BOOK << 16) | child;
const LIBRARY = { x: 3354, y: 9900, z: 0 };
let core;
let index = 7700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  ObjectDefinition.init();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name, stage) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(LIBRARY.x, LIBRARY.y, LIBRARY.z));
  p.needsPlacement = false;
  p.setAttribute(STAGE, stage);
  const seen = { messages: [], texts: new Map(), chatbox: [], items: [] };
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { seen.messages.push(String(text)); return send(text, ...rest); };
  const sender = p.getPacketSender();
  for (const [method, record] of [
    ["sendString", (text, id) => seen.texts.set(id, text)],
    ["sendChatboxInterface", (group) => seen.chatbox.push(group)],
    ["sendItemOnInterfaces", (id, item) => seen.items.push(item)],
  ]) {
    const original = sender[method].bind(sender);
    sender[method] = (...args) => { record(...args); return original(...args); };
  }
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  return { p, seen };
}

function read(p, itemId) {
  const slot = p.getInventory().getItems().findIndex((item) => item?.getId() === itemId);
  const item = p.getInventory().getItems()[slot];
  const action = [2, 3, 4, 6, 7].map((op) => ItemActionPacketListener.resolveInventoryWidgetAction(itemId, op))
    .find((candidate) => candidate?.option === "Read");
  assert.ok(action, "the cache's Read option");
  return PM.emitItemAction({ player: p, item, itemId, slot, interfaceId: (149 << 16),
    clickType: action.optionIndex, option: action.option, handled: false });
}

function turnPage(p) {
  return PM.emitInterfaceActionClick({ player: p, buttonId: uid(77), action: 1, handled: false });
}

function search(p, id) {
  const definition = ObjectDefinition.forPlayer(id, p) ?? ObjectDefinition.forId(id);
  const clickType = definition.getInteractions().findIndex((option) => option === "Search") + 1;
  assert.ok(clickType > 0, "the bookcase has the cache's Search option");
  const at = { x: 3354, y: 9899, z: 0 };
  return PM.emitObjectInteraction({ player: p, object: { getId: () => id, getLocation: () => new core.Location(at.x, at.y, 0) },
    objectId: id, definition, clickType, location: at, sourceLocation: LIBRARY, handled: false });
}

test("Read opens each library book in book 392 with live's title, first line and page count", (t) => {
  const I = core.ItemIdentifiers;
  const books = [
    [I.THE_SLEEPING_SEVEN, "The Sleeping Seven", "Though little is known of the", 9],
    [I.HISTORIES_OF_THE_HALLOWLAND, "Histories of the Hallowland", "In years gone by, the land", 11],
    [I.MODERN_DAY_MORYTANIA, "Modern day Morytania", null, 8],
  ];
  for (const [itemId, title, firstLine, spreads] of books) {
    const { p, seen } = player(t, `myrequebook${itemId}`, 430);
    p.getInventory().setItem(0, new core.Item(itemId, 1));
    assert.equal(read(p, itemId), true, title);
    assert.equal(seen.texts.get(uid(6)), title);
    if (firstLine) assert.equal(seen.texts.get(uid(44)), firstLine);
    assert.deepEqual(seen.messages, [], "no stand-in chat line");
    assert.equal(p.getInventory().getAmount(itemId), 1, "reading keeps the book");
    for (let page = 1; page < spreads; page++) turnPage(p);
    assert.equal(seen.texts.get(uid(9)), String(spreads * 2 - 1), `${title} ends on its last spread`);
  }
});

test("the last spreads carry live's closing lines", (t) => {
  const { p, seen } = player(t, "myrequebookend", 430);
  const I = core.ItemIdentifiers;
  p.getInventory().setItem(0, new core.Item(I.MODERN_DAY_MORYTANIA, 1));
  read(p, I.MODERN_DAY_MORYTANIA);
  for (let page = 1; page < 8; page++) turnPage(p);
  assert.equal(seen.texts.get(uid(44)), "centrally located in the");
  assert.equal(seen.texts.get(uid(49)), "this has yet to be confirmed.");
});

test("reading The Sleeping Seven moves the quest on from the opened library", (t) => {
  const { p } = player(t, "myrequebookstage", LIBRARY_OPEN);
  const I = core.ItemIdentifiers;
  p.getInventory().setItem(0, new core.Item(I.THE_SLEEPING_SEVEN, 1));
  read(p, I.THE_SLEEPING_SEVEN);
  assert.equal(p.getAttribute(STAGE), BOOK_READ);
});

test("the history bookcase gives both books, an objectbox each; the one that does not fit goes on the floor", (t) => {
  const I = core.ItemIdentifiers;
  const { p, seen } = player(t, "myrequecase1", 430);
  for (let slot = 0; slot < 27; slot++) p.getInventory().setItem(slot, new core.Item(I.BRONZE_DAGGER, 1));
  assert.equal(search(p, core.ObjectIdentifiers.BOOKCASE_51), true);
  assert.equal(seen.messages[0], "You search the bookcase...");
  assert.equal(p.getInventory().getAmount(I.HISTORIES_OF_THE_HALLOWLAND), 1);
  assert.equal(p.getInventory().getAmount(I.MODERN_DAY_MORYTANIA), 0, "no free slot for the second book");
  const { World } = require("../dist/game/World");
  const floor = World.getItems().filter((item) => item.getItem().getId() === I.MODERN_DAY_MORYTANIA);
  assert.equal(floor.length, 1, "Modern day Morytania on the floor");
  assert.deepEqual([floor[0].getPosition().getX(), floor[0].getPosition().getY()], [LIBRARY.x, LIBRARY.y], "under the player");
  assert.deepEqual(seen.chatbox, [193]);
  assert.equal(seen.texts.get((193 << 16) | 2), "You find a book called Histories of the Hallowland.");
  assert.deepEqual(seen.items, [I.HISTORIES_OF_THE_HALLOWLAND]);

  // The second book is the next box in the chain.
  p.getDialogueManager().advance();
  assert.equal(seen.texts.get((193 << 16) | 2), "You find a book called Modern day Morytania.");
  assert.deepEqual(seen.items, [I.HISTORIES_OF_THE_HALLOWLAND, I.MODERN_DAY_MORYTANIA]);
});

test("a bookcase whose books the player carries only sends the search line", (t) => {
  const I = core.ItemIdentifiers;
  const { p, seen } = player(t, "myrequecase2", 430);
  p.getInventory().setItem(0, new core.Item(I.THE_SLEEPING_SEVEN, 1));
  assert.equal(search(p, core.ObjectIdentifiers.BOOKCASE_52), true);
  assert.deepEqual(seen.messages, ["You search the bookcase..."]);
  assert.deepEqual(seen.chatbox, []);
  assert.equal(p.getInventory().getAmount(I.THE_SLEEPING_SEVEN), 1);
});

test("the Sleeping Seven bookcase gives the book with its objectbox", (t) => {
  const I = core.ItemIdentifiers;
  const { p, seen } = player(t, "myrequecase3", 430);
  assert.equal(search(p, core.ObjectIdentifiers.BOOKCASE_52), true);
  assert.deepEqual(seen.messages, ["You search the bookcase..."]);
  assert.equal(p.getInventory().getAmount(I.THE_SLEEPING_SEVEN), 1);
  assert.equal(seen.texts.get((193 << 16) | 2), "You find a book called The Sleeping Seven.");
});
