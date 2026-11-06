const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
require("../dist/Server").Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const core = PluginManager.getCoreApi();
const SAND_ITEM_ID = core.ItemIdentifiers.BUCKET_OF_SAND;
const EMPTY_BUCKET_ITEM_ID = core.ItemIdentifiers.BUCKET;
const YANILLE_SAND_PIT_OBJECT_ID = core.ObjectIdentifiers.SANDPIT;
const plugin = require("../plugins/achievements/diaries/ArdougneBertSandDiary.plugin");
const dialogueData = require("../data/definitions/npc-dialogues.json").Bert.variants;

const hooks = {};
const events = {};
const persistedAttributes = [];
const conditionTransitions = [];
const api = PluginManager.createApi("ArdougneBertSandDiaryTest");
const npcActions = {};
let itemOnObject;
let itemOnObjectFilter;
api.onNpcDialogueVariant = (handler) => (hooks.variant ??= []).push(handler);
api.onNpcDialogueCondition = (handler) => (hooks.condition ??= []).push(handler);
api.onNpcInteraction = (name, actions) => { npcActions[name] = actions; };
api.onItemOnObject = (handler, filter) => { itemOnObject = handler; itemOnObjectFilter = filter; };
api.onCustomEvent = (key, handler) => ((events[key] ??= []).push(handler));
api.emitCustomEvent = (key, event) => {
  if (key === "npc-dialogue:condition") conditionTransitions.push({ npcId: event.npcId, stepId: event.stepId, text: event.text });
  (events[key] ?? []).forEach((handler) => handler(event));
};
api.sendMultiChatboxPrompt = (player, title, ...pairs) => {
  player.bertPrompt = { title, pairs };
  return true;
};
PluginManager.emitNpcDialogueCondition = (event) => {
  for (const handler of hooks.condition ?? []) {
    const answer = handler(event);
    if (answer !== null && answer !== undefined) return answer;
  }
  return null;
};
api.persistAttribute = (key, initialValue) => {
  persistedAttributes.push([key, initialValue]);
  PlayerSave.persistAttribute(key, initialValue);
};
api.core = core;
let clock = new Date("2026-11-03T23:59:59.999Z");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
});

let nextPlayerIndex = 3100;
function realPlayer(t, name = "bert-sand-test") {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(nextPlayerIndex++);
  player.setUsername(`${name}${nextPlayerIndex}`);
  player.setRegistered(true);
  player.setLocation(new core.Location(2551, 3099, 0));
  player.needsPlacement = false;
  player.setAttribute(plugin._test.QUEST_STAGE_ATTRIBUTE, 160);
  player.setAttribute("ironman:mode", "normal");
  player.getBank(0);
  t.after(() => {
    player.setRegistered(false);
    core.TaskManager.cancelTasks(player.getIndex());
  });
  return player;
}

const emittedTasks = [];
api.onCustomEvent("diary:task", (event) => emittedTasks.push(event));
plugin.register(api, { now: () => new Date(clock) });

function makeBank({ amount = 0, free = 1 } = {}) {
  return {
    amount,
    free,
    getAmount(id) { return id === SAND_ITEM_ID ? this.amount : 0; },
    getFreeSlots() { return this.free; },
    getAddableAmount(item) {
      if (this.amount > 0) return Math.min(item.getAmount(), 0x7fffffff - this.amount);
      return this.free > 0 ? item.getAmount() : 0;
    },
    add(item) {
      const amount = this.getAddableAmount(item);
      this.amount += Math.min(amount, item.getAmount());
      this.free = 0;
    },
    deleteNumber(_id, amount) { this.amount -= amount; },
  };
}

function makePlayer({ complete = true, tabs = [makeBank()], mode = "normal", lastDelivery = null, introSeen = true } = {}) {
  const attributes = new Map([
    [plugin._test.QUEST_STAGE_ATTRIBUTE, complete ? 160 : 0],
    [plugin._test.INTRO_SEEN_ATTRIBUTE, introSeen],
    [plugin._test.LAST_DELIVERY_ATTRIBUTE, lastDelivery],
    ["ironman:mode", mode],
  ]);
  return {
    tabs,
    getAttribute(key) { return attributes.get(key); },
    setAttribute(key, value) { attributes.set(key, value); },
    getBanks() { return tabs; },
    sendMessage() {},
    attributes,
  };
}

