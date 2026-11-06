// Run after `yarn build`: node --test tests/barbarian-training.test.cjs
// Barbarian Training's rod fishing and Herblore sections, through the real Herblore mixing and
// the real Barbarian Training transcript (npc-dialogues.json, read the way NpcDialogues serves it).
const assert = require("node:assert/strict");
const path = require("path");
const { test, before } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const Herblore = require("../plugins/skills/Herblore.plugin");
const Training = require("../plugins/npcs/BarbarianTraining.plugin");
const T = Training._test;

let core;
let transcript;
const hooks = { itemOnItem: [], before: [], objects: new Map(), events: new Map() };

const api = new Proxy({
  onItemOnItem(handler) { hooks.itemOnItem.push(handler); },
  onBeforeNpcInteraction(handler) { hooks.before.push(handler); },
  onObjectInteraction(name, actions) { hooks.objects.set(name, actions); },
  onCustomEvent(name, handler) { if (!hooks.events.has(name)) hooks.events.set(name, []); hooks.events.get(name).push(handler); },
  emitCustomEvent(name, request) {
    for (const handler of hooks.events.get(name) ?? []) handler(request);
    if (name === "quest:is-complete") request.complete = true;
    // NpcDialogues' "npc-dialogue:start": an exact variant of Otto's page, handed to `select`.
    if (name === "npc-dialogue:start" && request.npcId === core.NpcIdentifiers.OTTO_GODBLESSED) {
      const steps = transcript.variants[request.variant];
      if (steps) request.select(steps);
    }
  },
}, { get: (target, key) => (key === "core" ? core : key in target ? target[key] : () => {}) });

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  transcript = require("../data/definitions/npc-dialogues.json")["Barbarian Training"];
  Herblore.register(api);
  Training.register(api);
});

const obj = (name) => core.CacheDefinitions.getObjId(name);

function inventory(names) {
  const slots = Array(28).fill(null);
  names.forEach((name, index) => { slots[index] = new core.Item(typeof name === "number" ? name : obj(name), 1); });
  const self = {
    getFreeSlots: () => slots.filter((item) => !item).length,
    getItems: () => slots.map((item) => item ?? new core.Item(-1, 0)),
    getAmount: (id) => slots.filter((item) => item?.getId() === id).length,
    contains: (id) => slots.some((item) => item?.getId() === id),
    refreshItems: () => self,
    addItem(item) { slots[slots.indexOf(null)] = new core.Item(item.getId(), 1); return self; },
    adds(id) { return self.addItem(new core.Item(id, 1)); },
    deleteNumber(id) { const slot = slots.findIndex((item) => item?.getId() === id); if (slot >= 0) slots[slot] = null; return self; },
    deleteAtSlot(slot) { slots[slot] = null; return self; },
    count: (name) => self.getAmount(obj(name)),
  };
  return self;
}

function player(names = [], level = 99) {
  const sent = { messages: [], spam: [], varbits: new Map(), xp: 0, made: [] };
  const attributes = new Map();
  const inv = inventory(names);
  const here = { isWithinDistance: () => true };
  const sender = new Proxy({
    sendVarbit(id, value) { sent.varbits.set(id, value); return sender; },
    sendTypedMessage(type, text) { sent.spam.push(text); return sender; },
  }, { get: (target, key) => key in target ? target[key] : () => sender });
  const who = {
    sent, inv, level, chain: null,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getInventory: () => inv,
    getPacketSender: () => sender,
    getLocation: () => here,
    getUsername: () => "Tester",
    getSkillManager: () => ({ getCurrentLevel: () => who.level, addExperiences(skill, xp) { sent.xp += xp; } }),
    sendMessage(text) { sent.messages.push(text); },
    getDialogueManager: () => ({ startDialogues(chain) { who.chain = chain; } }),
    performAnimation() {}, getIndex: () => 1,
  };
  return who;
}

/**
 * Continues through the open chat chain as the player would: spoken lines and boxes are
 * collected, actions run (and may open the next chain), and it stops at a menu or the end.
 */
function read(who) {
  const said = [];
  for (;;) {
    const chain = who.chain;
    if (!chain) return { said, options: null };
    const entries = [...chain.getDialogues().entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry);
    let replaced = false;
    for (const entry of entries) {
      if (entry instanceof core.OptionDialogue) return { said, options: entry.getOptions(), menu: entry };
      if (entry instanceof core.ActionDialogue) {
        who.chain = null;
        entry.send(who);
        if (who.chain) { replaced = true; break; }
        continue;
      }
      if (typeof entry.getText === "function") said.push(entry.getText());
    }
    if (!replaced) { who.chain = null; return { said, options: null }; }
  }
}

function pick(who, shown, option) {
  const index = shown.options.indexOf(option);
  assert.ok(index >= 0, `"${option}" in ${JSON.stringify(shown.options)}`);
  who.chain = null;
  shown.menu.execute(index + 1);
  return read(who);
}

