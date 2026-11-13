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
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const { OptionDialogue } = require("../dist/game/model/dialogues/entries/impl/OptionDialogue");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

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
  // What GameBuilder does after loading: plugins that read the core API in onServerStartup need it before any hook runs.
  PluginManager.emitServerStartup({ timestamp: Date.now() });
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

test("Kolodion's fallback dialogue refuses a player below 60 base Magic", () => {
  const lines = talk(makePlayer({ magic: 59, cape: false }));
  assert.ok(said(lines, /A wizard of your level\? Don't be absurd\./));
});

function talkInWorld(player, npcId, choices = []) {
  const npc = new core.NPC(npcId, player.getLocation());
  if (!PluginManager.emitNpcInteraction({ player, npc, npcId, clickType: 1, handled: false })) return null;
  return play(player, choices);
}

const ARENA_STAGE = "quest.mage_arena_i.stage";
const LEGACY_STAFF = "mage-arena-i:staff-received";
const miniquestCount = player => player.getPacketSender().getVarbit(14162);

test("Mage Arena I: base Magic gates the duel and a refusal keeps it unstarted", () => {
  const boosted = makePlayer({ magic: 59, cape: false });
  boosted.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 70, false);
  assert.ok(said(talkInWorld(boosted, KOLODION), /A wizard of your level/));

  const player = makePlayer({ magic: 60, cape: false });
  const choices = ["Can I fight here?", "Yes indeedy."];
  assert.ok(said(talkInWorld(player, KOLODION, [...choices, "No thanks."]), /^Before I can accept you in, we must duel/));
  assert.ok(!player.getAttribute(ARENA_STAGE));
  assert.ok(said(talkInWorld(player, KOLODION, [...choices, "Okay, let's fight."]), /prove yourself against me/));
  assert.equal(player.getAttribute(ARENA_STAGE), 1);
  core.TaskManager.cancelTasks(player);
});

test("Mage Arena I: the owner's magic-only fight resumes after reload and returns to the bank", (t) => {
  const player = makePlayer({ magic: 60, cape: false });
  const arena = new core.Location(3105, 3934, 0);
  const outside = new core.Location(3105, 3951, 0);
  const bank = new core.Location(2541, 4717, 0);
  const fight = owner => [...core.World.getNpcs()].find(npc => npc?.getOwner() === owner);
  t.after(() => PluginManager.emitPlayerLogout({ player, username: player.getUsername() }));

  player.setAttribute(ARENA_STAGE, 1);
  player.setLocation(arena);
  PluginManager.updatePlayerZones(player);
  const human = fight(player);
  assert.ok(human?.isOwnerOnly());
  assert.equal(human.getId(), core.NpcIdentifiers.KOLODION_3);
  const melee = { type: () => core.CombatType.MELEE };
  const magic = { type: () => core.CombatType.MAGIC };
  assert.equal(PluginManager.emitCanAttack(player, human, melee), false);
  assert.equal(PluginManager.emitCanAttack(makePlayer(), human, magic), false);
  assert.notEqual(PluginManager.emitCanAttack(player, human, magic), false);
  const battleMage = new core.NPC(core.NpcIdentifiers.BATTLE_MAGE, arena);
  assert.equal(PluginManager.emitCanAttack(battleMage, player, magic), false, "a regular mage cannot lock the duelist out");
  assert.equal(PluginManager.emitCanAttack(player, battleMage, magic), false, "a duelist cannot farm mages that cannot retaliate");

  human.setHitpoints(0);
  assert.equal(human.getCurrentDefinition().getId(), core.NpcIdentifiers.KOLODION_4);
  assert.equal(player.getAttribute(ARENA_STAGE), 2);
  player.setLocation(outside);
  PluginManager.updatePlayerZones(player);
  assert.equal(fight(player), undefined);

  const restored = makePlayer({ magic: 60, cape: false });
  t.after(() => PluginManager.emitPlayerLogout({ player: restored, username: restored.getUsername() }));
  PlayerSave.fromPlayer(player).applyToPlayer(restored);
  assert.equal(restored.getAttribute(ARENA_STAGE), 2);
  restored.setLocation(arena);
  PluginManager.updatePlayerZones(restored);
  const resumed = fight(restored);
  assert.equal(resumed.getId(), core.NpcIdentifiers.KOLODION_4);
  for (const [phase, id] of [[2, 1606], [3, 1607], [4, 1608], [5, 1609]]) {
    assert.equal(restored.getAttribute(ARENA_STAGE), phase);
    assert.equal(resumed.getCurrentDefinition().getId(), id);
    assert.equal(resumed.getHitpoints(), resumed.getMaxHitpoints());
    assert.equal(resumed.getCombatMethod().type(), core.CombatType.MAGIC);
    resumed.setHitpoints(0);
  }

  assert.equal(restored.getAttribute(ARENA_STAGE), 6);
  assert.equal(fight(restored), undefined);
  assert.equal(restored.getLocation().equals(bank), true);
  assert.ok(said(play(restored), /^Well done, young adventurer/));
});

test("Mage Arena I: only the matching first staff completes the miniquest and updates the count", () => {
  const player = makePlayer({ inventory: [Items.GUTHIX_CAPE] });
  const arena = QuestRuntime.questNamed("Mage Arena I");
  arena.setStage(player, 6);
  const count = miniquestCount(player);
  require("../plugins/minigames/magearena/MageArenaI.MageArena").recordCapeChoice(player);
  assert.equal(arena.getStage(player), 7);
  assert.equal(arena.isComplete(player), false);
  assert.match(arena.buildJournal(player).join(" "), /Chamber guardian.*staff/);
  assert.equal(miniquestCount(player), count);

  const inventory = player.getInventory();
  for (let slot = 1; slot < 28; slot++) inventory.setItem(slot, new core.Item(Items.BONES, 1));
  const guardian = core.NpcIdentifiers.CHAMBER_GUARDIAN;
  assert.ok(said(talkInWorld(player, guardian), /present you with a magic staff/));
  assert.equal(inventory.getAmount(Items.GUTHIX_STAFF), 0);
  assert.equal(arena.getStage(player), 7);
  assert.equal(miniquestCount(player), count);

  inventory.deleteNumber(Items.BONES, 1);
  assert.ok(said(talkInWorld(player, guardian), /hands you an ornate magic staff/));
  assert.equal(inventory.getAmount(Items.GUTHIX_STAFF), 1);
  assert.equal(player.getPacketSender().getVarp(267), 8);
  assert.equal(arena.isComplete(player), true);
  assert.match(arena.buildJournal(player).join(" "), /MINIQUEST COMPLETE/);
  assert.equal(miniquestCount(player), count + 1);

  talkInWorld(player, guardian);
  assert.equal(inventory.getAmount(Items.GUTHIX_STAFF), 1);
  assert.equal(miniquestCount(player), count + 1);
});

test("Mage Arena I: old cape and staff saves restore their separate reward stages", () => {
  const arena = QuestRuntime.questNamed("Mage Arena I");
  const guardian = core.NpcIdentifiers.CHAMBER_GUARDIAN;
  for (const { staff, expected } of [{ staff: false, expected: 7 }, { staff: true, expected: 8 }]) {
    const original = makePlayer({ inventory: [Items.GUTHIX_CAPE, ...(staff ? [Items.GUTHIX_STAFF] : [])] });
    if (staff) {
      original.setAttribute(ARENA_STAGE, 7);
      original.setAttribute(LEGACY_STAFF, true);
    }
    const restored = makePlayer({ cape: false });
    PlayerSave.fromPlayer(original).applyToPlayer(restored);
    PluginManager.emitPlayerLogin({ player: restored, username: restored.getUsername(), isNewAccount: false });
    PluginManager.emitCustomEvent("player:bootstrap-complete", { player: restored });
    assert.equal(arena.getStage(restored), expected);
    assert.equal(restored.getPacketSender().getVarp(267), expected);
    assert.equal(miniquestCount(restored), staff ? 1 : 0);
    assert.equal(PlayerSave.fromPlayer(restored).attributes[LEGACY_STAFF], undefined);

    if (staff) {
      talkInWorld(restored, guardian);
      assert.equal(restored.getInventory().getAmount(Items.GUTHIX_STAFF), 1);
      assert.equal(miniquestCount(restored), 1);
    }
  }
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

test("a lone remains is handed in with the hand-in's own ending", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.HUNTING, inventory: [Items.ENCHANTED_SYMBOL, Items.JUSTICIARS_HAND, Items.JUSTICIARS_HAND] });
  const lines = talk(player, ["Thanks, bye."]);
  assert.ok(said(lines, /^I've got the remains of the Saradominist justiciar\.$/));
  assert.ok(said(lines, /^Kolodion takes the Justiciar's remains\.$/), "its item box");
  assert.ok(said(lines, /but we aren't finished yet/));
  assert.equal(player.getInventory().contains(Items.JUSTICIARS_HAND), false, "duplicates are all taken (Wiki)");
  assert.ok(player.messages.includes("You hand Kolodion the remains of the Saradominist justiciar."));
  assert.equal(MageArenaII.components(player), 1);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.HUNTING);
});

test("all carried remains go in one conversation, straight on to the god cape (235/03344)", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.HUNTING, inventory: [Items.ENCHANTED_SYMBOL, Items.JUSTICIARS_HAND, Items.ENTS_ROOTS, Items.DEMONS_HEART] });
  const lines = talk(player, []);
  const handed = lines.filter((line) => /^I've got the remains of /.test(line));
  assert.deepEqual(handed, [
    "I've got the remains of the Saradominist justiciar.",
    "I've got the remains of the Guthixian Ent.",
    "I've got the remains of the Zamorakian Demon.",
  ]);
  assert.equal(said(lines, /but we aren't finished yet/), false);
  assert.ok(said(lines, /now you just need to hand me the god cape you wish to have imbued/));
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.ALL_REMAINS);
  assert.equal(MageArenaII.components(player), MageArenaII.ALL_COMPONENTS);
  assert.equal(player.messages.filter((m) => /^You hand Kolodion the remains of /.test(m)).length, 3);
});

test("a god cape before all three remains is nothing to Kolodion", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.HUNTING, inventory: [Items.ZAMORAK_CAPE] });
  assert.equal(useOnKolodion(player, Items.ZAMORAK_CAPE).handled, false);
});

test("the first imbue takes the three remains and quietly completes the miniquest", () => {
  const player = makePlayer({ stage: MageArenaII.STAGE.ALL_REMAINS, components: 7, inventory: [Items.ZAMORAK_CAPE] });
  const { handled, lines } = useOnKolodion(player, Items.ZAMORAK_CAPE, ["Yes."]);
  assert.equal(handled, true);
  assert.ok(said(lines, /^Kolodion takes your cape and imbues it with the power of the gods/));
  assert.equal(player.getInventory().contains(Items.ZAMORAK_CAPE), false);
  assert.equal(player.getInventory().getAmount(Items.IMBUED_ZAMORAK_CAPE), 1);
  assert.equal(MageArenaII.stageOf(player), MageArenaII.STAGE.COMPLETE);
  assert.equal(MageArenaII.components(player), 0);
  assert.equal(player.messages.some((message) => /completed a quest/.test(message)), false, "no announcement, as live");
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

// Issue #4374: the journal's lines fit its width. Live's completed journal (RSProx 3344 rev 235
// t163174-163188), line for line; no line at any stage is longer than live's longest.
test("Mage Arena I: the journal is live's short lines, so nothing runs past the box", () => {
  const arena = QuestRuntime.questNamed("Mage Arena I");
  const player = makePlayer();
  arena.setStage(player, 8);
  assert.deepEqual(arena.buildJournal(player), [
    "<str>I spoke to Kolodion in the Mage Arena basement. He said I",
    "<str>could train in the Mage Arena if I dueled him.",
    "<str>I have killed Kolodion's human form.",
    "<str>I have killed Kolodion's ogre form.",
    "<str>I have killed Kolodion's spider form.",
    "<str>I have killed Kolodion's ethereal form.",
    "<str>I have killed Kolodion's demonic form and finally defeated",
    "<str>Kolodion.",
    "<str>I travelled through the magical pool to find a chamber",
    "<str>containing statues of the gods. I chanted at the statue of my",
    "<str>chosen god and received a cape.",
    "<str>The Chamber Guardian presented me with a staff of my",
    "<str>chosen god.",
    "",
    "<col=ff0000>MINIQUEST COMPLETE!",
  ]);
  const longest = "containing statues of the gods. I chanted at the statue of my".length;
  for (let stage = 0; stage <= 8; stage++) {
    arena.setStage(player, stage);
    const lines = arena.buildJournal(player);
    assert.ok(lines.length > 0, `stage ${stage}`);
    for (const line of lines) {
      assert.ok(line.replace(/<[^>]*>/g, "").length <= longest, `stage ${stage}: "${line}"`);
    }
  }
  arena.setStage(player, 3);
  assert.deepEqual(arena.buildJournal(player).slice(-2), [
    "I have killed Kolodion's human form.",
    "I have killed Kolodion's ogre form.",
  ], "the forms killed so far, not yet struck");
});
