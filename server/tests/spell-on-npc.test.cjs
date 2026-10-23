const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { World } = require('../dist/game/World');
const { CombatSpells } = require('../dist/game/content/combat/magic/CombatSpells');
const { NPCOptionPacketListener } = require('../dist/net/packet/impl/NPCOptionPacketListener');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { Skill } = require('../dist/game/model/Skill');

test('spell-on-NPC validates target and spell, consumes once, and preserves combat casts', () => {
  const previous = {
    npcs: World.getNpcs,
    getSpell: CombatSpells.getCombatSpell,
    los: RegionManager.canProjectileAttackTarget,
    hookCount: PluginManager.spellOnNpcHooks.length,
  };
  let levelAndRunes = true, cooldownAndConsume = true, visible = true, attackable = false;
  let npcPrivateArea = null, areaVeto = false, handleSpell = true;
  let canCastChecks = [], casts = 0, xp = 0, combatCasts = 0, hookCalls = 0, runeConsume = 0;
  const point = (x, y, z = 0) => ({ getX: () => x, getY: () => y, getZ: () => z, isWithinDistance(other, range) { return Math.max(Math.abs(x - other.getX()), Math.abs(y - other.getY())) <= range && z === other.getZ(); } });
  const loc = point(100, 100);
  let targetLoc = point(101, 100);
  const player = {
    getHitpoints: () => 10, busy: () => false,
    getLocation: () => loc, getPrivateArea: () => null, getArea: () => null,
    getMovementQueue: () => ({ reset() {} }), setPositionToFace() {},
    getEquipment: () => ({ getItems: () => [] }),
    getSkillManager: () => ({ addExperiences(skill, amount) { assert.equal(skill, Skill.MAGIC); xp += amount; } }),
    getCombat: () => ({ castSpellOn() { combatCasts++; } }),
  };
  const npc = {
    getId: () => 999, getContentId: () => 999, getLocation: () => targetLoc,
    getHitpoints: () => 10, getPrivateArea: () => npcPrivateArea,
    getArea: () => areaVeto ? { canCastOnNpc: () => false } : null,
    getOwner: () => null, getCurrentDefinition: () => ({ isAttackable: () => attackable }),
  };
  const spell = {
    spellId: () => 12345,
    canCastOnTarget: () => true,
    canCast(_player, consume) {
      canCastChecks.push(consume);
      if (!consume) return levelAndRunes;
      if (!cooldownAndConsume) return false;
      runeConsume++;
      return true;
    },
    startCast() { casts++; },
    baseExperience: () => 42,
    castSound: () => null,
  };
  World.getNpcs = () => ({ capacityReturn: () => 1, get: () => npc });
  CombatSpells.getCombatSpell = () => spell;
  RegionManager.canProjectileAttackTarget = () => visible;
  PluginManager.spellOnNpcHooks.push({ pluginName: 'spell-on-npc-test', handler(event) {
    hookCalls++;
    assert.equal(event.player, player);
    assert.equal(event.npc, npc);
    assert.equal(event.npcId, 999);
    assert.equal(event.npcIndex, 0);
    assert.equal(event.spell, spell);
    assert.equal(event.spellId, 12345);
    assert.deepEqual(event.location, { x: 101, y: 100, z: 0 });
    if (!handleSpell) return;
    const consumed = event.consumeRunes();
    if (consumed) {
      assert.equal(event.consumeRunes(), false, 'the accepted cast can consume only once');
      event.handled = true;
    }
  } });
  try {
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), true);
    assert.deepEqual(canCastChecks, [false, true]);
    assert.equal(runeConsume, 1);
    assert.equal(casts, 1);
    assert.equal(xp, 42);
    assert.equal(hookCalls, 1);

    handleSpell = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'unhandled target casts are not accepted');
    assert.equal(runeConsume, 1, 'unhandled targeted casts consume no runes');
    assert.equal(casts, 1, 'unhandled targeted casts do not animate');
    handleSpell = true;

    const before = { hooks: hookCalls, casts, runeConsume };
    areaVeto = true;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'an area veto blocks scripted casting');
    areaVeto = false;
    assert.equal(hookCalls, before.hooks, 'area veto is checked before hook dispatch');
    visible = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'blocked line of sight rejects');
    visible = true;
    targetLoc = point(111, 100);
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'out of scripted range rejects');
    targetLoc = point(101, 100, 1);
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'different plane rejects');
    targetLoc = point(101, 100);
    npc.getOwner = () => ({ other: true });
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'another player’s owned NPC rejects');
    npc.getOwner = () => null;
    npcPrivateArea = {};
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'another private area rejects');
    npcPrivateArea = null;
    levelAndRunes = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'missing runes or level rejects');
    levelAndRunes = true;
    cooldownAndConsume = false;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), false, 'cooldown rejection does not dispatch as a cast');
    assert.equal(hookCalls, before.hooks + 1, 'cooldown is checked inside the consuming callback');
    assert.deepEqual({ casts, runeConsume }, { casts: before.casts, runeConsume: before.runeConsume }, 'rejected casts have no side effects');

    attackable = true;
    assert.equal(NPCOptionPacketListener.castSpell(player, 0, 12345), true);
    assert.equal(combatCasts, 1, 'ordinary attackable NPC spell casts retain the combat path');
  } finally {
    World.getNpcs = previous.npcs;
    CombatSpells.getCombatSpell = previous.getSpell;
    RegionManager.canProjectileAttackTarget = previous.los;
    PluginManager.spellOnNpcHooks.length = previous.hookCount;
  }
});
