// Run after `yarn build`: node --test tests/the-golem-reading.test.cjs
//
// #2559: The Golem's letter and Varmen's notes read in their native interfaces, as captured:
// - rsprox 3333 (rev 235), tick 396, lines 5491-5511: Read on the letter (4615) sets 220:1-15, runs
//   script 2524 and opens 220 as the main modal.
// - rsprox 3333, tick 715, lines 8025-8085: Read on the notes (4616) opens the book (392) titled
//   "The Ruins of Uzer"; rsprox 3232 (rev 232), ticks 1613-1621, has all 16 pages.
// The expected text below is copied from those captures, not read from the plugin's data.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

const HOME = [3222, 3218];
const LETTER_GROUP = 220;
const BOOK_GROUP = 392;
const PROGRESS = "quest.the_golem.letter";
const uid = (group, child) => (group << 16) | child;

let core;
let I;
let next = 6800;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("golemqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const strings = new Map();
  const messages = [];
  const sender = p.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendString", (text, id) => { strings.set(id, text); return sendString(text, id); });
  const sendMessage = sender.sendMessage.bind(sender);
  t.mock.method(sender, "sendMessage", (text) => { messages.push(text); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  return { p, c, inv: p.getInventory(), strings, messages };
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

/** Read, as the browser client sends it. */
async function read(f, itemId) {
  f.inv.add(new core.Item(itemId), false);
  const slot = f.inv.getItems().findIndex((held) => held?.getId() === itemId);
  await send(f, { type: "inventory_action", slot, itemId, widgetId: 3214, option: "Read" });
}

/** The book's next-page arrow, as captured: a resume on 392:77. */
const nextPage = (f) => send(f, { type: "dialogue_continue", widgetId: uid(BOOK_GROUP, 77), childIndex: -1 });

test("the letter opens in its own interface with the captured lines, and not in the chatbox", async (t) => {
  const f = actor(t);
  await read(f, I.LETTER_2);
  assert.equal(f.p.getInterfaceId(), LETTER_GROUP, "interface 220 is open");
  const line = (child) => f.strings.get(uid(LETTER_GROUP, child));
  assert.equal(line(3), "Dearest Varmen,");
  assert.equal(line(4), "I hope this finds you well. Here are the books you asked for.");
  assert.equal(line(6), "another city from the same period has been discovered east");
  assert.equal(line(9), "expedition as well as this one, so I fear your current trip will be");
  assert.equal(line(10), "the last.");
  assert.equal(line(12), "Your loving Elissa.");
  for (const child of [1, 2, 13, 14, 15]) assert.equal(line(child), "", `220:${child} is blank`);
  assert.equal(f.messages.some((text) => /Dearest Varmen|Your loving Elissa/.test(text)), false, "no chat lines");
  assert.equal(Number(f.p.getAttribute(PROGRESS)), 1, "reading it starts the hunt");
  await send(f, { type: "interface_close" });
  assert.notEqual(f.p.getInterfaceId(), LETTER_GROUP, "the generic interface close closes it");

  await read(f, I.LETTER_2);
  assert.equal(Number(f.p.getAttribute(PROGRESS)), 1, "reading it again changes nothing");
  f.p.setAttribute(PROGRESS, 2);
  await read(f, I.LETTER_2);
  assert.equal(Number(f.p.getAttribute(PROGRESS)), 2, "nor sets later progress back");
});

test("Varmen's notes open as the native book, all 16 pages, with the captured text", async (t) => {
  const f = actor(t);
  f.p.setAttribute(PROGRESS, 2);
  await read(f, I.VARMENS_NOTES);
  assert.equal(f.p.getInterfaceId(), BOOK_GROUP, "the book is open");
  const line = (child) => f.strings.get(uid(BOOK_GROUP, child));
  assert.equal(line(6), "The Ruins of Uzer");
  assert.deepEqual([line(9), line(10)], ["1", "2"]);
  assert.equal(line(44), "Septober 19:");
  assert.equal(line(45), "The nomads were right:");
  assert.equal(line(60), "tomorrow.");
  assert.equal(Number(f.p.getAttribute(PROGRESS)), 3, "reading them moves the hunt on");

  await nextPage(f);
  assert.deepEqual([line(9), line(10)], ["3", "4"], "the arrow turns the page");
  assert.equal(line(44), "Septober 20:");
  await nextPage(f);
  assert.equal(line(60), "Septober 21:");
  for (let spread = 0; spread < 5; spread++) await nextPage(f);
  assert.deepEqual([line(9), line(10)], ["15", "16"], "the last spread");
  await nextPage(f);
  assert.deepEqual([line(9), line(10)], ["15", "16"], "and there is no further page");

  await send(f, { type: "widget_action", widgetId: uid(BOOK_GROUP, 7), groupId: BOOK_GROUP, childId: 7, buttonNum: 1 });
  assert.notEqual(f.p.getInterfaceId(), BOOK_GROUP, "the close button closes it");
});

test("the notes can be read at any point, and only move the hunt on once Elissa has spoken", async (t) => {
  const f = actor(t);
  await read(f, I.VARMENS_NOTES);
  assert.equal(f.p.getInterfaceId(), BOOK_GROUP, "the book opens");
  assert.equal(Number(f.p.getAttribute(PROGRESS)) || 0, 0, "and no progress is skipped");
});
