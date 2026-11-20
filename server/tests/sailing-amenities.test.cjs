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

const DATA = require('../plugins/skills/sailing/data/amenities.json');

test('every site is its cache multiloc: the site varbit, the space at 0 and the built amenity at 1', () => {
  let count = 0;
  for (const [kind, amenity] of Object.entries(DATA.amenities)) {
    for (const site of amenity.sites) {
      const definition = core.CacheDefinitions.getObject(loc(site.loc));
      assert.ok(definition, site.loc);
      assert.equal(definition.transformVarbit, varbit(site.varbit), site.loc);
      const [space, built] = definition.transforms.map((id) => core.CacheDefinitions.getObject(id));
      assert.match(space.name, / space$/, `${site.loc}: ${space.name}`);
      assert.deepEqual(space.actions.filter(Boolean), ['Build', 'Inspect'], site.loc);
      assert.equal(space.name, `${built.name} space`, `${kind}: ${built.name}`);
      count++;
    }
    for (const [name] of amenity.materials) assert.ok(obj(name) != null, `${kind}: ${name}`);
  }
  assert.equal(count, 29);
});

test('one of each amenity builds with its Wiki materials and level, and needs that level', (t) => {
  for (const [kind, amenity] of Object.entries(DATA.amenities)) {
    const site = amenity.sites[0];
    const space = core.CacheDefinitions.getObject(core.CacheDefinitions.getObject(loc(site.loc)).transforms[0]).name;
    const low = player(t, amenity.level - 1);
    give(low, 'hammer'); give(low, 'poh_saw');
    for (const [name, amount] of amenity.materials) give(low, name, amount);
    hooks[space].Build({ player: low, objectId: loc(site.loc) });
    assert.match(low.lines[0], new RegExp(`level of ${amenity.level} to build ${amenity.name}\.$`), kind);

    const p = player(t, amenity.level);
    give(p, 'hammer'); give(p, 'poh_saw');
    for (const [name, amount] of amenity.materials) give(p, name, amount);
    assert.equal(hooks[space].Build({ player: p, objectId: loc(site.loc) }), true, kind);
    for (const [name] of amenity.materials) assert.equal(has(p, name), 0, `${kind} uses its ${name}`);
    assert.equal(p.varbits.get(varbit(site.varbit)), 1, kind);
    assert.deepEqual(p.lines, [`You build ${amenity.name}.`], kind);
  }
});

test("Inspect names the amenity's level and materials", (t) => {
  const p = player(t);
  hooks['Bank chest space'].Inspect({ player: p, objectId: loc('amenity_bankchest_sangvesti') });
  assert.deepEqual(p.lines, ['You could build a bank chest here with level 70 Construction, a hammer, a saw, 4 ironwood planks, 2 adamantite bars, 2 cupronickel bars and a magic stone.']);
});

test('a built cooking pot is a range: food used on it or Cook cooks as at a range', () => {
  const Cookers = require('../plugins/skills/cooking/Cookers.Cooking');
  const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
  ObjectDefinition.init();
  const pot = loc('amenity_cooking_pot_anglers');
  const built = { getPacketSender: () => ({ getVarbit: (id) => (id === varbit('amenity_cooking_pot_anglers') ? 1 : 0), getVarp: () => 0 }) };
  const unbuilt = { getPacketSender: () => ({ getVarbit: () => 0, getVarp: () => 0 }) };
  assert.equal(Cookers.isCooker(ObjectDefinition.forPlayer(pot, built)), true);
  assert.equal(Cookers.isCooker(ObjectDefinition.forPlayer(pot, unbuilt)), false, 'the space is not a cooker');
  assert.equal(Cookers.isCooker(ObjectDefinition.forId(loc('pandemonium_cooking_pot'))), true, "The Pandemonium's pot too");
  // The op-less decorative pots are not ranges: live cooks on fireplacecookingpot as a fire (rsprox
  // 240/911358), and the two uncaptured ones are not cookers.
  for (const name of ['fireplacecookingpot', 'qip_sheep_shearer_fireplacecookingpot', 'fai_varrock_shanty_cookingpot']) {
    assert.equal(ObjectDefinition.forId(loc(name)).getName(), 'Cooking pot', name);
    const fire = name === 'fireplacecookingpot';
    assert.equal(Cookers.isCooker(ObjectDefinition.forId(loc(name))), fire, name);
    assert.equal(Cookers.isFire(ObjectDefinition.forId(loc(name))), fire, name);
  }
});