const otto = { getLocation: () => ({}) };
function talk(who) {
  const definition = core.NpcDefinition.forId(core.NpcIdentifiers.OTTO_GODBLESSED);
  const event = { player: who, npc: otto, npcId: core.NpcIdentifiers.OTTO_GODBLESSED, definition, clickType: 1, handled: false };
  for (const handler of hooks.before) handler(event);
  assert.equal(event.handled, true);
  const greeting = read(who);
  assert.deepEqual(greeting.said, ["Good day to you, hearty warrior! May the spirits guide you."]);
  return greeting;
}

function use(who, used, usedWith) {
  const event = { player: who, usedItemId: obj(used), usedWithItemId: obj(usedWith), handled: false };
  const made = (payload) => who.sent.made.push(payload.itemId);
  hooks.events.get("herblore:made").push(made);
  try { for (const handler of hooks.itemOnItem) handler(event); }
  finally { hooks.events.get("herblore:made").splice(hooks.events.get("herblore:made").indexOf(made), 1); }
  return event.handled;
}

const stages = (who) => ({ fishingRod: T.state(who).fishingRod, herblore: T.state(who).herblore });

test("each topic's lines come from the Barbarian Training transcript, its player line first", () => {
  const who = player();
  for (const [variant, option] of [
    ["starting-off-after-speaking-to-him-once", T.TOPIC.rod],
    ["starting-off-after-speaking-to-him-once-talking-to-otto-again-without-doing-as-he-asks", T.TOPIC.rod],
    ["fishing", T.TOPIC.rodDone],
    ["herblore", T.TOPIC.herblore],
    ["herblore-speaking-to-otto-again-without-an-attack-mix", T.TOPIC.herblore],
    ["herblore-speaking-to-otto-with-an-attack-mix", T.TOPIC.herbloreDone],
  ]) {
    const lines = T.topicLines(who, otto, core.NpcIdentifiers.OTTO_GODBLESSED, variant, option);
    assert.ok(lines.length >= 3, `${variant}: ${lines.length} lines`);
    assert.deepEqual(lines[0], { player: option }, variant);
  }
});

test("Otto teaches rod fishing first; the bed gives the rod and a leaping fish completes it", () => {
  const who = player();
  let shown = talk(who);
  assert.deepEqual(shown.options, [T.TOPIC.rod, T.TOPIC.farming, T.TOPIC.leave]);
  shown = pick(who, shown, T.TOPIC.rod);
  assert.ok(shown.said.includes("Certainly. Take the rod from under my bed and fish in the lake. When you have caught a few fish, I am sure you will be ready to talk more with me."));
  assert.deepEqual(stages(who), { fishingRod: 1, herblore: 0 });
  assert.equal(who.sent.varbits.get(T.VARBITS.fishingRod), 1);
  assert.deepEqual(pick(who, shown, "I have no more questions at this time.").said, ["I have no more questions at this time.", "In that case, farewell."]);

  // Asking again before catching anything: the transcript's "not successful yet" reply.
  shown = pick(who, talk(who), T.TOPIC.rod);
  assert.ok(shown.said.some((line) => line.startsWith("Alas, I do not sense that you have been successful")));

  hooks.objects.get("Barbarian bed").Search({ player: who });
  assert.deepEqual(read(who).said, [T.ROD_TAKEN]);
  assert.equal(who.inv.contains(core.ItemIdentifiers.BARBARIAN_ROD), true);
  hooks.objects.get("Barbarian bed").Search({ player: who });
  const again = read(who);
  assert.deepEqual(again.options, ["Take another.", "Don't take any more."]);

  T.caughtFish({ player: who, itemId: obj("raw_trout") });
  assert.equal(stages(who).fishingRod, 1, "an ordinary trout is not a leaping fish");
  T.caughtFish({ player: who, itemId: core.ItemIdentifiers.LEAPING_TROUT });
  assert.equal(stages(who).fishingRod, 2);
  assert.deepEqual(who.sent.messages, [T.LEARNED]);

  shown = talk(who);
  assert.deepEqual(shown.options, [T.TOPIC.rodDone, T.TOPIC.farming, T.TOPIC.leave]);
  pick(who, shown, T.TOPIC.rodDone);
  assert.equal(stages(who).fishingRod, 3);
  assert.deepEqual(talk(who).options, [T.TOPIC.herblore, T.TOPIC.farming, T.TOPIC.leave]);
});

test("a full inventory leaves the rod under the bed", () => {
  const who = player(Array(28).fill("coins"));
  hooks.objects.get("Barbarian bed").Search({ player: who });
  assert.deepEqual(read(who).said, [T.ROD_NO_SPACE]);
});

