const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');

let core, Data, Progress, diary, quest, task, deathAltar, deathRift, deathRuins, successReceipt;
const teleports = [];
const objectActions = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const api = PluginManager.createApi('ArdougneDeathRunesDiaryTest');
  api.onCustomEvent('runecrafting:success', event => { successReceipt = event; });
  api.onCustomEvent('lever:teleport', event => teleports.push(event));
  const onObjectInteraction = api.onObjectInteraction;
  api.onObjectInteraction = (...args) => {
    const [name, actions] = args;
    for (const [option, handler] of Object.entries(actions ?? {})) objectActions.set(`${name}:${option}`, handler);
    return onObjectInteraction(...args);
  };
  const QuestRuntime = require('../plugins/quests/QuestRuntime');
  QuestRuntime.registerQuestWidgets(api);
  require('../plugins/quests/quests/MourningsEndPartII.Quest')(api);
  quest = QuestRuntime.getRegisteredQuests().find(entry => entry.key === 'mournings_end_part_ii');
  require('../plugins/achievements/AchievementDiaries.plugin').register(api);
  require('../plugins/skills/Runecrafting.plugin').register(api);
  require('../plugins/achievements/diaries/ArdougneDeathRunesDiary.plugin').register(api);
  Data = require('../plugins/achievements/diaries/Data.AchievementDiaries');
  Progress = require('../plugins/achievements/diaries/Progress.AchievementDiaries');
  diary = Data.BY_KEY.get('ardougne');
  task = 'craft-some-death-runes-from-essence';
  deathAltar = core.ObjectIdentifiers.ALTAR_56;
  deathRift = core.ObjectIdentifiers.DEATH_RIFT;
  deathRuins = require('../plugins/skills/data/runecrafting-ruins.json').find(ruins => ruins.name === 'Death').ruinsId;
});

let index = 1000;
function actor({ level = 65, essenceId = core.ItemIdentifiers.PURE_ESSENCE, amount = 1, questComplete = false, questStage, location = [2208, 4830, 0] } = {}) {
  const player = new Player(null, new core.Location(...location));
  player.setIndex(index++);
  player.setUsername('ardougne-death-runes-test');
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.messages = [];
  player.sendMessage = text => player.messages.push(text);
  const skills = player.getSkillManager();
  skills.setCurrentLevels(core.Skill.RUNECRAFTING, level);
  player.runecraftingXp = [];
  const addExperience = skills.addExperiences.bind(skills);
  skills.addExperiences = (skill, xp) => {
    if (skill === core.Skill.RUNECRAFTING) player.runecraftingXp.push(xp);
    return addExperience(skill, xp);
  };
  if (amount > 0) player.getInventory().add(new Item(essenceId, amount), false);
  player.setAttribute(Progress.TASKS_ATTRIBUTE, {});
  if (Number.isInteger(questStage)) quest.setStage(player, questStage);
  else if (questComplete) quest.setStage(player, 60);
  return player;
}

function interact(player, objectId, location = new core.Location(2208, 4830, 0)) {
  const object = new core.GameObject(objectId, location, 10, 0, null);
  const definition = core.ObjectDefinition.forPlayer(objectId, player);
  const event = { player, object, objectId, definition, clickType: 1, handled: false };
  const handled = PluginManager.emitObjectInteraction(event);
  return { object, event, handled };
}

const completed = player => Progress.doneTasks(player, diary).has(task);

test('pure and daeyalt essence at the Death Altar complete Ardougne hard #12 with correct XP', () => {
  const definition = core.ObjectDefinition.forId(deathAltar);
  assert.equal(definition.getName(), 'Altar');
  assert.ok(definition.getInteractions().includes('Craft-rune'));

  for (const [essenceId, expectedXp] of [
    [core.ItemIdentifiers.PURE_ESSENCE, 10],
    [core.ItemIdentifiers.DAEYALT_ESSENCE, 15],
  ]) {
    const player = actor({ essenceId, questComplete: true });
    const { event, handled } = interact(player, deathAltar);
    assert.equal(handled, true, 'the cache action reaches the Runecrafting altar handler');
    assert.equal(event.handled, true);
    assert.equal(player.getInventory().getAmount(core.ItemIdentifiers.DEATH_RUNE), 1);
    assert.equal(player.getInventory().getAmount(essenceId), 0);
    assert.deepEqual(player.runecraftingXp, [expectedXp]);
    assert.equal(successReceipt.source, 'altar');
    assert.equal(successReceipt.altarId, deathAltar);
    assert.equal(completed(player), true);
    assert.equal(player.getPacketSender().getVarbit(diary.tiers.hard.countVarbit), 1);
  }
});

