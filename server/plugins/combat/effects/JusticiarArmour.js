const { Equipment } = require("../../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { BonusManager } = require("../../../src/main/typescript/elvarg/game/model/equipment/BonusManager");
const { CombatType } = require("../../../src/main/typescript/elvarg/game/content/combat/CombatType");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");

// Wiki: full Justiciar set reduces non-PvP, non-typeless combat damage by
// defenceBonus / 3000 for the attack's style, always at least 1 and never more
// than the hit itself. It stacks additively with the Elysian passive.
const SET = new Map([
  [Equipment.HEAD_SLOT, ItemIdentifiers.JUSTICIAR_FACEGUARD],
  [Equipment.BODY_SLOT, ItemIdentifiers.JUSTICIAR_CHESTGUARD],
  [Equipment.LEG_SLOT, ItemIdentifiers.JUSTICIAR_LEGGUARDS],
]);

function defenceBonusIndex(context) {
  if (context.type === CombatType.MAGIC) {
    return BonusManager.DEFENCE_MAGIC;
  }
  if (context.type === CombatType.RANGED) {
    return BonusManager.DEFENCE_RANGE;
  }
  return Number.isInteger(context.meleeAttackBonusIndex) ? context.meleeAttackBonusIndex : BonusManager.DEFENCE_CRUSH;
}

function wearingFullSet(player) {
  const items = player.getEquipment().getItems();
  for (const [slot, id] of SET) {
    if (items[slot]?.getId?.() !== id) {
      return false;
    }
  }
  return true;
}

function applyJusticiarDamage(entity, hitDamage, context = {}) {
  if (!entity?.isPlayer?.() || !(hitDamage?.getDamage?.() > 0)) {
    return;
  }
  if (context.attacker?.isPlayer?.()) {
    return; // the set effect does not apply in PvP
  }
  const player = entity.getAsPlayer();
  if (!wearingFullSet(player)) {
    return;
  }
  const index = defenceBonusIndex(context);
  const bonus = Math.max(0, Number(player.getBonusManager?.()?.getDefenceBonus?.()?.[index] ?? 0));
  const damage = hitDamage.getDamage();
  const reduction = Math.max(1, Math.floor((damage * bonus) / 3000));
  hitDamage.setDamage(Math.max(0, damage - reduction));
}

module.exports = function registerJusticiarEffects(api) {
  api.registerIncomingDamageModifier(applyJusticiarDamage);
};
