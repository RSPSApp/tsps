// Run after `yarn build`: node --test tests/hunter-rumours.test.cjs
// Hunter Guild rumours: wording from rsprox captures 1108 and 1115 (Cervus, Aco, Teco).
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const C = require("../plugins/skills/hunter/Context.Hunter");
const Rumours = require("../plugins/skills/hunter/Rumours.Hunter");

const NPC = { GILMAN: 1, CERVUS: 2, ORNUS: 3, ACO: 4, TECO: 5, WOLF: 6 };
const ITEM = { JERBOA_TAIL: 110, PART: 100, SACK_ADEPT: 101, SACK_EXPERT: 102, SACK_BASIC: 103, SACK_MASTER: 104 };
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
    RED_CHINCHOMPA: 9001, RED_CHINCHOMPA_TUFT: ITEM.PART, LARGE_JERBOA_TAIL: ITEM.JERBOA_TAIL,
    HUNTERS_LOOT_SACK_BASIC_: ITEM.SACK_BASIC, HUNTERS_LOOT_SACK_ADEPT_: ITEM.SACK_ADEPT,
    HUNTERS_LOOT_SACK_EXPERT_: ITEM.SACK_EXPERT, HUNTERS_LOOT_SACK_MASTER_: ITEM.SACK_MASTER,
  };
  C.H.core = {
    // Any creature key resolves to some id, so every task is eligible.
    NpcIdentifiers: new Proxy(identifiers, { get: (t, k) => t[k] ?? 5000 }),
    ItemIdentifiers: new Proxy(identifiers, { get: (t, k) => t[k] }),
    Skill: { HUNTER: "hunter", HERBLORE: "herblore" },
    ItemDefinition: { forId: (id) => ({ getName: () => ({ [ITEM.PART]: "Red chinchompa tuft", [ITEM.JERBOA_TAIL]: "Large jerboa tail" })[id] ?? "item", isStackable: () => false, getNoteId: () => id }) },
    GameObject: class {},
    DialogueChainBuilder: Chain,
    NpcDialogue: class extends Dialogue { get text() { return this.args[1]; } get npc() { return this.args[0]; } },
    PlayerDialogue: class extends Dialogue { get text() { return this.args[0]; } },
    ActionDialogue: class extends Dialogue { run() { this.args[0].execute(); } },
    OptionDialogue: class extends Dialogue { get options() { return this.args.slice(1); } pick(n) { this.args[0].executeOption(n); } },
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
    getPacketSender: () => ({ sendInterfaceRemoval: () => {} }),
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
  assert.equal(Rumours.partPhrase("Large jerboa tail"), "its tail");
  // Review: "Tailfeathers" must not read as a tail; ear and tooth get their own phrases.
  assert.equal(Rumours.partPhrase("Tailfeathers"), "some of its feathers");
  assert.equal(Rumours.partPhrase("Larupia ear"), "one of its ears");
  assert.equal(Rumours.partPhrase("Kyatt tooth chip"), "one of its teeth");
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

const verityEvent = (p) => ({ player: p, npcId: 7, npc: { getPrivateArea: () => null, getLocation: () => ({ getZ: () => 0, getX: () => 0, getY: () => 0 }) } });

test("Verity's Talk-to gives her introduction to a newcomer and unlocks rumours after it", () => {
  const p = Object.assign(player({ unlocked: false }), {
    getPrivateArea: () => null,
    getLocation: () => ({ getZ: () => 0, getX: () => 0, getY: () => 0, clone: () => ({}) }),
  });
  Rumours.verity(verityEvent(p));
  const [greeting, options] = sent.dialogues.at(-1).entries;
  assert.equal(greeting.text, "Oh, hello there newcomer. I'm Guild Scribe Verity. Do you need me to explain the work we do here?");
  assert.deepEqual(options.options, ["Yes please.", "No thanks."]);
  assert.ok(!Rumours.state(p).unlocked, "nothing unlocks before the introduction is heard");
  options.pick(1);
  const chain = sent.dialogues.at(-1).entries;
  assert.equal(chain.length, Rumours.VERITY_TUTORIAL.length + 1);
  assert.equal(chain[0].text, "Yes please.");
  assert.match(chain[1].text, /^So it's nice and simple./);
  assert.ok(!Rumours.state(p).unlocked);
  chain.at(-1).run();
  assert.ok(Rumours.state(p).unlocked);
});

test("a hunter reminds a player with an unfinished rumour with the captured wording", () => {
  const p = player();
  const state = Rumours.state(p);
  state.assignments[0] = { task: Rumours.tasks.findIndex((t) => t.name === "Embertailed jerboa"), count: 0, found: false };
  Rumours.assign(p, 0, NPC.GILMAN);
  assert.equal(said(), "You're hunting for me at the moment. This rumour was about a embertailed jerboa. You'll need to bring back its tail.");
});

// A catch of the rumour's creature: the red chinchompa from Aco, caught in a box trap.
function catchPart(p, { count = 0, random = 0 } = {}) {
  const state = Rumours.state(p);
  state.assignments[3] = { task: Rumours.tasks.findIndex((t) => t.npc === "CARNIVOROUS_CHINCHOMPA"), count, found: false };
  state.active = 3;
  const realRandom = Math.random;
  Math.random = () => random;
  try { Rumours.success({ player: p, npcId: C.H.core.NpcIdentifiers.CARNIVOROUS_CHINCHOMPA, method: "box" }); }
  finally { Math.random = realRandom; }
  return state.assignments[3];
}
function huntingPlayer(options = {}, fill = 0) {
  const p = player(options);
  for (let i = 0; i < fill; i++) p.items.set(20000 + i, 1);
  p.sounds = []; p.ground = [];
  p.getPacketSender = () => ({ sendInterfaceRemoval: () => {}, sendSound: (id, loops, delay) => p.sounds.push([id, loops, delay]) });
  p.getEquipment = () => ({ getItems: () => [] });
  p.getLocation = () => ({ clone: () => "under the player" });
  p.getPrivateArea = () => null;
  C.H.core.Item = class { constructor(id, amount) { this.id = id; this.amount = amount; } };
  C.H.core.ItemOnGroundManager = { registerLocation: (owner, item, at, area, options) => p.ground.push({ owner, item, at, area, options }) };
  return p;
}

test("a found part is announced in green with its jingle and goes to the inventory", () => {
  const p = huntingPlayer();
  const assignment = catchPart(p);
  assert.equal(sent.messages.at(-1), "<col=229628>You find a rare piece of the creature! You should take it back to the Hunter Guild.");
  assert.deepEqual(p.sounds, [[2655, 1, 0]]);
  assert.equal(p.items.get(ITEM.PART), 1);
  assert.equal(assignment.found, true);
  assert.deepEqual(p.ground, []);
});

test("with a full inventory the part drops under the player, for them only, with live's line", () => {
  const p = huntingPlayer({}, 28);
  const assignment = catchPart(p);
  assert.equal(sent.messages.at(-1), "<col=229628>You find a rare piece of the creature! Though without space in your inventory, it drops to the ground.");
  assert.deepEqual(p.sounds, [[2655, 1, 0]]);
  assert.equal(p.items.get(ITEM.PART), undefined);
  assert.equal(p.ground.length, 1);
  assert.equal(p.ground[0].owner, p);
  assert.deepEqual([p.ground[0].item.id, p.ground[0].item.amount, p.ground[0].at], [ITEM.PART, 1, "under the player"]);
  assert.deepEqual(p.ground[0].options, { goesGlobal: false, despawnDelay: 200 });
  assert.equal(assignment.found, true);
});

test("a pity part with a full inventory is not given and waits for the next catch", () => {
  const p = huntingPlayer({}, 28);
  const assignment = catchPart(p, { count: 99, random: 0.999 });
  assert.deepEqual(p.ground, []);
  assert.deepEqual(p.sounds, []);
  assert.equal(assignment.found, false);
  assert.equal(sent.messages.at(-1), "Free an inventory slot to receive the rare creature part on your next catch.");
});

test("a pity part with room is announced like any other", () => {
  const p = huntingPlayer();
  const assignment = catchPart(p, { count: 99, random: 0.999 });
  assert.equal(sent.messages.at(-1), "<col=229628>You find a rare piece of the creature! You should take it back to the Hunter Guild.");
  assert.deepEqual(p.sounds, [[2655, 1, 0]]);
  assert.equal(assignment.found, true);
});

test("a catch that misses the roll sends nothing", () => {
  const p = huntingPlayer();
  const assignment = catchPart(p, { random: 0.999 });
  assert.deepEqual([sent.messages, p.sounds, assignment.found], [[], [], false]);
});
