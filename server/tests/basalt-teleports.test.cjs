// From server/ after `yarn build`: node --test tests/basalt-teleports.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const path = require('node:path');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { Server } = require('../dist/Server'); Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Sounds } = require('../dist/game/Sounds');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { TeleportHandler } = require('../dist/game/model/teleportation/TeleportHandler');
const Basalt = require('../plugins/items/BasaltTeleports.plugin');
const core = PluginManager.getCoreApi(), I = core.ItemIdentifiers;

function scene({ quest = true, at = [3162, 3487, 0], canTeleport = true, item = I.ICY_BASALT, agility = [73, 73], diary = true } = {}) {
  let count = 3, onLogin = null;
  const handlers = new Map();
  const messages = [], teleports = [], confirms = [], varbits = new Map(), attributes = new Map();
  const inventory = {
    contains: (id) => id === item && count > 0,
    deleteNumber: (id, amount) => { assert.equal(id, item); count -= amount; },
  };
  const player = {
    getInventory: () => inventory,
    getLocation: () => new core.Location(...at),
    sendMessage: (text) => messages.push(text),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => { assert.equal(skill, core.Skill.AGILITY); return agility[0]; },
      getMaxLevel: (skill) => { assert.equal(skill, core.Skill.AGILITY); return agility[1]; },
    }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => ({ getVarbit: (id) => varbits.get(id) ?? 0, sendVarbit: (id, value) => varbits.set(id, value) }),
  };
  const api = {
    core: { ...core, TeleportHandler: {
      checkReqs: () => canTeleport,
      confirm: (p, destination, go, level, options) => { confirms.push({ destination, level, options }); go(); },
      teleport: (...args) => teleports.push(args),
    } },
    onItemAction: (name, actions) => handlers.set(name, actions),
    onPlayerLogin: (handler) => { onLogin = handler; },
    emitCustomEvent: (name, request) => {
      if (name === 'quest:is-complete' && request.key === 'making_friends_with_my_arm') request.complete = quest;
      if (name === 'diary:is-complete' && request.diary === 'fremennik' && request.tier === 'hard') request.complete = diary;
    },
  };
  Basalt.attach(api);
  return {
    player, actions: handlers.get('Icy basalt'), stony: handlers.get('Stony basalt'), onItemActionName: [...handlers.keys()][0],
    messages, teleports, confirms, varbits, attributes, login: () => onLogin({ player }), count: () => count,
  };
}

const landing = (s) => s.teleports.map(([, d]) => [d.getX(), d.getY(), d.getZ()]);
let TOGGLE_VARBIT = null;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  TOGGLE_VARBIT = core.CacheDefinitions.getVarbitId('my2arm_stronghold_tele_toggle');
});

test('Weiss on icy basalt uses one basalt and teleports to the captured Weiss tile', () => {
  const s = scene();
  assert.equal(s.onItemActionName, 'Icy basalt');
  assert.equal(s.actions.Weiss({ player: s.player, itemId: I.ICY_BASALT }), true);
  assert.equal(s.count(), 2);
  assert.equal(s.teleports.length, 1);
  const [, destination, type] = s.teleports[0];
  assert.deepEqual([destination.getX(), destination.getY(), destination.getZ()], [2846, 3940, 0]);
  assert.equal(type, Basalt.basaltTeleport(core));
  assert.equal(s.confirms[0].options.item, I.ICY_BASALT);
  assert.deepEqual(s.messages, []);
});

test('without Making Friends with My Arm, or in the Weiss square, nothing is used', () => {
  const locked = scene({ quest: false });
  locked.actions.Weiss({ player: locked.player, itemId: I.ICY_BASALT });
  assert.equal(locked.count(), 3);
  assert.deepEqual(locked.teleports, []);
  assert.deepEqual(locked.messages, [Basalt.QUEST_LOCKED]);

  for (const at of [[2846, 3940, 0], [2844, 3936, 0], [2848, 3940, 0]]) {
    const here = scene({ at });
    here.actions.Weiss({ player: here.player, itemId: I.ICY_BASALT });
    assert.equal(here.count(), 3, `${at}`);
    assert.deepEqual(here.messages, [Basalt.ALREADY_HERE]);
  }
  const outside = scene({ at: [2846, 3943, 0] });
  outside.actions.Weiss({ player: outside.player, itemId: I.ICY_BASALT });
  assert.equal(outside.count(), 2, 'three tiles north of the square teleports');
});

test('a refused teleport check keeps the basalt', () => {
  const s = scene({ canTeleport: false });
  assert.equal(s.actions.Weiss({ player: s.player, itemId: I.ICY_BASALT }), true);
  assert.equal(s.count(), 3);
  assert.deepEqual(s.teleports, []);
});

