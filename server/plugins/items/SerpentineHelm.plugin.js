/**
 * Serpentine helm (https://oldschool.runescape.wiki/w/Serpentine_helm).
 *
 * Charged with Zulrah's scales (11,000 cap). While charged it grants poison and
 * venom immunity (without curing existing effects) and has a chance to envenom
 * monsters on a successful hit: 1/6 with a plain melee weapon, 1/2 with a
 * poisoned weapon, 100% with the toxic blowpipe, trident of the swamp or toxic
 * staff. It spends 10 scales on entering combat and 10 more every 90 ticks.
 */
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
const GUARANTEED_WEAPON_NAMES = new Set([
  "toxic blowpipe", "toxic staff of the dead", "trident of the swamp",
  "trident of the swamp (e)", "trident of the swamp (o)", "trident of the swamp (e) (o)",
]);

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function wornHelm(player) {
  if (!player?.getEquipment) {
    return null;
  }
  const item = player.getEquipment().get(core.Equipment.HEAD_SLOT);
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
  immunity?.protectBriefly(2, true);
  const combat = player.getCombat();
  const inCombat = combat.getTarget() != null || combat.getAttacker?.() != null;
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

function venomChance(player, combatType) {
  const weaponId = Number(player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.() ?? -1);
  const name = String(core.ItemDefinition.forId(weaponId)?.getName?.() ?? "").toLowerCase();
  if (GUARANTEED_WEAPON_NAMES.has(name)) return 1;
  // Read the selected projectile, including quiver and self-ammo weapons.
  if (combatType === core.CombatType.RANGED) {
    const ammoId = player.getCombat().getAmmunition()?.getItemId();
    const ammoName = String(core.ItemDefinition.forId(ammoId ?? -1)?.getName?.() ?? "").toLowerCase();
    return /\(p(?:\+\+?)?\)$/.test(ammoName) ? 0.5 : 0;
  }
  if (combatType !== core.CombatType.MELEE) return 0;
  // The halberd's own 1/3 roll (CombatPoisonData) follows this one, so 1/4 here makes the Wiki's 1/2.
  if (name === "noxious halberd") return 0.25;
  if (/^abyssal tentacle(?: \(or\))?$/.test(name) || /\(p(?:\+\+?)?\)$/.test(name)) return 0.5;
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
  if (Math.random() >= venomChance(player, hit.getCombatType())) {
    return;
  }
  core.CombatFactory.poisonEntity(target, VENOM_SEVERITY, 2);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your serpentine helm has ${charges(item).toLocaleString("en-US")} scales left.`);
}

function chargeHelm(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const helm = chargedIds.has(usedItemId) || chargedFromUncharged.has(usedItemId) ? usedItem : chargedIds.has(usedWithItemId) || chargedFromUncharged.has(usedWithItemId) ? usedWithItem : null;
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
  const total = charges(helm);
  player.sendMessage(`Scales: <col=007f00>${total.toLocaleString("en-US")} (${(100 * total / MAX_CHARGES).toFixed(1)}%)</col>`);
  event.handled = true;
}

function uncharge({ player, item }) {
  const left = charges(item);
  if (left <= 0) {
    player.sendMessage("Your serpentine helm has no scales to remove.");
    return true;
  }
  const refund = new core.Item(core.ItemIdentifiers.ZULRAHS_SCALES, left);
  if (player.getInventory().getAddableAmount(refund) < left) {
    player.sendMessage("You need a free inventory slot to uncharge your serpentine helm.");
    return true;
  }
  item.setId(chargedByUncharged.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  player.getInventory().addItem(refund);
  refresh(player);
  player.sendMessage(`You remove ${left} scales from your serpentine helm.`);
  return true;
}

function processPlayer({ player }) {
  if (!player?.isPlayerBot?.()) processUpkeep(player);
}

function attach(api) {
  core = api.core;
  const I = core.ItemIdentifiers;
  const families = [
    [I.SERPENTINE_HELM, I.SERPENTINE_HELM_2, I.SERPENTINE_HELM_UNCHARGED_],
    [I.TANZANITE_HELM, I.TANZANITE_HELM_2, I.TANZANITE_HELM_UNCHARGED_],
    [I.MAGMA_HELM, I.MAGMA_HELM_2, I.MAGMA_HELM_UNCHARGED_],
  ];
  chargedByUncharged = new Map(families.flatMap(([charged, alternate, empty]) => [[charged, empty], [alternate, empty]]));
  chargedIds = new Set(chargedByUncharged.keys());
  chargedFromUncharged = new Map(families.map(([charged, , empty]) => [empty, charged]));
  api.persistAttribute(COMBAT_CHARGE_TICK_ATTRIBUTE, null);
  for (const name of ["Serpentine helm", "Tanzanite helm", "Magma helm"]) {
    api.onItemAction(name, { Check: checkCharges, Uncharge: uncharge });
    api.onItemOnItem("Zulrah's scales", name, chargeHelm, { noted: false });
    api.onItemOnItem("Zulrah's scales", `${name} (uncharged)`, chargeHelm, { noted: false });
  }
  api.onCombatHitResolved(onHitResolved);
  api.onPlayerProcess(processPlayer);
}

module.exports = {
  name: "SerpentineHelm",
  description: "Charges the serpentine helm with Zulrah's scales for poison and venom immunity and a chance to envenom targets, spending scales in combat.",
  members: true,
  _test: { charges, wornHelm, processUpkeep, venomChance, onHitResolved, chargeHelm, uncharge, MAX_CHARGES },
  register(api) {
    attach(api);
  },
};
