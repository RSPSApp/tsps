/**
 * Toxic Staff of the Dead (https://oldschool.runescape.wiki/w/Toxic_Staff_of_the_Dead).
 *
 * Charged with Zulrah's scales (1 scale = 1 charge, 11,000 max). While charged
 * the staff consumes 10 scales on entering combat and another 10 for each full
 * minute of combat, and hits (melee or spell) have a 25% chance to envenom the
 * target - 100% against NPCs while a serpentine helm is worn. Uncharging
 * returns every unused scale.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");

const MAX_CHARGES = 11000;
const COMBAT_CHARGE = 10;
const COMBAT_CHARGE_INTERVAL_MS = 60 * 1000;
const VENOM_CHANCE = 0.25;
const VENOM_SEVERITY = 6;
const CHARGES_META_KEY = "toxic-staff-charges";
const COMBAT_CHARGE_AT_ATTRIBUTE = "toxic-staff:combat-charge-at";

let core = null;
let chargedIds = new Set();
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();
let snakeHelmIds = new Set();
let zulrahScalesId = 0;

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function weaponItem(player) {
  return player.getEquipment().get(Equipment.WEAPON_SLOT);
}

function isWieldingCharged(player) {
  return chargedIds.has(Number(weaponItem(player)?.getId?.() ?? -1));
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function deactivate(player, item) {
  item.setId(unchargedByCharged.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your toxic staff has run out of scales.");
}

function consumeCharges(player, item, amount) {
  const left = charges(item) - amount;
  if (left <= 0) {
    deactivate(player, item);
    return 0;
  }
  item.setMetaValue(CHARGES_META_KEY, left);
  return left;
}

/** Ten scales on entering combat, then ten for every full minute in combat. */
function processCombatUpkeep(player) {
  const item = weaponItem(player);
  if (!isWieldingCharged(player)) {
    player.setAttribute(COMBAT_CHARGE_AT_ATTRIBUTE, null);
    return;
  }
  const inCombat = player.getCombat?.()?.getTarget?.() != null;
  if (!inCombat) {
    player.setAttribute(COMBAT_CHARGE_AT_ATTRIBUTE, null);
    return;
  }
  const now = Date.now();
  const chargedAt = Number(player.getAttribute(COMBAT_CHARGE_AT_ATTRIBUTE));
  if (Number.isFinite(chargedAt) && chargedAt > 0 && now - chargedAt < COMBAT_CHARGE_INTERVAL_MS) {
    return;
  }
  consumeCharges(player, item, COMBAT_CHARGE);
  player.setAttribute(COMBAT_CHARGE_AT_ATTRIBUTE, now);
}

/** 25% venom chance; a serpentine helm makes it certain against NPCs. */
function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !hit?.isAccurate?.() || !(hit?.getTotalDamage?.() > 0)) {
    return;
  }
  const player = attacker.getAsPlayer();
  if (!isWieldingCharged(player) || target?.isVenomed?.()) {
    return;
  }
  const helmId = Number(player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() ?? -1);
  const guaranteed = target?.isNpc?.() && snakeHelmIds.has(helmId);
  if (!guaranteed && Math.random() >= VENOM_CHANCE) {
    return;
  }
  core.CombatFactory.poisonEntity(target, VENOM_SEVERITY, 2);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your toxic staff has ${charges(item).toLocaleString("en-US")} charges left.`);
}

function chargeStaff(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const staff = (chargedIds.has(usedItemId) || chargedByUncharged.has(usedItemId)) ? usedItem : usedWithItem;
  const otherId = staff === usedItem ? usedWithItemId : usedItemId;
  if (!staff || Number(otherId) !== zulrahScalesId) {
    return;
  }
  const inventory = player.getInventory();
  const available = inventory.getAmount(zulrahScalesId);
  const room = MAX_CHARGES - charges(staff);
  if (available <= 0 || room <= 0) {
    player.sendMessage("Your toxic staff cannot hold any more scales.");
    event.handled = true;
    return;
  }
  const used = Math.min(available, room);
  inventory.deleteNumber(zulrahScalesId, used);
  if (chargedByUncharged.has(staff.getId())) {
    staff.setId(chargedByUncharged.get(staff.getId()));
    refresh(player);
  }
  staff.setMetaValue(CHARGES_META_KEY, charges(staff) + used);
  player.sendMessage(`You add ${used} scales to your toxic staff.`);
  event.handled = true;
}

function uncharge({ player, item }) {
  const left = charges(item);
  if (left <= 0) {
    player.sendMessage("Your toxic staff has no scales to remove.");
    return true;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You need a free inventory slot to uncharge your toxic staff.");
    return true;
  }
  item.setId(unchargedByCharged.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  player.getInventory().addItem(new Item(zulrahScalesId, left));
  refresh(player);
  player.sendMessage(`You remove ${left} scales from your toxic staff.`);
  return true;
}

module.exports = {
  name: "ToxicStaffOfTheDead",
  members: true,
  _test: { charges, isWieldingCharged, consumeCharges, processCombatUpkeep, onHitResolved, chargeStaff, uncharge, MAX_CHARGES },
  register(api) {
    core = api.core;
    zulrahScalesId = core.ItemIdentifiers.ZULRAHS_SCALES;
    unchargedByCharged = new Map([
      [core.ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD, core.ItemIdentifiers.TOXIC_STAFF_UNCHARGED_],
      [core.ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD_2, core.ItemIdentifiers.TOXIC_STAFF_UNCHARGED_],
    ]);
    chargedIds = new Set(unchargedByCharged.keys());
    chargedByUncharged = new Map([
      [core.ItemIdentifiers.TOXIC_STAFF_UNCHARGED_, core.ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD],
    ]);
    snakeHelmIds = new Set([
      core.ItemIdentifiers.SERPENTINE_HELM,
      core.ItemIdentifiers.SERPENTINE_HELM_2,
    ]);

    api.persistAttribute(COMBAT_CHARGE_AT_ATTRIBUTE);
    api.onItemAction((event) => {
      if (!chargedIds.has(event.itemId) && !unchargedByCharged.has(event.itemId)) {
        return;
      }
      const option = String(event.option ?? "").toLowerCase();
      if (option === "check") {
        event.handled = true;
        checkCharges(event);
      } else if (option === "uncharge" && chargedIds.has(event.itemId)) {
        event.handled = uncharge(event);
      }
    });
    api.onItemOnItem(chargeStaff, { noted: false });
    api.onCombatHitResolved(onHitResolved);
    api.onPlayerProcess(({ player }) => {
      if (!player?.isPlayerBot?.()) {
        processCombatUpkeep(player);
      }
    });
  },
};