test('the Death Altar diary task requires quest completion and ignores other conversions', () => {
  const withoutEssence = actor({ questComplete: true, amount: 0 });
  interact(withoutEssence, deathAltar);
  assert.equal(completed(withoutEssence), false);

  const belowLevel = actor({ level: 64, questComplete: true });
  interact(belowLevel, deathAltar);
  assert.equal(completed(belowLevel), false);

  const incompleteQuest = actor();
  successReceipt = undefined;
  const refused = interact(incompleteQuest, deathAltar);
  assert.equal(refused.handled, true);
  assert.equal(incompleteQuest.getInventory().getAmount(core.ItemIdentifiers.DEATH_RUNE), 0);
  assert.equal(incompleteQuest.getInventory().getAmount(core.ItemIdentifiers.PURE_ESSENCE), 1);
  assert.deepEqual(incompleteQuest.runecraftingXp, []);
  assert.deepEqual(incompleteQuest.messages, ["You must complete Mourning's End Part II before you can craft death runes."]);
  assert.equal(successReceipt, undefined, 'a refused craft emits no success receipt');
  const questState = { player: incompleteQuest, key: 'mournings_end_part_ii', complete: false };
  PluginManager.emitCustomEvent('quest:is-complete', questState);
  assert.equal(questState.complete, false);
  assert.equal(completed(incompleteQuest), false, 'an incomplete quest earns no diary credit');

  const normalAltar = actor();
  interact(normalAltar, core.ObjectIdentifiers.ALTAR_33);
  assert.equal(normalAltar.getInventory().getAmount(core.ItemIdentifiers.AIR_RUNE), 6);
  assert.equal(normalAltar.getInventory().getAmount(core.ItemIdentifiers.PURE_ESSENCE), 0);

  const gotrTrip = actor();
  gotrTrip.__gotrTrip = {};
  interact(gotrTrip, deathAltar);
  assert.equal(gotrTrip.getInventory().getAmount(core.ItemIdentifiers.DEATH_RUNE), 1,
    'the Runecrafting fallback leaves Guardians of the Rift altar trips to the minigame gate');

  const ourania = actor({ level: 99, questComplete: true });
  interact(ourania, core.ObjectIdentifiers.ALTAR_31);
  assert.equal(completed(ourania), false, 'Ourania does not use the normal altar success identity');

  const noAltarIdentity = actor({ questComplete: true });
  const api = PluginManager.createApi('ArdougneDeathRunesDiaryNegativeTest');
  api.emitCustomEvent('runecrafting:success', {
    player: noAltarIdentity,
    skill: core.Skill.RUNECRAFTING,
    runeId: core.ItemIdentifiers.DEATH_RUNE,
    rolls: 1,
    amountPerEssence: 1,
  });
  assert.equal(completed(noAltarIdentity), false, 'GOTR receipts lack identity for the normal Death Altar');

  const unavailable = actor({ questComplete: true });
  unavailable.setRegistered(false);
  interact(unavailable, deathAltar);
  assert.equal(completed(unavailable), false, 'an unavailable player does not earn the task');
});

