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
    "Journal page": "Journal Page",
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

test("the Journal page is one spread with its text on the left page and no page buttons (rsprox 231/00392 tick 8232)", () => {
  const { player, state } = reader();
  itemActions.get("Journal page").Read({ player });
  assert.equal(state.texts.get(uid(9)), "1");
  assert.equal(state.texts.get(uid(10)), "2");
  assert.equal(state.texts.get(uid(44)), "From the stadium to");
  assert.equal(state.texts.get(uid(58)), "sure...");
  for (let line = 60; line < 75; line++) assert.equal(state.texts.get(uid(line)), "", `right line ${line}`);
  assert.equal(state.hidden.get(uid(77)), true, "no next page");
  assert.equal(state.hidden.get(uid(75)), true, "no previous page");
  for (let model = 12; model <= 42; model++) if (model !== 27) assert.equal(state.hidden.get(uid(model)), true);
  press(player, 7);
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

test("the Elixir of Everlasting opens the long scroll with its title and entries (rec 392 tick 523)", () => {
  const { player, state } = reader();
  assert.deepEqual(Object.keys(itemActions.get("Elixir of Everlasting")), ["Read"]);
  itemActions.get("Elixir of Everlasting").Read({ player });
  assert.equal(state.open, 625);
  // Rev 231's capture sends no busy; the shared long scroll sets it as rev 239's poem scroll capture does.
  assert.deepEqual(state.order.slice(0, 4), [["varbit", BUSY, 1], ["script", 2524, [-1, -1]], ["open", 625], ["script", 418]]);
  const [[, title, text]] = state.scripts;
  assert.equal(title, "Elixir of Everlasting");
  assert.ok(text.startsWith("~ Entry 1 ~<br><br>After weeks of searching"));
  assert.ok(text.endsWith("<col=252a25>~ the rest of the page is missing ~</col>"));
  assert.deepEqual(state.animations, [], "no reading animation on the scroll");
});

test("the Crombwick deed writes all twelve handwritten lines before the scroll opens (rec 391 tick 4736)", () => {
  const { player, state } = reader();
  itemActions.get("Deed").Read({ player });
  assert.equal(state.open, 95);
  const line = (n) => state.texts.get((95 << 16) | n);
  assert.equal(line(1), "");
  assert.equal(line(2), "To commemorate loyalty");
  assert.equal(line(5), "<col=800080>Ichabod Crombwick</col>");
  assert.equal(line(11), "Dated: <col=800080>4A, 661, 38th of Septober</col>");
  assert.equal(line(12), "");
  assert.equal(state.texts.size, 12);
  assert.deepEqual(state.order, [["script", 2524, [-1, -1]], ["open", 95]]);
  assert.deepEqual(state.animations, []);
});

test("the Entomologist's diary reads as Buggie's Diary across three spreads (#6871)", () => {
  const { player, state } = reader();
  assert.deepEqual(Object.keys(itemActions.get("Entomologist's diary")), ["Read"]);
  itemActions.get("Entomologist's diary").Read({ player });
  assert.equal(state.open, BOOK);
  assert.equal(state.texts.get(uid(6)), "Buggie's Diary");
  assert.deepEqual(state.animations, [READ]);
  assert.equal(state.texts.get(uid(9)), "1");
  assert.equal(state.texts.get(uid(10)), "2");
  assert.equal(state.texts.get(uid(44)), "They've laughed at me for");
  assert.equal(state.texts.get(uid(58)), "idiots who run the zoo just", "page 1 ends mid-sentence, as live's does");
  assert.equal(state.texts.get(uid(60)), "laughed at me! They like");
  assert.equal(state.texts.get(uid(74)), "got really thirsty trying to");
  press(player, 77);
  assert.equal(state.texts.get(uid(9)), "3");
  assert.equal(state.texts.get(uid(44)), "find their hive in the desert,");
  press(player, 77);
  assert.equal(state.texts.get(uid(9)), "5");
  assert.equal(state.texts.get(uid(60)), "The dizziness is getting");
  assert.equal(state.texts.get(uid(67)), "I've lost my dolphin.");
  assert.equal(state.texts.get(uid(68)), "", "page 6 ends early");
  assert.equal(state.hidden.get(uid(77)), true, "no fourth spread");
  press(player, 7);
});

test("The Grand Tree and The Hand in the Sand documents have a Read option with the Wiki's text (#6544, #6542)", () => {
  const scrolls = {
    "Hazelmere's scroll": /^Es lemanto meso pro eis prit ta Cinqo mond\.<br>Mi lovos te lemanto Daconia arpos<br>et Daconia arpos eto meriz ta priwl!$/,
    "Invasion plans": /Troops board three fleets of battleships at Karamja\..*Take no prisoners!/,
    "Lumber order": /^Karamja shipyard<br><br>Order<br>Order for 30 Karamja battleships<br>Lumber required: 2000<br>Troop capacity: 300$/,
    "Bert's rota": /Bert's Rota - Copy<br><br>(Week \d - 6am-10pm - 50gps<br>){5}Week 6 - 6am-10pm - 50gps$/,
    "Sandy's rota": /Bert's Rota - Original<br><br>(Week \d - 9am-6pm - 50gps<br>){5}Week 6 - 6am-10pm - 50gps$/,
  };
  for (const [name, text] of Object.entries(scrolls)) {
    const { player, state } = reader();
    assert.deepEqual(Object.keys(itemActions.get(name)), ["Read"], name);
    itemActions.get(name).Read({ player });
    assert.equal(state.open, 625, name);
    assert.match(state.scripts[0][2], text, name);
    for (const handler of events.get("interface:closed") ?? []) handler({ player, interfaceId: 625 });
  }
  for (const [name, title, spreads] of [["Translation book", "Gnome-English Translation", 3], ["Glough's journal", "Glough's Journal", 2]]) {
    const { player, state } = reader();
    itemActions.get(name).Read({ player });
    assert.equal(state.open, BOOK, name);
    assert.equal(state.texts.get(uid(6)), title);
    for (let spread = 1; spread < spreads; spread++) press(player, 77);
    assert.equal(state.hidden.get(uid(77)), true, `${name}: no spread after ${spreads}`);
    press(player, 7);
  }
});
