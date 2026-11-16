// Run after yarn build: node --test tests/fossil-bone-machine.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const { Player } = require('../dist/game/entity/impl/player/Player');
const fs = require('node:fs');
const path = require('node:path');

let core;
const hooks = new Map();
before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const plugin = path.join(__dirname, '../plugins/areas/FossilBoneMachine.plugin.js');
  if (fs.existsSync(plugin)) require(plugin).register({
    core, onItemOnObject: (item, loc, handler) => hooks.set(item, handler),
  });
});

const id = (name) => core.CacheDefinitions.getObjId(`fossil_enriched_bone_${name}`);
let nextIndex = 900;
function setup(t) {
  const p = new Player(null);
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  p.messages = []; p.xp = []; p.anims = []; p.locs = []; p.sounds = [];
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  p.moveTo(new Location(3768, 3870, 1));
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.mock.method(p, 'sendMessage', (s) => p.messages.push(s));
  t.mock.method(p, 'performAnimation', (anim) => p.anims.push(anim.getId()));
  t.mock.method(p.getSkillManager(), 'addExperiences', (skill, xp) => p.xp.push([skill, xp]));
  t.mock.method(p.getPacketSender(), 'sendObjectAnimation', (o, anim) => p.locs.push(anim.getId()));
  t.mock.method(p.getPacketSender(), 'sendSoundEffect', (...args) => p.sounds.push(args));
  t.after(() => { p.getSkill()?.cancel?.(); p.setRegistered(false); });
  return p;
}
function use(p, name, objectId = core.CacheDefinitions.getLocId('fossil_lab_bone_grinder')) {
  const slot = p.getInventory().getItems().findIndex(i => i?.getId() === id(name));
  const object = { getLocation: () => new Location(3769, 3868, 1), getId: () => objectId };
  const event = { player: p, object, objectId, itemId: id(name), itemSlot: slot, handled: false };
  const handler = hooks.get(`${name[0].toUpperCase()}${name.slice(1)} enriched bone`);
  assert.ok(handler, 'the enriched bone has an item-on-object handler');
  handler(event);
  return event;
}
function give(p, name) { p.getInventory().add(new core.Item(id(name), 1)); }

test('selected bone first, then carried enriched bones, with one cycle per two ticks and Wiki XP', t => {
  const p = setup(t);
  for (const n of ['small', 'medium', 'large', 'rare']) assert.ok(id(n) > 0, `${n} is in the cache`);
  for (const seq of ['human_pickuptable', 'fi_dkl_bone_machine_active', 'fi_dkl_bone_machine_inactive']) {
    assert.ok(core.CacheDefinitions.getSeqId(seq) > 0, `${seq} is in the cache`);
  }
  for (const n of ['small', 'medium', 'large', 'rare']) give(p, n);
  assert.equal(use(p, 'medium').handled, true);
  TaskManager.process();
  assert.deepEqual(p.messages, ['You feed the bone into the machine.']);
  assert.equal(p.getInventory().getAmount(id('medium')), 1);
  assert.deepEqual(p.anims, [core.CacheDefinitions.getSeqId('human_pickuptable')]);
  assert.equal(p.sounds[0][0], 127);
  TaskManager.process();
  assert.equal(p.getInventory().getAmount(id('medium')), 0);
  assert.deepEqual(p.xp.map(x => x[1]), [1000]);
  for (let i = 0; i < 6; i++) TaskManager.process();
  assert.deepEqual(p.xp.map(x => x[1]), [1000, 500, 1500, 2500]);
  assert.equal(p.messages.length, 4);
  assert.equal(p.locs.at(-1), core.CacheDefinitions.getSeqId('fi_dkl_bone_machine_inactive'));
  assert.equal(p.getSkill(), null);
});

test('other machines are untouched and interruption before reward keeps the bone', t => {
  const p = setup(t);
  give(p, 'small');
  assert.equal(use(p, 'small', core.CacheDefinitions.getLocId('fossil_lab_shield_maker')).handled, false);
  use(p, 'small');
  TaskManager.process();
  p.getSkill().cancel();
  TaskManager.process();
  assert.equal(p.getInventory().getAmount(id('small')), 1);
  assert.deepEqual(p.xp, []);
});

test('moving or replacing the selected slot stops the action without consuming a different item', t => {
  const p = setup(t);
  give(p, 'small');
  use(p, 'small');
  TaskManager.process();
  p.getInventory().setItem(0, new core.Item(id('rare'), 1));
  TaskManager.process();
  assert.equal(p.getInventory().getAmount(id('rare')), 1);
  assert.deepEqual(p.xp, []);
  use(p, 'rare');
  p.moveTo(new Location(3766, 3870, 1));
  TaskManager.process();
  assert.equal(p.getInventory().getAmount(id('rare')), 1);
  assert.deepEqual(p.xp, []);
});

for (const autoRetaliation of [false, true]) {
  test(`${autoRetaliation ? 'auto-retaliation' : 'attacking'} cancels the pending feed and clears the skill`, t => {
    const p = setup(t);
    const target = new Player(null);
    target.setIndex(++nextIndex);
    give(p, 'small');
    use(p, 'small');
    TaskManager.process();
    p.getCombat().attack(target, autoRetaliation);
    TaskManager.process();
    assert.equal(p.getInventory().getAmount(id('small')), 1);
    assert.deepEqual(p.xp, []);
    assert.equal(p.getSkill(), null);
    assert.equal(p.locs.at(-1), core.CacheDefinitions.getSeqId('fi_dkl_bone_machine_inactive'));
  });
}

test('disconnect before reward stops the feed without consuming the bone', t => {
  const p = setup(t);
  give(p, 'small');
  use(p, 'small');
  TaskManager.process();
  p.setRegistered(false);
  TaskManager.process();
  assert.equal(p.getInventory().getAmount(id('small')), 1);
  assert.deepEqual(p.xp, []);
  assert.equal(p.getSkill(), null);
});
