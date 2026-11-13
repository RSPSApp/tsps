// Run after `yarn build`: node --test tests/master-scroll-book.test.cjs
//
// The Master scroll book against rsprox.net recording 3932 (rev 236, ticks 7291-7360): a scroll
// used on it stores the stack, Teleport reads the default scroll, Remove default and interface
// 597's Set as default ask first, and the stored counts sit in the varbits 597's cache script
// draws. A real Player, plugins, DialogueManager and teleport.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const Book = require("../plugins/items/MasterScrollBook.plugin");

const GE = [3164, 3487];
let core;
let C;
let next = 9300;
let BOOK;
let EMPTY_BOOK;
let WATSON;
let ZULANDRA;
let REVENANTS;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  C = core.CacheDefinitions;
  core.ObjectDefinition.init();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...GE);
  PM.emitServerStartup({});
  BOOK = C.getObjId("bookofscrolls_charged");
  EMPTY_BOOK = C.getObjId("bookofscrolls_empty");
  WATSON = C.getObjId("teleportscroll_watson");
  ZULANDRA = C.getObjId("teleportscroll_zulandra");
  REVENANTS = C.getObjId("teleportscroll_revenants");
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("msb" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(GE[0], GE[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); });
  t.after(() => {
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, inv: p.getInventory(), messages };
}

const varbit = (f, name) => f.p.getPacketSender().getVarbit(C.getVarbitId(name));
const slotOf = (f, id) => f.inv.getItems().findIndex((item) => item?.getId() === id);
const prompt = (f) => MultiChatboxPrompt.getPending(f.p);

function give(f, id, amount = 1) {
  f.inv.add(new core.Item(id, amount), false);
}

function use(f, usedId, withId) {
  const usedSlot = slotOf(f, usedId);
  const withSlot = slotOf(f, withId);
  return PM.emitItemOnItem({
    player: f.p, handled: false,
    usedItem: f.inv.getItems()[usedSlot], usedItemId: usedId, usedItemSlot: usedSlot,
    usedWithItem: f.inv.getItems()[withSlot], usedWithItemId: withId, usedWithItemSlot: withSlot,
  });
}

/** An inventory op by its cache label: clickType is the label's 1-based place in the obj's ops. */
function op(f, option, id = BOOK) {
  const slot = slotOf(f, id);
  const clickType = C.getItem(id).inventoryActions.indexOf(option) + 1;
  assert.ok(clickType > 0, `${option} is one of the book's ops`);
  return PM.emitItemAction({
    player: f.p, interfaceId: (149 << 16), item: f.inv.getItems()[slot], itemId: id, slot,
    clickType, handled: false,
  });
}

function click(f, key, opId) {
  const uid = C.getComponentId(`bookofscrolls:teleportscroll_${key}`);
  const event = { player: f.p, buttonId: uid, action: opId, opId, groupId: uid >>> 16, childId: uid & 0xffff, handled: false };
  Book._test.click(event);
  return event.handled;
}

/** The chatbox menu's resume: one-based option on chatmenu:options. */
function choose(f, option) {
  assert.ok(prompt(f), "a chatbox menu is open");
  const uid = MultiChatboxPrompt.OPTIONS_WIDGET_ID;
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: f.p, buttonId: uid, groupId: uid >>> 16, childId: uid & 0xffff, slot: option, action: option, handled: false }), true);
}

function ticks(count) {
  for (let i = 0; i < count; i++) core.TaskManager.process();
}

function stock(f, counts, defaultIndex = 0) {
  f.p.setAttribute("master-scroll-book:scrolls", counts);
  f.p.setAttribute("master-scroll-book:default", defaultIndex);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
}

test("a scroll used on the book stores the stack: rec 3932 t7341 message and Watson's split varbit", (t) => {
  const f = actor(t);
  give(f, BOOK);
  give(f, WATSON, 20);
  assert.equal(use(f, WATSON, BOOK), true);
  assert.equal(f.inv.getAmount(WATSON), 0);
  assert.equal(varbit(f, "bookofscrolls_watson_lowbits"), 20);
  assert.equal(varbit(f, "bookofscrolls_watson_highbits"), 0);
  assert.deepEqual(f.messages, ["Your Master Scroll Book is now storing 20 Watson teleport scrolls"]);
  give(f, WATSON, 300);
  use(f, BOOK, WATSON);
  assert.equal(Book._test.countOf(f.p, "watson"), 320);
  assert.equal(varbit(f, "bookofscrolls_watson_highbits"), 1);
  assert.equal(varbit(f, "bookofscrolls_watson_lowbits"), 64);
  assert.equal(f.messages.at(-1), "Your Master Scroll Book is now storing 320 Watson teleport scrolls");
});

