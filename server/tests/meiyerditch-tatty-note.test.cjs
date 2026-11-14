const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const SKELETON = 38091;
const NOTE = 24684;
const objectHooks = new Map();
const itemHooks = new Map();

class Item {
  constructor(id, amount) { this.id = id; this.amount = amount; }
}
class DialogueChainBuilder {
  constructor() { this.dialogues = []; }
  add(dialogue) { this.dialogues.push(dialogue); return this; }
}
class ItemStatementDialogue {
  constructor(index, itemId, text) { Object.assign(this, { index, itemId, text }); }
}

const api = new Proxy({
  core: { Item, DialogueChainBuilder, ItemStatementDialogue },
  onObjectInteraction: (name, actions) => objectHooks.set(name, actions),
  onItemAction: (name, actions) => itemHooks.set(name, actions),
}, { get: (target, key) => target[key] ?? (() => {}) });

let plugin;
before(() => {
  plugin = require("../plugins/items/MeiyerditchTattyNote.plugin");
  plugin.register(api);
});

function searcher({ items = [], free = 28 } = {}) {
  const state = { messages: [], added: [], dialogues: [], interface: -1, scripts: [] };
  const sender = {
    sendInterface: (id) => { state.interface = id; return sender; },
    sendClientScript: (id, ...args) => { state.scripts.push([id, ...args]); return sender; },
  };
  const player = {
    sendMessage: (text) => state.messages.push(text),
    getInventory: () => ({
      contains: (id) => items.includes(id),
      getFreeSlots: () => free,
      addItem: (item) => { state.added.push(item); items.push(item.id); },
    }),
    getDialogueManager: () => ({ startDialogues: (chain) => state.dialogues.push(...chain.dialogues) }),
    getPacketSender: () => sender,
  };
  return { player, state };
}

const search = (player, objectId = SKELETON) => objectHooks.get("Skeleton").Search({ player, objectId });

test("Search on the laboratory skeleton gives the tatty note with an objectbox of it (rec 395 t23978)", () => {
  const { player, state } = searcher();
  assert.equal(search(player), true);
  assert.deepEqual(state.added.map(({ id, amount }) => [id, amount]), [[NOTE, 1]]);
  assert.equal(state.dialogues.length, 1);
  assert.equal(state.dialogues[0].itemId, NOTE);
  assert.equal(state.dialogues[0].text, "You find a note by the skeleton which you take.");
  assert.deepEqual(state.messages, []);
});

test("Searching again with the note in the backpack finds nothing (rec 395 t24049)", () => {
  const { player, state } = searcher();
  search(player);
  search(player);
  assert.equal(state.added.length, 1);
  assert.deepEqual(state.messages, ["You search the skeleton, but find nothing of interest."]);
});

test("a full backpack gets no note", () => {
  const { player, state } = searcher({ free: 0 });
  assert.equal(search(player), true);
  assert.deepEqual(state.added, []);
  assert.deepEqual(state.dialogues, []);
  assert.deepEqual(state.messages, ["You don't have enough inventory space."]);
});

test("other skeletons fall through to their own handlers", () => {
  const { player, state } = searcher();
  assert.equal(search(player, 38090), false);
  assert.deepEqual(state.added, []);
  assert.deepEqual(state.messages, []);
});

test("Read opens the long scroll with an empty title and the captured text (rec 395 t24079)", () => {
  const { player, state } = searcher({ items: [NOTE] });
  assert.equal(itemHooks.get("Tatty note").Read({ player, itemId: NOTE }), true);
  assert.equal(state.interface, 625);
  assert.equal(state.scripts.length, 1);
  const [script, title, text] = state.scripts[0];
  assert.equal(script, 418);
  assert.equal(title, "");
  assert.ok(text.startsWith("He stabbed me! He actually stabbed me!"));
  assert.ok(text.includes("unexplored tunnels.<br><br>Well, there you have it."));
  assert.ok(text.endsWith("There's a darkness here that should remain hidden."));
  assert.equal(text.split("<br><br>").length, 5);
});

test("Read leaves the other tatty notes (A Kingdom Divided's 23007) alone", () => {
  const { player, state } = searcher();
  assert.equal(itemHooks.get("Tatty note").Read({ player, itemId: 23007 }), false);
  assert.equal(state.interface, -1);
});
