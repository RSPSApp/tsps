// Kolodion and Mage Arena II's talk, hand-ins and imbuing (issue #3701). Run after `yarn build`:
// node --test tests/mage-arena-kolodion.test.cjs
// Every plugin is loaded through the real PluginManager; a real Player talks to Kolodion through the
// real transcript runtime, its real DialogueManager and native chatbox prompts. Only the network is stubbed.
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
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");

const core = PluginManager.getCoreApi();
const Items = core.ItemIdentifiers;
const KOLODION = core.NpcIdentifiers.KOLODION;
let MageArena;
let MageArenaII;
let Statues;
let Spells;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  await PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  MageArena = require("../plugins/minigames/MageArena.plugin");
  MageArenaII = require("../plugins/minigames/magearena/MageArenaII.MageArena");
  Statues = require("../plugins/minigames/magearena/Statues.MageArena");
  Spells = require("../plugins/minigames/magearena/Spells.MageArena");
});

function makePlayer({ magic = 99, cape = true, casts = [100, 100, 100], stage = 0, components = 0, inventory = [] } = {}) {
  const player = new Player(null);
  player.getSession = () => ({ sendClientPacket: () => true });
  player.setUsername("ma2 tester");
  player.setRegistered(true);
  const messages = [];
  const send = player.sendMessage.bind(player);
  player.sendMessage = (message) => { messages.push(message); return send(message); };
  player.messages = messages;
  const skills = player.getSkillManager();
  skills.setExperience(core.Skill.MAGIC, core.SkillManager.getExperienceForLevel(magic));
  skills.setMaxLevel(core.Skill.MAGIC, magic, false).setCurrentLevel(core.Skill.MAGIC, magic, false);
  if (cape) player.setAttribute(Statues.CAPE_RECEIVED_ATTRIBUTE, true);
  Spells.GODS.forEach((god, i) => player.setAttribute(god.counter, casts[i]));
  if (stage) MageArenaII.setStage(player, stage);
  MageArenaII.setComponents(player, components);
  for (const id of inventory) player.getInventory().adds(id, 1);
  return player;
}

/** Plays whatever is on screen, picking `choices` in order at each menu; returns what was said. */
function play(player, choices = []) {
  const lines = [];
  const manager = player.getDialogueManager();
  const picks = [...choices];
  for (let guard = 0; guard < 80; guard++) {
    const prompt = MultiChatboxPrompt.getPending(player);
    if (prompt) {
      const wanted = picks.shift();
      const index = prompt.options.indexOf(wanted);
      assert.ok(index >= 0, `menu ${JSON.stringify(prompt.options)} offers ${wanted}`);
      lines.push(`> ${wanted}`);
      MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, slot: index + 1 });
      continue;
    }
    const current = manager.getCurrent();
    if (!current) break;
    if (current instanceof OptionDialogue) {
      const wanted = picks.shift();
      const index = current.getOptions().indexOf(wanted);
      assert.ok(index >= 0, `options ${JSON.stringify(current.getOptions())} offer ${wanted}`);
      lines.push(`> ${wanted}`);
      manager.handleOption(index + 1);
      continue;
    }
    if (typeof current.getText === "function") lines.push(String(current.getText()).replace(/\s+/g, " "));
    manager.advance();
  }
  return lines;
}

function talk(player, choices) {
  const request = { player, npc: null, npcId: KOLODION, handled: false };
  PluginManager.emitCustomEvent("npc-dialogue:start", request);
  assert.equal(request.handled, true, "Kolodion's transcript plays");
  return play(player, choices);
}

function useOnKolodion(player, itemId, choices) {
  const target = new core.NPC(KOLODION, new core.Location(2542, 4715, 0));
  const event = { player, target, definition: NpcDefinition.forId(KOLODION), npcId: KOLODION, itemId, item: new core.Item(itemId, 1), slot: 0, handled: false };
  const handled = PluginManager.emitItemOnNpc(event);
  return { handled, lines: handled ? play(player, choices) : [] };
}

const CHALLENGES = "Are there any more challenges available?";
const ACCEPT = "Great, I've been waiting for an improvement!";
const PROGRESS = "How can I use my new spells outside of the arena?";
const said = (lines, pattern) => lines.some((line) => pattern.test(line));

