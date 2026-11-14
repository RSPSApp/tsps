const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const runtime = require("../plugins/quests/QuestRuntime");

const BOOK = 392;
const uid = (child) => (BOOK << 16) | child;
const BUSY = 12393;
const READ = 1350;
const buttons = new Map();
const itemActions = new Map();
const events = new Map();

class Animation {
  constructor(id) { this.id = id; }
}
const api = new Proxy({
  core: { Animation, Graphic: class { constructor(id) { this.id = id; } } },
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onInterfaceActionButton: (ids, handler) => ids.forEach((id) => buttons.set(id, handler)),
  onCustomEvent: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
}, { get: (target, key) => target[key] ?? (() => {}) });

before(() => {
  runtime.registerQuest(api, { key: "reading-books-fixture", name: "Reading Books Fixture" });
  require("../plugins/items/ReadingBooks.plugin").register(api);
});

function reader() {
  const state = { open: -1, texts: new Map(), hidden: new Map(), objects: new Map(), varbits: [], animations: [], scripts: [], order: [] };
  const sender = {
    sendInterface: (group) => { state.open = group; state.order.push(["open", group]); return sender; },
    sendClientScript: (id, ...args) => { state.scripts.push([id, ...args]); state.order.push(["script", id]); return sender; },
    sendString: (text, id) => { state.texts.set(id, text); return sender; },
    sendInterfaceDisplayState: (id, hide) => { state.hidden.set(id, hide); return sender; },
    sendItemOnInterface: (id, item, _slot, zoom) => { state.objects.set(id, { item, zoom }); return sender; },
    sendInterfaceScript: (id, args) => { state.order.push(["script", id, args]); return sender; },
    sendConfig: () => sender,
    sendVarbit: (id, value) => { state.varbits.push([id, value]); state.order.push(["varbit", id, value]); return sender; },
    sendInterfaceRemoval: () => { state.open = -1; return sender; },
  };
  const player = {
    getPacketSender: () => sender,
    performAnimation: (animation) => state.animations.push(animation.id),
    performGraphic: () => {},
  };
  return { player, state };
}

const press = (player, child) => buttons.get(uid(child))({ player, buttonId: uid(child) });

test("Read opens each non-quest book with its title, and sets busy with the reading animation", () => {
  const titles = {
    "Construction guide": "GUIDE TO CONSTRUCTION",
    "Glassblowing book": "Ultimate Guide to Glassblowing",
    "Archaeologist's diary": "Charles' Diary",
  };
  for (const [name, title] of Object.entries(titles)) {
    const { player, state } = reader();
    assert.deepEqual(Object.keys(itemActions.get(name)), ["Read"], name);
    itemActions.get(name).Read({ player });
    assert.equal(state.open, BOOK, name);
    assert.equal(state.texts.get(uid(6)), title);
    assert.deepEqual(state.varbits, [[BUSY, 1]]);
    assert.deepEqual(state.animations, [READ]);
    press(player, 7);
  }
});

test("closing the book clears busy and the reading animation, by the X or by the interface closing", () => {
  const { player, state } = reader();
  itemActions.get("Construction guide").Read({ player });
  press(player, 77);
  press(player, 7);
  assert.equal(state.open, -1);
  assert.deepEqual(state.varbits, [[BUSY, 1], [BUSY, 0]]);
  assert.deepEqual(state.animations, [READ, 3140, -1]);

  // Escape or walking away closes the modal, which the server reports as interface:closed.
  const walked = reader();
  itemActions.get("Archaeologist's diary").Read({ player: walked.player });
  for (const handler of events.get("interface:closed") ?? []) handler({ player: walked.player, interfaceId: BOOK });
  assert.deepEqual(walked.state.varbits, [[BUSY, 1], [BUSY, 0]]);
  assert.deepEqual(walked.state.animations, [READ, -1]);
});

test("closing keeps an animation the closing action started on the same tick", () => {
  const { player, state } = reader();
  itemActions.get("Glassblowing book").Read({ player });
  player.getAnimation = () => ({ getId: () => 714 });
  for (const handler of events.get("interface:closed") ?? []) handler({ player, interfaceId: BOOK });
  assert.deepEqual(state.varbits, [[BUSY, 1], [BUSY, 0]]);
  assert.deepEqual(state.animations, [READ], "no reset over the teleport");
});

test("the Construction guide runs to sixteen pages and the diary to six", () => {
  const { player, state } = reader();
  itemActions.get("Construction guide").Read({ player });
  assert.equal(state.texts.get(uid(44)), "<col=800000>How to build in your house<col=000000>");
  for (let page = 0; page < 7; page++) press(player, 77);
  assert.equal(state.texts.get(uid(9)), "15");
  assert.equal(state.texts.get(uid(56)), "greets guests and serve food");
  assert.equal(state.hidden.get(uid(77)), true, "no next page after 15-16");
  press(player, 7);

  const diary = reader();
  itemActions.get("Archaeologist's diary").Read({ player: diary.player });
  press(diary.player, 77);
  press(diary.player, 77);
  assert.equal(diary.state.texts.get(uid(9)), "5");
  assert.equal(diary.state.texts.get(uid(62)), "Where's Skely?");
  assert.equal(diary.state.hidden.get(uid(77)), true);
  press(diary.player, 7);
});

