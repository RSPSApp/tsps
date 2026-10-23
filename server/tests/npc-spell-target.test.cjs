// Run after `yarn build`: node --test tests/npc-spell-target.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { World } = require('../dist/game/World');
const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
const { RegionManager } = require('../dist/game/collision/RegionManager');

test('spell-on-NPC defaults to attackable definitions and honors an area-scoped opt-in', () => {
  const originalNpcs = World.getNpcs;
  const originalSpell = CombatSpells.getCombatSpell;
  const originalCustomEvent = PluginManager.emitCustomEvent;
  const originalProjectileCheck = RegionManager.canProjectileAttackTarget;
  const spell = { canCastOnTarget: () => true, canCast: () => true, spellId: () => 1,
    castSound: () => null, startCast() {}, baseExperience: () => 0 };
  let cast = null;
  let areaPermission = null;
  const npc = {
    getLocation: () => ({ getX: () => 1, getY: () => 1, getZ: () => 0 }),
    getPrivateArea: () => null,
    getOwner: () => null,
    getContentId: () => 1,
    isPlayer: () => false,
    getSize: () => 1,
    getCurrentDefinition: () => ({ isAttackable: () => false }),
    getHitpoints: () => 10,
    getArea: () => ({ canCastOnNpc: () => areaPermission }),
  };
  const player = {
    getHitpoints: () => 99,
    busy: () => false,
    getArea: () => null,
    getPrivateArea: () => null,
    isPlayer: () => true,
    getSize: () => 1,
    getLocation: () => ({ getX: () => 1, getY: () => 1, getZ: () => 0, isWithinDistance: () => true }),
    getMovementQueue: () => ({ reset() {} }),
    getCombat: () => ({ castSpellOn: (target, selectedSpell) => { cast = [target, selectedSpell]; } }),
  };
  World.getNpcs = () => ({ capacityReturn: () => 1, get: () => npc });
  CombatSpells.getCombatSpell = () => spell;
  RegionManager.canProjectileAttackTarget = () => true;
  try {
    PluginManager.emitCustomEvent = () => {};
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 1), false, 'unattackable NPCs reject ordinary spell targeting');
    assert.equal(cast, null, 'a rejected target never reaches combat or rune consumption');

    areaPermission = true;
    PluginManager.emitCustomEvent = () => {};
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 1), true, 'the NPC area can opt one target into spell casting');
    assert.deepEqual(cast, [npc, spell]);
  } finally {
    World.getNpcs = originalNpcs;
    CombatSpells.getCombatSpell = originalSpell;
    PluginManager.emitCustomEvent = originalCustomEvent;
    RegionManager.canProjectileAttackTarget = originalProjectileCheck;
  }
});
