// Run after `yarn build`: node --test tests/sailing-amenities.test.cjs
//
// Building the Sailing islands' rowboats (Wiki: Rowboat (amenity)) with a real Player, Inventory
// and skills: the requirements, what Build uses and gives, and the varbit kept across logins.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');

let Amenities, core;
const hooks = {};
const persisted = new Map();

before(() => {
  CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  const api = new Proxy({
    core,
    onObjectInteraction: (name, actions) => { hooks[name] = actions; },
    onPlayerLogin: (fn) => { hooks.login = fn; },
    persistAttribute: (key, value) => persisted.set(key, value),
  }, { get: (target, key) => (key in target ? target[key] : () => {}) });
  Amenities = require('../plugins/skills/sailing/Amenities.Sailing');
  Amenities.register(api);
});

const obj = (name) => core.CacheDefinitions.getObjId(name);
const loc = (name) => core.CacheDefinitions.getLocId(name);
const varbit = (name) => core.CacheDefinitions.getVarbitId(name);

let nextIndex = 950;
function player(t, construction = 50) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const p = new Player(null);
  p.lines = [];
  p.varbits = new Map();
  t.mock.method(p, 'getSession', () => ({ sendClientPacket: () => true, write: () => true }));
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.mock.method(p, 'sendMessage', (m) => p.lines.push(m));
  t.mock.method(p, 'performAnimation', () => {});
  t.mock.method(p.getPacketSender(), 'sendVarbit', (id, v) => { p.varbits.set(id, v); return p.getPacketSender(); });
  p.getSkillManager().setCurrentLevel(core.Skill.CONSTRUCTION, construction, false);
  p.setIndex(++nextIndex);
  p.setRegistered(true);
  t.after(() => p.setRegistered(false));
  return p;
}

const give = (p, name, n = 1) => p.getInventory().add(new core.Item(obj(name), n));
const has = (p, name) => p.getInventory().getAmount(obj(name));
const build = (p, gameval = 'amenity_rowboat_ynysdail_out') => hooks['Rowboat space'].Build({ player: p, objectId: loc(gameval) });
const kit = (p) => { give(p, 'hammer'); give(p, 'poh_saw'); give(p, 'plank_camphor', 8); give(p, 'swamppaste', 10); };

test('Build at the Ynysdail rowboat space uses the Wiki materials for 1297 Construction XP and shows the rowboat', (t) => {
  const p = player(t);
  kit(p);
  const before = p.getSkillManager().getExperience(core.Skill.CONSTRUCTION);
  assert.equal(build(p), true);
  assert.equal(has(p, 'plank_camphor'), 0);
  assert.equal(has(p, 'swamppaste'), 0);
  assert.equal(has(p, 'hammer'), 1, 'tools stay');
  assert.ok(p.getSkillManager().getExperience(core.Skill.CONSTRUCTION) > before);
  assert.equal(p.varbits.get(varbit('amenity_rowboat_ynysdail')), 1);
  assert.equal(p.getAttribute('sailing:amenity-rowboat-ynysdail'), 1);
  assert.equal(persisted.get('sailing:amenity-rowboat-ynysdail'), 0, 'saved, starting unbuilt');

  // Login sends the built rowboat again.
  p.varbits.clear();
  hooks.login({ player: p });
  assert.equal(p.varbits.get(varbit('amenity_rowboat_ynysdail')), 1);
  assert.equal(p.varbits.has(varbit('amenity_rowboat_anglers')), false, 'unbuilt sites are left at 0');
});

test('each of the five rowboat spaces builds its own site and no other', (t) => {
  for (const site of ['vatrachos', 'anglers', 'soul_tear', 'ynysdail', 'buccaneers']) {
    const p = player(t);
    kit(p);
    assert.equal(build(p, `amenity_rowboat_${site}_out`), true);
    assert.equal(p.varbits.get(varbit(`amenity_rowboat_${site}`)), 1, site);
    assert.equal(p.varbits.size, 1, site);
  }
});

test('Build refuses below 50 Construction, without a hammer and saw, or short of materials, and uses nothing', (t) => {
  const low = player(t, 49);
  kit(low);
  build(low);
  assert.deepEqual(low.lines, ['You need a Construction level of 50 to build a rowboat.']);
  assert.equal(has(low, 'plank_camphor'), 8);

  const noSaw = player(t);
  give(noSaw, 'hammer'); give(noSaw, 'plank_camphor', 8); give(noSaw, 'swamppaste', 10);
  build(noSaw);
  assert.deepEqual(noSaw.lines, ['You need a hammer and a saw to build a rowboat.']);

  const short = player(t);
  give(short, 'hammer'); give(short, 'poh_saw'); give(short, 'plank_camphor', 7); give(short, 'swamppaste', 10);
  build(short);
  assert.deepEqual(short.lines, ['You need 8 camphor planks and 10 swamp paste to build a rowboat.']);
  assert.equal(has(short, 'plank_camphor'), 7);
  assert.equal(short.varbits.size, 0);
});

test('other locs named Rowboat space (Fossil Island\'s) are left to their own plugin', (t) => {
  const p = player(t);
  kit(p);
  assert.equal(hooks['Rowboat space'].Build({ player: p, objectId: loc('fossil_rowboat_lithkren_hotspot') }), false);
  assert.equal(hooks['Rowboat space'].Inspect({ player: p, objectId: loc('fossil_rowboat_lithkren_hotspot') }), false);
  assert.equal(has(p, 'plank_camphor'), 8);
});
