// Run after `yarn build`: node --test tests/slayer-contact.test.cjs
//
// The slayer ring's Contact Master (docs/slayer.md). Wiki, Slayer ring: the ring contacts "the most
// advanced Slayer master they are eligible to receive tasks from", and "players cannot be assigned
// tasks, spend slayer reward points or purchase slayer equipment from a master when contacting them
// this way". The dialogue is the Wiki's transcript: Konar's item contact during a task, the Astral
// Contact variant for the rest.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
CachePipeline.initialize();
new NpcDefinitionLoader().load();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { PacketSender } = require("../dist/net/packet/PacketSender");
const { Skill } = require("../dist/game/model/Skill");

const Slayer = require("../plugins/skills/Slayer.plugin");
const Contact = require("../plugins/skills/slayer/Contact.Slayer");
const Masters = require("../plugins/skills/slayer/Masters.Slayer");
const State = require("../plugins/skills/slayer/State.Slayer");
const Transcripts = require("../data/definitions/npc-dialogues.json");

const core = PluginManager.getCoreApi();
const handlers = { events: new Map() };
const emitted = [];
Slayer.register({
  core,
  persistAttribute() {},
  onPlayerLogin() {},
  onPlayerLogout() {},
  onPlayerDisconnect() {},
  onPlayerMapSquareChange() {},
  onServerStartup() {},
  onNpcDeath() {},
  onCanAttack() {},
  onNpcInteraction() {},
  onAnyNpcInteraction() {},
  onNpcDialogueCondition() {},
  onItemAction() {},
  onInterfaceActionButton() {},
  onCombatHitRoll() {},
  onCombatHitResolved() {},
  onNpcHitModify() {},
  onPlayerDealtDamage() {},
  registerIncomingDamageModifier() {},
  onNpcBeforeDeath() {},
  registerNpcCombatMethodProvider() {},
  onItemOnNpc() {},
  onItemOnItem() {},
  registerCommand() {},
  registerDefinitionSource() {},
  onCanShop() {},
  spawnNpc() {},
  sendMultiChatboxPrompt() {},
  onCustomEvent: (name, fn) => handlers.events.set(name, [...(handlers.events.get(name) ?? []), fn]),
  emitCustomEvent: (name, payload) => {
    emitted.push([name, payload]);
    for (const fn of handlers.events.get(name) ?? []) fn(payload);
  },
});

const setVarbit = (player, name, value) => State.setVarbit(player, name, value);
const setVarp = (player, name, value) => State.setVarp(player, name, value);