function selectedVariant(player, npcId = core.NpcIdentifiers.BERT) {
  return hooks.variant.map((handler) => handler({ player, npcId })).find(Boolean) ?? null;
}

function chooseSandDelivery(player, npcId = core.NpcIdentifiers.BERT_2) {
  const event = { player, npcId, stepId: plugin._test.BANK_SPACE_CONDITION_ID };
  events["npc-dialogue:condition"].forEach((handler) => handler(event));
  return event;
}

function advanceToPromptOrEnd(player, limit = 500) {
  while (limit-- > 0) {
    if (player.bertPrompt) return;
    const current = player.getDialogueManager().getCurrent();
    if (!current) return;
    player.getDialogueManager().advance();
  }
  assert.fail("Bert's transcript did not reach a prompt or end");
}

function choosePrompt(player, text) {
  const prompt = player.bertPrompt;
  assert.ok(prompt, "Bert's transcript should present a menu");
  const index = prompt.pairs.findIndex((value, i) => i % 2 === 0 && value === text);
  assert.notEqual(index, -1, `missing option ${text}`);
  player.bertPrompt = null;
  prompt.pairs[index + 1]();
}

test("Bert's production post-quest dialogue delivers sand once per UTC day", async () => {
  const welcome = dialogueData[plugin._test.INTRO_VARIANT];
  assert.ok(welcome.some((step) => step.id === plugin._test.INTRO_MESSAGE_ID));
  const daily = dialogueData[plugin._test.DAILY_VARIANT];
  const optionTexts = daily.flatMap((step) => step.options ?? []).map((option) => option.text);
  assert.ok(optionTexts.includes("Can you deliver my sand to my bank, please?"));

  const player = makePlayer({ introSeen: false });
  assert.equal(selectedVariant(player), plugin._test.INTRO_VARIANT);
  assert.equal(selectedVariant(player, core.NpcIdentifiers.BERT_2), plugin._test.INTRO_VARIANT);
  assert.equal(selectedVariant(makePlayer({ complete: false })), null, "Bert's post-quest dialogue is unavailable before quest completion");
  events["npc-dialogue:action"].forEach((handler) => handler({ player, stepId: plugin._test.INTRO_MESSAGE_ID }));
  assert.equal(selectedVariant(player), plugin._test.DAILY_VARIANT);

  const targetBank = player.tabs[0];
  chooseSandDelivery(player);
  assert.equal(targetBank.amount, 84);
  assert.equal(emittedTasks.at(-1).task, "claim-buckets-of-sand-from-bert-in-yanille");
  chooseSandDelivery(player);
  assert.equal(targetBank.amount, 84, "duplicate callbacks do not pay twice");
  assert.equal(emittedTasks.length, 1);

  clock = new Date(clock.getTime() + 1);
  assert.equal(plugin._test.today(() => clock), "2026-11-04", "the clock crossed midnight UTC");
  chooseSandDelivery(player);
  assert.equal(targetBank.amount, 168, "a new UTC date permits another delivery");
});

test("Bert's delivery uses existing bank stacks and checks real bank space", () => {
  const existingStack = makeBank({ amount: 5, free: 0 });
  const stackPlayer = makePlayer({ tabs: [existingStack] });
  chooseSandDelivery(stackPlayer);
  assert.equal(existingStack.amount, 89);

  const fullTab = makeBank({ amount: 0, free: 0 });
  const spareTab = makeBank({ amount: 0, free: 1 });
  const multiTabPlayer = makePlayer({ tabs: [fullTab, spareTab] });
  chooseSandDelivery(multiTabPlayer);
  assert.equal(fullTab.amount, 0);
  assert.equal(spareTab.amount, 84);

  const noSpace = makePlayer({ tabs: [makeBank({ amount: 0, free: 0 })] });
  chooseSandDelivery(noSpace);
  assert.equal(noSpace.getAttribute(plugin._test.LAST_DELIVERY_ATTRIBUTE), null);
  assert.equal(noSpace.tabs[0].amount, 0, "a failed capacity check does not partly credit sand");

  const partialBank = makeBank();
  partialBank.add = function addOnly83() { this.amount += 83; };
  const partial = makePlayer({ tabs: [partialBank] });
  chooseSandDelivery(partial);
  assert.equal(partialBank.amount, 0, "a short bank add is rolled back");
  assert.equal(partial.getAttribute(plugin._test.LAST_DELIVERY_ATTRIBUTE), null);

  const ultimate = makePlayer({ mode: "ultimate" });
  const condition = hooks.condition.map((handler) => handler({
    player: ultimate,
    text: "If the player has space for the sand in their bank:",
  })).find((answer) => answer !== null && answer !== undefined);
  assert.equal(condition, false, "UIMs cannot receive Bert's bank delivery");
  const noBankCondition = hooks.condition.map((handler) => handler({
    player: ultimate,
    text: "If the player has no space for the sand in their bank, or is an Ultimate Ironman:",
  })).find((answer) => answer !== null && answer !== undefined);
  assert.equal(noBankCondition, true, "UIMs receive the dialogue's bank-delivery exclusion branch");
});

