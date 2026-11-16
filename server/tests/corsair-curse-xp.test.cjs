// Run after `yarn build`: node --test tests/corsair-curse-xp.test.cjs
//
// The Corsair Curse gives 1,200 Firemaking XP on completion (Wiki: "The Corsair Curse/Quick guide": "1,200 Firemaking
// experience"; "Quest experience rewards": The Corsair Curse, 1,200 Firemaking). The real registerQuest/complete runs on a
// stand-in player: the XP is paid once, it is on the reward scroll, and a completion not played through
// (`experience: false`) holds it back. Same model as tests/quest-xp-rewards-2026-11.test.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const core = PluginManager.getCoreApi();
const S = core.Skill;
const KEY = 'the_corsair_curse';

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = new Proxy({
    core: { ...core, TaskManager: { submit() {} } },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  require('../plugins/quests/quests/CorsairCurse.Quest')(api);
});

function player() {
  const attributes = new Map();
  const xp = [];
  const sender = new Proxy({}, { get: () => () => sender });
  return {
    xp,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    getInventory: () => new Proxy({}, { get: () => () => true }),
    sendMessage() {},
    isRegistered: () => true,
  };
}

test('The Corsair Curse: 1,200 Firemaking XP on completion, once, and on the reward scroll', () => {
  const quest = runtime.getRegisteredQuests().find((entry) => entry.key === KEY);
  assert.ok(quest, `${KEY} registered`);
  const p = player();
  assert.equal(quest.complete(p), true);
  assert.deepEqual(p.xp, [[S.FIREMAKING, 1200]], 'exactly 1,200 Firemaking XP');
  assert.equal(quest.complete(p), false, 'a second completion is refused');
  assert.deepEqual(p.xp, [[S.FIREMAKING, 1200]], 'and pays nothing more');
  const lines = runtime.rewardLines(quest);
  assert.ok(lines.includes('1,200 Firemaking XP'), lines.join(' | '));
});

test('The Corsair Curse: a completion not played through (experience: false) holds the XP back', () => {
  const quest = runtime.getRegisteredQuests().find((entry) => entry.key === KEY);
  const pack = player();
  assert.equal(quest.complete(pack, { experience: false }), true);
  assert.deepEqual(pack.xp, [], 'no XP for a completion not played through');
});
