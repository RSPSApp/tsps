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

let coreApi;
const lastLoadouts = new WeakMap();

function matches(item, identifiers, names) {
  return names.some((name) => item?.getId() === identifiers[name]);
}

function voidSetForStyle(api, entity, style) {
  if (!entity?.isPlayer?.()) return null;
  const { Equipment, ItemIdentifiers } = api.core;
  const items = entity.getAsPlayer().getEquipment().getItems();
  if (!matches(items[Equipment.HEAD_SLOT], ItemIdentifiers, HELMS[style]) ||
      !matches(items[Equipment.HANDS_SLOT], ItemIdentifiers, GLOVES)) return null;
  const top = items[Equipment.BODY_SLOT], robe = items[Equipment.LEG_SLOT];
  const eliteTop = matches(top, ItemIdentifiers, ELITE_TOP);
  const eliteRobe = matches(robe, ItemIdentifiers, ELITE_ROBE);
  if (!(eliteTop || matches(top, ItemIdentifiers, NORMAL_TOP)) ||
      !(eliteRobe || matches(robe, ItemIdentifiers, NORMAL_ROBE))) return null;
  return eliteTop && eliteRobe ? "elite" : "normal";
}

function voidSet(api, entity, combatType) {
  const { CombatType } = api.core;
  const style = combatType === CombatType.MAGIC ? "magic" : combatType === CombatType.RANGED ? "ranged" : "melee";
  return voidSetForStyle(api, entity, style);
}

function activeVoidStyle(player) {
  for (const style of ["melee", "ranged", "magic"]) {
    const set = voidSetForStyle({ core: coreApi }, player, style);
    if (set) return { style, set };
  }
  return null;
}

function effectLine({ style, set }) {
  if (style === "magic") {
    return set === "elite"
      ? "Elite void (magic): +45% accuracy, +5% magic damage"
      : "Void (magic): +45% magic accuracy";
  }
  const label = set === "elite" ? "Elite void" : "Void";
  if (style === "ranged" && set === "elite") {
    return `${label} (ranged): +10% accuracy, +12.5% damage`;
  }
  return `${label} (${style}): +10% ${style} accuracy and damage`;
}

function addVoidEffects(request) {
  const player = request?.player;
  if (!player || !coreApi) return;
  const active = activeVoidStyle(player);
  if (active) request.lines.push(effectLine(active));
}

function loadoutSignature(player) {
  const { Equipment } = coreApi;
  const items = player.getEquipment().getItems();
  return [Equipment.HEAD_SLOT, Equipment.BODY_SLOT, Equipment.LEG_SLOT, Equipment.HANDS_SLOT]
    .map((slot) => items[slot]?.getId?.() ?? -1)
    .join(",");
}

/** A void helm/top/robe/gloves swap changes the active style, so redraw the combat tab. */
function refreshCombatTab({ player }) {
  if (!player || !coreApi) return;
  const signature = loadoutSignature(player);
  const previous = lastLoadouts.get(player);
  lastLoadouts.set(player, signature);
  if (previous === signature) return;
  coreApi.WeaponInterfaceManager.assign(player);
  player.getUpdateFlag()?.flag?.(coreApi.Flag.APPEARANCE);
}

function rememberLoadout({ player }) {
  if (player) lastLoadouts.set(player, loadoutSignature(player));
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
  _test: { voidSetForStyle, activeVoidStyle, effectLine, addVoidEffects },
  register(api) {
    coreApi = api.core;
    api.registerCombatEffectiveLevelModifier(effectiveLevel.bind(null, api));
    api.registerMagicDamageBonusModifier(magicDamageBonus.bind(null, api));
    api.onCustomEvent?.("equipment:effects", addVoidEffects);
    api.onCustomEvent?.("equipment:changed", refreshCombatTab);
    api.onPlayerLogin?.(rememberLoadout);
  },
};