test("Bert's delivery uses actual bank tabs and refuses a stack with room for only 83", (t) => {
  const player = realPlayer(t, "bert-bank");
  const first = player.getBank(0);
  const second = player.getBank(1);
  for (let id = 1; core.Bank.freeSlots(player) > 1 && id < 3000; id++) {
    if (id === SAND_ITEM_ID) continue;
    if (core.ItemDefinition.forId(id).getId() === id) first.add(new core.Item(id, 1), false);
  }
  second.add(new core.Item(SAND_ITEM_ID, 5), false);
  assert.equal(core.Bank.freeSlots(player), 0);
  chooseSandDelivery(player, core.NpcIdentifiers.BERT_2);
  assert.equal(second.getAmount(SAND_ITEM_ID), 89);
  assert.equal(first.getAmount(SAND_ITEM_ID), 0);

  const nearlyFull = realPlayer(t, "bert-stack-limit");
  const bank = nearlyFull.getBank(0);
  bank.add(new core.Item(SAND_ITEM_ID, 0x7fffffff - 83), false);
  for (let id = 1; core.Bank.freeSlots(nearlyFull) > 0 && id < 3000; id++) {
    if (id === SAND_ITEM_ID) continue;
    if (core.ItemDefinition.forId(id).getId() !== id) continue;
    bank.add(new core.Item(id, 1), false);
  }
  const before = bank.getAmount(SAND_ITEM_ID);
  assert.equal(bank.getAddableAmount(new core.Item(SAND_ITEM_ID, 84)), 83);
  chooseSandDelivery(nearlyFull, core.NpcIdentifiers.BERT_2);
  assert.equal(bank.getAmount(SAND_ITEM_ID), before);
  assert.equal(nearlyFull.getAttribute(plugin._test.LAST_DELIVERY_ATTRIBUTE), undefined);

  const noSand = realPlayer(t, "bert-full-bank");
  const fullBank = noSand.getBank(0);
  for (let id = 1; core.Bank.freeSlots(noSand) > 0 && id < 3000; id++) {
    if (id === SAND_ITEM_ID) continue;
    if (core.ItemDefinition.forId(id).getId() === id) fullBank.add(new core.Item(id, 1), false);
  }
  assert.equal(core.Bank.freeSlots(noSand), 0);
  chooseSandDelivery(noSand, core.NpcIdentifiers.BERT_2);
  assert.equal(fullBank.getAmount(SAND_ITEM_ID), 0);
  assert.equal(noSand.getAttribute(plugin._test.LAST_DELIVERY_ATTRIBUTE), undefined);
});

