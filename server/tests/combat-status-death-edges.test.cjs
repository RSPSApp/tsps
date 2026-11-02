// Run after `yarn build`: node --test tests/combat-status-death-edges.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { CombatType } = require('../dist/game/content/combat/CombatType');
const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
const { AccuracyFormulasDpsCalc } = require('../dist/game/content/combat/formula/AccuracyFormulasDpsCalc');
const { PrayerHandler } = require('../dist/game/content/PrayerHandler');
const { DamageFormulas } = require('../dist/game/content/combat/formula/DamageFormulas');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');

const method = { type: () => CombatType.MELEE, accuracyDefenceType: () => undefined };

function npc(hitpoints = 100) {
  const entity = {
    hitpoints,
    isPlayer: () => false,
    isNpc: () => true,
    getHitpoints: () => entity.hitpoints,
  };
  return entity;
}

function withMaxHit(maxHit, action) {
  const original = DamageFormulas.sourceMaxHit;
  DamageFormulas.sourceMaxHit = () => maxHit;
  try {
    return action();
  } finally {
    DamageFormulas.sourceMaxHit = original;
  }
}

function player({ hitpoints = 99, shield = -1 } = {}) {
  const prayers = [];
  const entity = {
    hitpoints,
    prayers,
    isPlayer: () => true,
    isNpc: () => false,
    getHitpoints: () => entity.hitpoints,
    getAsPlayer: () => entity,
    getPrayerActive: () => prayers,
    getEquipment: () => ({
      getItems: () => Array.from({ length: 14 }, () => ({ getId: () => shield })),
    }),
    performGraphic() {},
  };
  return entity;
}

test('a heal after the roll but before impact keeps an already-rolled hit non-lethal', () => {
  const attacker = npc();
  const target = npc(10);
  const original = CombatFactory.getHitDamage;
  CombatFactory.getHitDamage = () => new HitDamage(20, HitMask.RED);
  try {
    const hit = new PendingHit(attacker, target, method, {
      rollAccuracy: false,
      experience: false,
      handleAfterHitEffects: false,
    });
    assert.equal(hit.getTotalDamage(), 10, 'the roll is capped to the 10 HP held when it was made');
    target.hitpoints = 20; // tick-eat before the hit lands
    assert.equal(hit.getTotalDamage(), 10, 'healing does not reroll the hit');
    assert.ok(target.hitpoints - hit.getTotalDamage() > 0, 'the capped roll cannot kill the healed target');
  } finally {
    CombatFactory.getHitDamage = original;
  }
});

test('protection prayer is read when the hit lands, not when its damage was rolled', withMaxHit(20, () => {
  const target = player();
  const hit = new PendingHit(npc(), target, method, { damage: 20, rollAccuracy: false, experience: false });
  assert.equal(hit.getTotalDamage(), 20, 'the roll itself is not reduced');

  target.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = true;
  CombatFactory.applyHitTimeDefences(hit);
  assert.equal(hit.getTotalDamage(), 0, 'a prayer flicked on before impact blocks the hit');

  const prayingTarget = player();
  prayingTarget.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = true;
  const flickedOff = new PendingHit(npc(), prayingTarget, method, { damage: 20, rollAccuracy: false, experience: false });
  assert.equal(flickedOff.getTotalDamage(), 20, 'a prayer active at roll time is not banked into the hit');
  prayingTarget.getPrayerActive()[PrayerHandler.PROTECT_FROM_MELEE] = false;
  CombatFactory.applyHitTimeDefences(flickedOff);
  assert.equal(flickedOff.getTotalDamage(), 20, 'turning the prayer off before impact leaves the hit unprotected');
}));

test('Elysian is evaluated at impact and still cuts the landing hit', withMaxHit(20, () => {
  const target = player({ shield: ItemIdentifiers.ELYSIAN_SPIRIT_SHIELD });
  const hit = new PendingHit(npc(), target, method, { damage: 20, rollAccuracy: false, experience: false });
  assert.equal(hit.getTotalDamage(), 20, 'the shield waits for impact');

  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    CombatFactory.applyHitTimeDefences(hit);
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(hit.getTotalDamage(), 15, 'the 70% Elysian proc cuts 25% when the hit lands');
}));

