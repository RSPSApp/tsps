const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const QuestRuntime = require('../plugins/quests/QuestRuntime');
const { DIARIES, TIERS } = require('../plugins/diaries/DiaryData');
const attachQuestCape = require('../plugins/quests/quest-cape/QuestCape.QuestCape');

const answers = { quests: true, diaries: true };
const eventHandlers = new Map();
const api = new Proxy({
  core: PluginManager.getCoreApi(),
  emitCustomEvent(name, request) {
    if (name === 'quest:is-complete') request.complete = answers.quests;
    else if (name === 'diary:is-complete') request.complete = answers.diaries;
    else for (const handler of eventHandlers.get(name) ?? []) handler(request);
  },
  onCustomEvent(name, handler) {
    eventHandlers.set(name, [...(eventHandlers.get(name) ?? []), handler]);
  },
}, { get: (target, key) => key in target ? target[key] : () => {} });

const canonicalRows = [
  { name: 'Animal Magnetism', type: 0, points: 1, subquests: 0 },
  { name: 'Ascent of Arceuus, The', type: 0, points: 1, subquests: 0 },
  { name: 'Recipe for Disaster', type: 0, points: 0, subquests: 1 },
  { name: 'Bear Your Soul', type: 1, points: 1, subquests: 0 },
  { name: '.', type: 0, points: 1, subquests: 0 },
].map(({ name, type, points, subquests }) => ({
  int(column) { return ({ 4: type, 17: points, 22: subquests })[column] ?? 0; },
  column() { return []; },
  string(column) { return column === 1 ? name : ''; },
}));
api.core.CacheDefinitions.getDbTableRows = (tableId) => tableId === 0 ? canonicalRows : [];
const registered = [
  { key: 'animal_magnetism', name: 'Animal Magnetism' },
  { key: 'ascent_of_arceuus', name: 'The Ascent of Arceuus' },
  { key: 'recipe_for_disaster', name: 'Recipe for Disaster' },
];
QuestRuntime.getRegisteredQuests = () => registered;
attachQuestCape(api);
const { allQuestsComplete, allDiariesComplete, answerCapeRequirement, buyCape, trimCape, untrimCape, removeInvalidCape } = attachQuestCape._test;

function playerWithInventory(coins = 99000, freeSlots = 1) {
  const items = [];
  const messages = [];
  const inventory = {
    getAmount: () => coins,
    getFreeSlots: () => freeSlots,
    deleteNumber(_id, amount) { coins -= amount; },
    adds(id, amount) { items.push([id, amount]); },
    refreshItems() {},
  };
  return {
    items, messages, inventory,
    getInventory: () => inventory,
    getEquipment: () => ({ refreshItems() {} }),
    sendMessage: (message) => messages.push(message),
  };
}

test('cape eligibility fails closed for a missing quest and checks every diary tier for trim', () => {
  assert.equal(allQuestsComplete({}), true);
  const removed = registered.pop();
  assert.equal(allQuestsComplete({}), false);
  registered.push(removed);
  registered.push({ key: 'duplicate', name: 'The Ascent of Arceuus' });
  assert.equal(allQuestsComplete({}), false);
  registered.pop();
  assert.equal(allDiariesComplete({}), true);
  answers.diaries = false;
  assert.equal(allDiariesComplete({}), false);
  assert.equal(DIARIES.length * TIERS.length > 0, true);
  answers.diaries = true;
});

test('cape purchase requires the complete cache catalogue and accepts the freed coin slot', () => {
  const player = playerWithInventory();
  buyCape(player);
  assert.deepEqual(player.items, [[api.core.ItemIdentifiers.QUEST_POINT_CAPE, 1], [api.core.ItemIdentifiers.QUEST_POINT_HOOD, 1]]);
  assert.equal(player.inventory.getAmount(), 0);
  assert.deepEqual(player.messages, ['The Wise Old Man sells you a Quest point cape and hood for 99,000 coins.']);
});


test('cape purchase refuses an incomplete catalogue without taking coins', () => {
  const removed = registered.pop();
  const player = playerWithInventory();
  buyCape(player);
  assert.deepEqual(player.items, []);
  assert.equal(player.inventory.getAmount(), 99000);
  assert.match(player.messages[0], /complete every quest/);
  registered.push(removed);
});

test('cape trim follows completed diary progress, not cape ownership', () => {
  let id = api.core.ItemIdentifiers.QUEST_POINT_CAPE;
  const item = { setId(next) { id = next; } };
  answers.diaries = false;
  trimCape({ player: playerWithInventory(), item, itemId: id });
  assert.equal(id, api.core.ItemIdentifiers.QUEST_POINT_CAPE);
  answers.diaries = true;
  answers.quests = false;
  trimCape({ player: playerWithInventory(), item, itemId: id });
  assert.equal(id, api.core.ItemIdentifiers.QUEST_POINT_CAPE_T_);
  answers.diaries = true;
  untrimCape({ player: playerWithInventory(), item, itemId: id });
  assert.equal(id, api.core.ItemIdentifiers.QUEST_POINT_CAPE);
  answers.diaries = true;
  answers.quests = true;
});

