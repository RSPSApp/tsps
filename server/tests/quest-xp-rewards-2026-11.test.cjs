// Run after `yarn build`: node --test tests/quest-xp-rewards-2026-11.test.cjs
//
// The 3 November 2026 update gave quests that had no XP reward some (Wiki: Update:Quest Month
// Kick Off, TFA Tweaks & More, "XP Rewards Added"). Each quest's real registerQuest/complete runs
// on a stand-in player: the XP is paid once on completion, it is on the reward scroll, and a
// completion not played through (`experience: false`) holds it back.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');

const core = PluginManager.getCoreApi();
const S = core.Skill;

const CASES = [
  { file: 'FamilyCrest', key: 'family_crest', xp: [[S.MINING, 2000, 'Mining'], [S.SMITHING, 2000, 'Smithing'], [S.CRAFTING, 2000, 'Crafting']] },
  { file: 'LostCity', key: 'lost_city', xp: [[S.WOODCUTTING, 1500, 'Woodcutting'], [S.CRAFTING, 1500, 'Crafting']] },
  { file: 'MerlinsCrystal', key: 'merlins_crystal', xp: [[S.FIREMAKING, 1000, 'Firemaking']] },
  { file: 'TrollStronghold', key: 'troll_stronghold', xp: [[S.AGILITY, 2000, 'Agility']] },
  { file: 'ClockTower', key: 'clock_tower', xp: [[S.FIREMAKING, 1000, 'Firemaking']] },
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = new Proxy({
    core: { ...core, TaskManager: { submit() {} } },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  for (const { file } of CASES) require(`../plugins/quests/quests/${file}.Quest`)(api);
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

for (const { file, key, xp } of CASES) {
  test(`${file}: ${xp.map(([, amount, label]) => `${amount} ${label}`).join(', ')} XP on completion, and on the scroll`, () => {
    const quest = runtime.getRegisteredQuests().find((entry) => entry.key === key);
    assert.ok(quest, `${key} registered`);
    const p = player();
    assert.equal(quest.complete(p), true);
    assert.deepEqual(p.xp, xp.map(([skill, amount]) => [skill, amount]));
    const lines = runtime.rewardLines(quest);
    for (const [, amount, label] of xp) assert.ok(lines.includes(`${amount.toLocaleString('en-US')} ${label} XP`), lines.join(' | '));
    const pack = player();
    quest.complete(pack, { experience: false });
    assert.deepEqual(pack.xp, [], 'a completion not played through holds the XP back');
  });
}
