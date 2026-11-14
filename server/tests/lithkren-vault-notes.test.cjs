// Run after `yarn build`: node --test tests/lithkren-vault-notes.test.cjs
//
// The Lithkren Vault notes (docs/lithkren-vault-notes.md), from the rsprox.net index: recording
// 722 (each Inspect, the crate's Search, Read on all seven notes, the combine and the book's Read)
// and recording 1528 (note 6 and its repeat). A real Player and the real cache.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const LithkrenVaultNotes = require("../plugins/items/LithkrenVaultNotes.plugin");
const { READING_BOOKS } = require("../plugins/items/ReadingBooks.plugin");

const { SOURCES, COMBINED, FIND_SOUND, COMBINED_ATTRIBUTE, found, nothing, searchForNote, readNote, combineNotes, login } = LithkrenVaultNotes._test;
const NOTE = 291;
const COMBINED_VARBIT = 12134;

let core;
const hooks = { objects: [], items: [], itemOnItem: [] };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const api = PluginManager.createApi("LithkrenVaultNotesTest");
  LithkrenVaultNotes.register(new Proxy(api, {
    get: (target, name) => {
      // Record the hooks and still register them, so dispatch through PluginManager is tested too.
      const record = {
        onObjectInteraction: (objectName, actions) => hooks.objects.push([objectName, Object.keys(actions)]),
        onItemAction: (itemName, actions) => hooks.items.push([itemName, Object.keys(actions)]),
        onItemOnItem: (a, b) => hooks.itemOnItem.push([a, b]),
      }[name];
      if (!record) return target[name];
      return (...args) => { record(...args); return target[name](...args); };
    },
  }));
});

const obj = (gameval) => core.CacheDefinitions.getObjId(gameval);
const loc = (gameval) => core.CacheDefinitions.getLocId(gameval);

function fixture(t, items = []) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  for (const [slot, gameval] of items) player.getInventory().setItem(slot, new core.Item(obj(gameval), 1));
  const boxes = [];
  t.mock.method(player.getDialogueManager(), "startDialogues", (chain) => {
    const first = chain.getDialogues().get(0);
    boxes.push({ text: first.getText?.(), item: first.getItemId?.() ?? null });
  });
  const messages = [];
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  const sender = player.getPacketSender();
  const sounds = [];
  t.mock.method(sender, "sendSound", (id) => { sounds.push(id); return sender; });
  const strings = new Map();
  t.mock.method(sender, "sendString", (text, id) => { strings.set(id, text); return sender; });
  const opened = [];
  t.mock.method(sender, "sendInterface", (id) => { opened.push(id); return sender; });
  const varbits = [];
  t.mock.method(sender, "sendVarbit", (id, value) => { varbits.push([id, value]); return sender; });
  const ids = () => player.getInventory().getItems().map((item) => item?.getId() ?? -1);
  return { player, boxes, messages, sounds, strings, opened, varbits, ids };
}

test("hooks the cache names and options of every note loc", () => {
  for (const { loc: gameval } of SOURCES) {
    const definition = core.ObjectDefinition.forId(loc(gameval));
    const hook = hooks.objects.find(([name]) => name === definition.getName());
    assert.ok(hook, gameval);
    assert.ok(definition.getInteractions().includes(hook[1][0]), `${gameval} ${hook[1][0]}`);
  }
  assert.deepEqual(hooks.itemOnItem, [["Old notes", "Old notes"]]);
  assert.deepEqual(hooks.items, [["Old notes", ["Read"]]]);
});

test("each loc gives its own note with sound 2582 and an item box (rec 722, rec 1528)", (t) => {
  for (const source of SOURCES) {
    const f = fixture(t);
    assert.equal(searchForNote({ player: f.player, objectId: loc(source.loc) }), true);
    assert.equal(f.ids().filter((id) => id === obj(source.note)).length, 1, source.loc);
    assert.deepEqual(f.sounds, [FIND_SOUND]);
    assert.deepEqual(f.boxes, [{ text: found(source.place), item: obj(source.note) }]);
    // The item box writes its own mesbox chat line; live sends no separate game message (rec 722).
    assert.deepEqual(f.messages, []);
  }
  assert.equal(found("incubator"), "You find some notes next to the incubator.");
  assert.equal(found("crate"), "You find some notes in the crate.");
  assert.equal(nothing("crate"), "You search the crate, but find nothing of interest.", "rec 722");
});

