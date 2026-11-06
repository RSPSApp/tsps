// Varrock Museum natural history quiz: Orlando Smith, the 14 plaques and the reward.
// From server/: node --test tests/natural-history-quiz.test.cjs
//
// Plays the quiz through the plugin's registered handlers and the real NpcDialogues
// transcript runtime, and checks it against the rsprox capture (recording 1723).
const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { DialogueManager } = require("../dist/game/model/dialogues/DialogueManager");
const { TaskManager } = require("../dist/game/task/TaskManager");

const NpcDialogues = require("../plugins/npcs/NpcDialogues.plugin.js");
const Museum = require("../plugins/world/Museum.plugin.js");
const QUIZ = require("../plugins/world/data/natural-history-quiz.json");

const STATE = "museum:natural-history";
const KUDOS = "museum:kudos";

let ids;
let baseVariantHooks = 0;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  baseVariantHooks = PluginManager.npcDialogueVariantHooks.length;
  ids = {
    orlando: CacheDefinitions.getNpcId("vm_nathis_apprentice"),
    quiz: CacheDefinitions.getInterfaceId("vm_natural_history"),
    question: CacheDefinitions.getComponentId("vm_natural_history:vm_nathis_question"),
    quizText: CacheDefinitions.getComponentId("vm_natural_history:vm_nathis_quiz_text"),
    answers: [1, 2, 3].map((n) => CacheDefinitions.getComponentId(`vm_natural_history:vm_nathis_answer_0${n}`)),
    agreed: CacheDefinitions.getVarbitId("vm_nathis_agreed"),
    rewarded: CacheDefinitions.getVarbitId("vm_nathis_reward_given"),
    alldone: CacheDefinitions.getVarbitId("vm_nathis_display_alldone"),
    ponder: CacheDefinitions.getSeqId("vm_display_case_ponder"),
  };
});
afterEach(() => {
  PluginManager.npcDialogueVariantHooks.length = baseVariantHooks;
});

function makePlayer(attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  const messages = [], texts = [], strings = new Map(), hidden = new Map(), sounds = [], animations = [];
  const rotates = [], scripts = [];
  const experience = new Map();
  const varps = new Map();
  let interfaceId = -1;
  let menu = null;
  const sender = new Proxy({
    sendVarbit(id, value) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
      varps.set(baseVar, ((varps.get(baseVar) ?? 0) & ~mask) | ((value << startBit) & mask));
      return sender;
    },
    getVarbit(id) {
      const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
      return ((varps.get(baseVar) ?? 0) >>> startBit) & ((1 << (endBit - startBit + 1)) - 1);
    },
    sendString(text, uid) { strings.set(uid, text); return sender; },
    sendInterfaceDisplayState(uid, hide) { hidden.set(uid, hide); return sender; },
    sendInterface(id) { interfaceId = id; return sender; },
    // As the real one: closing interfaces also ends the dialogue.
    sendInterfaceRemoval() { interfaceId = -1; player.manager.reset(); return sender; },
    sendSound(id) { sounds.push(id); return sender; },
    sendInterfaceRotateSpeed(uid, speedX, speedY) { rotates.push({ uid, speedX, speedY }); return sender; },
    sendClientScript(id, ...args) { scripts.push({ id, args }); return sender; },
    isChatboxInterface() { return true; },
  }, { get(target, key) { return key in target ? target[key] : () => sender; } });
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => { attrs.set(key, value); },
    getUsername: () => "quiz-test", getDisplayName: () => "quiz-test",
    getAppearance: () => ({ isMale: () => true }),
    getPacketSender: () => sender,
    getDialogueManager: () => player.manager,
    getInterfaceId: () => interfaceId,
    isRegistered: () => true,
    performAnimation: (animation) => animations.push(animation.getId()),
    sendMessage: (message) => messages.push(message),
    getSkillManager: () => ({
      addExperience(skill, amount) { experience.set(skill.getName(), (experience.get(skill.getName()) ?? 0) + amount); },
    }),
    varbit: (id) => sender.getVarbit(id),
    get menu() { return menu; },
    set menu(value) { menu = value; },
    attrs, messages, texts, strings, hidden, sounds, animations, experience, rotates, scripts,
  };
  player.manager = new DialogueManager(player);
  return player;
}

