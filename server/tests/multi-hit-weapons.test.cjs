// Registered ordinary method, real Player/NPC and PendingHit/HitQueue boundaries.
process.env.DISABLE_PLAYER_BOTS = '1';
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
let core, resolver, observed, index = 6800;
const WEAPONS = [29084, 29889, 30957, 33243, 4747, 4958, 4959, 4960, 4961];
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core = PluginManager.getCoreApi();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(3222, 3218);
  const api = PluginManager.createApi('MultiHitWeaponsTest');
  require('../plugins/combat/MultiHitWeapons.plugin').register({ ...api,
    registerCombatMethodResolver(value) { resolver = value; api.registerCombatMethodResolver(value); },
  });
  require('../plugins/items/BarrowsEquipment.plugin').register(PluginManager.createApi('MultiHitBarrowsTest'));
  api.onCombatHitDamage(event => { if (observed?.player === event.attacker) observed.parts.push(event); });
  api.onCustomEvent('combat:hit-rolled', event => {
    if (observed?.player === event.attacker) observed.ranges.push(event.maximum);
  });
});
function actors(t, weapon) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(index++); player.setUsername('TwinTest' + player.getIndex());
  player.setRights(core.PlayerRights.NONE); player.setRegistered(true);
  player.setAttribute('bot-skip-persistence', true);
  player.setLocation(new core.Location(3222, 3218)); player.setNeedsPlacement(false);
  for (const skill of [core.Skill.HITPOINTS, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE]) {
    player.getSkillManager().setMaxLevel(skill, 99); player.getSkillManager().setCurrentLevel(skill, 99);
  }
  player.setHitpoints(99);
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon, 1));
  player.setWeapon(core.WeaponInterfaces.MACE); player.setFightType(core.WeaponInterfaces.MACE.getFightType()[0]);
  core.BonusManager.update(player);
  const npc = PluginManager.spawnNpc({ id: core.NpcIdentifiers.SAND_CRAB, x: 3223, y: 3218, z: 0, wanderRadius: 0 });
  assert.ok(npc?.isRegistered()); npc.setNeedsPlacement(false); npc.setHitpoints(100);
  t.after(() => { observed = null; player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); npc.getCombat().getHitQueue().clear(); PluginManager.removeNpc(npc); });
  return { player, npc };
}
function roll(player, npc, rolls, maximum) {
  const originalAccuracy = core.AccuracyFormulasDpsCalc.rollAccuracy;
  const originalMaximum = core.DamageFormulas.sourceMaxHit;
  const remaining = [...rolls]; observed = { player, parts: [], ranges: [] };
  core.AccuracyFormulasDpsCalc.rollAccuracy = (attacker, target, ...args) => {
    if (attacker !== player || target !== npc) return originalAccuracy.call(core.AccuracyFormulasDpsCalc, attacker, target, ...args);
    assert.ok(remaining.length, 'only two independent accuracy checks'); return remaining.shift();
  };
  core.DamageFormulas.sourceMaxHit = (attacker, ...args) => attacker === player ? maximum : originalMaximum.call(core.DamageFormulas, attacker, ...args);
  try {
    const method = core.CombatFactory.getMethod(player);
    const hits = method.hits(player, npc);
    return { ...observed, method, hits, remaining };
  } finally {
    core.AccuracyFormulasDpsCalc.rollAccuracy = originalAccuracy;
    core.DamageFormulas.sourceMaxHit = originalMaximum;
    observed = null;
  }
}
test('all functional twin weapon variants create two same-tick ordinary splats', t => {
  for (const id of WEAPONS) {
    assert.ok(core.CacheDefinitions.getItem(id).inventoryActions.includes('Wield'));
    const { player, npc } = actors(t, id), result = roll(player, npc, [true, true], 48);
    assert.equal(result.hits.length, 1); assert.equal(result.hits[0].getHits().length, 2, 'weapon ' + id);
    assert.deepEqual(result.remaining, []); assert.equal(result.hits[0].getHitDelays(), undefined, 'no staggered reveal delay');
    assert.deepEqual(result.ranges, [24, 24]);
  }
});
for (const accuracy of [[false, true], [true, false], [false, false], [true, true]]) {
  test('both accuracy rolls remain independent: ' + accuracy, t => {
    const { player, npc } = actors(t, 29084), result = roll(player, npc, accuracy, 47);
    assert.deepEqual(result.remaining, []);
    assert.deepEqual(result.parts.map(part => part.accurate), accuracy);
    assert.equal(result.hits[0].isAccurate(), accuracy.includes(true), 'after-hit effects see any landed hit');
    assert.deepEqual(result.parts.filter(part => !part.accurate).map(part => part.damage.getDamage()), accuracy.filter(x => !x).map(() => 0));
  });
}
test('final odd/even maximum is split without adding damage, on every weapon family', t => {
  for (const id of [29084, 29889, 30957, 33243, 4747]) for (const maximum of [47, 48]) {
    const { player, npc } = actors(t, id), result = roll(player, npc, [true, true], maximum);
    assert.deepEqual(result.ranges, [Math.floor(maximum / 2), Math.ceil(maximum / 2)]);
  }
});
test('both splats enter the same native NPC update and apply once', t => {
  const { player, npc } = actors(t, 4747), result = roll(player, npc, [true, true], 47);
  assert.equal(result.hits[0].getHits().length, 2);
  result.hits[0].getHits()[0].setDamage(22); result.hits[0].getHits()[1].setDamage(23);
  const queue = npc.getCombat().getHitQueue(); queue.addPendingHit(result.hits[0]); queue.process(100);
  assert.equal(npc.getHitpoints(), 55); assert.deepEqual(npc.getTickHits().map(hit => hit.getDamage()), [22, 23]);
  queue.process(101); assert.equal(npc.getHitpoints(), 55);
});
test('noted, placeholder, broken and unrelated items are not ordinary twin weapons', t => {
  for (const id of [4748, 4962, 4963, 15701, 15702, 29085, 29086, 29890, 29891, 30958, 30959, 33244, 4151]) {
    const { player } = actors(t, id); assert.equal(resolver.resolve(player), null, 'item ' + id);
  }
  const { player } = actors(t, 29084); player.setSpecialActivated(true);
  assert.equal(resolver.resolve(player), null, 'special method selection is preserved');
  assert.equal(resolver.resolve({ isPlayer: () => false }), null);
});

