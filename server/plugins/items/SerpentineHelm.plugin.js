/**
 * Serpentine helm (https://oldschool.runescape.wiki/w/Serpentine_helm).
 *
 * Charged with Zulrah's scales (11,000 cap). While charged it grants poison and
 * venom immunity (without curing existing effects) and has a chance to envenom
 * monsters on a successful hit: 1/6 with a plain melee weapon, 1/2 with a
 * poisoned weapon, 100% with the toxic blowpipe, trident of the swamp or toxic
 * staff. It spends 10 scales on entering combat and 10 more every 90 ticks.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const MAX_CHARGES = 11000;
const COMBAT_CHARGE = 10;
const COMBAT_CHARGE_TICKS = 90;
const VENOM_SEVERITY = 6;
const CHARGES_META_KEY = "serpentine-helm";
const COMBAT_CHARGE_TICK_ATTRIBUTE = "serpentine:combat-charge-tick";

let core = null;
let chargedIds = new Set();
let chargedByUncharged = new Map();
let chargedFromUncharged = new Map();
let guaranteedWeaponIds = new Set();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function wornHelm(player) {
  if (!player?.getEquipment) {
    return null;
  }
  const item = player.getEquipment().get(Equipment.HEAD_SLOT);
  return item && chargedIds.has(item.getId()) ? item : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function deactivate(player, item) {
  item.setId(chargedByUncharged.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your serpentine helm has run out of scales.");
}

function processUpkeep(player) {
  const helm = wornHelm(player);
  if (!helm) {
    player.setAttribute(COMBAT_CHARGE_TICK_ATTRIBUTE, null);
    return;
  }
  // Poison/venom immunity: keep the shared immunity timer alive without curing.
  const immunity = player.getCombat?.()?.getPoisonImmunityTimer?.();
  if (immunity?.finished?.()) {
    immunity.start(2);
  }
  const inCombat = player.getCombat?.()?.getTarget?.() != null;
  if (!inCombat) {
    player.setAttribute(COMBAT_CHARGE_TICK_ATTRIBUTE, null);
    return;
  }
  const cycle = core.World?.getProcessCycle?.() ?? 0;
  const chargedAt = Number(player.getAttribute(COMBAT_CHARGE_TICK_ATTRIBUTE));
  if (Number.isFinite(chargedAt) && chargedAt > 0 && cycle - chargedAt < COMBAT_CHARGE_TICKS) {
    return;
  }
  const left = charges(helm) - COMBAT_CHARGE;
  if (left <= 0) {
    deactivate(player, helm);
  } else {
    helm.setMetaValue(CHARGES_META_KEY, left);
  }
  player.setAttribute(COMBAT_CHARGE_TICK_ATTRIBUTE, cycle);
}

function venomChance(player) {
  const weaponId = Number(player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() ?? -1);
  if (guaranteedWeaponIds.has(weaponId)) {
    return 1;
  }
  const name = String(core.ItemDefinition.forId(weaponId)?.getName?.() ?? "").toLowerCase();
  if (/\(p(?:\+\+?)?\)$/.test(name)) {
    return 0.5;
  }
  return 1 / 6;
}

function onHitResolved({ attacker, target, hit }) {
  if (!attacker?.isPlayer?.() || !hit?.isAccurate?.() || !(hit?.getTotalDamage?.() > 0)) {
    return;
  }
  const player = attacker.getAsPlayer();
  if (!wornHelm(player) || !target?.isNpc?.() || target.isVenomed?.()) {
    return;
  }
  if (Math.random() >= venomChance(player)) {
    return;
  }
  core.CombatFactory.poisonEntity(target, VENOM_SEVERITY, 2);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your serpentine helm has ${charges(item).toLocaleString("en-US")} scales left.`);
}

function chargeHelm(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const helm = chargedIds.has(usedItemId) || chargedFromUncharged.has(usedItemId) ? usedItem : usedWithItem;
  const otherId = helm === usedItem ? usedWithItemId : usedItemId;
  if (!helm || Number(otherId) !== core.ItemIdentifiers.ZULRAHS_SCALES) {
    return;
  }
  const inventory = player.getInventory();
  const available = inventory.getAmount(core.ItemIdentifiers.ZULRAHS_SCALES);
  const room = MAX_CHARGES - charges(helm);
  if (available <= 0 || room <= 0) {
    player.sendMessage("Your serpentine helm cannot hold any more scales.");
    event.handled = true;
    return;
  }
  const used = Math.min(available, room);
  inventory.deleteNumber(core.ItemIdentifiers.ZULRAHS_SCALES, used);
  if (chargedFromUncharged.has(helm.getId())) {
    helm.setId(chargedFromUncharged.get(helm.getId()));
    refresh(player);
  }
  helm.setMetaValue(CHARGES_META_KEY, charges(helm) + used);
  player.sendMessage(`You add ${used} scales to your serpentine helm.`);
  event.handled = true;
}

function uncharge({ player, item }) {
  const left = charges(item);
  if (left <= 0) {
    player.sendMessage("Your serpentine helm has no scales to remove.");
    return true;
  }
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage("You need a free inventory slot to uncharge your serpentine helm.");
    return true;
  }
  item.setId(chargedByUncharged.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  player.getInventory().addItem(new Item(core.ItemIdentifiers.ZULRAHS_SCALES, left));
  refresh(player);
  player.sendMessage(`You remove ${left} scales from your serpentine helm.`);
  return true;
}

module.exports = {
  name: "SerpentineHelm",
  members: true,
  _test: { charges, wornHelm, processUpkeep, venomChance, onHitResolved, chargeHelm, uncharge, MAX_CHARGES },
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    const chargedIdsList = [I.SERPENTINE_HELM, I.SERPENTINE_HELM_2];
    const unchargedId = I.SERPENTINE_HELM_UNCHARGED_;
    chargedIds = new Set(chargedIdsList);
    chargedByUncharged = new Map(chargedIdsList.map((id) => [id, unchargedId]));
    chargedFromUncharged = new Map([[unchargedId, chargedIdsList[0]]]);
    guaranteedWeaponIds = new Set([I.TOXIC_BLOWPIPE, I.TRIDENT_OF_THE_SWAMP, I.TOXIC_STAFF_OF_THE_DEAD]);

    api.persistAttribute(COMBAT_CHARGE_TICK_ATTRIBUTE);
    api.onItemAction((event) => {
      if (chargedIds.has(event.itemId)) {
        const option = String(event.option ?? "").toLowerCase();
        if (option === "check") {
          event.handled = true;
          checkCharges(event);
        } else if (option === "uncharge") {
          event.handled = uncharge(event);
        }
      }
    });
    api.onItemOnItem(chargeHelm, { noted: false });
    api.onCombatHitResolved(onHitResolved);
    api.onPlayerProcess(({ player }) => {
      if (!player?.isPlayerBot?.()) {
        processUpkeep(player);
      }
    });
  },
};
