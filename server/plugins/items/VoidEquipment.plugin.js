// https://oldschool.runescape.wiki/w/Void_Knight_equipment
// Apply Void to effective levels before equipment bonuses, preserving integer rounding.
// Base, trouver-locked and ornamented worn IDs verified against cache revision 237.
const NORMAL_TOP = ["VOID_KNIGHT_TOP", "VOID_KNIGHT_TOP_L_", "VOID_KNIGHT_TOP_OR_", "VOID_KNIGHT_TOP_L_OR_"];
const NORMAL_ROBE = ["VOID_KNIGHT_ROBE", "VOID_KNIGHT_ROBE_L_", "VOID_KNIGHT_ROBE_OR_", "VOID_KNIGHT_ROBE_L_OR_"];
const ELITE_TOP = ["ELITE_VOID_TOP", "ELITE_VOID_TOP_L_", "ELITE_VOID_TOP_OR_", "ELITE_VOID_TOP_L_OR_"];
const ELITE_ROBE = ["ELITE_VOID_ROBE", "ELITE_VOID_ROBE_L_", "ELITE_VOID_ROBE_OR_", "ELITE_VOID_ROBE_L_OR_"];
const GLOVES = ["VOID_KNIGHT_GLOVES", "VOID_KNIGHT_GLOVES_L_", "VOID_KNIGHT_GLOVES_OR_", "VOID_KNIGHT_GLOVES_L_OR_"];
const HELMS = {
  melee: ["VOID_MELEE_HELM", "VOID_MELEE_HELM_L_", "VOID_MELEE_HELM_OR_", "VOID_MELEE_HELM_L_OR_"],
  ranged: ["VOID_RANGER_HELM", "VOID_RANGER_HELM_L_", "VOID_RANGER_HELM_OR_", "VOID_RANGER_HELM_L_OR_"],
  magic: ["VOID_MAGE_HELM", "VOID_MAGE_HELM_L_", "VOID_MAGE_HELM_OR_", "VOID_MAGE_HELM_L_OR_"],
};

function matches(item, identifiers, names) {
  return names.some((name) => item?.getId() === identifiers[name]);
}

function voidSet(api, entity, combatType) {
  if (!entity?.isPlayer?.()) return null;
  const { CombatType, Equipment, ItemIdentifiers } = api.core;
  const items = entity.getAsPlayer().getEquipment().getItems();
  const style = combatType === CombatType.MAGIC ? "magic" : combatType === CombatType.RANGED ? "ranged" : "melee";
  if (!matches(items[Equipment.HEAD_SLOT], ItemIdentifiers, HELMS[style]) ||
      !matches(items[Equipment.HANDS_SLOT], ItemIdentifiers, GLOVES)) return null;
  const top = items[Equipment.BODY_SLOT], robe = items[Equipment.LEG_SLOT];
  const eliteTop = matches(top, ItemIdentifiers, ELITE_TOP);
  const eliteRobe = matches(robe, ItemIdentifiers, ELITE_ROBE);
  if (!(eliteTop || matches(top, ItemIdentifiers, NORMAL_TOP)) ||
      !(eliteRobe || matches(robe, ItemIdentifiers, NORMAL_ROBE))) return null;
  return eliteTop && eliteRobe ? "elite" : "normal";
}

function effectiveLevel(api, entity, level, { combatType, purpose }) {
  const set = voidSet(api, entity, combatType);
  if (!set) return level;
  const { CombatType } = api.core;
  if (combatType === CombatType.MAGIC) {
    return purpose === "accuracy" ? Math.floor(level * 145 / 100) : level;
  }
  if (combatType === CombatType.RANGED && purpose === "damage" && set === "elite") {
    return Math.floor(level * 1125 / 1000);
  }
  return Math.floor(level * 110 / 100);
}

function magicDamageBonus(api, entity, permille) {
  return voidSet(api, entity, api.core.CombatType.MAGIC) === "elite" ? permille + 50 : permille;
}

module.exports = {
  name: "VoidEquipment",
  members: true,
  register(api) {
    api.registerCombatEffectiveLevelModifier(effectiveLevel.bind(null, api));
    api.registerMagicDamageBonusModifier(magicDamageBonus.bind(null, api));
  },
};
