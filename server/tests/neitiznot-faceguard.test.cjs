// Run after `yarn build`: node --test tests/neitiznot-faceguard.test.cjs
//
// Flow from rsprox captures 1862 (rev 227.1: Olaf's story, the attach prompt and boxes) and
// 3215 (rev 232.1: Dismantle). Nothing else is asserted: the Wiki's revert-on-PvP-death is not
// captured and not implemented.
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();

const { Item } = require("../dist/game/model/Item");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIdentifiers: I } = require("../dist/util/ItemIdentifiers");
const { NpcIdentifiers } = require("../dist/util/NpcIdentifiers");
const { DialogueChainBuilder } = require("../dist/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../dist/game/model/dialogues/entries/impl/StatementDialogue");
const { ItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { DoubleItemStatementDialogue } = require("../dist/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { EndDialogue } = require("../dist/game/model/dialogues/entries/impl/EndDialogue");

const Faceguard = require("../plugins/items/NeitiznotFaceguard.plugin");

const STORY_CONDITION = "If the player has a basilisk jaw in their inventory and has not learned about the story yet:";
const STORY_ACTION = "(The player can now create Neitiznot faceguards.)";
const UNKNOWN_TEXT = "You're not quite sure how to do that. Perhaps Olaf the Bard can help. He's likely to know a good story about Basilisk Jaws.";
const LEARNED_VARBIT = 9472;

const onItemOnItem = [];
const onItemAction = [];
const conditions = [];
const actions = [];
const persisted = [];
const api = new Proxy({
  core: {
    Item, ItemIdentifiers: I, DialogueChainBuilder, StatementDialogue, ItemStatementDialogue,
    DoubleItemStatementDialogue, EndDialogue, NpcIdentifiers,
  },
  onItemOnItem(first, second, handler, filter) { onItemOnItem.push({ first, second, handler, filter }); },
  onItemAction(name, handlers) { onItemAction.push({ name, handlers }); },
  onNpcDialogueCondition(handler) { conditions.push(handler); },
  onCustomEvent(name, handler) { if (name === "npc-dialogue:action") actions.push(handler); },
  persistAttribute(key, value) { persisted.push([key, value]); },
  sendMultiChatboxPrompt(player, title, ...pairs) {
    player.prompt = {
      title,
      options: pairs.filter((_, i) => i % 2 === 0),
      callbacks: pairs.filter((_, i) => i % 2 === 1),
    };
    return true;
  },
}, { get: (target, property) => (property in target ? target[property] : () => {}) });
Faceguard.register(api);

function createPlayer(ids, { learned = false, free = 10 } = {}) {
  const slots = ids.map((id) => new Item(id, 1));
  const attributes = new Map();
  const inventory = {
    slots,
    get amounts() {
      const totals = new Map();
      for (const entry of slots) if (entry) totals.set(entry.getId(), (totals.get(entry.getId()) ?? 0) + entry.getAmount());
      return totals;
    },
    getItems: () => slots,
    getAmount: (id) => slots.reduce((sum, entry) => sum + (entry && entry.getId() === id ? entry.getAmount() : 0), 0),
    getFreeSlots: () => player.free,
    deleteNumber(id) {
      const at = slots.findIndex((entry) => entry && entry.getId() === id);
      if (at >= 0) slots[at] = null;
    },
    deleteAtSlot(slot) { slots[slot] = null; },
    addItem(item) { slots.push(item); },
  };
  const player = {
    free, inventory, attributes, chains: [], messages: [], varbits: [], removals: 0, prompt: null,
    getInventory: () => inventory,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getDialogueManager: () => ({ startDialogues: (chain) => player.chains.push(chain) }),
    getPacketSender: () => ({
      sendInterfaceRemoval() { player.removals++; },
      sendVarbit(id, value) { player.varbits.push([id, value]); },
    }),
    sendMessage: (message) => player.messages.push(message),
  };
  if (learned) learn(player);
  return player;
}

function learn(player) {
  for (const handler of actions) {
    handler({ player, npcId: NpcIdentifiers.OLAF_THE_BARD, text: STORY_ACTION, stepId: "2-vVl4" });
  }
}

function findHook(usedId, withId) {
  const used = ItemDefinition.forId(usedId).getName();
  const target = ItemDefinition.forId(withId).getName();
  return onItemOnItem.find((r) =>
    (r.first === used && r.second === target) || (r.first === target && r.second === used));
}

// Dispatch the way PluginManager does: find the hook registered for the two item names.
function use(player, usedId, withId) {
  const hook = findHook(usedId, withId);
  assert.ok(hook, `no onItemOnItem hook registered for item ${usedId} + ${withId}`);
  assert.equal(hook.filter?.noted, false, "the combine must not accept noted items");
  const items = player.inventory.slots;
  const usedItem = items.find((entry) => entry && entry.getId() === usedId);
  const usedWithItem = items.find((entry) => entry && entry.getId() === withId);
  hook.handler({ player, usedItem, usedItemId: usedId, usedWithItem, usedWithItemId: withId });
}

function dismantle(player) {
  const registration = onItemAction.find((r) => r.name === "Neitiznot faceguard");
  assert.ok(registration?.handlers?.Dismantle, "no Dismantle option registered for the Neitiznot faceguard");
  registration.handlers.Dismantle({ player, item: new Item(I.NEITIZNOT_FACEGUARD, 1) });
}

const sorted = (player) => [...player.inventory.amounts.entries()].sort((a, b) => a[0] - b[0]);
const entries = (chain) => [...chain.getDialogues().values()];

test("the helm and the jaw are what the issue names", () => {
  assert.equal(ItemDefinition.forId(I.HELM_OF_NEITIZNOT).getName(), "Helm of Neitiznot");
  assert.equal(ItemDefinition.forId(I.BASILISK_JAW).getName(), "Basilisk jaw");
  assert.equal(ItemDefinition.forId(I.NEITIZNOT_FACEGUARD).getName(), "Neitiznot faceguard");
});

test("Olaf's story: the condition is true only with an unlearned jaw, the action learns it", () => {
  const ask = (player, npcId = NpcIdentifiers.OLAF_THE_BARD, text = STORY_CONDITION) =>
    conditions.map((handler) => handler({ player, npcId, text })).find((answer) => answer !== null && answer !== undefined);
  assert.equal(ask(createPlayer([I.BASILISK_JAW])), true);
  assert.equal(ask(createPlayer([])), false, "no jaw");
  assert.equal(ask(createPlayer([I.BASILISK_JAW], { learned: true })), false, "already learned");
  assert.equal(ask(createPlayer([I.BASILISK_JAW]), 1), undefined, "another npc is not answered");
  const player = createPlayer([I.BASILISK_JAW]);
  learn(player);
  assert.deepEqual(player.varbits, [[LEARNED_VARBIT, 1]], "the captured varbit 9472 is set");
  assert.ok(persisted.length >= 1, "the flag is persisted");
});

test("before Olaf's story the combine explains itself and consumes nothing", () => {
  const player = createPlayer([I.HELM_OF_NEITIZNOT, I.BASILISK_JAW]);
  use(player, I.BASILISK_JAW, I.HELM_OF_NEITIZNOT);
  assert.equal(player.prompt, null);
  assert.equal(player.chains.length, 1);
  const [box] = entries(player.chains[0]);
  assert.ok(box instanceof StatementDialogue);
  assert.equal(box.getText(), UNKNOWN_TEXT);
  assert.deepEqual(sorted(player), [[I.HELM_OF_NEITIZNOT, 1], [I.BASILISK_JAW, 1]].sort((a, b) => a[0] - b[0]));
});

for (const [label, order] of [["jaw on helm", [I.BASILISK_JAW, I.HELM_OF_NEITIZNOT]], ["helm on jaw", [I.HELM_OF_NEITIZNOT, I.BASILISK_JAW]]]) {
  test(`${label}: asks, and Yes consumes both and creates one faceguard`, () => {
    const player = createPlayer([I.HELM_OF_NEITIZNOT, I.BASILISK_JAW], { learned: true });
    use(player, order[0], order[1]);
    assert.equal(player.prompt.title, "Attach the jaw to the helmet?");
    assert.deepEqual(player.prompt.options, ["Yes.", "No."]);
    assert.equal(sorted(player).length, 2, "nothing is consumed before Yes");
    player.prompt.callbacks[0]();
    assert.deepEqual(sorted(player), [[I.NEITIZNOT_FACEGUARD, 1]]);
    const [box] = entries(player.chains.at(-1));
    assert.ok(box instanceof ItemStatementDialogue);
    assert.equal(box.getItemId(), I.NEITIZNOT_FACEGUARD);
    assert.equal(box.getText(), "You attach the Basilisk Jaw to the Helm of Neitiznot.");
  });
}

test("No leaves the helm and the jaw alone", () => {
  const player = createPlayer([I.HELM_OF_NEITIZNOT, I.BASILISK_JAW], { learned: true });
  use(player, I.BASILISK_JAW, I.HELM_OF_NEITIZNOT);
  player.prompt.callbacks[1]();
  assert.equal(sorted(player).length, 2);
  assert.ok(!sorted(player).some(([id]) => id === I.NEITIZNOT_FACEGUARD));
});

for (const [label, drop] of [["helm", I.HELM_OF_NEITIZNOT], ["jaw", I.BASILISK_JAW]]) {
  test(`the ${label} dropped after the prompt is re-checked at Yes`, () => {
    const player = createPlayer([I.HELM_OF_NEITIZNOT, I.BASILISK_JAW], { learned: true });
    use(player, I.BASILISK_JAW, I.HELM_OF_NEITIZNOT);
    player.inventory.deleteNumber(drop, 1);
    const left = sorted(player);
    player.prompt.callbacks[0]();
    assert.deepEqual(sorted(player), left);
  });
}

test("a wrong item is not combined with the helm or the jaw", () => {
  assert.equal(findHook(I.HELM_OF_NEITIZNOT, I.DRAGON_BOOTS), undefined);
  assert.equal(findHook(I.BASILISK_JAW, I.DRAGON_BOOTS), undefined);
  assert.equal(findHook(I.HELM_OF_NEITIZNOT, I.NEITIZNOT_FACEGUARD), undefined);
});

test("a noted jaw is the same name but the hook refuses noted items", () => {
  const hook = findHook(I.BASILISK_JAW, I.HELM_OF_NEITIZNOT);
  assert.equal(hook.filter?.noted, false);
  assert.equal(ItemDefinition.forId(I.BASILISK_JAW_2).isNoted(), true);
});

test("Dismantle asks, and Yes returns the helm and the jaw", () => {
  const player = createPlayer([I.NEITIZNOT_FACEGUARD]);
  dismantle(player);
  assert.equal(player.prompt.title, "Remove the jaw from the helmet?");
  assert.deepEqual(player.prompt.options, ["Yes.", "No."]);
  assert.deepEqual(sorted(player), [[I.NEITIZNOT_FACEGUARD, 1]], "nothing happens before Yes");
  player.prompt.callbacks[0]();
  assert.deepEqual(sorted(player), [[I.HELM_OF_NEITIZNOT, 1], [I.BASILISK_JAW, 1]].sort((a, b) => a[0] - b[0]));
  const [box] = entries(player.chains.at(-1));
  assert.ok(box instanceof DoubleItemStatementDialogue);
  assert.deepEqual(box.getItemIds(), [I.HELM_OF_NEITIZNOT, I.BASILISK_JAW]);
  assert.equal(box.getText(), "You remove the Basilisk Jaw from the Neitiznot Faceguard.");
});

test("Dismantle: No keeps the faceguard, a lost faceguard gives nothing, a full inventory refuses", () => {
  const kept = createPlayer([I.NEITIZNOT_FACEGUARD]);
  dismantle(kept);
  kept.prompt.callbacks[1]();
  assert.deepEqual(sorted(kept), [[I.NEITIZNOT_FACEGUARD, 1]]);

  const lost = createPlayer([I.NEITIZNOT_FACEGUARD]);
  dismantle(lost);
  lost.inventory.deleteNumber(I.NEITIZNOT_FACEGUARD, 1);
  lost.prompt.callbacks[0]();
  assert.deepEqual(sorted(lost), []);

  const full = createPlayer([I.NEITIZNOT_FACEGUARD], { free: 0 });
  dismantle(full);
  if (full.prompt) full.prompt.callbacks[0]();
  assert.deepEqual(sorted(full), [[I.NEITIZNOT_FACEGUARD, 1]]);
  assert.ok(full.messages.length >= 1, "the player is told why");
});

test("Dismantle: the inventory filling up before Yes keeps the faceguard and loses nothing", () => {
  const player = createPlayer([I.NEITIZNOT_FACEGUARD], { free: 1 });
  dismantle(player);
  assert.ok(player.prompt, "one free slot is enough to open the prompt");
  player.free = 0;
  player.prompt.callbacks[0]();
  assert.deepEqual(sorted(player), [[I.NEITIZNOT_FACEGUARD, 1]]);
  assert.ok(player.messages.length >= 1, "the player is told why");
});
