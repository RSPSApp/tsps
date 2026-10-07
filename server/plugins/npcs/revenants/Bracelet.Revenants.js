/**
 * The bracelet of ethereum (https://oldschool.runescape.wiki/w/Bracelet_of_ethereum): charged
 * with revenant ether (up to 16,000), it cuts each revenant attack's damage by 75% for a charge
 * and makes revenants tolerant. With absorption on, defeated revenants' ether goes straight into
 * it. The check and toggle messages are captured; the rest is ours (docs/revenants.md).
 */
const { ITEMS } = require("./Data.Revenants");
const Revenants = require("./Common.Revenants");

const MAX_CHARGES = 16_000;
const DISMANTLE_ETHER = 250;
const DAMAGE_KEPT = 0.25;
const CHARGES_META_KEY = "charges";
const ABSORB_ATTRIBUTE = "revenants:absorb-ether";
const HANDS_SLOT = 9;

function charges(item) {
  const saved = Number(item?.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function absorbing(player) {
  return player.getAttribute(ABSORB_ATTRIBUTE) === true;
}

/** "The bracelet has 100 (<col=007f00>0.6%</col>) charges, it will not absorb ether ..." */
function chargesMessage(player, item) {
  const amount = charges(item);
  const percent = (Math.floor((amount / MAX_CHARGES) * 1000) / 10).toFixed(1);
  const absorb = absorbing(player) ? "it will absorb" : "it will not absorb";
  return `The bracelet has ${amount.toLocaleString("en-US")} (<col=007f00>${percent}%</col>) charges, ${absorb} ether from defeated revenants.`;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function setCharges(item, amount) {
  item.setId(amount > 0 ? ITEMS.BRACELET_CHARGED : ITEMS.BRACELET_UNCHARGED);
  item.setMetaValue(CHARGES_META_KEY, amount > 0 ? amount : undefined);
}

function wornBracelet(player) {
  const item = player.getEquipment?.()?.getItems?.()[HANDS_SLOT];
  const id = item?.getId?.();
  return id === ITEMS.BRACELET_CHARGED || id === ITEMS.BRACELET_UNCHARGED ? item : null;
}

function wearsCharged(player) {
  const item = wornBracelet(player);
  return item?.getId() === ITEMS.BRACELET_CHARGED && charges(item) > 0;
}

/**
 * A revenant attack on this player: a charged bracelet keeps a quarter of the damage and spends
 * a charge. Returns the damage to deal.
 */
function reduceRevenantDamage(player, damage) {
  const item = wornBracelet(player);
  if (!item || item.getId() !== ITEMS.BRACELET_CHARGED) return damage;
  const left = charges(item) - 1;
  setCharges(item, left);
  if (left <= 0) {
    refresh(player);
    player.sendMessage("Your bracelet of ethereum has run out of charges.");
  }
  return Math.floor(damage * DAMAGE_KEPT);
}

/** Ether from a defeated revenant: into the worn bracelet when absorbing. Returns what is left over. */
function absorbEther(player, amount) {
  const item = wornBracelet(player);
  if (!item || !absorbing(player)) return amount;
  const taken = Math.min(amount, MAX_CHARGES - charges(item));
  if (taken <= 0) return amount;
  setCharges(item, charges(item) + taken);
  refresh(player);
  return amount - taken;
}

// ------------------------------------------------------------------ item options

function chargeWithEther(event) {
  const { player } = event;
  const ether = event.usedItemId === ITEMS.ETHER ? event.usedItem : event.usedWithItem;
  const bracelet = ether === event.usedItem ? event.usedWithItem : event.usedItem;
  const taken = Math.min(ether.getAmount(), MAX_CHARGES - charges(bracelet));
  if (taken <= 0) {
    player.sendMessage("The bracelet can't hold any more ether.");
    return;
  }
  player.getInventory().delete(ITEMS.ETHER, taken);
  setCharges(bracelet, charges(bracelet) + taken);
  refresh(player);
  player.sendMessage(chargesMessage(player, bracelet));
}

function check({ player, item }) {
  player.sendMessage(chargesMessage(player, item));
}

function toggleAbsorption({ player }) {
  const on = !absorbing(player);
  player.setAttribute(ABSORB_ATTRIBUTE, on);
  player.sendMessage(on
    ? "Your bracelet will now automatically absorb ether from defeated revenants."
    : "Your bracelet will no longer automatically absorb ether from defeated revenants.");
}

function uncharge({ player, item }) {
  const amount = charges(item);
  const inventory = player.getInventory();
  if (!inventory.contains(ITEMS.ETHER) && inventory.getFreeSlots() < 1) {
    player.sendMessage("You don't have enough inventory space to uncharge the bracelet.");
    return;
  }
  setCharges(item, 0);
  if (amount > 0) inventory.adds(ITEMS.ETHER, amount);
  refresh(player);
  player.sendMessage("You uncharge the bracelet.");
}

function dismantle({ player, slot }) {
  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId?.() !== ITEMS.BRACELET_UNCHARGED) return;
  inventory.deleteAtSlot(slot, 1);
  inventory.adds(ITEMS.ETHER, DISMANTLE_ETHER);
  player.sendMessage(`You dismantle the bracelet into ${DISMANTLE_ETHER} revenant ether.`);
}

/** Always lost on death; its ether drops beside it (Wiki). */
function neverKept(event) {
  const id = event.item?.getId?.();
  if (id === ITEMS.BRACELET_CHARGED || id === ITEMS.BRACELET_UNCHARGED) event.keep = false;
}

/** A charged bracelet drops uncharged; returns the ether it held, which drops beside it. */
function emptyForDeathDrop(item) {
  if (item?.getId?.() !== ITEMS.BRACELET_CHARGED) return 0;
  const amount = charges(item);
  setCharges(item, 0);
  return amount;
}

/** A charged bracelet drops uncharged, with its ether beside it (Wiki: always lost on death). */
function braceletDeathDrop(event) {
  const id = event.item?.getId?.();
  if (id !== ITEMS.BRACELET_CHARGED || !event.shouldDropItems) return;
  const { core } = Revenants;
  const ether = emptyForDeathDrop(event.item);
  const owner = event.killer?.isPlayer?.() ? event.killer.getAsPlayer() : event.player;
  core.ItemOnGroundManager.registerLocation(owner, new core.Item(ITEMS.BRACELET_UNCHARGED, 1), event.location);
  if (ether > 0) core.ItemOnGroundManager.registerLocation(owner, new core.Item(ITEMS.ETHER, ether), event.location);
  event.handled = true;
}

module.exports = function attachBracelet(api) {
  api.persistAttribute(ABSORB_ATTRIBUTE);
  api.onItemOnItem("Revenant ether", "Bracelet of ethereum", chargeWithEther);
  api.onItemOnItem("Revenant ether", "Bracelet of ethereum (uncharged)", chargeWithEther);
  api.onItemAction("Bracelet of ethereum", {
    Check: check, "Toggle-absorption": toggleAbsorption, Uncharge: uncharge,
  });
  api.onItemAction("Bracelet of ethereum (uncharged)", {
    "Toggle-absorption": toggleAbsorption, Dismantle: dismantle,
  });
  api.onShouldKeepItemOnDeath(neverKept);
  api.onPlayerDeathItemDrop(braceletDeathDrop);
};

Object.assign(module.exports, {
  MAX_CHARGES,
  ABSORB_ATTRIBUTE,
  charges,
  chargesMessage,
  wearsCharged,
  reduceRevenantDamage,
  absorbEther,
  chargeWithEther,
  check,
  toggleAbsorption,
  uncharge,
  dismantle,
  neverKept,
  emptyForDeathDrop,
  braceletDeathDrop,
});
