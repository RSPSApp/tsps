/**
 * Karamja gloves' shop prices (Wiki: Karamja gloves, Karamja Diary rewards): while the gloves are worn, the
 * Karamja shops sell and buy at their "(Karamja gloves)" version's prices. Any tier does for Davon, Obli,
 * Fernahei, Tamayu, Gabooty and the five Mor Ul Rek stores; Jiminua's Jungle Store and the Karamja General
 * Store need Karamja gloves 3 or 4 ("(Karamja gloves 3)", "(Karamja gloves 3+)").
 *
 * The generated shops.json gives each of these shops a Default and a gloves version on the same NPC option;
 * Trade and the shopkeepers' open_shop dialogue steps ask "npc-dialogue:shop" which one opens, and this unit
 * answers it from the gloves in the hands slot. Gloves taken off or put on while the shop is open change
 * nothing until it is opened again (ours).
 */
const Rewards = require("./Common.DiaryRewards");

const FAMILY = "Karamja gloves";
/** "Davon's Amulet Store. (Karamja gloves)", "Karamja General Store (Karamja gloves 3)", "... (Karamja gloves 3+)". */
const GLOVES_VERSION = /\(Karamja gloves(?: (\d)\+?)?\)$/;

/** The tier (1-4) of the Karamja gloves the player wears, or 0. */
function wornTier(player) {
  const worn = player?.getEquipment?.()?.getItems?.()?.[Rewards.core.Equipment.HANDS_SLOT];
  const reward = worn ? Rewards.TIER_BY_ITEM.get(worn.getId()) : null;
  return reward?.family?.name === FAMILY ? reward.tier + 1 : 0;
}

/** The lowest gloves tier a shop version needs, or null for a version that isn't a gloves one. */
function requiredTier(name) {
  const match = GLOVES_VERSION.exec(String(name ?? ""));
  return match ? Number(match[1] ?? 1) : null;
}

/** Opens the gloves version of a versioned shop while gloves of its tier are worn. */
function pickGlovesVersion(request) {
  if (request.shop != null || !Array.isArray(request.shops)) return;
  const tier = wornTier(request.player);
  if (tier <= 0) return;
  const version = request.shops.find((name) => {
    const needed = requiredTier(name);
    return needed !== null && tier >= needed;
  });
  if (version) request.shop = version;
}

module.exports = function attach(api) {
  api.onCustomEvent("npc-dialogue:shop", pickGlovesVersion);
};
module.exports.wornTier = wornTier;
module.exports.requiredTier = requiredTier;
module.exports.pickGlovesVersion = pickGlovesVersion;