function makeWorld() {
  const custom = new Map(), object = new Map(), buttons = new Map(), login = [];
  let anyNpc = null;
  const api = {
    core: PluginManager.getCoreApi(),
    persistAttribute() {},
    onCustomEvent(name, handler) { custom.set(name, [...(custom.get(name) ?? []), handler]); },
    emitCustomEvent(name, payload) { for (const handler of custom.get(name) ?? []) handler(payload); },
    onObjectInteraction(name, actions) { object.set(name, { ...(object.get(name) ?? {}), ...actions }); },
    onItemOnObject() {},
    onItemOnNpc() {},
    onItemAction() {},
    onNpcDialogueCondition() {},
    onNpcDialogueVariant(handler) { PluginManager.npcDialogueVariantHooks.push({ pluginName: "QuizTest", handler }); },
    onInterfaceActionButton(uid, handler) { buttons.set(uid, handler); },
    onAnyNpcInteraction(actions) { anyNpc = actions; },
    onPlayerLogin(handler) { login.push(handler); },
    registerArea() {},
    sendMultiChatboxPrompt(player, _title, ...flat) {
      const options = [];
      for (let i = 0; i < flat.length; i += 2) options.push([flat[i], flat[i + 1]]);
      player.menu = { options };
      return true;
    },
  };
  Museum.register(api);
  NpcDialogues.register(api);
  return { api, object, buttons, login, get anyNpc() { return anyNpc; } };
}

/** Continue every chat line (picking `choice` at a menu) until the dialogue ends. */
function play(player, choice) {
  for (let guard = 0; guard < 200; guard++) {
    if (player.menu) {
      const { options } = player.menu;
      player.menu = null;
      const option = options.find(([label]) => label === choice);
      assert.ok(option, `no ${JSON.stringify(choice)} in ${JSON.stringify(options.map(([label]) => label))}`);
      option[1]();
      continue;
    }
    const current = player.getDialogueManager().getCurrent();
    if (!current) return;
    const text = current.getText?.();
    // NpcDialogues joins its wrapped lines with a space, so a wrapped line can carry two.
    if (text) player.texts.push(text.replace(/\s+/g, " "));
    player.getDialogueManager().advance();
  }
  assert.fail("dialogue did not finish");
}

/** Continue chat lines until the quiz interface is open again or the dialogue ends. */
function continueChat(player, quizId) {
  for (let guard = 0; guard < 20; guard++) {
    const current = player.getDialogueManager().getCurrent();
    if (!current || player.getInterfaceId() === quizId) return;
    const text = current.getText?.();
    if (text) player.texts.push(text);
    player.getDialogueManager().advance();
  }
}

function talkToOrlando(world, player, choice) {
  world.anyNpc["Talk-to"]({
    player, npc: { getId: () => ids.orlando }, npcId: ids.orlando,
    definition: world.api.core.NpcDefinition.forId(ids.orlando), handled: false,
  });
  play(player, choice);
}

function study(world, player, entry) {
  const objectId = CacheDefinitions.getLocId(entry.plaque);
  return world.object.get("Plaque").Study({ player, objectId, location: { x: 0, y: 0, z: 0 } });
}

function click(world, player, index) {
  world.buttons.get(ids.answers[index])({ player });
}

function finishCase(world, player, entry) {
  study(world, player, entry);
  for (const question of entry.questions) {
    assert.equal(player.strings.get(ids.question), question.question);
    click(world, player, question.correct);
    continueChat(player, ids.quiz);
  }
}

test("a plaque before agreeing gives the Wiki message and no quiz", () => {
  const world = makeWorld();
  const player = makePlayer();
  assert.equal(study(world, player, QUIZ.cases[0]), true);
  assert.deepEqual(player.animations, [ids.ponder]);
  assert.deepEqual(player.messages, ["This looks like some sort of quiz. I wonder if I can take part..."]);
  assert.equal(player.getInterfaceId(), -1);
});

test("Orlando's \"Sure thing.\" starts the quiz", () => {
  const world = makeWorld();
  const player = makePlayer();
  talkToOrlando(world, player, "Sure thing.");
  assert.equal(player.texts[0], "G'day there, mate.");
  assert.equal(player.varbit(ids.agreed), 1);
  assert.equal(player.attrs.get(STATE).agreed, true);
});

