// node --test tests/wall-of-flame-fuse.test.cjs   (needs `dist` for the core API; most cases drive the plugin with a fake player,
// api and tasks; the last case loads the real plugin set and fires PluginManager.emitItemOnObject with real players)
// Wall of flame (#5635): onyx and zenyte shards fuse into uncut zenyte, at the Ape Atoll pit only (objects 4765 and 4766;
// the Between a Rock mine's walls, 5977-5980, share the name and are not fuse walls). Captures, by game tick (raw decoded
// recordings: rsprox 1157, rev 237.1, raw sha256 3efbb079...b484; rsprox 3342, rev 235.1, raw sha256 35030e04...232e):
// 1157: the shard on the wall at tick 3260; the "Fuse all..." prompt at 3262; the choice at 3266; fuse messages at 3268,
// 3271, 3274. 3342: onyx on the wall with no greegree at 4251, the statement box at 4252; one pair: the use at 4451, the
// "Fuse your onyx and zenyte shard?" prompt at 4452, the choice at 4454, the message at 4456.
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
const WALL_IDS = [4765, 4766];

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
    onItemOnObject(item, obj, handler, filter) { api.hooks.push({ item, obj, handler, filter }); },
    produced: [],
    emitCustomEvent(name, request) {
      if (name === 'quest:is-complete') request.complete = api.mm2 && request.key === 'monkey_madness_ii';
      if (name === 'skills:produced') api.produced.push(request);
    },
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

/** A player with onyx and shards in the inventory, a greegree worn (`greegree` true for the small one, or an id), and a Crafting level. */
function player({ onyx = 0, shard = 0, greegree = false, crafting = 70 } = {}) {
  const counts = new Map([[I.ONYX, onyx], [I.ZENYTE_SHARD, shard]]);
  const worn = greegree === true ? I.ZOMBIE_MONKEY_GREEGREE : greegree || null;
  const xp = [];
  const messages = [];
  return {
    counts, xp, messages,
    getInventory: () => ({
      getAmount: (id) => counts.get(id) ?? 0,
      contains: (id) => (counts.get(id) ?? 0) > 0,
      deleteNumber: (id, n) => counts.set(id, (counts.get(id) ?? 0) - n),
      adds: (id, n) => counts.set(id, (counts.get(id) ?? 0) + n),
    }),
    getEquipment: () => ({ get: (slot) => (worn && slot === core.Equipment.WEAPON_SLOT ? { getId: () => worn } : null) }),
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
    hasBlockingInterface: () => false,
    getInterfaceId: () => -1,
    getAttribute: () => null,
    setAttribute: () => {},
    performAnimation: () => {},
    getPacketSender: () => ({ sendTypedMessage: () => {} }),
  };
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
  const event = { player: p, objectId: WALL_IDS[0], handled: false };
  const result = hook.handler(event);
  return { result, handled: event.handled };
}

function choose(api, label) {
  const prompt = api.prompts[api.prompts.length - 1];
  const option = prompt.options.find((o) => o.label === label);
  assert.ok(option, `"${label}" offered: ${JSON.stringify(prompt.options.map((o) => o.label))}`);
  option.run();
}

test('the wall of flame has both item uses registered (onyx and zenyte shard), by object name, noted items excluded', () => {
  const api = fakeApi();
  assert.deepEqual(api.hooks.map((h) => [h.item, h.obj]).sort(), [['Onyx', 'Wall of flame'], ['Zenyte shard', 'Wall of flame']]);
  for (const hook of api.hooks) assert.deepEqual(hook.filter, { noted: false });
});

test('no greegree: the statement box with the captured text one tick later, nothing consumed, no prompt', () => {
  const api = fakeApi();
  const p = player({ onyx: 1, shard: 1, greegree: false });
  const shown = [];
  const send = core.StatementDialogue.send;
  core.StatementDialogue.send = (player, text, canContinue) => shown.push([player, text, canContinue]);
  try {
    const { result, handled } = useOn(api, p);
    assert.equal(result, true);
    assert.equal(handled, true);
    run(api, 1);
    assert.equal(shown.length, 1, 'one statement box');
    assert.equal(shown[0][0], p);
    assert.equal(shown[0][1], NO_GREEGREE_MESSAGE);
    assert.deepEqual(p.messages, [], 'the line is not a chat message');
  } finally {
    core.StatementDialogue.send = send;
  }
  assert.equal(p.counts.get(I.ONYX), 1);
  assert.equal(p.counts.get(I.ZENYTE_SHARD), 1);
  assert.equal(api.prompts.length, 0);
});

