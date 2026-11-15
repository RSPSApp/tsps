// node --test tests/wall-of-flame-fuse.test.cjs   (needs `dist` for the core API; the plugin is driven with fake player, api and tasks)
// Wall of flame (#5635): onyx and zenyte shards fuse into uncut zenyte. Captures: rsprox 1157 (rev 237.1; sha256
// 3efbb079...b484): prompt at 97070 [3262] with "Fuse all..." (3 options), choice 97124 [3266], fuse messages 97160 [3268],
// 97209 [3271], 97258 [3274]; rsprox 3342 (rev 235.1; sha256 35030e04...232e): no greegree 89555 [4252]; one pair prompt
// 92452 [4452] with "Yes - fuse them." / "Don't fuse any of my gems!", choice 92465 [4454], message 92484 [4456].
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Shared = require('../plugins/skills/crafting/Shared.Crafting');
const WallOfFlame = require('../plugins/skills/crafting/WallOfFlame.Crafting');

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const Skill = core.Skill;
const { FUSE_MESSAGE, NO_GREEGREE_MESSAGE } = WallOfFlame._test;
const FUSE_ONE = "Fuse your onyx and zenyte shard?";
const FUSE_ALL = "Fuse all of your onyx and zenyte shards?";
const DONT = "Don't fuse any of my gems!";

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
});

/** A fake plugin api: records hooks, prompts and submitted tasks; `mm2` is the quest's answer. */
function fakeApi(mm2 = true) {
  const api = {
    core,
    hooks: [],
    prompts: [],
    tasks: [],
    mm2,
    onItemOnObject(item, obj, handler) { api.hooks.push({ item, obj, handler }); },
    emitCustomEvent(name, request) { if (name === 'quest:is-complete') request.complete = api.mm2 && request.key === 'monkey_madness_ii'; },
    getTaskManager() { return { submit(task) { task.setRunning(true); api.tasks.push(task); } }; },
    sendMultiChatboxPrompt(player, title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ label: pairs[i], run: pairs[i + 1] });
      api.prompts.push({ title, options });
    },
  };
  Shared.attach(api);
  WallOfFlame(api);
  return api;
}

/** A player with onyx and shards in the inventory, a greegree worn or not, and a Crafting level. */
function player(api, { onyx = 0, shard = 0, greegree = false, crafting = 70 } = {}) {
  const counts = new Map([[I.ONYX, onyx], [I.ZENYTE_SHARD, shard]]);
  const xp = [];
  const messages = [];
  const p = {
    counts, xp, messages,
    getInventory: () => ({
      getAmount: (id) => counts.get(id) ?? 0,
      contains: (id) => (counts.get(id) ?? 0) > 0,
      deleteNumber: (id, n) => counts.set(id, (counts.get(id) ?? 0) - n),
      adds: (id, n) => counts.set(id, (counts.get(id) ?? 0) + n),
    }),
    getEquipment: () => ({ get: (slot) => (greegree && slot === core.Equipment.WEAPON_SLOT ? { getId: () => I.ZOMBIE_MONKEY_GREEGREE } : null) }),
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.CRAFTING ? crafting : 1),
      getCurrentLevel: () => crafting,
      addExperiences: (skill, amount) => xp.push([skill, amount]),
    }),
    sendMessage: (text) => messages.push(text),
    isRegistered: () => true,
    getIndex: () => 1,
    getHitpoints: () => 10,
    getMovementQueue: () => ({ size: () => 0 }),
    getForceMovement: () => null,
    getLocation: () => ({ equals: () => true, clone() { return this; }, getDistance: () => 0 }),
    getInterfaceId: () => -1,
    getAttribute: () => null,
    setAttribute: () => {},
    performAnimation: () => {},
    getPacketSender: () => ({ sendTypedMessage: () => {} }),
  };
  return p;
}

/** Plays the scheduled tasks for `ticks` ticks: each running task executes once per tick. */
function run(api, ticks) {
  for (let t = 0; t < ticks; t++) {
    for (const task of [...api.tasks]) if (task.isRunning()) task.execute();
  }
}

function useOn(api, p, itemName = 'Onyx') {
  const hook = api.hooks.find((h) => h.item === itemName && h.obj === 'Wall of flame');
  assert.ok(hook, `a ${itemName} on Wall of flame hook is registered`);
  const event = { player: p, objectId: I.WALL_OF_FLAME ?? 4765, handled: false };
  const result = hook.handler(event);
  return { result, handled: event.handled };
}

function choose(api, label) {
  const prompt = api.prompts[api.prompts.length - 1];
  const option = prompt.options.find((o) => o.label === label);
  assert.ok(option, `"${label}" offered: ${JSON.stringify(prompt.options.map((o) => o.label))}`);
  option.run();
}

test('the wall of flame has both item uses registered (onyx and zenyte shard), by object name', () => {
  const api = fakeApi();
  assert.deepEqual(api.hooks.map((h) => [h.item, h.obj]).sort(), [['Onyx', 'Wall of flame'], ['Zenyte shard', 'Wall of flame']]);
});