test("Herblore: Otto asks for an attack mix, takes it, and every mix is learned", () => {
  const who = player(["2dose1attack", "brut_roe", "2doserangerspotion", "brut_caviar", "2doserangerspotion", "brut_caviar"]);
  T.setStage(who, "fishingRod", 3);

  // Untaught, roe and caviar mix nothing.
  assert.equal(use(who, "brut_roe", "2dose1attack"), true);
  assert.deepEqual(who.sent.messages, ["Nothing interesting happens."]);
  assert.equal(who.inv.count("brutal_2dose1attack"), 0);
  who.sent.messages.length = 0;

  pick(who, talk(who), T.TOPIC.herblore);
  assert.equal(stages(who).herblore, 1);
  assert.equal(who.sent.varbits.get(T.VARBITS.herblore), 1);

  // Asked for: the attack mix, as recorded, and the "learned more" box. Other mixes wait.
  assert.equal(use(who, "brut_roe", "2dose1attack"), true);
  assert.equal(who.inv.count("brutal_2dose1attack"), 1);
  assert.deepEqual(who.sent.spam, ["You combine your potion with the fish eggs."]);
  assert.equal(who.sent.xp, 8);
  assert.deepEqual(read(who).said, [T.LEARNED]);
  assert.equal(stages(who).herblore, 2);
  assert.equal(use(who, "brut_caviar", "2doserangerspotion"), true);
  assert.equal(who.inv.count("brutal_2doserangerspotion"), 0);

  let shown = talk(who);
  assert.deepEqual(shown.options, [T.TOPIC.herbloreDone, T.TOPIC.farming, T.TOPIC.leave]);
  shown = pick(who, shown, T.TOPIC.herbloreDone);
  assert.ok(shown.said.includes("I will take that off your hands now. I will say no more than that I am eternally grateful."));
  assert.equal(who.inv.count("brutal_2dose1attack"), 0);
  assert.equal(stages(who).herblore, 3);
  assert.equal(who.sent.varbits.get(T.VARBITS.herblore), 3);
  assert.deepEqual(talk(who).options, [T.TOPIC.farming, T.TOPIC.leave]);

  // Learned: the ranging mix at 80 Herblore (Wiki), 54 XP, and "herblore:made" for Sherlock.
  who.level = 79;
  who.sent.messages.length = 0;
  use(who, "brut_caviar", "2doserangerspotion");
  assert.deepEqual(who.sent.messages, ["You need a Herblore level of 80 to combine those."]);
  who.level = 80;
  who.sent.xp = 0;
  assert.equal(use(who, "2doserangerspotion", "brut_caviar"), true);
  assert.equal(who.inv.count("brutal_2doserangerspotion"), 1);
  assert.equal(who.inv.count("2doserangerspotion"), 1, "one at a time");
  assert.equal(who.sent.xp, 54);
  assert.deepEqual(who.sent.made, [core.ItemIdentifiers.ATTACK_MIX_2_, core.ItemIdentifiers.RANGING_MIX_2_]);
});

test("the attack mix hand-in needs the mix carried", () => {
  const who = player();
  T.setStage(who, "fishingRod", 3);
  T.setStage(who, "herblore", 2);
  const shown = talk(who);
  assert.deepEqual(shown.options, [T.TOPIC.herblore, T.TOPIC.farming, T.TOPIC.leave]);
  assert.ok(pick(who, shown, T.TOPIC.herblore).said.includes("Do you have my potion?"));
  assert.equal(stages(who).herblore, 2);
});

test("roe makes only the mixes up to the restore mix; caviar makes them all", () => {
  const who = player(["2dose1energy", "brut_roe", "2dose1energy", "brut_caviar"], 99);
  T.setStage(who, "herblore", 3);
  assert.equal(use(who, "brut_roe", "2dose1energy"), false, "no roe recipe for the energy mix");
  assert.equal(use(who, "brut_caviar", "2dose1energy"), true);
  assert.equal(who.inv.count("brutal_2dose1energy"), 1);
});

test("a saved stage outside the varbit's range loads as not started", () => {
  const who = player();
  who.setAttribute(T.STATE_ATTRIBUTE, { fishingRod: 7, herblore: "3" });
  assert.deepEqual(stages(who), { fishingRod: 0, herblore: 0 });
});

test("Otto out of reach: the topic closes the chatbox and the stage stays put", () => {
  const who = player();
  T.setStage(who, "fishingRod", 2);
  const shown = talk(who);
  who.getLocation = () => ({ isWithinDistance: () => false });
  assert.deepEqual(pick(who, shown, T.TOPIC.rodDone).said, []);
  assert.equal(stages(who).fishingRod, 2);
});

test("Otto takes only an attack mix that keeps no restriction", () => {
  const who = player(["brutal_2dose1attack"]);
  who.inv.getItems()[0].setMetaValue(core.Item.UNTRADEABLE_META, true);
  T.setStage(who, "fishingRod", 3);
  T.setStage(who, "herblore", 2);
  assert.deepEqual(talk(who).options, [T.TOPIC.herblore, T.TOPIC.farming, T.TOPIC.leave]);
  who.inv.addItem(new core.Item(obj("brutal_2dose1attack"), 1));
  pick(who, talk(who), T.TOPIC.herbloreDone);
  assert.equal(stages(who).herblore, 3);
  assert.equal(who.inv.count("brutal_2dose1attack"), 1);
  assert.equal(who.inv.getItems()[0].getMetaValue(core.Item.UNTRADEABLE_META), true, "the restricted copy stays");
});