test('dying clears the actor cache; a later roll starts from fresh effective levels', () => {
  const cache = AccuracyFormulasDpsCalc.rollCache;
  const entity = {};
  cache.set(entity, { cycle: 1, defenceLevel: 99, defenseMeleeRolls: new Map() });
  assert.equal(cache.has(entity), true);

  CombatFactory.clearHitRollCache(entity);
  assert.equal(cache.has(entity), false, 'the dead actor no longer reuses its cached levels');
});

test('the dying event fires during the death animation, before respawning', t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerDeathTask } = require('../dist/game/task/impl/PlayerDeath');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const victim = new Player(null), killer = new Player(null);
  const order = [];
  t.mock.method(victim.getCombat(), 'getKiller', () => killer);
  t.mock.method(victim, 'getPacketSender', () => ({ sendConfig() {}, sendInterfaceRemoval() {}, sendDestination() {} }));
  t.mock.method(victim, 'sendMessage', () => {});
  t.mock.method(victim, 'performAnimation', animation => {
    assert.equal(animation.getId(), 836);
    order.push('animation');
  });
  t.mock.method(victim, 'moveTo', () => order.push('respawn'));
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    assert.equal(name, 'player:dying');
    assert.equal(event.player, victim);
    assert.equal(event.killer, killer);
    order.push('dying');
  });
  new PlayerDeathTask(victim).execute();
  assert.deepEqual(order, ['animation', 'dying']);
});

test('attack-started observers run only after permission succeeds, for every combat style', t => {
  const { Combat } = require('../dist/game/content/combat/Combat');
  const { CanAttackResponse } = require('../dist/game/content/combat/CombatFactory');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const attacker = { isPlayer: () => false, isNpc: () => false, isSpecialActivated: () => false };
  const target = { getCombat: () => ({ getAttacker: () => attacker }) };
  const combat = new Combat(attacker);
  const order = [];
  let allowed = false;
  t.mock.method(CombatFactory, 'canAttack', () => allowed ? CanAttackResponse.CAN_ATTACK : CanAttackResponse.CANT_ATTACK);
  t.mock.method(combat, 'handleAttackDenied', () => {});
  t.mock.method(combat, 'expectAttackAnimation', () => {});
  t.mock.method(combat, 'attackTiming', () => ({}));
  t.mock.method(PluginManager, 'emitCustomEvent', (name, event) => {
    assert.equal(name, 'combat:attack-started');
    assert.deepEqual(event, { attacker, target });
    order.push('event');
  });
  for (const type of [CombatType.MELEE, CombatType.RANGED, CombatType.MAGIC]) {
    const method = {
      type: () => type, onCombatBegan() {}, finished() {}, hits: () => [],
      start: () => order.push('attack'),
    };
    allowed = false;
    assert.equal(combat.executeAttack(method, target, true, 0, false), false);
    allowed = true;
    assert.equal(combat.executeAttack(method, target, true, 0, false), true);
  }
  assert.deepEqual(order, ['event', 'attack', 'event', 'attack', 'event', 'attack']);
});

test('both player and NPC death clear their roll cache before the death task runs', () => {
  const { NPC } = require('../dist/game/entity/impl/npc/NPC');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { TaskManager } = require('../dist/game/task/TaskManager');

  const cleared = [];
  const originalClear = CombatFactory.clearHitRollCache;
  const originalSubmit = TaskManager.submit;
  CombatFactory.clearHitRollCache = (entity) => cleared.push(entity);
  TaskManager.submit = () => {};
  try {
    const npcActor = { isDying: false };
    NPC.prototype.appendDeath.call(npcActor);
    assert.deepEqual(cleared, [npcActor], 'NPC death forgets its rolls');

    const playerActor = {
      isDying: false,
      getCombat: () => ({ getRecentDamagerEntries: () => [], getKiller: () => null }),
    };
    Player.prototype.appendDeath.call(playerActor);
    assert.deepEqual(cleared, [npcActor, playerActor], 'player death forgets its rolls');
  } finally {
    CombatFactory.clearHitRollCache = originalClear;
    TaskManager.submit = originalSubmit;
  }
});
