// Kolodion's Talk-to branch and conditions (issue #3701). Run after `yarn build`:
// node --test tests/mage-arena-kolodion.test.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { NpcDefinition } = require("../dist/game/definition/NpcDefinition");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { startDialogue } = require("../plugins/npcs/NpcDialogues.plugin");
const MageArena = require("../plugins/minigames/MageArena.plugin");
const data = require("../data/definitions/npc-dialogues.json");

const core = PluginManager.getCoreApi();
const { kolodion, spells, statues } = MageArena._test;
const [SARADOMIN, GUTHIX, ZAMORAK] = spells.GODS;
const KOLODION = core.NpcIdentifiers.KOLODION;
const variants = [];
const conditions = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  // The unit alone, as MageArena.register wires it.
  require("../plugins/minigames/magearena/Kolodion.MageArena")({
    core,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
  });
});

function makePlayer({ magic = 99, cape = true, casts = [0, 0, 0] } = {}) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true }); // Only the network is stubbed.
  const skills = player.getSkillManager();
  skills.setExperience(core.Skill.MAGIC, core.SkillManager.getExperienceForLevel(magic));
  skills.setMaxLevel(core.Skill.MAGIC, magic, false).setCurrentLevel(core.Skill.MAGIC, magic, false);
  if (cape) player.setAttribute(statues.CAPE_RECEIVED_ATTRIBUTE, true);
  [SARADOMIN, GUTHIX, ZAMORAK].forEach((god, i) => player.setAttribute(god.counter, casts[i]));
  return player;
}

function context(player) {
  return { player, npcId: KOLODION, definition: NpcDefinition.forId(KOLODION), pages: [] };
}

function variantFor(player) {
  return variants.map((handler) => handler(context(player))).find((answer) => answer != null) ?? null;
}

/**
 * Kolodion's lines after choosing `option` in the after-Mage-Arena-I menu, played by the real
 * Talk-to runner (startDialogue). Only the dispatch to plugin condition handlers is routed to this
 * unit's handler, and the chat chain is walked instead of sent to a client.
 */
function linesAfter(t, player, option) {
  const menu = data.Kolodion.variants[kolodion.AFTER_MAGE_ARENA_I].find((step) => step.type === "choice");
  const chosen = menu.options.find((each) => each.text === option);
  t.mock.method(PluginManager, "emitNpcDialogueCondition", (event) =>
    conditions.map((handler) => handler(event)).find((answer) => answer != null) ?? null);
  let chain = null;
  let current = null;
  const manager = {
    reset() { current = null; },
    getCurrent: () => current,
    startDialogues(builder) { chain = builder; current = [...builder.getDialogues().values()][0]; },
  };
  const talker = new Proxy(player, {
    get: (target, key) => (key === "getDialogueManager" ? () => manager : Reflect.get(target, key, target)),
  });
  const lines = [];
  startDialogue({ core, emitCustomEvent() {} }, { ...context(talker) }, chosen.steps, {}, { ...context(talker) });
  for (let guard = 0; guard < 50 && chain; guard++) {
    const entries = [...chain.getDialogues().values()];
    chain = null;
    // NpcDialogue lines, unwrapped from the chatbox's line breaks.
    for (const entry of entries) if (entry instanceof core.NpcDialogue) lines.push(String(entry.getText()).replace(/\s+/g, " "));
    current = entries.at(-1);
    current.send(talker);
  }
  return lines;
}

const PROGRESS = "How can I use my new spells outside of the arena?";
const CHALLENGES = "Are there any more challenges available?";

test("Kolodion's cache name is what the unit keys on", () => {
  assert.equal(NpcDefinition.forId(KOLODION).getName(), "Kolodion");
});

test("a player with the Mage Arena I god cape gets the after-Mage-Arena-I talk, whatever their Magic", () => {
  assert.equal(variantFor(makePlayer({ magic: 99 })), kolodion.AFTER_MAGE_ARENA_I);
  assert.equal(variantFor(makePlayer({ magic: 60 })), kolodion.AFTER_MAGE_ARENA_I);
  assert.equal(variantFor(makePlayer({ magic: 99, cape: false })), null, "the default plays until Mage Arena I");
  assert.equal(data.Kolodion.default, "without-level-60-magic");
});

test("the progress report gives one line per god spell from its arena casts", (t) => {
  const lines = linesAfter(t, makePlayer({ casts: [50, 89, 100] }), PROGRESS);
  assert.deepEqual(lines.slice(-3), [
    "You still need to train with the strike spell inside the arena before you can use it outside.",
    "You have completed over half of the training needed to use the claw spell outside of the arena.",
    "You're experienced enough to use the flame spell anywhere.",
  ]);
  const edges = linesAfter(t, makePlayer({ casts: [51, 90, 99] }), PROGRESS);
  assert.deepEqual(edges.slice(-3), [
    "You have completed over half of the training needed to use the strike spell outside of the arena.",
    "You are almost ready to use the claw spell outside of the arena.",
    "You are almost ready to use the flame spell outside of the arena.",
  ]);
});

test("every cast-count tier's step id is in the generated transcript, in order", () => {
  const menu = data.Kolodion.variants[kolodion.AFTER_MAGE_ARENA_I].find((step) => step.type === "choice");
  const ids = menu.options.find((each) => each.text === PROGRESS).steps.filter((step) => step.type === "condition").map((step) => step.id);
  assert.deepEqual(ids, kolodion.TIERS.flatMap((tier) => tier.ids));
});

test("more challenges: spells first, then 75 Magic, then the hand-over to Mage Arena II", (t) => {
  assert.deepEqual(linesAfter(t, makePlayer({ casts: [100, 100, 99] }), CHALLENGES), [
    "You still need to learn how to cast all god spells outside of the arena.",
    "I've made a note of the spells you still need to learn in your journal.",
  ]);
  const low = linesAfter(t, makePlayer({ magic: 74, casts: [100, 100, 100] }), CHALLENGES);
  assert.equal(low.at(-1), "However, a wizard of your level wouldn't stand a chance.");
  const ready = linesAfter(t, makePlayer({ magic: 75, casts: [100, 100, 100] }), CHALLENGES);
  assert.equal(ready.length, 1);
  assert.match(ready[0], /^I am one of the most powerful mages in existence\./);
});

test("75 Magic is the base level, not a boost", (t) => {
  const player = makePlayer({ magic: 70, casts: [100, 100, 100] });
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 80, false);
  assert.equal(linesAfter(t, player, CHALLENGES).at(-1), "However, a wizard of your level wouldn't stand a chance.");
});

test("other NPCs' conditions and variants are left alone", () => {
  const event = { player: makePlayer(), npcId: 1, definition: NpcDefinition.forId(1), pages: [], text: "If player doesn't have 75 Magic:" };
  assert.equal(kolodion.answerCondition(event), null);
  assert.equal(kolodion.pickVariant(event), null);
});