test('the Death Altar requires Mourning\'s End Part II through its ruins and Abyss rift', () => {
  const riftDefinition = core.ObjectDefinition.forId(deathRift);
  assert.equal(riftDefinition.getName(), 'Death rift');
  assert.ok(riftDefinition.getInteractions().includes('Exit-through'));

  teleports.length = 0;
  const incomplete = actor({ location: [3000, 4800, 0] });
  const denied = interact(incomplete, deathRift, new core.Location(3000, 4800, 0));
  assert.equal(denied.handled, true);
  assert.equal(teleports.length, 0, 'the Abyss Death rift does not start a teleport');
  assert.ok(incomplete.getPacketSender().getVarbit(1103) < 60, 'the registered quest remains incomplete');

  const crystalId = core.ItemIdentifiers.NEWLY_MADE_CRYSTAL;
  const conventional = actor({ questStage: 5, location: [1858, 4638, 0] });
  conventional.getInventory().add(new Item(crystalId, 1), false);
  conventional.getEquipment().setItem(core.Equipment.HEAD_SLOT, new Item(core.ItemIdentifiers.DEATH_TIARA, 1));
  conventional.getEquipment().refreshItems();
  PluginManager.emitCustomEvent('equipment:changed', { player: conventional });
  let conventionalLanding;
  conventional.moveTo = destination => { conventionalLanding = destination; };
  assert.equal(objectActions.get('Mysterious ruins:Enter')({ player: conventional, objectId: deathRuins }), true);
  assert.equal(conventionalLanding, undefined, 'the conventional ruins route also requires the quest');
  assert.deepEqual(conventional.messages, ["You must solve the Death Altar puzzle during Mourning's End Part II before entering the Death Altar."]);

  const noCrystal = actor({ questStage: 6, location: [1858, 4638, 0] });
  noCrystal.getEquipment().setItem(core.Equipment.HEAD_SLOT, new Item(core.ItemIdentifiers.DEATH_TIARA, 1));
  let noCrystalLanding;
  noCrystal.moveTo = destination => { noCrystalLanding = destination; };
  assert.equal(objectActions.get('Mysterious ruins:Enter')({ player: noCrystal, objectId: deathRuins }), true);
  assert.equal(noCrystalLanding, undefined, 'stage 6 without the newly made crystal cannot use the quest exception');

  const talisman = actor({ questStage: 5, location: [1858, 4638, 0] });
  const itemEvent = {
    player: talisman,
    objectId: deathRuins,
    itemId: core.ItemIdentifiers.DEATH_TALISMAN,
    handled: false,
    object: { getDefinition: () => core.ObjectDefinition.forId(deathRuins) },
  };
  assert.equal(PluginManager.emitItemOnObject(itemEvent), true);
  assert.equal(itemEvent.handled, true);
  assert.equal(talisman.getAttribute('runecrafting:travel'), undefined);
  assert.deepEqual(talisman.messages, ["You must solve the Death Altar puzzle during Mourning's End Part II before entering the Death Altar."]);

  const puzzleComplete = actor({ questStage: 6, location: [1858, 4638, 0] });
  puzzleComplete.getInventory().add(new Item(crystalId, 1), false);
  puzzleComplete.getEquipment().setItem(core.Equipment.HEAD_SLOT, new Item(core.ItemIdentifiers.DEATH_TIARA, 1));
  let puzzleLanding;
  puzzleComplete.moveTo = destination => { puzzleLanding = destination; };
  assert.equal(objectActions.get('Mysterious ruins:Enter')({ player: puzzleComplete, objectId: deathRuins }), true);
  assert.deepEqual([puzzleLanding.getX(), puzzleLanding.getY(), puzzleLanding.getZ()], [2208, 4830, 0],
    'stage 6 opens access so the player can continue the quest at the altar');

  const puzzleTalisman = actor({ questStage: 6, location: [1858, 4638, 0] });
  puzzleTalisman.getInventory().add(new Item(crystalId, 1), false);
  const talismanEnter = {
    player: puzzleTalisman,
    objectId: deathRuins,
    itemId: core.ItemIdentifiers.DEATH_TALISMAN,
    handled: false,
    object: { getDefinition: () => core.ObjectDefinition.forId(deathRuins) },
  };
  assert.equal(PluginManager.emitItemOnObject(talismanEnter), true);
  assert.equal(talismanEnter.handled, true);
  assert.ok(puzzleTalisman.getAttribute('runecrafting:travel'), 'stage 6 with the crystal can use a death talisman');
  assert.equal(puzzleTalisman.messages.some(message => message.includes('solve the Death Altar puzzle')), false);

  const stageSeven = actor({ questStage: 7 });
  const newlyMadeCrystal = core.ItemIdentifiers.NEWLY_MADE_CRYSTAL;
  const deathTalisman = core.ItemIdentifiers.DEATH_TALISMAN;
  const altarChamber = 34823;
  stageSeven.getInventory().add(new Item(newlyMadeCrystal, 1), false);
  const useCrystal = () => PluginManager.emitItemOnObject({
    player: stageSeven,
    itemId: newlyMadeCrystal,
    objectId: altarChamber,
    handled: false,
    object: { getDefinition: () => core.ObjectDefinition.forId(altarChamber) },
  });
  assert.equal(useCrystal(), true);
  assert.equal(stageSeven.getInventory().getAmount(newlyMadeCrystal), 1, 'the quest interaction requires the death talisman');
  stageSeven.getInventory().add(new Item(deathTalisman, 1), false);
  assert.equal(useCrystal(), true);
  PluginManager.emitCustomEvent('npc-dialogue:action', { player: stageSeven, stepId: 'vExKj3' });
  assert.equal(stageSeven.getInventory().getAmount(newlyMadeCrystal), 0);
  assert.equal(stageSeven.getInventory().getAmount(core.ItemIdentifiers.NEWLY_MADE_CRYSTAL_2), 1,
    'the quest action charges the newly made crystal at the altar');
  const questState = { player: stageSeven, key: 'mournings_end_part_ii', complete: false };
  PluginManager.emitCustomEvent('quest:is-complete', questState);
  assert.equal(questState.complete, false, 'the crystal charge remains part of an incomplete quest');

  const completeRuins = actor({ questComplete: true, location: [1858, 4638, 0] });
  completeRuins.getEquipment().setItem(core.Equipment.HEAD_SLOT, new Item(core.ItemIdentifiers.DEATH_TIARA, 1));
  completeRuins.getEquipment().refreshItems();
  PluginManager.emitCustomEvent('equipment:changed', { player: completeRuins });
  let completeLanding;
  completeRuins.moveTo = destination => { completeLanding = destination; };
  assert.equal(objectActions.get('Mysterious ruins:Enter')({ player: completeRuins, objectId: deathRuins }), true);
  assert.deepEqual([completeLanding.getX(), completeLanding.getY(), completeLanding.getZ()], [2208, 4830, 0]);

  teleports.length = 0;
  const otherRift = actor({ location: [3000, 4800, 0] });
  const air = interact(otherRift, core.ObjectIdentifiers.AIR_RIFT, new core.Location(3000, 4800, 0));
  assert.equal(air.handled, true);
  assert.equal(teleports.length, 1, 'an unfinished quest does not block the air rift');
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], [2841, 4829]);

  teleports.length = 0;
  const complete = actor({ questComplete: true, location: [3000, 4800, 0] });
  const death = interact(complete, deathRift, new core.Location(3000, 4800, 0));
  assert.equal(death.handled, true);
  assert.equal(teleports.length, 1);
  assert.deepEqual([teleports[0].destination.getX(), teleports[0].destination.getY()], [2208, 4830]);
});
