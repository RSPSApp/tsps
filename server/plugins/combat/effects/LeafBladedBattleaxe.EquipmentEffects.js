const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Wiki: +17.5% damage against turoths and kurasks, stacking with the slayer helmet.
const LEAF_BLADED_BATTLEAXE_IDS = new Set([
  ItemIdentifiers.LEAF_BLADED_BATTLEAXE,
]);
const DAMAGE_MULTIPLIER = 1.175;

function wieldingBattleaxe(player) {
  return LEAF_BLADED_BATTLEAXE_IDS.has(player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.());
}

function isTurothOrKurask(target) {
  if (!target?.isNpc?.()) {
    return false;
  }
  const name = target.getAsNpc()?.getCurrentDefinition?.()?.getName?.() ?? "";
  return /turoth|kurask/i.test(name);
}

let core;

/** The core API; the battleaxe judges an area hit against its own victim (core.hitTargetOf). */
function init(api) {
  core = api.core;
}

function applyLeafBladedDamage(attacker, baseHit) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  if (!player || !wieldingBattleaxe(player) || !isTurothOrKurask(core?.hitTargetOf(attacker))) {
    return baseHit;
  }
  return baseHit * DAMAGE_MULTIPLIER;
}

module.exports = function registerLeafBladedBattleaxeEffects(api) {
  init(api);
  api.registerMeleeHitModifier(applyLeafBladedDamage);
};