test('the basalt teleport plays out as in the captures, tick by tick', (t) => {
  const ticks = [[]];
  const log = (entry) => ticks[ticks.length - 1].push(entry);
  const playAreaSoundAt = Sounds.playAreaSoundAt, sendSound = Sounds.sendSound;
  Sounds.playAreaSoundAt = (_entity, sound, range) => log(`area sound ${sound.getId()} range ${range}`);
  Sounds.sendSound = (_player, sound) => log(`sound ${sound.getId()}`);
  t.after(() => { Sounds.playAreaSoundAt = playAreaSoundAt; Sounds.sendSound = sendSound; });
  const player = {
    getMovementQueue: () => ({ setBlockMovement: (blocked) => { log(blocked ? 'locked' : 'free'); return { reset: () => {} }; }, reset: () => {} }),
    getSkillManager: () => ({ stopSkillable: () => {} }),
    getPacketSender: () => ({ sendInterfaceRemoval: () => {}, sendVarbit: (id, value) => log(`varbit ${id}=${value}`) }),
    getCombat: () => ({ reset: () => {} }),
    getClickDelay: () => ({ reset: () => {} }),
    performAnimation: (animation) => log(`anim ${animation.getId()}`),
    performGraphic: (graphic) => graphic && log(`spotanim ${graphic.getId()} delay ${graphic.getDelay()} height ${graphic.getHeight()}`),
    setUntargetable: () => {},
    setTeleporting: () => {},
    moveTo: (location) => log(`teleport ${location.getX()},${location.getY()},${location.getZ()}`),
  };
  TeleportHandler.teleport(player, new core.Location(...Basalt.DESTINATION), Basalt.basaltTeleport(core), false);
  ticks.push([]);
  for (let tick = 0; tick < 7; tick++) { TaskManager.process(); ticks.push([]); }

  assert.deepEqual(ticks.slice(0, 6), [
    ['locked', 'anim 8172', 'spotanim 1628 delay 10 height 0', 'area sound 2596 range 10'],
    [], [], [],
    ['anim 65535', 'teleport 2846,3940,0', 'free'],
    ['anim 65535'],
  ]);
  assert.deepEqual(ticks.slice(6).flat(), [], 'nothing after, and no varbit busy (not captured)');
});

test('stony basalt: the entrance and roof options land on their tiles with the stony spotanim', () => {
  assert.equal(TOGGLE_VARBIT, 19649);
  const s = scene({ item: I.STONY_BASALT });
  s.stony['Troll Stronghold entrance']({ player: s.player, itemId: I.STONY_BASALT });
  s.stony['Troll Stronghold roof']({ player: s.player, itemId: I.STONY_BASALT });
  assert.deepEqual(landing(s), [[2845, 3694, 0], [2838, 3693, 0]]);
  assert.equal(s.count(), 1);
  for (const [, , type] of s.teleports) assert.equal(type, Basalt.stonyBasaltTeleport(core));
  assert.equal(Basalt.stonyBasaltTeleport(core).getStartGraphic().getId(), 1617);
  assert.equal(s.confirms[0].options.item, I.STONY_BASALT);
  assert.deepEqual(s.messages, []);
});

test('stony basalt: the roof needs 73 Agility (boosted, or a drained 73 base) and the hard Fremennik Diary', () => {
  for (const [agility, diary, roof] of [
    [[72, 72], true, false], [[73, 70], true, true], [[70, 73], true, true], [[80, 80], false, false],
  ]) {
    const s = scene({ item: I.STONY_BASALT, agility, diary });
    s.stony['Troll Stronghold roof']({ player: s.player, itemId: I.STONY_BASALT });
    assert.equal(s.count(), roof ? 2 : 3, `${agility} ${diary}`);
    assert.deepEqual(s.messages, roof ? [] : [Basalt.ROOF_LOCKED]);
    // The left-click falls back to the entrance.
    const left = scene({ item: I.STONY_BASALT, agility, diary });
    left.stony['Troll Stronghold']({ player: left.player, itemId: I.STONY_BASALT });
    assert.deepEqual(landing(left), [roof ? [2838, 3693, 0] : [2845, 3694, 0]]);
  }
  const noQuest = scene({ item: I.STONY_BASALT, quest: false, diary: false });
  noQuest.stony['Troll Stronghold roof']({ player: noQuest.player, itemId: I.STONY_BASALT });
  assert.deepEqual(noQuest.messages, [Basalt.QUEST_LOCKED]);
});

test('stony basalt: Toggle swaps the left-click between roof and entrance, in the cache varbit', () => {
  const s = scene({ item: I.STONY_BASALT });
  s.stony.Toggle({ player: s.player, itemId: I.STONY_BASALT });
  assert.equal(s.varbits.get(TOGGLE_VARBIT), 1);
  assert.equal(s.attributes.get(Basalt.STRONGHOLD_TOGGLE_ATTRIBUTE), true);
  s.stony['Troll Stronghold']({ player: s.player, itemId: I.STONY_BASALT });
  s.stony.Toggle({ player: s.player, itemId: I.STONY_BASALT });
  assert.equal(s.varbits.get(TOGGLE_VARBIT), 0);
  s.stony['Troll Stronghold']({ player: s.player, itemId: I.STONY_BASALT });
  assert.deepEqual(landing(s), [[2845, 3694, 0], [2838, 3693, 0]]);
  assert.deepEqual(s.messages, [Basalt.TOGGLED_ENTRANCE, Basalt.TOGGLED_ROOF]);

  const relog = scene({ item: I.STONY_BASALT });
  relog.attributes.set(Basalt.STRONGHOLD_TOGGLE_ATTRIBUTE, true);
  relog.login();
  assert.equal(relog.varbits.get(TOGGLE_VARBIT), 1, 'login restores the saved toggle');
});

test('stony basalt: standing in a destination square refuses only that destination', () => {
  const s = scene({ item: I.STONY_BASALT, at: [2838, 3693, 0] });
  s.stony['Troll Stronghold']({ player: s.player, itemId: I.STONY_BASALT });
  assert.deepEqual(s.messages, [Basalt.ALREADY_HERE]);
  s.stony['Troll Stronghold entrance']({ player: s.player, itemId: I.STONY_BASALT });
  assert.deepEqual(landing(s), [[2845, 3694, 0]]);
  const below = scene({ item: I.STONY_BASALT, at: [2847, 3696, 0] });
  below.stony['Troll Stronghold entrance']({ player: below.player, itemId: I.STONY_BASALT });
  assert.deepEqual(below.messages, [Basalt.ALREADY_HERE]);
  assert.equal(below.count(), 3);
});
