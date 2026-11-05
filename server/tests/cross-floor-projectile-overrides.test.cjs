const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');
const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
const { HitQueue } = require('../dist/game/content/combat/hit/HitQueue');
const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
const { World } = require('../dist/game/World');
const { Equipment } = require('../dist/game/model/container/impl/Equipment');
const { Location } = require('../dist/game/model/Location');
const { Item } = require('../dist/game/model/Item');
const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
const DragonfireShield = require('../plugins/items/DragonfireShield.plugin');
const TumekensShadow = require('../plugins/items/TumekensShadow.plugin');

const core = {
  ...PluginManager.getCoreApi(),
  AccuracyFormulasDpsCalc: {
    ...PluginManager.getCoreApi().AccuracyFormulasDpsCalc,
    defenseMagicRoll: () => 1,
    hitChance: () => 1,
  },
};
const resolvers = { shield: null, shadow: null };
const api = {
  core,
  persistAttribute() {},
  onPlayerLogin() {},
  onItemAction() {},
  onItemOnItem() {},
  onCustomEvent() {},
  registerCombatMethodResolver(resolver) {
    if (resolver.overridesWeapon) resolvers.shield = resolver;
    else resolvers.shadow = resolver;
  },
  registerBonusProvider() {},
  getBonusManager: () => ({ update() {} }),
  emitCustomEvent() {},
};
DragonfireShield.register(api);
TumekensShadow.register(api);

function actor(location, { player = false, equipment = [] } = {}) {
  const attributes = new Map([
    ['dragonfire-shield:armed', true],
    ['dragonfire-shield:recharge', 0],
  ]);
  const entity = {
    getLocation: () => location,
    getSize: () => 1,
    getPrivateArea: () => null,
    getHitpoints: () => 99,
    isPlayer: () => player,
    isNpc: () => !player,
    getAsPlayer: () => entity,
    isUntargetable: () => false,
    isNeedsPlacement: () => false,
    getEquipment: () => ({ getItems: () => equipment, refreshItems() {} }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, addExperience() {} }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUpdateFlag: () => ({ flag() {} }),
    getPacketSender: () => ({ sendConfig() {}, sendVarbit() {} }),
    isSpecialActivated: () => false,
    getCombat: () => ({ setCastSpell(spell) { entity.castSpell = spell; } }),
  };
  return entity;
}

function queuedRevealCycle(t, method, attacker, target) {
  t.mock.method(PendingHit.prototype, 'prepareHits', () => []);
  t.mock.method(PluginManager, 'emitPlayerDealtDamage', () => {});
  t.mock.method(CombatFactory, 'rewardExp', () => {});
  t.mock.method(World, 'getProcessCycle', () => 100);
  const queue = new HitQueue(target);
  target.getCombat = () => ({ getHitQueue: () => queue });
  const [hit] = method.hits(attacker, target);
  CombatFactory.addPendingHit(hit);
  return { delay: hit.getDelay(), revealCycle: queue.pendingHits[0].revealCycle };
}

test('registered dragonfire shield blast queues bounded same-floor and cross-floor hits', (t) => {
  const shield = new Item(I.DRAGONFIRE_SHIELD, 1);
  const equipment = new Array(14).fill(null);
  equipment[Equipment.SHIELD_SLOT] = shield;
  const attacker = actor(new Location(3200, 3200, 1), { player: true, equipment });
  const method = resolvers.shield.resolve(attacker);
  assert.ok(method, 'the registered shield resolver selects its blast method');

  const sameFloor = actor(new Location(3201, 3200, 1));
  const crossFloor = actor(new Location(3201, 3200, 0));
  assert.deepEqual(queuedRevealCycle(t, method, attacker, sameFloor), { delay: 3, revealCycle: 104 });
  assert.deepEqual(queuedRevealCycle(t, method, attacker, crossFloor), { delay: 3, revealCycle: 104 });
});

test("registered Tumeken's shadow queues bounded same-floor and cross-floor hits", (t) => {
  const staff = new Item(I.TUMEKENS_SHADOW, 1);
  staff.setMetaValue(TumekensShadow.CHARGES_KEY, 10);
  const equipment = new Array(14).fill(null);
  equipment[Equipment.WEAPON_SLOT] = staff;
  const attacker = actor(new Location(3200, 3200, 1), { player: true, equipment });
  const method = resolvers.shadow.resolve(attacker);
  assert.ok(method, 'the registered shadow resolver selects the powered spell method');

  const sameFloor = actor(new Location(3201, 3200, 1));
  const crossFloor = actor(new Location(3201, 3200, 0));
  assert.deepEqual(queuedRevealCycle(t, method, attacker, sameFloor), { delay: 2, revealCycle: 103 });
  assert.deepEqual(queuedRevealCycle(t, method, attacker, crossFloor), { delay: 2, revealCycle: 103 });

  assert.equal(method.canAttack(attacker, crossFloor), true);
  const shot = attacker.castSpell.castProjectile(attacker, crossFloor);
  assert.equal(shot.speed, 82, 'the emitted projectile uses the same bounded horizontal travel cycles');
});