test("questions, answers and progress follow the capture", () => {
  const world = makeWorld();
  const player = makePlayer({ [STATE]: { agreed: true } });
  const lizard = QUIZ.cases.find((entry) => entry.plaque === "vm_plaque_lizard");
  const varbit = CacheDefinitions.getVarbitId(lizard.varbit);

  study(world, player, lizard);
  assert.equal(player.getInterfaceId(), ids.quiz);
  assert.equal(player.strings.get(ids.question), "What order do lizards belong to?");
  assert.deepEqual(ids.answers.map((uid) => player.strings.get(uid)), ["Mammal.", "Squamata.", "Insecta."]);
  assert.equal(player.hidden.get(ids.quizText), false);

  // Wrong: Orlando's Wiki reply, then the same question again.
  click(world, player, 0);
  assert.equal(player.varbit(varbit), 0);
  continueChat(player, ids.quiz);
  assert.equal(player.texts.at(-1), "Hmm, I don't think that's right, mate. Try again.");
  assert.equal(player.strings.get(ids.question), "What order do lizards belong to?");

  click(world, player, 1);
  assert.equal(player.varbit(varbit), 1);
  assert.deepEqual(player.sounds, [3648]);
  continueChat(player, ids.quiz);
  assert.equal(player.texts.at(-1), "Nice job, mate. That looks about right.");
  assert.equal(player.strings.get(ids.question), "How does a lizard regulate body heat?");

  click(world, player, 2);
  continueChat(player, ids.quiz);
  click(world, player, 0);
  assert.equal(player.varbit(varbit), 3);
  assert.equal(player.attrs.get(KUDOS), 2);
  assert.deepEqual(player.sounds, [3648, 3648, 3648, 3653]);
  assert.ok(player.messages.includes("You have earned Kudos with the Museum!"));
  continueChat(player, ids.quiz);
  assert.deepEqual(player.texts.slice(-2), ["Nice job, mate. That looks about right.", "Bonza, mate! I think that's all of them."]);
  assert.equal(player.getInterfaceId(), -1);

  // A finished case shows its display without the quiz, and its buttons do nothing.
  study(world, player, lizard);
  assert.equal(player.getInterfaceId(), ids.quiz);
  assert.equal(player.hidden.get(ids.quizText), true);
  click(world, player, 0);
  assert.equal(player.attrs.get(KUDOS), 2);
});

test("only the captured quiz model components get native rotate speed", () => {
  const world = makeWorld();
  const player = makePlayer({ [STATE]: { agreed: true } });
  // Recording 1723 (rev 227): IF_SETROTATESPEED (0, 5) on vm_natural_history components
  // 2, 3, 7-12, 17-20 only; the dragon (4-6) and seaslug (13-16) models got no packet.
  const captured = [2, 3, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20];
  const rotated = [];
  for (const entry of QUIZ.cases) {
    player.rotates.length = 0;
    study(world, player, entry);
    for (const call of player.rotates) {
      assert.equal(call.speedX, 0);
      assert.equal(call.speedY, 5);
      assert.equal(Math.floor(call.uid / 0x10000), ids.quiz);
      rotated.push(call.uid & 0xffff);
    }
  }
  assert.deepEqual(rotated.sort((a, b) => a - b), captured);
  // The interim cache spinner script is gone: the native packet carries the rotation, so
  // there is no second timer running at its own speed.
  assert.deepEqual(player.scripts, []);
});

test("all 14 cases, then Orlando's reward once", () => {
  const world = makeWorld();
  const player = makePlayer();
  talkToOrlando(world, player, "Sure thing.");
  for (const entry of QUIZ.cases) finishCase(world, player, entry);
  assert.equal(player.attrs.get(KUDOS), 28);
  // 14 two-bit cases full, as the capture's vm_nathis_display_alldone 2^28 - 1.
  assert.equal(player.varbit(ids.alldone), 2 ** 28 - 1);

  player.texts.length = 0;
  talkToOrlando(world, player);
  assert.equal(player.texts[0], "G'day there, mate. How're the display cases coming along?");
  // The whole hand-in plays: a level-up pop-up mid-chat would have cut it off.
  assert.equal(player.texts.at(-1), "Goodbye.");
  assert.equal(player.varbit(ids.rewarded), 1);
  assert.ok(player.messages.includes("You have gained 1000xp in Slayer and Hunter."));
  // The XP lands on the next tick, once the chat is closed.
  assert.equal(player.experience.size, 0);
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(Object.fromEntries(player.experience), { Slayer: 1000, Hunter: 1000 });

  player.texts.length = 0;
  talkToOrlando(world, player);
  assert.deepEqual(player.texts, ["Thanks for all your help, mate. Hope you enjoy the museum!"]);
  assert.deepEqual(Object.fromEntries(player.experience), { Slayer: 1000, Hunter: 1000 });
});

test("XP still owed from a hand-in cut short arrives on the next login", () => {
  const world = makeWorld();
  const cases = Object.fromEntries(QUIZ.cases.map((entry) => [entry.varbit, 3]));
  const player = makePlayer({ [STATE]: { agreed: true, rewarded: true, xpPending: true, cases } });
  for (const handler of world.login) handler({ player });
  assert.deepEqual(Object.fromEntries(player.experience), { Slayer: 1000, Hunter: 1000 });
  for (const handler of world.login) handler({ player });
  assert.deepEqual(Object.fromEntries(player.experience), { Slayer: 1000, Hunter: 1000 });
});

test("login restores the quiz varbits", () => {
  const world = makeWorld();
  const dragon = QUIZ.cases[0];
  const player = makePlayer({ [STATE]: { agreed: true, cases: { [dragon.varbit]: 2 } } });
  for (const handler of world.login) handler({ player });
  assert.equal(player.varbit(ids.agreed), 1);
  assert.equal(player.varbit(CacheDefinitions.getVarbitId(dragon.varbit)), 2);
});
