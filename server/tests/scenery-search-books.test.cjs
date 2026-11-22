// node --test tests/scenery-search-books.test.cjs
// Plain bookcases, the Varrock book shelves and sacks (rsprox captures: books in 21 recordings,
// revisions 227-242, e.g. local 1001726, 1002048, 1002053; sacks local 1000075, 1001339; Wiki:
// Bookcase), answered as fallbacks behind any plugin's own handler for the same name.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, beforeEach, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { GameObject } = require("../dist/game/entity/impl/object/GameObject");
const { ObjectDefinition } = require("../dist/game/definition/ObjectDefinition");
const { TaskManager } = require("../dist/game/task/TaskManager");

const BOOK_LINES = [
  "None of them look very interesting.",
  "You find nothing to interest you.",
  "You don't find anything you'd ever want to read.",
];
let core, C, api;
const ownClaims = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  ObjectDefinition.init();
  core = PluginManager.getCoreApi();
  C = core.CacheDefinitions;
  api = PluginManager.createApi("ScenerySearch");
  require("../plugins/objects/ScenerySearch.plugin").register(api);
  // A plugin loaded after ScenerySearch that owns one bookcase: its handler still answers first.
  PluginManager.createApi("OwnBookcaseTest").onObjectInteraction("Bookcase", {
    Search: (event) => {
      if (event.objectId !== C.getLocId("questbookcase")) return false;
      ownClaims.push(event.objectId);
    },
  });
});

beforeEach(() => { ownClaims.length = 0; });

function fixture() {
  const player = new Player(null);
  const sent = [];
  const sender = new Proxy({}, { get: (_target, key) => {
    if (key === "sendTypedMessage") return (type, text) => { sent.push([type === core.ChatType.SPAM ? "spam" : "typed", text]); return sender; };
    return () => sender;
  } });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  player.isRegistered = () => true;
  player.sendMessage = (message) => sent.push(["message", message]);
  return { player, sent };
}

function search(f, gameval, roll = 0) {
  const objectId = C.getLocId(gameval);
  const location = new core.Location(3236, 3409, 0);
  const object = new GameObject(objectId, location, 10, 0, null);
  const original = Math.random;
  Math.random = () => roll;
  try {
    return PluginManager.emitObjectInteraction({ player: f.player, object, objectId, clickType: 1, location, handled: false });
  } finally {
    Math.random = original;
  }
}

function tick(n = 1) {
  for (let i = 0; i < n; i++) TaskManager.process();
}

test("a plain bookcase says it searched the books, then one of three lines a tick later", () => {
  for (const [roll, line] of [[0, BOOK_LINES[0]], [0.5, BOOK_LINES[1]], [0.99, BOOK_LINES[2]]]) {
    const f = fixture();
    assert.equal(search(f, "fai_varrock_posh_bookcase", roll), true);
    assert.deepEqual(f.sent, [], "nothing on the handler tick (arrival + 1)");
    tick();
    assert.deepEqual(f.sent, [["spam", "You search the books..."], ["message", line]], "both on arrival + 2 (rev 239+)");
    tick(3);
    assert.equal(f.sent.length, 2);
  }
});

test("old bookshelves and the two Varrock book shelves search the same way", () => {
  for (const gameval of ["canafis_bookshelf_old_short3", "fai_varrock_shelf_books", "fai_varrock_shelves_books"]) {
    const f = fixture();
    assert.equal(search(f, gameval, 0), true, gameval);
    tick();
    assert.deepEqual(f.sent, [["spam", "You search the books..."], ["message", BOOK_LINES[0]]], gameval);
  }
});

test("a player who logged out before the tick gets no book messages", () => {
  const f = fixture();
  search(f, "bookcase2");
  f.player.isRegistered = () => false;
  tick();
  assert.deepEqual(f.sent, []);
});

test("another plugin's own bookcase still answers first, even when it loaded later", () => {
  const f = fixture();
  assert.equal(search(f, "questbookcase"), true);
  tick();
  assert.deepEqual(ownClaims, [C.getLocId("questbookcase")]);
  assert.deepEqual(f.sent, []);
});

test("the plain sacks find nothing on arrival; other sacks are left alone", () => {
  const f = fixture();
  assert.equal(search(f, "sacks"), true);
  assert.deepEqual(f.sent, [["message", "There's nothing interesting in these sacks."]]);

  const dig = fixture();
  assert.equal(search(dig, "digsamplesacks"), false);
  assert.deepEqual(dig.sent, []);
});

test("Wydin's potato and cabbage crates ask on the fourth tick and Yes takes one (rsprox 233/00465)", (t) => {
  for (const [gameval, item, many, one] of [["potato_crate", "potato", "potatoes", "potato"], ["cabbage_crate", "cabbage", "cabbages", "cabbage"]]) {
    const f = fixture();
    const prompts = [];
    t.mock.method(api, "sendMultiChatboxPrompt", (_player, title, ...options) => { prompts.push({ title, options }); return true; });
    const animations = [];
    f.player.performAnimation = (animation) => animations.push(animation.getId());
    assert.equal(search(f, gameval), true, gameval);
    assert.deepEqual(f.sent, [["message", `There are a lot of ${many} in the crate.`]], "the line on arrival");
    tick(3);
    assert.deepEqual(prompts, [], "no question before the fourth tick");
    tick();
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].title, `Do you want to take a ${one}?`);
    prompts[0].options[1]();
    assert.equal(f.player.getInventory().getAmount(C.getObjId(item)), 1, gameval);
    assert.deepEqual(f.sent.at(-1), ["message", `You take a ${one}.`]);
    assert.deepEqual(animations, [C.getSeqId("human_pickuptable")]);
    t.mock.restoreAll();
  }
});

// rsprox 233/00465: Search on tick 7315, a walk click on 7318, the question on 7319 with the
// player still on (3011,3204).
test("a walk click during the four ticks is ignored and the question still comes", (t) => {
  const f = fixture();
  f.player.setIndex(4321);
  f.player.setLocation(new core.Location(3011, 3204, 0));
  const prompts = [];
  t.mock.method(api, "sendMultiChatboxPrompt", (...args) => { prompts.push(args); return true; });
  search(f, "potato_crate");
  const queue = f.player.getMovementQueue();
  assert.equal(queue.isMovementBlocked(), true);
  tick(2);
  queue.requestWalk(new core.Location(3011, 3206, 0));
  assert.equal(queue.isMovementBlocked(), true, "the walk click neither moves nor cancels");
  tick();
  assert.equal(prompts.length, 0);
  tick();
  assert.equal(prompts.length, 1, "the question on the fourth tick");
  assert.equal(queue.isMovementBlocked(), false, "free again with the question open");
  assert.ok(f.player.getLocation().equals(new core.Location(3011, 3204, 0)));
});

test("a new click (cancelling the player's tasks) gives the hold back; another system's hold is kept", (t) => {
  const f = fixture();
  f.player.setIndex(4322);
  const prompts = [];
  t.mock.method(api, "sendMultiChatboxPrompt", (...args) => { prompts.push(args); return true; });
  const queue = f.player.getMovementQueue();
  search(f, "potato_crate");
  TaskManager.cancelTasks(f.player.getIndex());
  assert.equal(queue.isMovementBlocked(), false);
  tick(5);
  assert.deepEqual(prompts, []);

  search(f, "potato_crate");
  queue.setBlockMovement(true); // a cutscene or another plugin's hold
  tick(4);
  assert.equal(prompts.length, 1);
  assert.equal(queue.isMovementBlocked(), true, "not ours to release");
  queue.setBlockMovement(false);
});