test('one pair with the greegree: the one-pair prompt; yes fuses once at 2 ticks, 15 XP, one uncut zenyte', () => {
  const api = fakeApi();
  const p = player({ onyx: 1, shard: 1, greegree: true });
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
  // Decision (#5646): the fuse does not emit skills:produced. Its consumers (league relic extra products, league
  // fragments and tasks, diaries) could duplicate the uncut zenyte, and no retail capture or Wiki line shows that.
  assert.equal(api.produced.length, 0, 'no skills:produced from the fuse');
  assert.deepEqual(p.messages, [FUSE_MESSAGE]);
  assert.deepEqual(p.xp, [[Skill.CRAFTING, 15]]);
  run(api, 10);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 1, 'a single fuse, never a second');
});

test('the second zombie monkey greegree (large) counts the same', () => {
  const api = fakeApi();
  const p = player({ onyx: 1, shard: 1, greegree: I.ZOMBIE_MONKEY_GREEGREE_2 });
  useOn(api, p);
  assert.equal(api.prompts[0].title, FUSE_ONE);
});

test('one pair: "don\'t" makes nothing and consumes nothing', () => {
  const api = fakeApi();
  const p = player({ onyx: 1, shard: 1, greegree: true });
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
  const p = player({ onyx: 3, shard: 4, greegree: true });
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

test('several pairs: "only one" fuses one pair (the label, inferred)', () => {
  const api = fakeApi();
  const p = player({ onyx: 3, shard: 3, greegree: true });
  useOn(api, p);
  choose(api, 'Fuse only one.');
  run(api, 20);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE), 1);
  assert.equal(p.counts.get(I.ONYX), 2);
  assert.equal(p.counts.get(I.ZENYTE_SHARD), 2);
});

test('several pairs: "don\'t" makes nothing', () => {
  const api = fakeApi();
  const p = player({ onyx: 2, shard: 2, greegree: true });
  useOn(api, p);
  choose(api, DONT);
  run(api, 10);
  assert.equal(p.counts.get(I.UNCUT_ZENYTE) ?? 0, 0);
  assert.equal(p.counts.get(I.ONYX), 2);
});

test('the zenyte shard used first gives the same prompt (both item orders)', () => {
  const api = fakeApi();
  const p = player({ onyx: 1, shard: 1, greegree: true });
  const { result, handled } = useOn(api, p, 'Zenyte shard');
  assert.equal(result, true);
  assert.equal(handled, true);
  assert.equal(api.prompts[0].title, FUSE_ONE);
});

test('Monkey Madness II not complete: not handled, nothing consumed, no prompt', () => {
  const api = fakeApi(false);
  const p = player({ onyx: 1, shard: 1, greegree: true });
  const { result, handled } = useOn(api, p);
  assert.equal(result, false);
  assert.equal(handled, false);
  assert.equal(api.prompts.length, 0);
  assert.equal(p.counts.get(I.ONYX), 1);
});

test('Crafting 69: not handled, nothing consumed, no prompt', () => {
  const api = fakeApi();
  const p = player({ onyx: 1, shard: 1, greegree: true, crafting: 69 });
  const { result, handled } = useOn(api, p);
  assert.equal(result, false);
  assert.equal(handled, false);
  assert.equal(api.prompts.length, 0);
});

test('only one of the two gems held: not handled', () => {
  const api = fakeApi();
  const p = player({ onyx: 1, shard: 0, greegree: true });
  const { result, handled } = useOn(api, p);
  assert.equal(result, false);
  assert.equal(handled, false);
  assert.equal(api.prompts.length, 0);
});

