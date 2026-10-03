/**
 * Infernal harpoon (OSRS Wiki): each fish it catches has a 1/3 chance to be cooked and destroyed,
 * giving half that fish's Cooking experience and using one of 5,000 charges; Fishing experience is
 * unaffected. With no charges left it turns into its uncharged form, which fishes like a dragon
 * harpoon. A smouldering stone on a dragon harpoon makes one (75 Fishing and 85 Cooking, not
 * boostable; 200 Fishing and 350 Cooking experience), and a smouldering stone or another dragon
 * harpoon recharges an uncharged one. Harpoons with no charge data yet count as fully charged.
 */
const COOK_CHANCE = 3;
const MAX_CHARGES = 5000;
const CHARGES_META_KEY = "infernal-harpoon";
const CREATE_LEVELS = Object.freeze({ fishing: 75, cooking: 85 });
const CREATE_XP = Object.freeze({ fishing: 200, cooking: 350 });

let api = null;
let core = null;
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY)?.charges);
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : MAX_CHARGES;
}

/** The charged infernal harpoon the player is wielding or carrying, wielded first. */
function findCharged(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  if (weapon && unchargedByCharged.has(weapon.getId())) {
    return weapon;
  }
  return player.getInventory().getItems().find((item) => item && unchargedByCharged.has(item.getId())) ?? null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharge(player, item) {
  const left = charges(item) - 1;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, { charges: left });
    return;
  }
  item.setId(unchargedByCharged.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your infernal harpoon has run out of charges.");
}

/** Returns true when the fish was cooked and destroyed instead of going to the inventory. */
function tryCookFish(player, rawId, random = Math.random) {
  const item = findCharged(player);
  if (!item || Math.floor(random() * COOK_CHANCE) !== 0) {
    return false;
  }
  const request = { rawId, xp: null };
  api.emitCustomEvent("cooking:raw-xp", request);
  if (!(request.xp > 0)) {
    return false;
  }
  player.getSkillManager().addExperiences(core.Skill.COOKING, request.xp / 2);
  useCharge(player, item);
  return true;
}

function checkCharges({ player, item }) {
  const left = charges(item);
  player.sendMessage(`Your infernal harpoon has ${left.toLocaleString("en-US")} charge${left === 1 ? "" : "s"} left.`);
}

/** The inventory slot of whichever of the two used items has one of these ids. */
function slotOf(event, ids) {
  if (ids.has(event.usedItemId)) return event.usedItemSlot;
  if (ids.has(event.usedWithItemId)) return event.usedWithItemSlot;
  return -1;
}

function otherId(event, slot) {
  return slot === event.usedItemSlot ? event.usedWithItemId : event.usedItemId;
}

function makeHarpoon(event) {
  const { player } = event;
  const { Skill, ItemIdentifiers: I } = core;
  const skills = player.getSkillManager();
  if (skills.getMaxLevel(Skill.FISHING) < CREATE_LEVELS.fishing || skills.getMaxLevel(Skill.COOKING) < CREATE_LEVELS.cooking) {
    player.sendMessage(
      `You need a Fishing level of ${CREATE_LEVELS.fishing} and a Cooking level of ${CREATE_LEVELS.cooking} to do that.`
    );
    return;
  }
  const slot = slotOf(event, new Set([I.DRAGON_HARPOON]));
  const harpoon = player.getInventory().getItems()[slot];
  if (!harpoon) return;
  player.getInventory().deleteNumber(otherId(event, slot), 1);
  harpoon.setId(I.INFERNAL_HARPOON);
  harpoon.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  skills.addExperiences(Skill.FISHING, CREATE_XP.fishing);
  skills.addExperiences(Skill.COOKING, CREATE_XP.cooking);
  player.sendMessage("You infuse the dragon harpoon with the smouldering stone.");
}

function rechargeHarpoon(event) {
  const { player } = event;
  const slot = slotOf(event, new Set(chargedByUncharged.keys()));
  const harpoon = player.getInventory().getItems()[slot];
  if (!harpoon) return;
  player.getInventory().deleteNumber(otherId(event, slot), 1);
  harpoon.setId(chargedByUncharged.get(harpoon.getId()));
  harpoon.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage(`Your infernal harpoon has been recharged with ${MAX_CHARGES.toLocaleString("en-US")} charges.`);
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const I = core.ItemIdentifiers;
  unchargedByCharged = new Map([
    [I.INFERNAL_HARPOON, I.INFERNAL_HARPOON_UNCHARGED_],
    [I.INFERNAL_HARPOON_OR_, I.INFERNAL_HARPOON_UNCHARGED__2],
    [I.INFERNAL_HARPOON_OR__3, I.INFERNAL_HARPOON_UNCHARGED__4],
  ]);
  chargedByUncharged = new Map([...unchargedByCharged].map(([charged, uncharged]) => [uncharged, charged]));

  api.onItemAction("Infernal harpoon", { Check: checkCharges });
  api.onItemAction("Infernal harpoon (or)", { Check: checkCharges });
  api.onItemOnItem("Smouldering stone", "Dragon harpoon", makeHarpoon, { noted: false });
  api.onItemOnItem("Smouldering stone", "Infernal harpoon (uncharged)", rechargeHarpoon, { noted: false });
  api.onItemOnItem("Dragon harpoon", "Infernal harpoon (uncharged)", rechargeHarpoon, { noted: false });
}

module.exports = { attach, tryCookFish, charges, MAX_CHARGES };