test("an Ultimate ironman fills a bucket at Bert's sandpit for the diary task", (t) => {
  assert.equal(YANILLE_SAND_PIT_OBJECT_ID, 10814);
  const player = realPlayer(t, "bert-uim");
  player.setAttribute("ironman:mode", "ultimate");
  player.setAttribute(plugin._test.QUEST_STAGE_ATTRIBUTE, 0);
  const inventory = player.getInventory();
  inventory.add(new core.Item(EMPTY_BUCKET_ITEM_ID, 1), false);
  const bucketSlot = inventory.getSlotForItemId(EMPTY_BUCKET_ITEM_ID);
  const event = {
    player,
    itemId: EMPTY_BUCKET_ITEM_ID,
    objectId: YANILLE_SAND_PIT_OBJECT_ID,
    itemSlot: bucketSlot,
    location: { x: 2542, y: 3103, z: 0 },
    handled: false,
  };
  assert.deepEqual(itemOnObjectFilter, { noted: false });
  itemOnObject(event);
  assert.equal(event.handled, true);
  assert.equal(inventory.getAmount(EMPTY_BUCKET_ITEM_ID), 0);
  assert.equal(inventory.getAmount(SAND_ITEM_ID), 1);
  assert.equal(emittedTasks.at(-1).task, "claim-buckets-of-sand-from-bert-in-yanille");
  const taskCount = emittedTasks.length;
  const repeatedUse = { ...event, handled: false };
  itemOnObject(repeatedUse);
  assert.equal(repeatedUse.handled, false);
  assert.equal(emittedTasks.length, taskCount, "a later click without a bucket cannot repeat the diary event");

  const nonPit = { ...event, handled: false, location: { x: 2543, y: 3103, z: 0 } };
  itemOnObject(nonPit);
  assert.equal(nonPit.handled, false, "the alternate counts only the public Yanille sandpit");

  const ordinaryPlayer = realPlayer(t, "bert-non-uim");
  ordinaryPlayer.getInventory().add(new core.Item(EMPTY_BUCKET_ITEM_ID, 1), false);
  const nonUimEvent = { ...event, player: ordinaryPlayer, handled: false };
  itemOnObject(nonUimEvent);
  assert.equal(nonUimEvent.handled, false);
  assert.equal(ordinaryPlayer.getInventory().getAmount(EMPTY_BUCKET_ITEM_ID), 1);
});

test("Bert's Sand option on NPC 5819 deposits the daily delivery", (t) => {
  const player = realPlayer(t, "bert-sand-option");
  assert.equal(npcActions.Bert.Sand({ player, npcId: core.NpcIdentifiers.BERT_2 }), true);
  assert.equal(player.getBank(0).getAmount(SAND_ITEM_ID), 84);
  assert.equal(player.getAttribute(plugin._test.LAST_DELIVERY_ATTRIBUTE), plugin._test.today(() => clock));
});

test("the real Bert transcript credits every randomized sand-delivery branch", (t) => {
  const player = realPlayer(t, "bert-dialogue");
  player.setAttribute(plugin._test.INTRO_SEEN_ATTRIBUTE, true);
  const previousRandom = Math.random;
  try {
    for (let branch = 0; branch < 4; branch++) {
      if (branch > 0) clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
      Math.random = () => (branch + 0.1) / 4;
      const runtime = require("../plugins/quests/QuestRuntime");
      assert.equal(runtime.startTranscript(api, player, 5819, "Bert", selectedVariant(player, 5819)), true);
      advanceToPromptOrEnd(player);
      choosePrompt(player, "Can you deliver my sand to my bank, please?");
      advanceToPromptOrEnd(player);
      if (player.bertPrompt) choosePrompt(player, "Did you already give me some sand today?");
      while (player.getDialogueManager().getCurrent()) player.getDialogueManager().advance();
      assert.equal(player.getBank(0).getAmount(SAND_ITEM_ID), (branch + 1) * 84,
        `random branch ${branch + 1} is credited`);
      assert.ok(conditionTransitions.some(({ npcId, stepId }) => npcId === 5819 && stepId === plugin._test.BANK_SPACE_CONDITION_ID));
    }
  } finally {
    Math.random = previousRandom;
  }
});

test("Bert's daily delivery survives player state reload", (t) => {
  assert.ok(persistedAttributes.some(([key]) => key === plugin._test.LAST_DELIVERY_ATTRIBUTE));
  assert.ok(persistedAttributes.some(([key, initialValue]) =>
    key === plugin._test.INTRO_SEEN_ATTRIBUTE && initialValue === false));
  const beforeSave = realPlayer(t, "bert-save");
  chooseSandDelivery(beforeSave, core.NpcIdentifiers.BERT_2);
  const savedDay = beforeSave.getAttribute(plugin._test.LAST_DELIVERY_ATTRIBUTE);
  const snapshot = PlayerSave.fromPlayer(beforeSave);
  const reloaded = new Player(null);
  snapshot.applyToPlayer(reloaded);
  assert.equal(reloaded.getAttribute(plugin._test.LAST_DELIVERY_ATTRIBUTE), savedDay);
  chooseSandDelivery(reloaded, core.NpcIdentifiers.BERT_2);
  assert.equal(reloaded.getBank(0).getAmount(SAND_ITEM_ID), 84);
});
