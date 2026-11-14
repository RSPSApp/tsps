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
// Ids as the rev 231 captures name them (rsprox 391, 392).
const INTERFACES = { longscroll: 625, messagescroll_handwriting_2: 95 };
const CacheDefinitions = {
  getInterfaceId: (gameval) => INTERFACES[gameval],
  getComponentId: (name) => {
    const [group, component] = name.split(":");
    return (INTERFACES[group] << 16) | Number(/^messagescroll(\d+)_hw$/.exec(component)[1]);
  },
};
const api = new Proxy({
  core: { Animation, Graphic: class { constructor(id) { this.id = id; } }, CacheDefinitions },
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onInterfaceActionButton: (ids, handler) => ids.forEach((id) => buttons.set(id, handler)),
  onCustomEvent: (name, handler) => events.set(name, [...(events.get(name) ?? []), handler]),
}, { get: (target, key) => target[key] ?? (() => {}) });

before(() => {
  runtime.registerQuest(api, { key: "reading-books-fixture", name: "Reading Books Fixture" });
  require("../plugins/items/ReadingBooks.plugin").register(api);
});

function reader() {
  const state = { open: -1, texts: new Map(), hidden: new Map(), objects: new Map(), varbits: [], animations: [], sent: [] };
  const sender = {
    sendInterface: (group) => { state.open = group; state.sent.push(["open", group]); return sender; },
    sendString: (text, id) => { state.texts.set(id, text); state.sent.push(["text", id]); return sender; },
    sendInterfaceDisplayState: (id, hide) => { state.hidden.set(id, hide); return sender; },
    sendItemOnInterface: (id, item, _slot, zoom) => { state.objects.set(id, { item, zoom }); return sender; },
    sendInterfaceScript: (id, args) => { state.sent.push(["script", id, args]); return sender; },
    sendClientScript: (id, ...args) => { state.sent.push(["script", id, args]); return sender; },
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

test("the Slepe Sisterhood books open in the book viewer with live's titles and run to their last spread", () => {
  const books = { "The Turncloak": ["The Turncloak", 3], "Explosive Discovery": ["Explosive Discovery", 2], "Bloody grimoire": ["Bloody Grimoire", 4] };
  for (const [name, [title, spreads]] of Object.entries(books)) {
    const { player, state } = reader();
    itemActions.get(name).Read({ player });
    assert.equal(state.open, BOOK, name);
    assert.equal(state.texts.get(uid(6)), title);
    assert.deepEqual(state.animations, [READ]);
    for (let spread = 1; spread < spreads; spread++) press(player, 77);
    assert.equal(state.texts.get(uid(9)), String(spreads * 2 - 1), name);
    assert.equal(state.hidden.get(uid(77)), true, `${name} has no page after ${spreads * 2}`);
    press(player, 7);
  }

  const grimoire = reader();
  itemActions.get("Bloody grimoire").Read({ player: grimoire.player });
  assert.equal(grimoire.state.texts.get(uid(44)), "An evil has swept into our");
  assert.equal(grimoire.state.texts.get(uid(60)), "their wounds, while the light");
  for (let spread = 1; spread < 4; spread++) press(grimoire.player, 77);
  assert.equal(grimoire.state.texts.get(uid(44)), "<str>Vigour Potion", "each spread has its own lines");
  press(grimoire.player, 7);
});

test("the Elixir of Everlasting opens the long scroll with its title and entries", () => {
  const { player, state } = reader();
  assert.deepEqual(Object.keys(itemActions.get("Elixir of Everlasting")), ["Read"]);
  itemActions.get("Elixir of Everlasting").Read({ player });
  assert.equal(state.open, 625);
  const [mainmodal, open, [, setup, [title, text]]] = state.sent;
  assert.deepEqual(mainmodal, ["script", 2524, [-1, -1]]);
  assert.deepEqual(open, ["open", 625]);
  assert.equal(setup, 418);
  assert.equal(title, "Elixir of Everlasting");
  assert.ok(text.startsWith("~ Entry 1 ~<br><br>After weeks of searching"));
  assert.ok(text.endsWith("<col=252a25>~ the rest of the page is missing ~</col>"));
  assert.deepEqual(state.animations, [], "no reading animation on the scroll");
});

test("the Crombwick deed writes all twelve handwritten lines before the scroll opens", () => {
  const { player, state } = reader();
  itemActions.get("Deed").Read({ player });
  assert.equal(state.open, 95);
  const line = (n) => state.texts.get((95 << 16) | n);
  assert.equal(line(1), "");
  assert.equal(line(2), "To commemorate loyalty");
  assert.equal(line(5), "<col=800080>Ichabod Crombwick</col>");
  assert.equal(line(11), "Dated: <col=800080>4A, 661, 38th of Septober</col>");
  assert.equal(line(12), "");
  assert.equal(state.sent.length, 14);
  assert.deepEqual(state.sent.slice(12), [["script", 2524, [-1, -1]], ["open", 95]]);
  assert.deepEqual(state.animations, []);
});
