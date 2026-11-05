const assert = require('node:assert/strict');
const { test, before, after, mock } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { ClientConnection } = require('../dist/net/NetworkBuilder');
const { CombatPoisonEffect } = require('../dist/game/task/impl/CombatPoisonEffect');
let core;
let cycle = 1000, wallTime = 1000000000000;

before(async () => {
  await CachePipeline.initialize(process.cwd());
  core = PluginManager.getCoreApi();
  require('../plugins/combat/LunarCures.plugin').register(PluginManager.createApi('LunarCuresTest'));
  mock.method(core.World, 'getProcessCycle', () => cycle);
  mock.method(Date, 'now', () => wallTime);
});
after(() => mock.restoreAll());

function channel() {
  return { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
}

function actor(t, x = 3200, y = 3200, z = 0) {
  const player = new Player(new PlayerSession(channel())), amounts = new Map(), xp = [];
  player.setRegistered(true); player.setSpellbook(core.MagicSpellbook.LUNAR);
  player.setLocation(new core.Location(x, y, z));
  let level = 99, defence = 99;
  t.mock.method(player, 'getSkillManager', () => ({ getMaxLevel: skill => skill === core.Skill.DEFENCE ? defence : level, getCurrentLevel: () => level,
    addExperiences: (skill, value) => xp.push(value) }));
  t.mock.method(player, 'getInventory', () => ({ getAmount: id => amounts.get(id) ?? 0,
    deletes: item => amounts.set(item.id, (amounts.get(item.id) ?? 0) - item.getAmount()) }));
  for (const id of [core.ItemIdentifiers.ASTRAL_RUNE, core.ItemIdentifiers.COSMIC_RUNE,
    core.ItemIdentifiers.LAW_RUNE, core.ItemIdentifiers.EARTH_RUNE]) amounts.set(id, 100);
  return { player, amounts, xp, level(value) { level = value; }, defence(value) { defence = value; } };
}

async function cast(t, caster, name, targets = [], targeted = null, sameTick = false) {
  if (!sameTick) { cycle++; wallTime += 600; }
  const widget = core.CacheDefinitions.getSpellByName(name); assert.ok(widget, name);
  const players = [caster.player, ...targets.map(a => a.player)];
  t.mock.method(core.World, 'getPlayers', () => ({ get: index => players[index], forEach: fn => players.forEach(fn) }));
  const connection = new ClientConnection(channel()); connection.player = caster.player;
  const packet = targeted ? { type: 'spell_on_player', targetIndex: players.indexOf(targeted.player),
    spellWidget: widget.widgetId, spellChild: widget.widgetId & 65535, spellItemId: widget.itemId }
    : { type: 'widget_action', widgetId: widget.widgetId, groupId: widget.widgetId >>> 16,
      childId: widget.widgetId & 65535, buttonNum: 1, itemId: widget.itemId };
  await connection.dispatch([packet]); connection.processTurnPackets();
}

test('native Cure Me clears poison, consumes the Wiki runes and grants no protection', async t => {
  const f = actor(t); f.player.setPoisonDamage(30);
  await cast(t, f, 'Cure Me');
  assert.equal(f.player.getAnimation().getId(), core.CacheDefinitions.getSeqId('quest_lunar_pushing_magic_animation'));
  assert.equal(f.player.getGraphic().getId(), core.CacheDefinitions.getSpotanimId('quest_lunar_cure_me_spot'));
  assert.equal(f.player.getPoisonDamage(), 0);
  assert.equal(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
  assert.deepEqual(f.xp, [69]);
  assert.equal(f.amounts.get(core.ItemIdentifiers.ASTRAL_RUNE), 98);
  assert.equal(f.amounts.get(core.ItemIdentifiers.COSMIC_RUNE), 98);
  assert.equal(f.amounts.get(core.ItemIdentifiers.LAW_RUNE), 99);
});

test('Cure Me downgrades venom at its current damage; a second cast removes poison', async t => {
  for (const damage of [6, 12, 20]) {
    const f = actor(t); f.player.setPoisonDamage(damage); f.player.setVenomed(true);
    await cast(t, f, 'Cure Me');
    assert.equal(f.player.isVenomed(), false);
    assert.equal(CombatPoisonEffect.damageFromSeverity(f.player.getPoisonDamage()), damage);
    assert.equal(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
    const hits = [];
    t.mock.method(f.player.getCombat().getHitQueue(), 'addPendingDamage', values => hits.push(...values));
    const task = new CombatPoisonEffect(f.player); task.setRunning(true);
    try {
      for (let i = 0; i < 32; i++) task.tick();
      assert.deepEqual(hits.map(hit => hit.getDamage()), [damage]);
      assert.ok(f.player.isPoisoned(), 'conversion leaves real poison before the second cast');
      await cast(t, f, 'Cure Me'); assert.equal(f.player.getPoisonDamage(), 0);
    } finally { task.stop(); }
  }
});

test('Lunar cures preserve existing protection instead of replacing it with 12 seconds', async t => {
  const f = actor(t); f.player.getCombat().getPoisonImmunityTimer().start(90);
  f.player.setPoisonDamage(30); await cast(t, f, 'Cure Me');
  assert.ok(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining() >= 89);
});

test('native Cure Other changes only the consenting target and grants no protection', async t => {
  const caster = actor(t), target = actor(t, 3201, 3200);
  caster.player.setPoisonDamage(30); target.player.setPoisonDamage(12); target.player.setVenomed(true);
  await cast(t, caster, 'Cure Other', [target], target);
  assert.equal(caster.player.getPoisonDamage(), 30);
  assert.equal(target.player.isVenomed(), false);
  assert.equal(CombatPoisonEffect.damageFromSeverity(target.player.getPoisonDamage()), 12);
  assert.equal(target.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
  assert.deepEqual(caster.xp, [65]);
});

test('native Cure Group respects Accept Aid, radius and plane, with no immunity', async t => {
  const caster = actor(t), near = actor(t, 3201, 3201), refused = actor(t, 3199, 3200),
    far = actor(t, 3202, 3200), upstairs = actor(t, 3200, 3200, 1);
  for (const f of [caster, near, refused, far, upstairs]) f.player.setPoisonDamage(30);
  refused.player.setAttribute('accept-aid', false);
  await cast(t, caster, 'Cure Group', [near, refused, far, upstairs]);
  for (const f of [caster, near]) {
    assert.equal(f.player.getPoisonDamage(), 0);
    assert.equal(f.player.getCombat().getPoisonImmunityTimer().secondsRemaining(), 0);
  }
  for (const f of [refused, far, upstairs]) assert.equal(f.player.getPoisonDamage(), 30);
  assert.deepEqual(caster.xp, [74]);
});

test('failed requirements cannot cure, award XP or consume runes', async t => {
  for (const mode of ['magic', 'defence', 'book', 'runes']) {
    const f = actor(t); f.player.setPoisonDamage(30);
    if (mode === 'magic') f.level(70);
    if (mode === 'defence') f.defence(39);
    if (mode === 'book') f.player.setSpellbook(core.MagicSpellbook.NORMAL);
    if (mode === 'runes') f.amounts.set(core.ItemIdentifiers.COSMIC_RUNE, 0);
    await cast(t, f, 'Cure Me');
    assert.equal(f.player.getPoisonDamage(), 30, mode); assert.deepEqual(f.xp, [], mode);
    assert.equal(f.amounts.get(core.ItemIdentifiers.ASTRAL_RUNE), 100, mode);
  }
});

test('refused, self, distant, dead and different-plane Cure Other targets cost nothing', async t => {
  for (const mode of ['aid', 'self', 'far', 'dead', 'plane']) {
    const caster = actor(t), target = actor(t, mode === 'far' ? 3211 : 3201, 3200, mode === 'plane' ? 1 : 0);
    caster.player.setPoisonDamage(30); target.player.setPoisonDamage(30);
    if (mode === 'aid') target.player.setAttribute('accept-aid', false);
    if (mode === 'dead') t.mock.method(target.player, 'getHitpoints', () => 0);
    await cast(t, caster, 'Cure Other', [target], mode === 'self' ? caster : target);
    assert.equal(caster.player.getPoisonDamage(), 30, mode);
    assert.equal(target.player.getPoisonDamage(), 30, mode);
    assert.deepEqual(caster.xp, [], mode);
    assert.equal(caster.amounts.get(core.ItemIdentifiers.ASTRAL_RUNE), 100, mode);
  }
});

test('other Lunar player spells still reach their existing fallback', async t => {
  const caster = actor(t), target = actor(t, 3201, 3200);
  caster.amounts.set(core.ItemIdentifiers.NATURE_RUNE, 1);
  caster.player.setRunEnergy(100); target.player.setRunEnergy(0);
  await cast(t, caster, 'Energy Transfer', [target], target);
  assert.equal(caster.player.getRunEnergy(), 0);
  assert.equal(target.player.getRunEnergy(), 50);
  assert.deepEqual(caster.xp, [100]);
});

test('Cure Me casts at most once per game tick without double costs or XP', async t => {
  const f = actor(t); f.player.setPoisonDamage(12); f.player.setVenomed(true);
  await cast(t, f, 'Cure Me');
  const severity = f.player.getPoisonDamage(); assert.ok(severity > 0);
  await cast(t, f, 'Cure Me', [], null, true);
  assert.equal(f.player.getPoisonDamage(), severity);
  assert.deepEqual(f.xp, [69]); assert.equal(f.amounts.get(core.ItemIdentifiers.ASTRAL_RUNE), 98);
  await cast(t, f, 'Cure Me'); assert.equal(f.player.getPoisonDamage(), 0);
  assert.deepEqual(f.xp, [69, 69]);
});

test('Cure Other and Cure Group cannot aid actors in another private instance', async t => {
  const caster = actor(t), other = actor(t), outside = actor(t), same = actor(t);
  const ownArea = {}, anotherArea = {};
  t.mock.method(caster.player, 'getPrivateArea', () => ownArea);
  t.mock.method(same.player, 'getPrivateArea', () => ownArea);
  t.mock.method(other.player, 'getPrivateArea', () => anotherArea);
  for (const f of [other, outside, same]) f.player.setPoisonDamage(30);
  for (const f of [other, outside]) {
    await cast(t, caster, 'Cure Other', [f], f);
    assert.equal(f.player.getPoisonDamage(), 30); assert.deepEqual(caster.xp, []);
  }
  await cast(t, caster, 'Cure Group', [other, outside, same]);
  assert.equal(other.player.getPoisonDamage(), 30); assert.equal(outside.player.getPoisonDamage(), 30);
  assert.equal(same.player.getPoisonDamage(), 0); assert.deepEqual(caster.xp, [74]);
});