test('through the real plugin manager: each wall id and each item reaches the fuse prompt', (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { SkillManager } = require('../dist/game/content/skill/SkillManager');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  core.ObjectDefinition.init();
  Shared.attach(PluginManager.createApi('Crafting'));
  WallOfFlame(PluginManager.createApi('WallOfFlame'));
  PluginManager.createApi('TestMonkeyMadnessII').onCustomEvent('quest:is-complete', (request) => {
    if (request.key === 'monkey_madness_ii') request.complete = true;
  });
  let index = 15000;
  for (const objectId of WALL_IDS) {
    for (const itemId of [I.ONYX, I.ZENYTE_SHARD]) {
      const p = new Player(new PlayerSession({ kind: 'test', isOpen: () => true, send: () => true }))
        .setUsername(`wall${index}`).setIndex(index++);
      p.setRegistered(true); p.setNeedsPlacement(false);
      p.setLocation(new core.Location(2811, 9209));
      p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 70, false).setMaxLevels(core.Skill.CRAFTING, 70, false)
        .setExperience(core.Skill.CRAFTING, SkillManager.getExperienceForLevel(70));
      p.getInventory().adds(I.ONYX, 1);
      p.getInventory().adds(I.ZENYTE_SHARD, 1);
      p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.ZOMBIE_MONKEY_GREEGREE, 1));
      t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
      const slot = p.getInventory().getSlotForItemId(itemId);
      const object = new core.GameObject(objectId, new core.Location(2811, 9208), 10, 0);
      const handled = PluginManager.emitItemOnObject({ player: p, itemId, item: p.getInventory().get(slot), slot,
        objectId, object, location: p.getLocation(), handled: false });
      assert.equal(handled, true, `item ${itemId} on wall ${objectId} is handled`);
      const pending = MultiChatboxPrompt.getPending(p);
      assert.equal(pending?.title, FUSE_ONE, `item ${itemId} on wall ${objectId} asks to fuse`);
    }
  }
});

test('through the real plugin manager: the Between a Rock walls of flame (5977-5980) are not fuse walls', (t) => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { SkillManager } = require('../dist/game/content/skill/SkillManager');
  const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
  core.ObjectDefinition.init();
  Shared.attach(PluginManager.createApi('Crafting'));
  WallOfFlame(PluginManager.createApi('WallOfFlame'));
  PluginManager.createApi('TestMonkeyMadnessII').onCustomEvent('quest:is-complete', (request) => {
    if (request.key === 'monkey_madness_ii') request.complete = true;
  });
  // The cache names these "Wall of flame" too (ObjectIdentifiers.WALL_OF_FLAME_3..6); the Between a Rock mine has its own use.
  const MINE_WALLS = [core.ObjectIdentifiers.WALL_OF_FLAME_3, core.ObjectIdentifiers.WALL_OF_FLAME_6];
  assert.deepEqual(MINE_WALLS, [5977, 5980]);
  let index = 16000;
  for (const objectId of MINE_WALLS) {
    for (const itemId of [I.ONYX, I.ZENYTE_SHARD]) {
      const p = new Player(new PlayerSession({ kind: 'test', isOpen: () => true, send: () => true }))
        .setUsername(`mine${index}`).setIndex(index++);
      p.setRegistered(true); p.setNeedsPlacement(false);
      p.setLocation(new core.Location(2811, 9209));
      p.getSkillManager().setCurrentLevel(core.Skill.CRAFTING, 70, false).setMaxLevels(core.Skill.CRAFTING, 70, false)
        .setExperience(core.Skill.CRAFTING, SkillManager.getExperienceForLevel(70));
      p.getInventory().adds(I.ONYX, 1);
      p.getInventory().adds(I.ZENYTE_SHARD, 1);
      p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.ZOMBIE_MONKEY_GREEGREE, 1));
      t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p.getIndex()); });
      const slot = p.getInventory().getSlotForItemId(itemId);
      const object = new core.GameObject(objectId, new core.Location(2811, 9208), 10, 0);
      const handled = PluginManager.emitItemOnObject({ player: p, itemId, item: p.getInventory().get(slot), slot,
        objectId, object, location: p.getLocation(), handled: false });
      assert.equal(handled, false, `item ${itemId} on the mine's wall ${objectId} is not handled by the fuse`);
      assert.equal(MultiChatboxPrompt.getPending(p), null, `no fuse prompt on wall ${objectId}`);
      assert.equal(p.getInventory().getAmount(I.ONYX), 1, 'onyx not consumed');
      assert.equal(p.getInventory().getAmount(I.ZENYTE_SHARD), 1, 'shard not consumed');
    }
  }
});