test("a second Inspect while carrying the note finds nothing (rec 722 tick 17, rec 1528 tick 19)", (t) => {
  const f = fixture(t, [[0, "ds2_lithkren_notes_5"]]);
  searchForNote({ player: f.player, objectId: loc("lithkren_vault_machine_notes_5") });
  assert.deepEqual(f.messages, ["You inspect the incubator, but find nothing of interest."]);
  assert.equal(nothing("machinery"), "You inspect the machinery, but find nothing of interest.");
  assert.deepEqual(f.boxes, []);
  assert.deepEqual(f.sounds, []);
  assert.equal(f.ids().filter((id) => id === obj("ds2_lithkren_notes_5")).length, 1);

  const book = fixture(t, [[0, "ds2_lithkren_notes_complete"]]);
  searchForNote({ player: book.player, objectId: loc("lithkren_vault_machine_notes") });
  assert.equal(book.ids().includes(obj("ds2_lithkren_notes_1")), false, "the combined book already holds the notes");
});

test("other locs with the same names fall through", (t) => {
  const f = fixture(t);
  assert.equal(searchForNote({ player: f.player, objectId: loc("ds2_lithkren_vault_machine01") }), false);
});

test("Read opens interface 291 with the captured lines (rec 722 ticks 586-1281)", (t) => {
  const f = fixture(t, [[0, "ds2_lithkren_notes_4"]]);
  assert.equal(readNote({ player: f.player, itemId: obj("ds2_lithkren_notes_4") }), true);
  assert.deepEqual(f.opened, [NOTE]);
  assert.equal(f.strings.get((NOTE << 16) | 6), "I am making good progress. So much so that I've");
  assert.equal(f.strings.get((NOTE << 16) | 14), "this could be a difficult process.");
  assert.equal(f.strings.get((NOTE << 16) | 16), "");
  assert.equal(f.strings.size, 12);
  assert.equal(readNote({ player: f.player, itemId: core.ItemIdentifiers.OLD_NOTES_30 }), false, "other quests' Old notes fall through");
});

test("one note on another with all seven makes the book and sets ds2_lithkren_notes (rec 722 tick 1434)", (t) => {
  const f = fixture(t, [[0, "coins"], ...SOURCES.map((source, i) => [i + 1, source.note])]);
  const event = { player: f.player, usedItemId: obj("ds2_lithkren_notes_5"), usedWithItemId: obj("ds2_lithkren_notes_4") };
  assert.equal(combineNotes(event), true);
  assert.equal(f.ids()[1], obj("ds2_lithkren_notes_complete"), "the book takes the first freed slot");
  assert.equal(SOURCES.some((source) => f.ids().includes(obj(source.note))), false);
  assert.deepEqual(f.varbits, [[COMBINED_VARBIT, 1]]);
  assert.deepEqual(f.boxes, [{ text: COMBINED, item: obj("ds2_lithkren_notes_complete") }]);
  assert.equal(f.player.getAttribute(COMBINED_ATTRIBUTE), 1);
  assert.deepEqual(f.messages, [], "the combine line is the item box's mesbox only");

  f.varbits.length = 0;
  login({ player: f.player });
  assert.deepEqual(f.varbits, [[COMBINED_VARBIT, 1]], "the varbit is sent again at login");
});

test("without all seven the notes do not combine", (t) => {
  const f = fixture(t, SOURCES.slice(0, 6).map((source, i) => [i, source.note]));
  assert.equal(combineNotes({ player: f.player, usedItemId: obj("ds2_lithkren_notes_1"), usedWithItemId: obj("ds2_lithkren_notes_2") }), false);
  assert.deepEqual(f.varbits, []);
  assert.equal(f.ids().includes(obj("ds2_lithkren_notes_complete")), false);
});

test("the book reads as Lithkren Lab Notes over five spreads (rec 722 ticks 1717-1723)", () => {
  const book = READING_BOOKS.find((entry) => entry.name === "Lithkren vault notes");
  assert.equal(book.title, "Lithkren Lab Notes");
  assert.equal(book.pages.length, 5);
  assert.equal(book.pages[0][44], "She came to Lithkren.");
  assert.equal(book.pages[4][56], "has nearly destroyed us.");
  assert.equal(core.CacheDefinitions.getObjId("ds2_lithkren_notes_complete"), 25704);
  assert.equal(core.ItemDefinition.forId(25704).getName(), "Lithkren vault notes");
});

test("Read dispatches through PluginManager: ours opens 291, other quests' Old notes are left alone", (t) => {
  const f = fixture(t, [[0, "ds2_lithkren_notes_4"], [1, "ds2_lithkren_notes_7"]]);
  const read = (id) => core.CacheDefinitions.getItem(id).inventoryActions.indexOf("Read") + 1;
  const event = (slot) => ({ player: f.player, interfaceId: 149, item: f.player.getInventory().getItems()[slot], itemId: f.ids()[slot], slot, clickType: read(f.ids()[slot]), handled: false });
  assert.equal(PluginManager.emitItemAction(event(0)), true);
  assert.deepEqual(f.opened, [NOTE]);
  f.player.getInventory().setItem(2, new core.Item(core.ItemIdentifiers.OLD_NOTES_30, 1));
  PluginManager.emitItemAction(event(2));
  assert.equal(f.opened.length, 1, "our handler does not open 291 for Forsaken Tower's notes");
});