test("the Glassblowing book shows its item pictures on their lines and hides the other slots", () => {
  const { player, state } = reader();
  itemActions.get("Glassblowing book").Read({ player });
  for (let model = 12; model <= 42; model++) if (model !== 27) assert.equal(state.hidden.get(uid(model)), true);
  assert.equal(state.objects.size, 0);

  press(player, 77);
  assert.equal(state.texts.get(uid(9)), "3");
  assert.equal(state.hidden.get(uid(14)), false);
  assert.deepEqual(state.objects.get(uid(14)), { item: 1925, zoom: 300 });
  assert.equal(state.hidden.get(uid(30)), false);
  assert.deepEqual(state.objects.get(uid(30)), { item: 1785, zoom: 100 });
  assert.equal(state.texts.get(uid(46)), "", "a picture line has no text");
  assert.equal(state.texts.get(uid(49)), "<col=000080>An empty bucket");
  assert.equal(state.hidden.get(uid(15)), true);

  press(player, 77);
  assert.deepEqual(state.objects.get(uid(14)), { item: 401, zoom: 300 });
  assert.deepEqual(state.objects.get(uid(30)), { item: 1781, zoom: 300 });

  press(player, 77);
  assert.equal(state.hidden.get(uid(14)), true, "the next spread hides the pictures again");
  assert.equal(state.hidden.get(uid(30)), true);
  assert.equal(state.texts.get(uid(73)), "titles!");
  press(player, 7);
});

test("bookPagesFromSpreads maps lines to text components and pictures to model components", () => {
  const [page] = runtime.bookPagesFromSpreads([[["a", { item: 1, zoom: 2 }], ["b"]]]);
  assert.deepEqual(page, { 44: "a", 13: { item: 1, zoom: 2 }, 60: "b" });
});

test("the rotten diary reads as live's two-spread Mouldy Diary (rec 4288 tick 19991)", () => {
  const { player, state } = reader();
  assert.deepEqual(Object.keys(itemActions.get("Rotten diary")), ["Read"]);
  itemActions.get("Rotten diary").Read({ player });
  assert.equal(state.open, BOOK);
  assert.equal(state.texts.get(uid(6)), "Mouldy Diary");
  assert.equal(state.texts.get(uid(44)), "<col=600000>*A lot of the diary is too");
  assert.equal(state.texts.get(uid(48)), "", "the left page ends after the mould note");
  assert.equal(state.texts.get(uid(74)), "afar. Lowerniel proved his");
  assert.deepEqual(state.animations, [READ]);
  press(player, 77);
  assert.equal(state.texts.get(uid(9)), "3");
  assert.equal(state.texts.get(uid(58)), "would always have made a");
  assert.equal(state.texts.get(uid(60)), "better Ghrazi.");
  assert.equal(state.hidden.get(uid(77)), true, "no third spread");
  press(player, 7);
});

test("the poem scroll opens the long scroll with busy set, and closing it clears busy (rec 4288 tick 3136)", () => {
  const { player, state } = reader();
  assert.deepEqual(Object.keys(itemActions.get("Poem scroll")), ["Read"]);
  itemActions.get("Poem scroll").Read({ player });
  assert.deepEqual(state.order.slice(0, 4), [["varbit", BUSY, 1], ["script", 2524, [-1, -1]], ["open", 625], ["script", 418]],
    "busy, the modal background, the scroll, then its setup, in live's order");
  const [[, title, text]] = state.scripts;
  assert.equal(title, "");
  assert.equal(text.split("<br>").length, 19);
  assert.match(text, /^To Apsul they did travel,<br>The father and the son\./);
  assert.match(text, /The father killed eleven,<br>/);
  assert.match(text, /Then departed to the west\.$/);
  assert.deepEqual(state.animations, [], "live plays no reading animation for the scroll");
  for (const handler of events.get("interface:closed") ?? []) handler({ player, interfaceId: 625 });
  assert.deepEqual(state.varbits, [[BUSY, 1], [BUSY, 0]]);
  for (const handler of events.get("interface:closed") ?? []) handler({ player, interfaceId: 625 });
  assert.deepEqual(state.varbits, [[BUSY, 1], [BUSY, 0]], "a second close sends nothing");
});

test("closing another plugin's long scroll leaves busy alone", () => {
  const { player, state } = reader();
  for (const handler of events.get("interface:closed") ?? []) handler({ player, interfaceId: 625 });
  assert.deepEqual(state.varbits, []);
});

test("switching between a book and the scroll keeps busy set for the one now open", () => {
  for (const [first, second, group] of [["Rotten diary", "Poem scroll", 625], ["Poem scroll", "Rotten diary", BOOK]]) {
    const { player, state } = reader();
    // As Player.setInterfaceId: a new main modal reports the previous one as closed.
    const close = (id) => { for (const handler of events.get("interface:closed") ?? []) handler({ player, interfaceId: id }); };
    const sender = player.getPacketSender();
    const open = sender.sendInterface;
    sender.sendInterface = (id) => { const previous = state.open; open(id); if (previous >= 0 && previous !== id) close(previous); return sender; };
    sender.sendInterfaceRemoval = () => { const previous = state.open; state.open = -1; if (previous >= 0) close(previous); return sender; };
    player.getInterfaceId = () => state.open;
    itemActions.get(first).Read({ player });
    itemActions.get(second).Read({ player });
    assert.equal(state.open, group, `${first} then ${second}`);
    assert.deepEqual(state.varbits.at(-1), [BUSY, 1], `${first} then ${second}`);
    assert.deepEqual(state.varbits, [[BUSY, 1], [BUSY, 0], [BUSY, 1]], `${first} then ${second}`);
  }
});
