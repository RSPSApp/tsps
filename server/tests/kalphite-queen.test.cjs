const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
require('../dist/Server').Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const Queen = require('../plugins/bosses/KalphiteQueen.plugin');
const SpiritShields = require('../plugins/combat/effects/SpiritShields.EquipmentEffects');
const core = { ...PluginManager.getCoreApi() };
let Method, spectralDrain;
const namedHooks = new Map();
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.RegionManager.init();
  new NpcDefinitionLoader().load();
  SpiritShields({ registerPrayerDrainModifier: fn => { spectralDrain = fn; } });
  Queen.register(new Proxy({ core, getTaskManager: () => core.TaskManager, getWorld: () => core.World,
    registerNpcCombatMethodProvider: (_ids, method) => { Method = method; },
    onObjectInteraction: (name, actions) => namedHooks.set(name, actions),
  }, { get: (obj, key) => obj[key] ?? (() => {}) }));
});
function scene(t, { protect = true, roll = 31, prayer = 50, spectral = false, form = core.NpcIdentifiers.KALPHITE_QUEEN_2 } = {}) {
  const channel = { isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel), new core.Location(3485, 9500, 0));
  player.getSkillManager().setCurrentLevels(core.Skill.PRAYER, prayer);
  player.setHitpoints(99);
  player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MISSILES] = protect;
  if (spectral) player.getEquipment().set(core.Equipment.SHIELD_SLOT, new core.Item(core.ItemIdentifiers.SPECTRAL_SPIRIT_SHIELD));
  const queen = core.NPC.create(form, new core.Location(3480, 9500, 0));
  queen.getPlayersWithinDistance = () => [];
  t.mock.method(core.Projectile.prototype, 'sendProjectile', () => {});
  t.mock.method(core.AccuracyFormulasDpsCalc, 'rollAccuracy', () => true);
  t.mock.method(core.DamageFormulas, 'sourceMaxHit', () => 31);
  t.mock.method(core.Misc, 'randomInclusive', (min, max) => min === 0 && max === 31 ? roll : min);
  t.mock.method(core, 'applyPrayerDrainModifiers', spectralDrain);
  const method = new Method(); method.attackType = core.CombatType.RANGED;
  return { player, queen, method, prayer: () => player.getSkillManager().getCurrentLevel(core.Skill.PRAYER) };
}
for (const form of [core.NpcIdentifiers.KALPHITE_QUEEN_2, core.NpcIdentifiers.KALPHITE_QUEEN_3]) test(`KQ ${form}: positive ranged rolls drain at impact through Protect from Missiles`, t => {
  const f = scene(t, { form }); const [hit] = f.method.hits(f.queen, f.player);
  core.CombatFactory.applyHitTimeDefences(hit);
  assert.equal(hit.getTotalDamage(), 0, 'protection still blocks HP damage');
  assert.equal(f.prayer(), 50, 'no drain before impact');
  f.method.handleAfterHitEffects(hit); assert.equal(f.prayer(), 49);
});
test('positive unprotected ranged hits drain one Prayer', t => {
  const f = scene(t, { protect: false }); const [hit] = f.method.hits(f.queen, f.player);
  core.CombatFactory.applyHitTimeDefences(hit);
  assert.equal(hit.getTotalDamage(), 31); f.method.handleAfterHitEffects(hit); assert.equal(f.prayer(), 49);
});
for (const protect of [true, false]) test(`zero ranged rolls do not drain Prayer (protect=${protect})`, t => {
  const f = scene(t, { protect, roll: 0 }); const [hit] = f.method.hits(f.queen, f.player);
  f.method.handleAfterHitEffects(hit); assert.equal(f.prayer(), 50);
});
for (const [random, expected] of [[0.25, 49], [0.75, 50]]) test(`Spectral shield protected drain random=${random}`, t => {
  const f = scene(t, { spectral: true }); t.mock.method(Math, 'random', () => random);
  const [hit] = f.method.hits(f.queen, f.player);
  core.CombatFactory.applyHitTimeDefences(hit);
  f.method.handleAfterHitEffects(hit); assert.equal(f.prayer(), expected);
});
test('a ranged drain cannot take Prayer below zero', t => {
  const f = scene(t, { prayer: 0 }); const [hit] = f.method.hits(f.queen, f.player);
  core.CombatFactory.applyHitTimeDefences(hit);
  f.method.handleAfterHitEffects(hit); assert.equal(f.prayer(), 0);
});
test('the pending ranged hit keeps its drain when the next attack style changes', t => {
  const f = scene(t); const [hit] = f.method.hits(f.queen, f.player); f.method.attackType = core.CombatType.MAGIC;
  core.CombatFactory.applyHitTimeDefences(hit);
  f.method.handleAfterHitEffects(hit); assert.equal(f.prayer(), 49);
});
for (const type of [core.CombatType.MELEE, core.CombatType.MAGIC]) test(`KQ ${type} attacks do not drain Prayer`, t => {
  const f = scene(t); f.method.attackType = type; const [hit] = f.method.hits(f.queen, f.player);
  core.CombatFactory.applyHitTimeDefences(hit);
  f.method.handleAfterHitEffects(hit); assert.equal(f.prayer(), 50);
});