test("without Mage Arena I's god cape Kolodion turns away even a 99 Magic player", () => {
  const lines = talk(makePlayer({ cape: false }));
  assert.ok(said(lines, /A wizard of your level\? Don't be absurd\./));
});

test("after Mage Arena I: one progress line per god spell from its arena casts", () => {
  const lines = talk(makePlayer({ casts: [50, 89, 100] }), [PROGRESS]);
  assert.ok(said(lines, /^You still need to train with the strike spell/));
  assert.ok(said(lines, /^You have completed over half of the training needed to use the claw spell/));
  assert.ok(said(lines, /^You're experienced enough to use the flame spell anywhere\./));
  assert.equal(lines.filter((line) => /spell (inside|outside|anywhere)/.test(line)).length, 3);
  const edges = talk(makePlayer({ casts: [51, 90, 99] }), [PROGRESS]);
  assert.ok(said(edges, /over half of the training needed to use the strike spell/));
  assert.ok(said(edges, /almost ready to use the claw spell/));
  assert.ok(said(edges, /almost ready to use the flame spell/));
});

test("more challenges: spells first, then 75 base Magic", () => {
  assert.ok(said(talk(makePlayer({ casts: [100, 100, 99] }), [CHALLENGES]), /still need to learn how to cast all god spells/));
  const boosted = makePlayer({ magic: 74 });
  boosted.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 80, false);
  assert.ok(said(talk(boosted, [CHALLENGES]), /a wizard of your level wouldn't stand a chance/));
  assert.equal(MageArenaII.stageOf(boosted), MageArenaII.STAGE.NOT_STARTED);
});

test("starting Mage Arena II hands over one enchanted symbol", () => {
  const player = makePlayer();
  const lines = talk(player, [CHALLENGES, ACCEPT, "Thanks, bye."]);
  assert.ok(said(lines, /^Kolodion hands you an enchanted symbol\.$/), "the hand-out shows as its item box");
  assert.equal(player.getInventory().getAmount(Items.ENCHANTED_SYMBOL), 1);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.HUNTING);
  // Talking again with it owned hands out no second one.
  talk(player, ["Thanks, bye."]);
  assert.equal(player.getInventory().getAmount(Items.ENCHANTED_SYMBOL), 1);
});

test("a full pack gets the symbol on the next talk, once there's room", () => {
  const player = makePlayer();
  player.getInventory().adds(Items.COINS, 1);
  for (let i = player.getInventory().getFreeSlots(); i > 0; i--) player.getInventory().adds(Items.BONES, 1);
  const lines = talk(player, [CHALLENGES, ACCEPT]);
  assert.ok(said(lines, /free up an inventory space/));
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.STARTED);
  assert.equal(player.getInventory().contains(Items.ENCHANTED_SYMBOL), false);
  player.getInventory().delete(Items.BONES, 1);
  talk(player, ["Thanks, bye."]);
  assert.equal(player.getInventory().getAmount(Items.ENCHANTED_SYMBOL), 1);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.HUNTING);
});

test("a lost symbol is replaced; a banked one isn't", () => {
  const lost = makePlayer({ stage: MageArenaII.STAGE.HUNTING });
  talk(lost, ["Thanks, bye."]);
  assert.equal(lost.getInventory().getAmount(Items.ENCHANTED_SYMBOL), 1);
  const banked = makePlayer({ stage: MageArenaII.STAGE.HUNTING });
  banked.getBank(0).add(new core.Item(Items.ENCHANTED_SYMBOL, 1), false);
  talk(banked, ["Thanks, bye."]);
  assert.equal(banked.getInventory().contains(Items.ENCHANTED_SYMBOL), false);
});

test("remains are handed in one per talk; the third moves on to the god cape", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.HUNTING, inventory: [Items.ENCHANTED_SYMBOL, Items.JUSTICIARS_HAND, Items.JUSTICIARS_HAND] });
  const first = talk(player, ["Thanks, bye."]);
  assert.ok(said(first, /^I've got the remains of the Saradominist justiciar\.$/));
  assert.ok(said(first, /but we aren't finished yet/));
  assert.equal(player.getInventory().contains(Items.JUSTICIARS_HAND), false, "duplicates are all taken (Wiki)");
  assert.ok(player.messages.includes("You hand Kolodion the remains of the Saradominist justiciar."));
  assert.equal(MageArenaII.components(player), 1);

  player.getInventory().adds(Items.ENTS_ROOTS, 1);
  talk(player, ["Thanks, bye."]);
  assert.equal(MageArenaII.components(player), 3);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.HUNTING);

  player.getInventory().adds(Items.DEMONS_HEART, 1);
  const third = talk(player, []);
  assert.ok(said(third, /^I've got the remains of the Zamorakian Demon\.$/));
  assert.ok(said(third, /now you just need to hand me the god cape you wish to have imbued/));
  assert.equal(said(third, /but we aren't finished yet/), false);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.ALL_REMAINS);
  assert.equal(MageArenaII.components(player), MageArenaII.ALL_COMPONENTS);
});

test("a god cape before all three remains is nothing to Kolodion", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.HUNTING, inventory: [Items.ZAMORAK_CAPE] });
  assert.equal(useOnKolodion(player, Items.ZAMORAK_CAPE).handled, false);
});

test("the first imbue takes the three remains and completes the miniquest", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.ALL_REMAINS, components: 7, inventory: [Items.ZAMORAK_CAPE] });
  const { handled, lines } = useOnKolodion(player, Items.ZAMORAK_CAPE, ["Yes."]);
  assert.equal(handled, true);
  assert.ok(said(lines, /^Kolodion takes your cape and imbues it with the power of the gods/));
  assert.equal(player.getInventory().contains(Items.ZAMORAK_CAPE), false);
  assert.equal(player.getInventory().getAmount(Items.IMBUED_ZAMORAK_CAPE), 1);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.COMPLETE);
  assert.equal(MageArenaII.components(player), 0);
  assert.ok(player.messages.some((message) => /completed a quest: .*Mage Arena II/.test(message)));
});

