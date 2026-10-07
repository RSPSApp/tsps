// Run after `yarn build`: node --test tests/weapon-effects.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

const registerLeafBladed = require("../plugins/combat/effects/LeafBladedBattleaxe");

function fakePlayer(weaponId, targetName) {
  return {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getEquipment: () => ({ get: () => ({ getId: () => weaponId }) }),
    getCombat: () => ({
      getTarget: () => ({
        isNpc: () => true,
        getAsNpc: () => ({ getCurrentDefinition: () => ({ getName: () => targetName }) }),
      }),
    }),
  };
}

test("the leaf-bladed battleaxe does 17.5% more damage to turoths and kurasks", () => {
  let modifier;
  registerLeafBladed({ registerMeleeHitModifier: (value) => { modifier = value; } });
  assert.equal(typeof modifier, "function");
  assert.equal(modifier(fakePlayer(ItemIdentifiers.LEAF_BLADED_BATTLEAXE, "Kurask"), 100), 117.5);
  assert.equal(modifier(fakePlayer(ItemIdentifiers.LEAF_BLADED_BATTLEAXE, "Turoth"), 100), 117.5);
  assert.equal(modifier(fakePlayer(ItemIdentifiers.LEAF_BLADED_BATTLEAXE, "Goblin"), 100), 100);
  assert.equal(modifier(fakePlayer(ItemIdentifiers.LEAF_BLADED_SPEAR, "Kurask"), 100), 100, "only the battleaxe has the passive");
});

test("every active crystal halberd stage shares the dragon halberd Sweep special", () => {
  require("../plugins/combat/specials/DragonHalberd.SpecialAttack")({
    core: PluginManager.getCoreApi(),
    registerCombatSpecial: CombatSpecial.register,
  });
  const sweep = CombatSpecial.getById("dragon_halberd");
  assert.ok(sweep);
  for (const id of [
    ItemIdentifiers.DRAGON_HALBERD,
    ItemIdentifiers.CRYSTAL_HALBERD_FULL_I_,
    ItemIdentifiers.CRYSTAL_HALBERD_1_10,
    ItemIdentifiers.CRYSTAL_HALBERD,
    ItemIdentifiers.CRYSTAL_HALBERD_3,
  ]) {
    assert.equal(CombatSpecial.getForWeaponId(id), sweep, `item ${id} has Sweep`);
  }
  for (const id of [ItemIdentifiers.CRYSTAL_HALBERD_INACTIVE_, ItemIdentifiers.CRYSTAL_HALBERD_INACTIVE__2]) {
    assert.notEqual(CombatSpecial.getForWeaponId(id), sweep, "an inactive halberd cannot sweep");
  }
});
