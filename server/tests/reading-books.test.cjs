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
  const state = { open: -1, texts: new Map(), hidden: new Map(), objects: new Map(), varbits: [], animations: [] };
  const sender = {
    sendInterface: (group) => { state.open = group; return sender; },
    sendString: (text, id) => { state.texts.set(id, text); return sender; },
    sendInterfaceDisplayState: (id, hide) => { state.hidden.set(id, hide); return sender; },
    sendItemOnInterface: (id, item, _slot, zoom) => { state.objects.set(id, { item, zoom }); return sender; },
    sendInterfaceScript: () => sender,
    sendConfig: () => sender,
    sendVarbit: (id, value) => { state.varbits.push([id, value]); return sender; },
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

test("the Tattered journal is one spread titled A journal, with both page buttons hidden", () => {
  // rsprox.net recording 4288 (rev 239) tick 19533: Read on sotfa_forest_journal.
  const { player, state } = reader();
  assert.deepEqual(Object.keys(itemActions.get("Tattered journal")), ["Read"]);
  itemActions.get("Tattered journal").Read({ player });
  assert.equal(state.open, BOOK);
  assert.equal(state.texts.get(uid(6)), "A journal");
  assert.equal(state.texts.get(uid(9)), "1");
  assert.equal(state.texts.get(uid(10)), "2");
  assert.equal(state.texts.get(uid(44)), "My skin hurts. The sunlight");
  assert.equal(state.texts.get(uid(51)), "");
  assert.equal(state.texts.get(uid(58)), "my body to action. A part of");
  assert.equal(state.texts.get(uid(60)), "me rejects this savagery. The");
  assert.equal(state.texts.get(uid(70)), "Vampyrium.");
  for (const child of [71, 72, 73, 74]) assert.equal(state.texts.get(uid(child)), "", `right line ${child}`);
  for (let line = 0; line < 15; line++) {
    for (const model of [12 + line, 28 + line]) assert.equal(state.hidden.get(uid(model)), true, `model ${model}`);
  }
  assert.equal(state.hidden.get(uid(75)), true, "no previous page");
  assert.equal(state.hidden.get(uid(77)), true, "no next page");
  assert.deepEqual(state.varbits, [[BUSY, 1]]);
  assert.deepEqual(state.animations, [READ]);
  press(player, 7);
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
