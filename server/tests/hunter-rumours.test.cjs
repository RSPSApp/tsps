// Run after `yarn build`: node --test tests/hunter-rumours.test.cjs
// Hunter Guild rumours: wording from rsprox captures 1108 and 1115 (Cervus, Aco, Teco).
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const C = require("../plugins/skills/hunter/Context.Hunter");
const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");

const NPC = { GILMAN: 1, CERVUS: 2, ORNUS: 3, ACO: 4, TECO: 5, WOLF: 6 };
const ITEM = { PART: 100, SACK_ADEPT: 101, SACK_EXPERT: 102, SACK_BASIC: 103, SACK_MASTER: 104 };
let sent;
let events;

class Dialogue { constructor(i, ...rest) { this.index = i; this.args = rest; } }
class Chain { constructor() { this.entries = []; } add(...e) { this.entries.push(...e); return this; } }

function setup() {
  sent = { messages: [], dialogues: [] };
  events = [];
  const identifiers = {
    GUILD_HUNTER_CERVUS_ADEPT_: NPC.CERVUS, GUILD_HUNTER_ORNUS_ADEPT_: NPC.ORNUS, GUILD_HUNTER_ACO_EXPERT_: NPC.ACO,
    GUILD_HUNTER_TECO_EXPERT_: NPC.TECO, GUILD_HUNTER_WOLF_MASTER_: NPC.WOLF, HUNTMASTER_GILMAN_NOVICE_: NPC.GILMAN,
    RED_CHINCHOMPA: 9001, RED_CHINCHOMPA_TUFT: ITEM.PART,
    HUNTERS_LOOT_SACK_BASIC_: ITEM.SACK_BASIC, HUNTERS_LOOT_SACK_ADEPT_: ITEM.SACK_ADEPT,
    HUNTERS_LOOT_SACK_EXPERT_: ITEM.SACK_EXPERT, HUNTERS_LOOT_SACK_MASTER_: ITEM.SACK_MASTER,
  };
  C.H.core = {
    // Any creature key resolves to some id, so every task is eligible.
    NpcIdentifiers: new Proxy(identifiers, { get: (t, k) => t[k] ?? 5000 }),
    ItemIdentifiers: new Proxy(identifiers, { get: (t, k) => t[k] }),
    Skill: { HUNTER: "hunter", HERBLORE: "herblore" },
    ItemDefinition: { forId: (id) => ({ getName: () => (id === ITEM.PART ? "Red chinchompa tuft" : "item"), isStackable: () => false, getNoteId: () => id }) },
    DialogueChainBuilder: Chain,
    NpcDialogue: class extends Dialogue { get text() { return this.args[1]; } get npc() { return this.args[0]; } },
    EndDialogue: Dialogue,
  };
  C.H.api = { emitCustomEvent: (name, payload) => { events.push([name, payload]); if (name === "quest:is-complete") payload.complete = true; } };
}

function player({ hunter = 99, unlocked = true, held = [] } = {}) {
  const attributes = new Map();
  const items = new Map(held.map((id) => [id, 1]));
  const p = {
    getAttribute: (k) => attributes.get(k),
    setAttribute: (k, v) => attributes.set(k, v),
    sendMessage: (m) => sent.messages.push(m),
    getSkillManager: () => ({ getMaxLevel: () => hunter, getCurrentLevel: () => hunter, addExperiences: (skill, xp) => { p.xp = (p.xp ?? 0) + xp; } }),
    getDialogueManager: () => ({ startDialogues: (chain) => sent.dialogues.push(chain) }),
    getInventory: () => ({
      contains: (id) => (items.get(id) ?? 0) > 0,
      getItems: () => [...items].map(([id, n]) => ({ getId: () => id, getAmount: () => n })),
      full: () => sent.messages.push("full"),
      capacity: () => 28,
      deleteNumber: (id, n) => items.set(id, (items.get(id) ?? 0) - n),
      adds: (id, n) => items.set(id, (items.get(id) ?? 0) + n),
    }),
    items,
  };
  if (unlocked) Rumours.state(p).unlocked = true;
  return p;
}
const said = (i = -1) => sent.dialogues.at(i).entries[0].text;

beforeEach(setup);

test("OFFERS cover the six captured wordings and fill creature and part", () => {
  assert.equal(Rumours.OFFERS.length, 6);
  for (const offer of Rumours.OFFERS) assert.ok(offer.includes("{creature}") && offer.endsWith("bring back {part}."));
});

test("the part is worded like the hunters do", () => {
  assert.equal(Rumours.partPhrase("Red chinchompa tuft"), "some of its fur");
  assert.equal(Rumours.partPhrase("Fox fluff"), "some of its fur");
  assert.equal(Rumours.partPhrase("Swamp lizard claw"), "one of its claws");
  assert.equal(Rumours.partPhrase("Antelope hoof shard"), "one of its hooves");
  assert.equal(Rumours.partPhrase("Sunlight moth wing"), "one of its wings");
  assert.equal(Rumours.partPhrase("Graahk horn spur"), "its horn");
});

test("a hunter who is too low-level refuses with Teco's captured line", () => {
  const p = player({ hunter: 40 });
  Rumours.assign(p, 4, NPC.TECO);
  assert.equal(said(), "I don't think you'd be able to hunt the creatures on my list. Rumour has it you're not the most experienced hunter.");
  assert.equal(sent.dialogues.at(-1).entries[0].npc, NPC.TECO);
  assert.deepEqual(Rumours.state(p).assignments, {});
});

test("a new player is sent to Verity before getting a rumour", () => {
  const p = player({ unlocked: false });
  Rumours.assign(p, 1, NPC.CERVUS);
  assert.equal(said(), "Looks like you could do with talking to Verity first, given you're new to this whole business.");
});

test("an offer is one NPC dialogue that names the creature and the part", () => {
  const p = player();
  Rumours.assign(p, 3, NPC.ACO);
  const state = Rumours.state(p);
  const task = Rumours.tasks[state.assignments[3].task];
  assert.equal(sent.dialogues.length, 1);
  assert.equal(sent.dialogues[0].entries[0].npc, NPC.ACO);
  assert.ok(said().includes(task.name.toLowerCase()), said());
  assert.match(said(), /Once you find it, bring back /);
  assert.equal(state.active, 3);
});

test("the quetzal whistle reports the target, its part and the source", () => {
  const p = player();
  const state = Rumours.state(p);
  state.assignments[3] = { task: Rumours.tasks.findIndex((t) => t.npc === "CARNIVOROUS_CHINCHOMPA"), count: 0, found: false };
  state.active = 3;
  Rumours.check({ player: p });
  assert.equal(sent.messages.at(-1), "Your current rumour target is a red chinchompa. You'll need to bring back some of its fur. Aco was the source of the rumour.");
});

test("handing in the part counts the rumour and does not offer another until the next click", () => {
  const p = player({ held: [ITEM.PART] });
  const state = Rumours.state(p);
  state.assignments[3] = { task: Rumours.tasks.findIndex((t) => t.npc === "CARNIVOROUS_CHINCHOMPA"), count: 3, found: true };
  state.active = 3;
  state.completed = 1;
  Rumours.assign(p, 3, NPC.ACO);
  assert.equal(sent.messages[0], "You have completed <col=ff3045>2</col> rumours for the Hunter Guild.");
  assert.equal(said(), "Thanks for that. I'll mark off that report for you. Would you like another rumour?");
  assert.deepEqual(state.assignments, {});
  assert.equal(p.items.get(ITEM.SACK_EXPERT), 1);
  assert.ok(events.some(([name]) => name === "hunter:rumour-completed"));
});