test('quest completion event fires once after the stage and rewards are applied', () => {
  const { registerQuest } = QuestRuntime;
  let completion;
  const questApi = new Proxy({
    emitCustomEvent(name, payload) {
      if (name === 'quest:completed') completion?.(payload);
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  const quest = registerQuest(questApi, {
    key: 'cape_event_test', name: 'Cape Event Test', varpId: 9100,
    completionValue: 2, questPoints: 1,
  });
  const attrs = new Map();
  const sender = new Proxy({}, { get: () => () => sender });
  const player = {
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getPacketSender: () => sender,
    getFrameUpdater: () => ({ clear() {} }),
    getInventory: () => ({ adds() {} }),
    sendMessage() {},
  };
  let count = 0;
  completion = ({ player: completedPlayer, key }) => {
    count++;
    assert.equal(completedPlayer, player);
    assert.equal(key, quest.key);
    assert.equal(quest.isComplete(player), true);
    assert.equal(attrs.get('quest.points'), 1);
  };
  assert.equal(quest.complete(player), true);
  assert.equal(quest.complete(player), false);
  assert.equal(count, 1);
});

test('cape use query is the shared fail-closed eligibility gate', () => {
  answers.quests = true;
  const request = { player: {} };
  answerCapeRequirement(request);
  assert.equal(request.canUse, true);
  const removed = registered.pop();
  const missingQuest = { player: {} };
  answerCapeRequirement(missingQuest);
  assert.equal(missingQuest.canUse, false);
  registered.push(removed);
});


test('invalid equipped cape is banked or removed with appearance and bonuses refreshed', () => {
  const originalBonusManager = api.getBonusManager;
  let bonusRefreshes = 0;
  api.getBonusManager = () => ({ update: () => bonusRefreshes++ });
  answers.quests = false;
  const makePlayer = (mode, freeBankSlots) => {
    const cape = {
      getId: () => api.core.ItemIdentifiers.QUEST_POINT_CAPE,
      getAmount: () => 1,
      getDefinition: () => ({ isStackable: () => false }),
    };
    const slots = [];
    slots[api.core.Equipment.CAPE_SLOT] = cape;
    let removed = false;
    const equipment = {
      capacity: () => 14,
      getItems: () => slots,
      set(slot, item) { slots[slot] = item; removed = item.getId() < 0; },
      refreshItems() {},
    };
    const bank = {
      added: null,
      getFreeSlots: () => freeBankSlots,
      add(item) { this.added = item; },
      refreshItems() {},
    };
    let appearance = false;
    const player = {
      getHitpoints: () => 99,
      getEquipment: () => equipment,
      getInventory: () => ({ getAmount: () => 0, getEmptySlot: () => -1, full() {}, refreshItems() {} }),
      getBanks: () => freeBankSlots > 0 ? [bank] : [],
      getAttribute: (key) => key === 'ironman:mode' ? mode : undefined,
      getUpdateFlag: () => ({ flag(value) { appearance = value === api.core.Flag.APPEARANCE; } }),
    };
    return { player, bank, removed: () => removed, appearance: () => appearance };
  };

  const standard = makePlayer('none', 1);
  removeInvalidCape({ player: standard.player });
  assert.ok(standard.bank.added);
  assert.equal(standard.removed(), true);
  assert.equal(standard.appearance(), true);

  const fullBank = makePlayer('none', 0);
  removeInvalidCape({ player: fullBank.player });
  assert.equal(fullBank.bank.added, null);
  assert.equal(fullBank.removed(), true);
  assert.equal(fullBank.appearance(), true);

  const ultimate = makePlayer('ultimate', 1);
  removeInvalidCape({ player: ultimate.player });
  assert.equal(ultimate.bank.added, null);
  assert.equal(ultimate.removed(), true);
  assert.equal(ultimate.appearance(), true);
  assert.equal(bonusRefreshes, 3);
  answers.quests = true;
  api.getBonusManager = originalBonusManager;
});

test('Quest point cape skillcape emote requires every quest and uses its cache animation', () => {
  const { resolveSkillcapeEmote, resolveEmote } = require('../plugins/interface/Emotes.plugin')._test;
  const cape = { getId: () => api.core.ItemIdentifiers.QUEST_POINT_CAPE_T_, getDefinition: () => ({ getName: () => 'Quest point cape (t)' }) };
  const slots = [];
  slots[api.core.Equipment.CAPE_SLOT] = cape;
  const player = { getEquipment: () => ({ getItems: () => slots }) };
  answers.quests = true;
  assert.deepEqual(resolveSkillcapeEmote(player, api), { sequence: 4945, graphic: 816 });
  answers.quests = false;
  assert.equal(resolveSkillcapeEmote(player, api), undefined);
  answers.quests = true;
  let musicUnlocked = false;
  const musicApi = new Proxy({
    core: api.core,
    emitCustomEvent(name, request) {
      if (name === 'music:air-guitar-unlocked') request.unlocked = musicUnlocked;
    },
  }, { get: (target, key) => key in target ? target[key] : () => {} });
  assert.equal(resolveEmote(player, 44, 1, musicApi), undefined);
  musicUnlocked = true;
  assert.deepEqual(resolveEmote(player, 44, 1, musicApi), { sequence: 4751, graphic: 1239 });
  const musicCape = { getId: () => api.core.ItemIdentifiers.MUSIC_CAPE };
  slots[api.core.Equipment.CAPE_SLOT] = musicCape;
  musicUnlocked = false;
  assert.equal(resolveSkillcapeEmote(player, musicApi), undefined);
  musicUnlocked = true;
  assert.deepEqual(resolveSkillcapeEmote(player, musicApi), { sequence: 4751, graphic: 1239 });
});
