// Run after `yarn build`: node --test tests/cooks-assistant.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const MILK = 1927;
const FLOUR = 1933;
const EGG = 1944;

function playerWith(...itemIds) {
  const inventory = new Map();
  for (const id of itemIds) inventory.set(id, (inventory.get(id) || 0) + 1);
  return { getInventory: () => ({ getAmount: (id) => inventory.get(id) || 0 }) };
}

function registerCooksAssistant() {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const customEvents = {};
  let conditionHandler;
  const noop = () => {};
  const api = {
    core: PluginManager.getCoreApi(),
    onNpcDialogueVariant: noop,
    onNpcDialogueCondition: (h) => { conditionHandler = h; },
    onCustomEvent: (name, h) => { (customEvents[name] ??= []).push(h); },
    onPlayerLogin: noop,
    onInterfaceActionButton: noop,
    persistAttribute: noop,
  };
  require('../plugins/quests/quests/CooksAssistant.Quest')(api);
  return { conditionHandler, customEvents };
}

test('Cook transcript conditions follow inventory through the whole hand-in chain', () => {
  const { conditionHandler } = registerCooksAssistant();
  const ask = (player, text) => conditionHandler({ npcId: 4626, player, text });
  const NONE = 'If the player has not obtained anything yet:';
  const HAS = 'If the player has the ingredients:';
  const NOT_ALL = 'If the player has not brought all the ingredients:';
  const ALL = 'If the player has brought all the ingredients:';

  const empty = playerWith();
  const some = playerWith(EGG);
  const full = playerWith(MILK, FLOUR, EGG);

  // "HAS" is the else of "NONE": with a partial inventory it must win, or the
  // runner falls back to NONE and wrongly says the player has nothing.
  assert.equal(ask(empty, NONE), true);
  assert.equal(ask(some, NONE), false);
  assert.equal(ask(full, NONE), false);

  assert.equal(ask(empty, HAS), false);
  assert.equal(ask(some, HAS), true);
  assert.equal(ask(full, HAS), true);

  // Under HAS, not-all hands in what was gathered and asks for the rest; all completes.
  assert.equal(ask(some, NOT_ALL), true);
  assert.equal(ask(full, NOT_ALL), false);
  assert.equal(ask(some, ALL), false);
  assert.equal(ask(full, ALL), true);
});

test('completion grants the reward item, quest points and builds the scroll', () => {
  const { registerQuest } = require('../plugins/quests/QuestRuntime');
  const noop = () => {};
  let rewarded = 0;
  const quest = registerQuest(
    { persistAttribute: noop, onInterfaceActionButton: noop, onCustomEvent: noop },
    {
      key: 'reward_smoke', name: 'Reward Smoke', varpId: 9999,
      startedValue: 1, completionValue: 2, questPoints: 3,
      rewardItemId: 1891, rewardItemLabel: 'A cake',
      onReward: () => { rewarded++; },
    }
  );

  const attrs = new Map();
  const grants = [];
  const packet = new Proxy({}, { get: () => () => packet });
  const player = {
    getAttribute: (k) => attrs.get(k),
    setAttribute: (k, v) => attrs.set(k, v),
    getPacketSender: () => packet,
    getFrameUpdater: () => ({ clear() {} }),
    getInventory: () => ({ adds: (id, amount) => grants.push([id, amount]) }),
    getSkillManager: () => ({ addExperiences: noop }),
    sendMessage: noop,
  };

  assert.equal(quest.complete(player), true);
  assert.equal(quest.getStage(player), 2);
  assert.equal(attrs.get('quest.points'), 3);
  assert.equal(rewarded, 1);
  assert.deepEqual(grants, [[1891, 1]]);
});

test('hand-over lines are skipped for ingredients the player is not carrying', () => {
  const { customEvents } = registerCooksAssistant();
  const handler = customEvents['npc-dialogue:line'][0];
  const says = (player, text) => {
    const event = { npcId: 4626, player, text, skip: false };
    handler(event);
    return !event.skip;
  };

  assert.equal(says(playerWith(), "Here's a bucket of milk."), false);
  assert.equal(says(playerWith(MILK), "Here's a bucket of milk."), true);
  assert.equal(says(playerWith(FLOUR), "Here's a pot of flour."), true);
  assert.equal(says(playerWith(EGG), "Here's a fresh egg."), true);
  // Unrelated lines and other NPCs are untouched.
  assert.equal(says(playerWith(), 'Some other line.'), true);
  const otherNpc = { npcId: 1, player: playerWith(), text: "Here's an egg.", skip: false };
  handler(otherNpc);
  assert.equal(otherNpc.skip, false);
});
