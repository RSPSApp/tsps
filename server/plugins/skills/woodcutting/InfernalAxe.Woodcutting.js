/**
 * Infernal axe (OSRS Wiki): a 1/3 chance that each log is burnt as it is cut, giving half the
 * Firemaking experience for that log and using one of 5,000 charges. Woodcutting experience is
 * unaffected. An axe with no charges turns into its uncharged form, which cuts like a dragon axe.
 * Axes with no charge data yet are treated as fully charged.
 * Live (rsprox captures 1637, 3996): a burnt log still gets "You get some logs." (sent by the
 * woodcutting loop), with the smokepuff graphic at height 150 and the fire sound; "Check" says
 * "Infernal axe: 69.2% remaining." as a game message.
 */
const BURN_CHANCE = 3;
const MAX_CHARGES = 5000;
const CHARGES_META_KEY = "infernal-axe";
const BURN_GRAPHIC = 86; // smokepuff
const BURN_GRAPHIC_HEIGHT = 150;

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
  // Wiki (Infernal axe): half the log's Firemaking XP, "increased by the Pyromancer outfit bonus".
  const outfit = { player, multiplier: 1 };
  api.emitCustomEvent("firemaking:xp-multiplier", outfit);
  player.getSkillManager().addExperiences(core.Skill.FIREMAKING, (request.xp / 2) * outfit.multiplier);
  player.performGraphic(new core.Graphic(BURN_GRAPHIC, 0, BURN_GRAPHIC_HEIGHT));
  player.getPacketSender().sendSoundEffect(core.Sound.FIRE_SUCCESSFUL.getId(), 1, 0, 1);
  useCharge(player, item);
  return true;
}

/** "Check": the charges left as a share of 5,000, to one decimal place. */
function check({ player, item }) {
  if (!item || !unchargedByCharged.has(item.getId())) return false;
  player.sendMessage(`Infernal axe: ${((charges(item) / MAX_CHARGES) * 100).toFixed(1)}% remaining.`);
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
  api.onItemAction("Infernal axe", { Check: check });
  api.onItemAction("Infernal axe (or)", { Check: check });
}

module.exports = { attach, tryBurnLog };
