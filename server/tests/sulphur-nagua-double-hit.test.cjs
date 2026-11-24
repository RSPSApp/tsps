// Sulphur Nagua (13033): one attack is two same-tick splats sharing the 11 maximum (wiki: 6+5).
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const NAGUA = 13033;
let core, index = 6900;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  const api = PluginManager.createApi('SulphurNaguaTest');
  require('../plugins/npcs/SulphurNagua.plugin').register(api);
});
function actors(t, id) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('NaguaTest' + player.getIndex());
  player.setRights(core.PlayerRights.NONE); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3218)); player.setNeedsPlacement(false);
  player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99); player.setHitpoints(99);
  const npc = PluginManager.spawnNpc({ id, x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  assert.ok(npc?.isRegistered()); npc.setNeedsPlacement(false);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); });
  return { player, npc };
}
test('the nagua swings once for two splats that split the 11 maximum', t => {
  const { player, npc } = actors(t, NAGUA);
  assert.equal(npc.getDefinition().getMaxHit(), 11);
  const ranges = [];
  const api = PluginManager.createApi('SulphurNaguaRanges');
  api.onCustomEvent('combat:hit-rolled', event => { if (event.attacker === npc) ranges.push(event.maximum); });
  const originalAccuracy = core.AccuracyFormulasDpsCalc.rollAccuracy;
  core.AccuracyFormulasDpsCalc.rollAccuracy = (attacker, ...args) =>
    attacker === npc ? true : originalAccuracy.call(core.AccuracyFormulasDpsCalc, attacker, ...args);
  try {
    npc.getCombat().setTarget?.(player);
    const method = core.CombatFactory.getMethod(npc);
    assert.equal(method.type(), core.CombatType.MELEE);
    const hits = method.hits(npc, player);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].getHits().length, 2);
    assert.equal(hits[0].getHitDelays(), undefined, 'both splats land on the same tick');
    assert.equal(ranges.reduce((a, b) => a + b, 0), 11, 'the two maxima add up to 11');
    assert.deepEqual(ranges.slice().sort(), [5, 6]);
  } finally {
    core.AccuracyFormulasDpsCalc.rollAccuracy = originalAccuracy;
  }
});
test('an ordinary NPC still swings once', t => {
  const { player, npc } = actors(t, core.NpcIdentifiers.SAND_CRAB);
  npc.getCombat().setTarget?.(player);
  const hits = core.CombatFactory.getMethod(npc).hits(npc, player);
  assert.equal(hits.length, 1); assert.equal(hits[0].getHits().length, 1);
});

/** One attack through the method, as Combat does: start, then hits. */
function swing(method, npc, player) {
  method.start(npc, player);
  return method.hits(npc, player);
}

test('after five attacks it raises its weapon: no hit, and 5 prayer drained from a player still beside it 3 ticks later (Wiki)', t => {
  const { player, npc } = actors(t, NAGUA);
  const Plugin = require('../plugins/npcs/SulphurNagua.plugin');
  player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 70);
  player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 70);
  const anims = [], graphics = [];
  t.mock.method(npc, 'performAnimation', a => anims.push(a.getId?.() ?? a.id));
  t.mock.method(npc, 'performGraphic', g => graphics.push([g.id, g.delay, g.height]));
  const submitted = [];
  t.mock.method(core.TaskManager, 'submit', task => submitted.push(task));
  const method = core.CombatFactory.getMethod(npc);
  for (let i = 0; i < Plugin._test.ATTACKS_BEFORE_SPECIAL; i++) assert.equal(swing(method, npc, player).length, 1, `attack ${i + 1} hits`);
  assert.equal(submitted.length, 0);
  assert.deepEqual(swing(method, npc, player), [], 'the sixth is the special: no hit');
  assert.equal(anims.at(-1), core.CacheDefinitions.getSeqId('npc_djinn_01_magic'));
  assert.deepEqual(graphics, [[core.CacheDefinitions.getSpotanimId('lizardshaman_spawn_explode'), 75, 150]]);
  assert.equal(npc.getCombat().getAttackDelay(), Plugin._test.NEXT_ATTACK_AFTER_SPECIAL);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].getDelay?.() ?? submitted[0].delay, 3);
  // Still beside it (east of its 2x2 footprint at 3223,3218): drained.
  player.setLocation(new core.Location(3225, 3219));
  submitted[0].execute();
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 65);
  assert.equal(swing(method, npc, player).length, 1, 'then ordinary attacks again');
});

test('the drain misses a player who stepped out of range, and counts diagonals as in range', t => {
  const { player, npc } = actors(t, NAGUA);
  const Plugin = require('../plugins/npcs/SulphurNagua.plugin');
  const { inMeleeRange } = Plugin._test;
  const at = (x, y) => { player.setLocation(new core.Location(x, y)); return inMeleeRange(npc, player); };
  assert.equal(at(3222, 3217), true, 'south-west diagonal');
  assert.equal(at(3225, 3220), true, 'north-east diagonal of the 2x2');
  assert.equal(at(3224, 3219), false, 'under it');
  assert.equal(at(3226, 3218), false, 'two away');
  player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 70);
  player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 70);
  const submitted = [];
  t.mock.method(core.TaskManager, 'submit', task => submitted.push(task));
  Plugin._test.attacks.set(npc, Plugin._test.ATTACKS_BEFORE_SPECIAL);
  player.setLocation(new core.Location(3222, 3218));
  assert.deepEqual(swing(core.CombatFactory.getMethod(npc), npc, player), []);
  player.setLocation(new core.Location(3220, 3218));
  submitted[0].execute();
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 70, 'out of range: nothing');
});

test('the drain still lands on a nagua that died meanwhile, with the recorded hitsplat 59 for what was drained (237/01137.txt tick 45)', t => {
  const { player, npc } = actors(t, NAGUA);
  const Plugin = require('../plugins/npcs/SulphurNagua.plugin');
  player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 70);
  player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 3);
  const splats = [];
  t.mock.method(player, 'showHitsplat', (damage, splat, health) => splats.push([damage, splat, health]));
  const submitted = [];
  t.mock.method(core.TaskManager, 'submit', task => submitted.push(task));
  Plugin._test.attacks.set(npc, Plugin._test.ATTACKS_BEFORE_SPECIAL);
  player.setLocation(new core.Location(3222, 3218));
  assert.deepEqual(swing(core.CombatFactory.getMethod(npc), npc, player), []);
  npc.setHitpoints(0);
  submitted[0].execute();
  assert.equal(player.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 0);
  assert.deepEqual(splats, [[3, { mine: 59, others: 59 }, false]], 'the splat shows the 3 points there were, not 5');
});