test('nearby ranged targets retain independent pre-protection rolls and Prayer drains', t => {
  const f = scene(t);
  const channel = { isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const second = new Player(new PlayerSession(channel), new core.Location(3485, 9501, 0));
  second.setHitpoints(99);
  second.getSkillManager().setCurrentLevels(core.Skill.PRAYER, 50);
  second.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MISSILES] = true;
  f.queen.getPlayersWithinDistance = () => [f.player, second];
  t.mock.method(core.CombatFactory, 'canAttackSecondaryTarget', (_a, primary, candidate) => candidate !== primary);
  let rolls = [31, 0];
  t.mock.method(core.Misc, 'randomInclusive', (min, max) => min === 0 && max === 31 ? rolls.shift() : min);
  const hits = f.method.hits(f.queen, f.player);
  assert.equal(hits.length, 2);
  for (const hit of hits) core.CombatFactory.applyHitTimeDefences(hit);
  assert.deepEqual(hits.map(h => h.getTotalDamage()), [0, 0]);
  for (const hit of hits) f.method.handleAfterHitEffects(hit);
  assert.equal(f.prayer(), 49);
  assert.equal(second.getSkillManager().getCurrentLevel(core.Skill.PRAYER), 50);
});

test('name-based rope handlers preserve destinations and yield unrelated ropes', () => {
  const destinations = [];
  const player = { moveTo: tile => destinations.push([tile.getX(), tile.getY(), tile.getZ()]) };
  const climb = namedHooks.get('Rope')['Climb-up'];
  climb({ player, object: { getId: () => 3829 } });
  climb({ player, object: { getId: () => 3832 } });
  assert.equal(climb({ player, object: { getId: () => -1 } }), false);
  assert.deepEqual(destinations, [[3227, 3108, 0], [3508, 9494, 2]]);
  assert.equal(typeof core.TimedObjectReplacementTask, 'function');
});

for (const [adjacent, roll, expected] of [
  [true, 0, core.CombatType.MELEE], [true, 1, core.CombatType.MELEE],
  [true, 2, core.CombatType.RANGED], [true, 3, core.CombatType.MAGIC],
  [false, 0, core.CombatType.RANGED], [false, 1, core.CombatType.MAGIC],
]) test(`fresh combat methods select the launch style (adjacent=${adjacent}, roll=${roll})`, t => {
  const f = scene(t);
  f.player.setLocation(new core.Location(3485, adjacent ? 9500 : 9507, 0));
  t.mock.method(core.Misc, 'randomInclusive', (min, max) => {
    if (max === (adjacent ? 3 : 1)) return roll;
    return min;
  });
  // The production non-singleton provider constructs a new method on each lookup.
  for (let attack = 0; attack < 2; attack++) {
    const method = new Method(f.queen);
    method.start(f.queen, f.player);
    assert.equal(method.type(), expected);
    assert.equal(method.hits(f.queen, f.player)[0].getCombatType(), expected);
    method.finished(f.queen, f.player);
  }
});

for (const type of ['RANGED', 'MAGIC']) test(`${type.toLowerCase()} hits land with the projectile, not before it (#1862)`, t => {
  const f = scene(t);
  const sent = [];
  t.mock.method(core.Projectile.prototype, 'sendProjectile', function () { sent.push(this); });
  f.method.attackType = core.CombatType[type];
  const [hit] = f.method.hits(f.queen, f.player);
  assert.equal(sent.length, 1);
  assert.equal(hit.getDelay(), Math.ceil(sent[0].speed / 30));
  assert.equal(hit.getDelay(), 3);
});