function createPlayer({ combat = 126, slayer = 99, task = false } = {}) {
  const attributes = new Map();
  const player = {
    isPlayer: () => true,
    isPlayerBot: () => false,
    getSession: () => ({ sendClientPacket() {}, write() {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage() {},
    setInterfaceId() {},
    getInterfaceId: () => -1,
    getFrameUpdater: () => ({ clear() {}, clearGroup() {} }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.SLAYER ? slayer : 99),
      getCurrentLevel: () => 99,
      getCombatLevel: () => combat,
      addExperiences() {},
    }),
    getEquipment: () => ({ getItems: () => [] }),
    getInventory: () => ({ getFreeSlots: () => 28, contains: () => false, adds() {}, deleteNumber() {} }),
  };
  const sender = new PacketSender(player);
  player.getPacketSender = () => sender;
  if (task) {
    setVarp(player, "slayer_target", 1);
    setVarp(player, "slayer_count", 10);
    setVarbit(player, "slayer_master", 8);
  }
  return player;
}

const handlerFor = (name) => handlers.events.get(name)?.[0];

/** Every npc-dialogue:start the contact asked for, in order. */
function contactFor(player) {
  emitted.length = 0;
  handlerFor("jewellery:action")({ player, item: { getId: () => 11866 }, action: "Contact Master", equipped: false });
  return emitted.filter(([name]) => name === "npc-dialogue:start").map(([, request]) => request);
}

test("the ring reaches the most advanced master the player may take tasks from", () => {
  const cases = [
    [3, 1, 1], [3, 99, 1], // Turael below everything, and even with 99 Slayer
    [19, 1, 1], [20, 1, 2], [39, 1, 2], [40, 1, 3], // Mazchna 20, Vannaka 40
    [70, 1, 4], [75, 1, 8], [85, 1, 6], // Chaeldar 70, Konar 75, Nieve 85
    [100, 49, 6], [100, 50, 5], [100, 69, 5], [100, 70, 10], [126, 99, 10], // Duradel, Mortimer
  ];
  for (const [combat, slayer, expected] of cases) {
    const master = Contact.contactMaster(createPlayer({ combat, slayer }));
    assert.equal(master.id, expected, `combat ${combat} slayer ${slayer}`);
  }
});

test("with a task the ring reaches the master who assigned it, not the most advanced", () => {
  const assigned = createPlayer({ combat: 82, task: true }); // its task is Konar's (master 8)
  assert.equal(Contact.contactMaster(assigned).id, 8);
  setVarbit(assigned, "slayer_master", 1); // the same levels, but the task is Turael's
  assert.equal(Contact.contactMaster(assigned).id, 1);
  assert.equal(Contact.contactMaster(createPlayer({ combat: 82 })).id, 8, "without one: Konar");
});

test("Konar's line fills the area, and drops it for a task that has none", () => {
  const line = (player) => {
    const request = { player, definition: { getName: () => "Konar quo Maten" },
      text: "You're currently assigned to bring balance to [monster] in [area]; you have [amount] more to go." };
    Masters.fillLine(request);
    return request.text;
  };
  const noArea = line(createPlayer({ combat: 82, task: true }));
  assert.match(noArea, /bring balance to monkeys; you have 10 more to go\./, "no dangling area");
});

test("Krystilia is not on the ladder", () => {
  assert.equal(Contact._test.LADDER.includes(7), false);
  assert.notEqual(Contact.contactMaster(createPlayer({ combat: 126, slayer: 99 })).id, 7);
});

test("without a task it plays the master's Astral Contact variant, filtered to the ring's rows", () => {
  const [request] = contactFor(createPlayer({ combat: 3 }));
  assert.equal(request.variant, Contact._test.SPELL_VARIANT);
  assert.equal(request.exact, true, "a named variant, not the page default");
  assert.equal(typeof request.select, "function");
  const npcName = core.NpcDefinition.forId(request.npcId).getName();
  assert.equal(npcName, "Turael", "the master's own NPC speaks");

  const steps = request.select(Transcripts.Turael.variants[Contact._test.SPELL_VARIANT]);
  assert.equal(steps[0].npc, "'Ello, can I help you?", "the transcript's contact greeting");
  const texts = steps[1].options.map((option) => option.text);
  assert.deepEqual(texts, [
    "Let's talk about the difficulty of my assignments.",
    "Err... Nothing...",
  ]);
});

test("the rows the ring may not use are the ones dropped", () => {
  const [request] = contactFor(createPlayer({ combat: 3 }));
  const steps = request.select(Transcripts.Turael.variants[Contact._test.SPELL_VARIANT]);
  const texts = steps[1].options.map((option) => option.text);
  assert.equal(texts.some((text) => /another assignment/i.test(text)), false, "no new task");
  assert.equal(texts.some((text) => /rewards|trade/i.test(text)), false, "no rewards or shop");
  const nothing = steps[1].options.find((option) => /nothing/i.test(option.text));
  assert.deepEqual(nothing.steps.map((step) => step.type ?? (step.player ? "player" : "?")), ["player", "end"]);
});

test("Konar's item contact is played whole while the player has a task", () => {
  const [request] = contactFor(createPlayer({ combat: 75, task: true }));
  assert.equal(request.variant, Contact._test.ITEM_VARIANT);
  assert.equal(request.exact, true);
  assert.equal(request.select, undefined, "the transcript's own menu, unedited");
  assert.equal(core.NpcDefinition.forId(request.npcId).getName(), "Konar quo Maten");
  const steps = Transcripts["Konar quo Maten"].variants[Contact._test.ITEM_VARIANT];
  assert.deepEqual(
    steps[1].options.map((option) => option.text),
    ["How am I doing so far?", "Who are you?", "Where are you?", "Got any tips for me?", "Nothing really."],
  );
});

test("when no named variant plays, it falls back to the page's default transcript", () => {
  const requests = contactFor(createPlayer({ combat: 85 })); // Nieve has no Astral Contact variant
  const fallback = requests.at(-1);
  assert.equal(fallback.variant, null);
  assert.equal(typeof fallback.select, "function");
  assert.equal(core.NpcDefinition.forId(fallback.npcId).getName(), "Nieve");
});

test("the worn ring's \"Master\" option is the same action as Rub's Contact Master", () => {
  emitted.length = 0;
  handlerFor("jewellery:action")({
    player: createPlayer({ combat: 3 }), item: { getId: () => 11866 }, action: "Master", equipped: true,
  });
  const [request] = emitted.filter(([name]) => name === "npc-dialogue:start").map(([, payload]) => payload);
  assert.ok(request, "the worn option plays the contact");
  assert.equal(core.NpcDefinition.forId(request.npcId).getName(), "Turael");
});

test("other ring rows are left to their own handler", () => {
  emitted.length = 0;
  handlerFor("jewellery:action")({ player: createPlayer(), item: { getId: () => 11866 }, action: "Open Log" });
  assert.equal(emitted.some(([name]) => name === "npc-dialogue:start"), false);
});
