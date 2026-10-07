/**
 * Infernal axe (OSRS Wiki): a 1/3 chance that each log is burnt as it is cut, giving half the
 * Firemaking experience for that log and using one of 5,000 charges. Woodcutting experience is
 * unaffected. An axe with no charges turns into its uncharged form, which cuts like a dragon axe.
 * Axes with no charge data yet are treated as fully charged.
 */
const BURN_CHANCE = 3;
const MAX_CHARGES = 5000;
const CHARGES_META_KEY = "infernal-axe";

let api = null;
let core = null;
let unchargedByCharged = new Map();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY)?.charges);
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : MAX_CHARGES;
}

function findChargedAxe(player, axeId) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  if (weapon?.getId() === axeId) {
    return weapon;
  }
  return player.getInventory().getItems().find((item) => item?.getId() === axeId) ?? null;
}

function useCharge(player, item) {
  const left = charges(item) - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, { charges: left });
    return;
  }
  item.setId(unchargedByCharged.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.sendMessage("Your infernal axe has run out of charges.");
}

/** Returns true when the log was burnt instead of going to the inventory. */
function tryBurnLog(player, axeId, logId) {
  if (!unchargedByCharged.has(axeId) || Math.floor(Math.random() * BURN_CHANCE) !== 0) {
    return false;
  }
  const item = findChargedAxe(player, axeId);
  const request = { logId, xp: null };
  api.emitCustomEvent("firemaking:log-xp", request);
  if (!item || !(request.xp > 0)) {
    return false;
  }
  player.getSkillManager().addExperiences(core.Skill.FIREMAKING, request.xp / 2);
  useCharge(player, item);
  return true;
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const ids = core.ItemIdentifiers;
  unchargedByCharged = new Map([
    [ids.INFERNAL_AXE, ids.INFERNAL_AXE_UNCHARGED_],
    [ids.INFERNAL_AXE_OR_, ids.INFERNAL_AXE_UNCHARGED__2],
    [ids.INFERNAL_AXE_OR__3, ids.INFERNAL_AXE_UNCHARGED__4],
  ]);
}

module.exports = { attach, tryBurnLog };
