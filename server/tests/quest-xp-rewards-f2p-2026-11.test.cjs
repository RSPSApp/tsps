// Run after `yarn build`: node --test tests/quest-xp-rewards-f2p-2026-11.test.cjs
//
// The 3 November 2026 update's free-to-play quest rewards (Wiki: Update:Quest Month Kick Off, TFA
// Tweaks & More, "XP Rewards Added"): XP on completion for Prince Ali Rescue, Pirate's Treasure and
// Below Ice Mountain; antique lamps for Romeo & Juliet, Shield of Arrav, Ernest the Chicken and
// Black Knights' Fortress, rubbed through the shared xpreward interface. Each quest's real
// registerQuest/complete runs on a stand-in player.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const Lamps = require('../plugins/items/QuestRewardLamps.plugin');

const core = PluginManager.getCoreApi();
const S = core.Skill;
const events = {};
let xpreward = null;

const XP = [
  { file: 'PrinceAliRescue', key: 'prince_ali_rescue', xp: [[S.SMITHING, 500, 'Smithing'], [S.CRAFTING, 500, 'Crafting']] },
  { file: 'PiratesTreasure', key: 'pirates_treasure', xp: [[S.COOKING, 800, 'Cooking']] },
  { file: 'BelowIceMountain', key: 'below_ice_mountain', xp: [[S.MINING, 1200, 'Mining']] },
];
const LAMPS = [
  { file: 'RomeoAndJuliet', key: 'romeo_and_juliet', lamp: 34754, count: 1, line: 'An antique lamp giving 500 XP' },
  { file: 'ShieldOfArrav', key: 'shield_of_arrav', lamp: 34755, count: 1, line: 'An antique lamp giving 500 XP' },
  { file: 'ErnestTheChicken', key: 'ernest_the_chicken', lamp: 34750, count: 1, line: 'An antique lamp giving 500 XP' },
  { file: 'BlackKnightsFortress', key: 'black_knights_fortress', lamp: 34748, count: 2, line: '2 antique lamps giving 1,000 combat XP each' },
];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  const api = new Proxy({
    core: { ...core, TaskManager: { submit() {} } },
    onServerStartup: (fn) => fn(),
    onCustomEvent: (name, fn) => (events[name] ??= []).push(fn),
    emitCustomEvent: (name, event) => {
      if (name === 'xpreward:open') { xpreward = event; return; }
      for (const fn of events[name] ?? []) fn(event);
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  Lamps.register(api);
  for (const { file } of [...XP, ...LAMPS]) require(`../plugins/quests/quests/${file}.Quest`)(api);
});

function player() {
  const attributes = new Map();
  const xp = [];
  const added = [];
  const sender = new Proxy({}, { get: () => () => sender });
  return {
    xp, added,
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push([skill, amount]) }),
    getInventory: () => new Proxy({ forceAdd: (_p, item) => added.push([item.getId(), item.getAmount()]) }, { get: (t, k) => t[k] ?? (() => true) }),
    sendMessage() {},
    isRegistered: () => true,
  };
}

const questFor = (key) => runtime.getRegisteredQuests().find((entry) => entry.key === key);

for (const { file, key, xp } of XP) {
  test(`${file}: ${xp.map(([, amount, label]) => `${amount} ${label}`).join(', ')} XP on completion, and on the scroll`, () => {
    const quest = questFor(key);
    const p = player();
    assert.equal(quest.complete(p), true);
    for (const [skill, amount] of xp) assert.ok(p.xp.some(([s, a]) => s === skill && a === amount), `${amount} ${skill.getName()}`);
    const lines = runtime.rewardLines(quest);
    for (const [, amount, label] of xp) assert.ok(lines.includes(`${amount.toLocaleString('en-US')} ${label} XP`), lines.join(' | '));
    const pack = player();
    quest.complete(pack, { experience: false });
    for (const [skill, amount] of xp) assert.ok(!pack.xp.some(([s, a]) => s === skill && a === amount), 'held back');
  });
}

for (const { file, key, lamp, count, line } of LAMPS) {
  test(`${file}: ${count} antique lamp${count > 1 ? 's' : ''} (${lamp}) on completion, and on the scroll`, () => {
    const quest = questFor(key);
    const p = player();
    assert.equal(quest.complete(p), true);
    assert.ok(p.added.some(([id, amount]) => id === lamp && amount === count), JSON.stringify(p.added));
    assert.ok(runtime.rewardLines(quest).includes(line));
    const pack = player();
    quest.complete(pack, { experience: false });
    assert.ok(!pack.added.some(([id]) => id === lamp), 'no lamp for a completion not played through');
  });
}

test('rubbing a lamp: any skill for 500, a combat skill or Prayer for 1,000; the lamp goes once used', () => {
  const { rub } = Lamps._test;
  const make = (id) => {
    const item = new core.Item(id, 1);
    const removed = [];
    const gained = [];
    let experience = 0;
    const p = {
      getInventory: () => ({ get: () => item, deleteAtSlot: (slot, n) => removed.push([slot, n]) }),
      getSkillManager: () => ({ getExperience: () => experience, addExperience: (skill, amount) => { experience += amount; gained.push([skill, amount]); } }),
      sendMessage() {},
    };
    return { p, item, removed, gained };
  };
  const romeo = make(34754);
  assert.equal(rub({ player: romeo.p, item: romeo.item, itemId: 34754, slot: 3 }), true);
  assert.equal(xpreward.skills, undefined, 'any skill');
  assert.equal(xpreward.onConfirm(S.FLETCHING, 'Fletching'), '<col=0000ff>Your wish has been granted!</col> You have been awarded 500 Fletching experience!');
  assert.deepEqual(romeo.gained, [[S.FLETCHING, 500]]);
  assert.deepEqual(romeo.removed, [[3, 1]]);
  const knights = make(34748);
  rub({ player: knights.p, item: knights.item, itemId: 34748, slot: 0 });
  assert.ok(xpreward.skills.includes(S.PRAYER) && !xpreward.skills.includes(S.FLETCHING));
  assert.equal(xpreward.onConfirm(S.FLETCHING, 'Fletching'), null, 'not a combat skill');
  assert.equal(knights.removed.length, 0);
  assert.equal(rub({ player: knights.p, item: new core.Item(4447, 1), itemId: 4447, slot: 0 }), false, 'another antique lamp is left to its own plugin');
});