test('choosing "No." keeps the cape', () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.ALL_REMAINS, components: 7, inventory: [Items.GUTHIX_CAPE] });
  useOnKolodion(player, Items.GUTHIX_CAPE, ["No."]);
  assert.equal(player.getInventory().contains(Items.GUTHIX_CAPE), true);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.ALL_REMAINS);
});

test("after the miniquest each further cape needs its own follower's remains", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.COMPLETE, inventory: [Items.SARADOMIN_CAPE] });
  const refused = useOnKolodion(player, Items.SARADOMIN_CAPE, []);
  assert.ok(said(refused.lines, /You'll have to bring me the Saradomin creature's remains to imbue this cape\./));
  assert.equal(said(refused.lines, /^> /), false, "no Yes/No menu");
  assert.equal(player.getInventory().contains(Items.SARADOMIN_CAPE), true);

  player.getInventory().adds(Items.JUSTICIARS_HAND, 1);
  useOnKolodion(player, Items.SARADOMIN_CAPE, ["Yes."]);
  assert.equal(player.getInventory().getAmount(Items.IMBUED_SARADOMIN_CAPE), 1);
  assert.equal(player.getInventory().contains(Items.JUSTICIARS_HAND), false);
  assert.equal(MageArenaII.components(player), 0);
});

test("after the miniquest Kolodion keeps carried remains and names the capes he can imbue", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.COMPLETE, inventory: [Items.ENCHANTED_SYMBOL, Items.ENTS_ROOTS] });
  const lines = talk(player, []);
  assert.equal(player.getInventory().contains(Items.ENTS_ROOTS), false);
  assert.equal(MageArenaII.components(player), 2);
  assert.ok(lines.includes("You may currently have a Guthix cape imbued, just hand over the cape when you're ready."));
});

test("after the miniquest a symbol is offered again when none is owned", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.COMPLETE });
  talk(player, ["Thanks, bye."]);
  assert.equal(player.getInventory().getAmount(Items.ENCHANTED_SYMBOL), 1);
});

test("Mage Arena II is a registered miniquest with the cache row's stages", () => {
  const QuestRuntime = require("../plugins/quests/QuestRuntime");
  const quest = QuestRuntime.questNamed("Mage Arena II");
  assert.ok(quest);
  assert.equal(quest.varbitId, 6067);
  assert.equal(quest.completionValue, 4);
  assert.equal(quest.questPoints, 0);
  assert.ok(MageArena.members);
  // Lost Property's imbued god cape rows ask this (lost-property.json "quest": "Mage Arena II").
  const ask = (player) => {
    const request = { player, name: "Mage Arena II", complete: null };
    PluginManager.emitCustomEvent("quest:is-complete", request);
    return request.complete;
  };
  assert.equal(ask(makePlayer({ stage: MageArenaII.STAGE.ALL_REMAINS })), false);
  assert.equal(ask(makePlayer({ stage: MageArenaII.STAGE.COMPLETE })), true);
});
