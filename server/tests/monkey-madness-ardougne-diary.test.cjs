// From server/: node --test tests/monkey-madness-ardougne-diary.test.cjs (after yarn build).
'use strict';

const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const TASKS_ATTRIBUTE = 'achievement-diaries:tasks';
const MONKEY_CAGE_TASK = 'have-a-zookeeper-put-you-in-ardougne-zoo-s-monke';
const PREVIOUS_HARD_TASK = 'enter-the-magic-guild';
const ARDOUGNE_HARD_TASK_COUNT_VARBIT = 6293;
let nextIndex = 1;
let quest;
let api;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();

  api = PluginManager.createApi('MonkeyMadnessArdougneDiaryTest');
  const existing = runtime.getRegisteredQuests().length;
  require('../plugins/quests/quests/MonkeyMadnessI.Quest')(api);
  quest = runtime.getRegisteredQuests().slice(existing).find(entry => entry.key === 'monkey_madness_i');
  assert.ok(quest, 'Monkey Madness I registered its quest handle');
  require('../plugins/achievements/AchievementDiaries.plugin').register(api);
});

function playerAt(x, y, options = {}) {
  const attrs = new Map();
  const items = new Map();
  const varbits = new Map();
  let location = new core.Location(x, y, 0);
  const packet = new Proxy({
    sendVarbit(id, value) { varbits.set(id, value); return packet; },
    sendConfig() { return packet; },
    sendInterfaceRemoval() { return packet; },
  }, { get: (target, key) => target[key] ?? (() => packet) });
  const inventory = {
    getAmount: id => items.get(id) ?? 0,
    getFreeSlots: () => 28,
    isFull: () => false,
    adds: (id, amount = 1) => items.set(id, (items.get(id) ?? 0) + amount),
    deleteNumber(id, amount = 1) { items.set(id, (items.get(id) ?? 0) - amount); },
  };
  const p = {
    varbits,
    index: nextIndex++,
    getIndex: () => p.index,
    getAttribute: key => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getEquipment: () => ({ get: slot => slot === core.Equipment.WEAPON_SLOT
      ? new core.Item(I.KARAMJAN_MONKEY_GREEGREE, 1)
      : null }),
    getPacketSender: () => packet,
    getDialogueManager: () => p.manager,
    getLocation: () => location,
    moveTo: destination => { location = destination; },
    isRegistered: () => options.registered !== false,
    isDyingReturn: () => false,
    getPrivateArea: () => options.privateArea ?? null,
    getHitpoints: () => options.hitpoints ?? 10,
    getUsername: () => 'Diary regression',
    getDisplayName: () => 'Diary regression',
    getAppearance: () => ({ isMale: () => true }),
    getSkillManager: () => ({ addExperiences() {} }),
    sendMessage() {},
  };
  p.manager = new DialogueManager(p);
  if (options.stage !== undefined) quest.setStage(p, options.stage);
  return p;
}

function minderNpc() {
  const definition = core.NpcDefinition.forId(N.MONKEY_MINDER);
  assert.ok(definition, 'cache provides the Monkey Minder definition');
  const location = new core.Location(2601, 3278, 0);
  return {
    definition,
    npc: {
      getId: () => N.MONKEY_MINDER,
      getIndex: () => nextIndex++,
      getLocation: () => location,
      getCurrentDefinition: () => definition,
    },
  };
}

function talkToMinder(player, npcId = N.MONKEY_MINDER) {
  const { definition, npc } = minderNpc();
  const event = {
    player,
    npc,
    npcId,
    clickType: 1,
    definition,
    handled: false,
  };
  const handled = PluginManager.emitNpcInteraction(event);
  return { event, handled };
}

test('Monkey Minder capture completes the Ardougne hard diary task through registered production plugins', () => {
  const player = playerAt(2600, 3278, { stage: 8 });
  player.setAttribute(TASKS_ATTRIBUTE, { ardougne: [PREVIOUS_HARD_TASK] });

  const { event, handled } = talkToMinder(player);

  assert.equal(handled, true);
  assert.equal(event.handled, true);
  assert.deepEqual([player.getLocation().getX(), player.getLocation().getY()], [2602, 3280]);
  assert.equal(player.getAttribute('quest.monkey_madness_i.monkey-captured'), true);
  assert.equal(player.manager.isActive(), true, 'the imported Monkey Madness I transcript started');
  assert.ok(player.manager.getCurrent(), 'the dialogue manager holds the transcript dialogue');

  const completed = player.getAttribute(TASKS_ATTRIBUTE).ardougne;
  assert.ok(completed.includes(PREVIOUS_HARD_TASK), 'the existing Ardougne task remains complete');
  assert.ok(completed.includes(MONKEY_CAGE_TASK), 'the cage task is saved as complete');
  assert.equal(player.varbits.get(ARDOUGNE_HARD_TASK_COUNT_VARBIT), 2,
    'the Ardougne hard-task varbit includes both tasks');
});

test('Monkey Minder capture conditions reject invalid players and leave diary progress unchanged', () => {
  for (const [label, options, handledExpected] of [
    ['wrong NPC', { npcId: N.MONKEY_MINDER + 1 }, false],
    ['before chapter 3', { stage: 7 }, false],
    ['not wearing the greegree', { monkeyForm: false }, false],
    ['outside the zoo', { x: 2700, y: 3278 }, false],
    ['unregistered player', { registered: false }, true],
    ['private area', { privateArea: {} }, true],
    ['dead player', { hitpoints: 0 }, true],
  ]) {
    const player = playerAt(options.x ?? 2600, options.y ?? 3278, { stage: 8, ...options });
    player.setAttribute(TASKS_ATTRIBUTE, { ardougne: [PREVIOUS_HARD_TASK] });
    if (options.monkeyForm === false) {
      player.getEquipment = () => ({ get: () => null });
    }

    const { event, handled } = talkToMinder(player, options.npcId ?? N.MONKEY_MINDER);

    assert.equal(handled, handledExpected, label);
    assert.equal(event.handled, handledExpected, label);
    assert.deepEqual(player.getAttribute(TASKS_ATTRIBUTE).ardougne, [PREVIOUS_HARD_TASK], label);
    assert.equal(player.varbits.get(ARDOUGNE_HARD_TASK_COUNT_VARBIT), undefined, label);
  }
});