for (const accuracy of [[true, false], [false, true], [false, false], [true, true]]) {
  test('Torag passive consumes aggregate accuracy at impact: ' + accuracy, t => {
    const { player } = actors(t, 4747), victim = actors(t, 4151).player;
    for (const [slot, id] of [[core.Equipment.HEAD_SLOT, 4745], [core.Equipment.BODY_SLOT, 4749], [core.Equipment.LEG_SLOT, 4751]]) {
      player.getEquipment().setItem(slot, new core.Item(id, 1));
    }
    assert.equal(core.CombatFactory.fullTorags(player), true);
    victim.setRunEnergy(100);
    const result = roll(player, victim, accuracy, 48), hit = result.hits[0];
    hit.getHits().forEach((part, i) => part.setDamage(accuracy[i] ? 5 : 0));
    hit.updateTotalDamage();
    const queue = victim.getCombat().getHitQueue(), random = Math.random;
    t.after(() => queue.clear());
    try {
      Math.random = () => 0; // Force the existing Barrows proc after real accuracy and damage rolls.
      queue.addPendingHit(hit);
      queue.process(200);
    } finally {
      Math.random = random;
    }
    assert.equal(victim.getRunEnergy(), accuracy.includes(true) ? 80 : 100,
      'real Barrows resolved-hit listener drains once on any successful roll, never on two misses');
  });
}