test("the book holds 1000 of a scroll (Wiki); the rest stays in the inventory", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { zulandra: 990 });
  give(f, ZULANDRA, 25);
  use(f, ZULANDRA, BOOK);
  assert.equal(Book._test.countOf(f.p, "zulandra"), 1000);
  assert.equal(varbit(f, "bookofscrolls_zulandra"), 1000);
  assert.equal(f.inv.getAmount(ZULANDRA), 15);
  f.messages.length = 0;
  use(f, ZULANDRA, BOOK);
  assert.equal(f.inv.getAmount(ZULANDRA), 15);
  assert.deepEqual(f.messages, []);
});

test("a scroll used on the empty book turns it into the book with Teleport", (t) => {
  const f = actor(t);
  give(f, EMPTY_BOOK);
  give(f, WATSON, 3);
  use(f, WATSON, EMPTY_BOOK);
  assert.equal(f.inv.getAmount(EMPTY_BOOK), 0);
  assert.equal(f.inv.getAmount(BOOK), 1);
  assert.equal(Book._test.countOf(f.p, "watson"), 3);
});

test("Teleport reads one of the default scroll: rec 3932 t7294 Zul-andra 86 -> 85 and the scroll's landing", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { zulandra: 86 }, 12);
  assert.equal(varbit(f, "bookofscrolls_selected_teleport_lowbits"), 12);
  assert.equal(varbit(f, "bookofscrolls_zulandra"), 86);
  assert.equal(op(f, "Teleport"), true);
  assert.equal(varbit(f, "bookofscrolls_zulandra"), 85);
  assert.equal(f.inv.getAmount(BOOK), 1);
  ticks(6);
  const at = f.p.getLocation();
  assert.ok(Math.abs(at.getX() - 2195) <= 3 && Math.abs(at.getY() - 3057) <= 3, `landed at ${at.getX()},${at.getY()}`);
});

test("Teleport through a scroll the teleport-tablets data reads (Watson, default 15 = highbits 1)", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { watson: 20 }, 15);
  assert.equal(varbit(f, "bookofscrolls_selected_teleport_highbits"), 1);
  assert.equal(varbit(f, "bookofscrolls_selected_teleport_lowbits"), 0);
  op(f, "Teleport");
  assert.equal(varbit(f, "bookofscrolls_watson_lowbits"), 19);
  ticks(6);
  const at = f.p.getLocation();
  assert.ok(Math.abs(at.getX() - 1644) <= 2 && Math.abs(at.getY() - 3580) <= 2, `landed at ${at.getX()},${at.getY()}`);
});

test("Remove default asks, then clears the default: rec 3932 t7344-7346", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { zulandra: 5 }, 12);
  op(f, "Remove default");
  assert.equal(prompt(f).title, "Remove your default teleport?");
  assert.deepEqual(prompt(f).options, ["Yes", "No"]);
  choose(f, 1);
  assert.equal(Book._test.defaultIndex(f.p), 0);
  assert.equal(varbit(f, "bookofscrolls_selected_teleport_lowbits"), 0);
  assert.deepEqual(f.messages, ["You remove your default Master Scroll book teleport."]);
});

test("Open shows interface 597; Set as default asks and opens the book again: rec 3932 t7352-7358", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { watson: 20 });
  op(f, "Open");
  const group = C.getInterfaceId("bookofscrolls");
  assert.equal(f.p.getInterfaceId(), group);
  assert.equal(varbit(f, "busy"), 1);
  assert.equal(click(f, "watson", 2), true);
  assert.equal(prompt(f).title, "Set Watson teleport as your default teleport?");
  choose(f, 1);
  assert.equal(Book._test.defaultIndex(f.p), 15);
  assert.equal(varbit(f, "bookofscrolls_selected_teleport_highbits"), 1);
  assert.equal(f.messages.at(-1), "Your default Master Scroll Book teleport has been set to Watson teleport.");
  assert.equal(f.p.getInterfaceId(), group);
});

test("Activate reads the entry's scroll; Remove takes the stored scrolls out", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { watson: 4, zulandra: 7 });
  op(f, "Open");
  click(f, "zulandra", 3);
  assert.equal(f.inv.getAmount(ZULANDRA), 7);
  assert.equal(varbit(f, "bookofscrolls_zulandra"), 0);
  click(f, "watson", 1);
  assert.equal(varbit(f, "bookofscrolls_watson_lowbits"), 3);
  assert.notEqual(f.p.getInterfaceId(), C.getInterfaceId("bookofscrolls"));
});