test('no greegree: the captured line one tick later, nothing consumed, no prompt', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 1, shard: 1, greegree: false });
  const { result, handled } = useOn(api, p);
  assert.equal(result, true);
  assert.equal(handled, true);
  assert.equal(p.messages.length, 0, 'not on the same tick');
  run(api, 1);
  assert.deepEqual(p.messages, [NO_GREEGREE_MESSAGE]);
  assert.equal(p.counts.get(I.ONYX), 1);
  assert.equal(p.counts.get(I.ZENYTE_SHARD), 1);
  assert.equal(api.prompts.length, 0);
});

test('one pair with the greegree: the one-pair prompt; yes fuses once at 2 ticks, 15 XP, one uncut zenyte', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 1, shard: 1, greegree: true });
  useOn(api, p);
  assert.equal(api.prompts[0].title, FUSE_ONE);
  assert.deepEqual(api.prompts[0].options.map((o) => o.label), ['Yes - fuse them.', DONT]);
  choose(api, 'Yes - fuse them.');
  run(api, 1);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE) ?? 0, 0, 'nothing made before the second tick');
  run(api, 1);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 1);
  assert.equal(p.counts.get(I.ONYX), 0);
  assert.equal(p.counts.get(I.ZENYTE_SHARD), 0);
  assert.deepEqual(p.messages, [FUSE_MESSAGE]);
  assert.deepEqual(p.xp, [[Skill.CRAFTING, 15]]);
  run(api, 10);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 1, 'a single fuse, never a second');
});

test('one pair: "don\'t" makes nothing and consumes nothing', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 1, shard: 1, greegree: true });
  useOn(api, p);
  choose(api, DONT);
  run(api, 10);
  assert.equal(p.counts.get(I.ONYX), 1);
  assert.equal(p.counts.get(I.ZENYTE_SHARD), 1);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE) ?? 0, 0);
  assert.equal(p.messages.length, 0);
});

test('several pairs: "all" fuses every pair, one per 3 ticks from 2 ticks after the choice; inventory is conserved', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 3, shard: 4, greegree: true });
  useOn(api, p);
  assert.equal(api.prompts[0].title, FUSE_ALL);
  assert.deepEqual(api.prompts[0].options.map((o) => o.label), ['Yes - fuse them all.', 'Fuse only one.', DONT]);
  choose(api, 'Yes - fuse them all.');
  run(api, 2);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 1);
  run(api, 3);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 2);
  run(api, 3);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 3);
  run(api, 10);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 3, 'the three pairs, no more');
  assert.equal(p.counts.get(I.ONYX), 0);
  assert.equal(p.counts.get(I.ZENYTE_SHARD), 1, 'the spare shard is kept');
  assert.equal(p.messages.length, 3);
  assert.deepEqual(p.xp, [[Skill.CRAFTING, 15], [Skill.CRAFTING, 15], [Skill.CRAFTING, 15]]);
});

test('several pairs: "only one" fuses one pair', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 3, shard: 3, greegree: true });
  useOn(api, p);
  choose(api, 'Fuse only one.');
  run(api, 20);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 1);
  assert.equal(p.counts.get(I.ONYX), 2);
  assert.equal(p.counts.get(I.ZENYTE_SHARD), 2);
});

test('several pairs: "don\'t" makes nothing', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 2, shard: 2, greegree: true });
  useOn(api, p);
  choose(api, DONT);
  run(api, 10);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE) ?? 0, 0);
  assert.equal(p.counts.get(I.ONYX), 2);
});

test('the zenyte shard used first gives the same prompt (both item orders)', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 1, shard: 1, greegree: true });
  const { result, handled } = useOn(api, p, 'Zenyte shard');
  assert.equal(result, true);
  assert.equal(handled, true);
  assert.equal(api.prompts[0].title, FUSE_ONE);
});

test('Monkey Madness II not complete: not handled, nothing consumed, no prompt', () => {
  const api = fakeApi(false);
  const p = player(api, { onyx: 1, shard: 1, greegree: true });
  const { result, handled } = useOn(api, p);
  assert.equal(result, false);
  assert.equal(handled, false);
  assert.equal(api.prompts.length, 0);
  assert.equal(p.counts.get(I.ONYX), 1);
});

test('Crafting 69: not handled, nothing consumed, no prompt', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 1, shard: 1, greegree: true, crafting: 69 });
  const { result, handled } = useOn(api, p);
  assert.equal(result, false);
  assert.equal(handled, false);
  assert.equal(api.prompts.length, 0);
});

test('only one of the two gems held: not handled', () => {
  const api = fakeApi();
  const p = player(api, { onyx: 1, shard: 0, greegree: true });
  const { result, handled } = useOn(api, p);
  assert.equal(result, false);
  assert.equal(handled, false);
  assert.equal(api.prompts.length, 0);
});
