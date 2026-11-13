const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test, before } = require("node:test");
const path = require("node:path");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ItemActionPacketListener } = require("../dist/net/packet/impl/ItemActionPacketListener");
const runtime = require("../plugins/quests/QuestRuntime");
const buttons = new Map();
const itemActions = new Map();
const api = new Proxy({
  core: { Animation: class { constructor(id) { this.id = id; } }, Graphic: class { constructor(id) { this.id = id; } } },
  onItemAction: (name, actions) => itemActions.set(name, actions),
  onInterfaceActionButton: (ids, handler) => ids.forEach(id => buttons.set(id, handler)),
}, { get: (target, key) => target[key] ?? (() => {}) });
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  runtime.registerQuest(api, { key: "book-ui-fixture", name: "Book UI Fixture" });
});
test("Goblin book Read uses the shared book UI, turns pages and closes without consuming anything", () => {
  const plugin = require("../plugins/items/GoblinBook.plugin");
  assert.equal(plugin.members, true);
  plugin.register(api);
  const actions = itemActions.get("Goblin book");
  assert.deepEqual(Object.keys(actions), ["Read"]);
  const inventory = [{ id: 10999, amount: 1 }];
  const initial = structuredClone(inventory);
  let open = -1;
  const texts = new Map();
  const hidden = new Map();
  const varbits = [];
  const animations = [];
  const sender = {
    sendInterface: (group) => { open = group; return sender; },
    sendString: (text, uid) => { texts.set(uid, text); return sender; },
    sendInterfaceDisplayState: (uid, hide) => { hidden.set(uid, hide); return sender; },
    sendInterfaceScript: () => sender,
    sendConfig: () => sender,
    sendVarbit: (id, value) => { varbits.push([id, value]); return sender; },
    sendInterfaceRemoval: () => { open = -1; return sender; },
  };
  const player = { getPacketSender: () => sender, getInventory: () => inventory, performAnimation: (a) => animations.push(a.id) };
  actions.Read({ player, itemId: 10999 });
  assert.equal(open, 392);
  assert.deepEqual(varbits, [[12393, 1]], "reading sets busy");
  assert.deepEqual(animations, [1350], "and plays human_readbook");
  assert.match(texts.get((392 << 16) | 6), /Big High War God/);
  assert.equal(texts.get((392 << 16) | 9), "1");
  assert.equal(hidden.get((392 << 16) | 75), true);
  const first = texts.get((392 << 16) | 44);
  buttons.get((392 << 16) | 77)({ player, buttonId: (392 << 16) | 77 });
  assert.equal(texts.get((392 << 16) | 9), "3");
  assert.notEqual(texts.get((392 << 16) | 44), first);
  buttons.get((392 << 16) | 77)({ player, buttonId: (392 << 16) | 77 });
  assert.equal(texts.get((392 << 16) | 9), "5");
  assert.equal(hidden.get((392 << 16) | 77), false);
  for (const page of [7, 9, 11]) {
    buttons.get((392 << 16) | 77)({ player, buttonId: (392 << 16) | 77 });
    assert.equal(texts.get((392 << 16) | 9), String(page));
    assert.equal(texts.get((392 << 16) | 10), String(page + 1));
  }
  assert.equal(hidden.get((392 << 16) | 77), true);
  assert.equal(texts.get((392 << 16) | 60), "end in victory and victory");
  assert.equal(texts.get((392 << 16) | 74), "", "short pages clear the previous page's final line");
  buttons.get((392 << 16) | 77)({ player, buttonId: (392 << 16) | 77 });
  assert.equal(texts.get((392 << 16) | 9), "11", "forged next at the last spread stays in bounds");
  buttons.get((392 << 16) | 75)({ player, buttonId: (392 << 16) | 75 });
  assert.equal(texts.get((392 << 16) | 9), "9");
  buttons.get((392 << 16) | 7)({ player, buttonId: (392 << 16) | 7 });
  assert.equal(open, -1);
  assert.deepEqual(varbits.at(-1), [12393, 0], "closing clears busy");
  assert.equal(animations.at(-1), -1, "and resets the reading animation");
  actions.Read({ player, itemId: 10999 });
  assert.equal(texts.get((392 << 16) | 9), "1", "reopening starts at the beginning");
  buttons.get((392 << 16) | 75)({ player, buttonId: (392 << 16) | 75 });
  assert.equal(texts.get((392 << 16) | 9), "1", "forged previous at the first spread stays in bounds");
  assert.deepEqual(inventory, initial);
});

test("the twelve supplied pages retain their screenshot boundaries and section headings", () => {
  const book = require("../plugins/items/data/goblin-book");
  assert.equal(book.pages.length, 6);
  const boundaries = [
    ["The Creation of the Goblins", "Then Big High War God go", "to demons and ask, Will you", "but none of us fight for you!"],
    ["Big High War God very sad.", "He give them good armour", "so they not be harmed. He", "War God take some tribes"],
    ["and sell them, one to God of", "War God who created them!", "The Several Commandments", "Cowards must die!"],
    ["Not to show mercy. Merciful", "Thinkers must die!", "The end of the war and the", "true soldiers like goblins! But"],
    ["now goblins not have enough", "Then Hopespear of the", "Narogoshuun tribe have", "tribe. Goblins must find other"],
    ["enemies to fight, but not fight", "and rule over all. War will", "end in victory and victory", "sacrifices."],
  ];
  const plain = text => text.replace(/<[^>]+>/g, "");
  book.pages.forEach((spread, index) => {
    const left = [], right = [];
    for (const [key, text] of Object.entries(spread)) {
      const component = Number(key);
      assert.ok(component >= 44 && component <= 58 || component >= 60 && component <= 74);
      (component < 60 ? left : right).push(plain(text));
    }
    assert.deepEqual([left[0], left.filter(Boolean).at(-1), right[0], right.filter(Boolean).at(-1)], boundaries[index]);
  });
  assert.match(book.pages[0][44], /^<col=800000>The Creation of the Goblins<\/col>$/);
  assert.match(book.pages[2][60], /^<col=800000>The Several Commandments<\/col>$/);
  assert.match(book.pages[3][60], /^<col=800000>The end of the war and the<\/col>$/);
  assert.match(book.pages[3][61], /^<col=800000>prophecy<\/col>$/);
});
test("cache inventory operations expose Read only on the actual book", () => {
  assert.deepEqual(ItemActionPacketListener.resolveInventoryWidgetAction(10999, 2), { optionIndex: 1, option: "Read" });
  assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(11000, 2), null);
  assert.equal(ItemActionPacketListener.resolveInventoryWidgetAction(17850, 2), null);
});

test("the paginated book reproduces the complete reporter-supplied transcript", () => {
  const book = require("../plugins/items/data/goblin-book");
  const transcript = fs.readFileSync(path.join(__dirname, "fixtures/goblin-book-transcript.txt"), "utf8");
  const normalize = text => text.replace(/<[^>]+>/g, "").replace(/-\s+/g, "-").replace(/\s+/g, " ").trim();
  const displayed = book.pages.flatMap(spread => Object.values(spread)).join(" ");
  assert.equal(normalize(displayed), normalize(transcript));
});