test("a stored Revenant cave teleport asks like the scroll: No keeps it, Yes spends one", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { revenants: 2 });
  op(f, "Open");
  click(f, "revenants", 1);
  assert.equal(prompt(f).options[0], "Yes, teleport me now.");
  assert.equal(Book._test.countOf(f.p, "revenants"), 2);
  choose(f, 2);
  assert.equal(Book._test.countOf(f.p, "revenants"), 2);
  op(f, "Open");
  click(f, "revenants", 1);
  choose(f, 1);
  assert.equal(Book._test.countOf(f.p, "revenants"), 1);
  assert.equal(f.inv.getAmount(REVENANTS), 0);
});

test("Ours: Teleport with no default (or none of it left) opens the book", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { watson: 2 });
  op(f, "Teleport");
  assert.equal(f.p.getInterfaceId(), C.getInterfaceId("bookofscrolls"));
  assert.equal(varbit(f, "bookofscrolls_watson_lowbits"), 2);
});

test("the counts and default come back on login", (t) => {
  const f = actor(t);
  stock(f, { feldip: 8, ardeaglais: 3 }, 20);
  assert.equal(varbit(f, "bookofscrolls_feldip"), 8);
  assert.equal(varbit(f, "bookofscrolls_ardeaglais"), 3);
  assert.equal(varbit(f, "bookofscrolls_selected_teleport_highbits"), 1);
  assert.equal(varbit(f, "bookofscrolls_selected_teleport_lowbits"), 5);
});

/** On a stand-in boat at sea (every tile its deck), with the boat teleport warning on (the default). */
function aboard(t, f) {
  const boat = { containsDeckTile: () => true };
  const real = core.Sailing.instanceAboard;
  t.mock.method(core.Sailing, "instanceAboard", (player) => (player === f.p ? boat : real.call(core.Sailing, player)));
}

/** The boat warning's message box, then its question: answers `answer`. */
function answerBoatWarning(f, answer) {
  const TeleportWarning = require("../plugins/skills/sailing/TeleportWarning.Sailing");
  assert.equal(f.p.getDialogueManager().getCurrent()?.text, TeleportWarning.TEXT_BOX);
  f.p.getDialogueManager().advance();
  assert.equal(prompt(f).title, TeleportWarning.QUESTION);
  choose(f, prompt(f).options.indexOf(answer(TeleportWarning)) + 1);
}

test("at sea, the boat warning's yes reads a stored scroll: it checks the book is still carried", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { watson: 20 }, 15);
  aboard(t, f);
  op(f, "Teleport");
  answerBoatWarning(f, (w) => w.YES);
  ticks(6);
  assert.deepEqual(f.messages.filter((m) => /no longer have/.test(m)), []);
  assert.equal(Book._test.countOf(f.p, "watson"), 19);
  const at = f.p.getLocation();
  assert.ok(Math.abs(at.getX() - 1644) <= 2 && Math.abs(at.getY() - 3580) <= 2, `landed at ${at.getX()},${at.getY()}`);
});

test("at sea, a book dropped before the warning's yes reads nothing and spends nothing", (t) => {
  const f = actor(t);
  give(f, BOOK);
  stock(f, { watson: 20 }, 15);
  aboard(t, f);
  op(f, "Teleport");
  f.inv.deleteAtSlot(slotOf(f, BOOK), 1);
  answerBoatWarning(f, (w) => w.YES);
  ticks(6);
  assert.ok(f.messages.includes("You no longer have the item you were teleporting with."));
  assert.equal(Book._test.countOf(f.p, "watson"), 20);
  assert.equal(f.p.getLocation().getX(), GE[0]);
});

test("at sea with only the empty book, 597's Activate reads a stored scroll past the warning's yes", (t) => {
  const f = actor(t);
  give(f, EMPTY_BOOK);
  stock(f, { watson: 20 });
  aboard(t, f);
  op(f, "Open", EMPTY_BOOK);
  click(f, "watson", 1);
  answerBoatWarning(f, (w) => w.YES);
  ticks(6);
  assert.deepEqual(f.messages.filter((m) => /no longer have/.test(m)), []);
  assert.equal(Book._test.countOf(f.p, "watson"), 19);
});
