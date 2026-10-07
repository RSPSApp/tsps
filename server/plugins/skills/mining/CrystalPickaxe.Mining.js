/**
 * Crystal pickaxe charges (OSRS Wiki): created with 10,000 charges, one consumed
 * for each ore mined, recharged with crystal shards (100 each, up to 20,000).
 * An empty pickaxe turns inactive and mines like a dragon pickaxe. Wearing an
 * elven signet gives a 10% chance to save the charge.
 */
const START_CHARGES = 10000;
const MAX_CHARGES = 20000;
const SHARD_CHARGES = 100;
const CHARGES_META_KEY = "crystal-pickaxe";

let core = null;
let api = null;
let unchargedByCharged = new Map();
let chargedByUncharged = new Map();
let chargedIds = new Set();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY)?.charges);
  if (Number.isFinite(saved)) {
    return Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved)));
  }
  return chargedIds.has(item?.getId?.()) ? START_CHARGES : 0;
}

/** The charged crystal pickaxe the player is wielding or carrying, wielded first. */
function findCharged(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT];
  if (weapon && chargedIds.has(weapon.getId())) {
    return weapon;
  }
  return player.getInventory().getItems().find((item) => item && chargedIds.has(item.getId())) ?? null;
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
  player.sendMessage("Your crystal pickaxe has run out of charges.");
}

function wearingSignet(player) {
  const { ELVEN_SIGNET, ELVEN_SIGNET_2, ELVEN_SIGNET_3 } = core.ItemIdentifiers;
  return [ELVEN_SIGNET, ELVEN_SIGNET_2, ELVEN_SIGNET_3].some((id) => player.getEquipment().contains(id));
}

/** Spends one charge for a mined ore; returns false when the signet saved it. */
function tryUseCharge(player, random = Math.random) {
  const item = findCharged(player);
  if (!item) {
    return false;
  }
  if (wearingSignet(player) && random() < 0.10) {
    return false;
  }
  useCharge(player, item);
  return true;
}

function checkCharges({ player, item }) {
  const left = charges(item);
  player.sendMessage(`Your crystal pickaxe has ${left.toLocaleString("en-US")} charge${left === 1 ? "" : "s"} left.`);
}

function addShardCharges(event) {
  const { player } = event;
  const pickaxe = [event.usedItem, event.usedWithItem].find((candidate) => {
    const id = candidate?.getId?.();
    return chargedIds.has(id) || chargedByUncharged.has(id);
  });
  if (!pickaxe) {
    return;
  }
  const shardCount = player.getInventory().getAmount(core.ItemIdentifiers.CRYSTAL_SHARD);
  if (shardCount <= 0) {
    return;
  }
  const left = charges(pickaxe);
  if (left >= MAX_CHARGES) {
    player.sendMessage("Your crystal pickaxe cannot hold any more charges.");
    event.handled = true;
    return;
  }
  const shards = Math.min(shardCount, Math.ceil((MAX_CHARGES - left) / SHARD_CHARGES));
  player.getInventory().deleteNumber(core.ItemIdentifiers.CRYSTAL_SHARD, shards);
  if (chargedByUncharged.has(pickaxe.getId())) {
    pickaxe.setId(chargedByUncharged.get(pickaxe.getId()));
  }
  pickaxe.setMetaValue(CHARGES_META_KEY, { charges: Math.min(MAX_CHARGES, left + shards * SHARD_CHARGES) });
  refresh(player);
  player.sendMessage(`You add ${shards} crystal shard${shards === 1 ? "" : "s"} to the pickaxe.`);
  event.handled = true;
}

function attach(pluginApi) {
  core = pluginApi.core;
  api = pluginApi;
  const I = core.ItemIdentifiers;
  unchargedByCharged = new Map([
    [I.CRYSTAL_PICKAXE, I.CRYSTAL_PICKAXE_INACTIVE_],
    [I.CRYSTAL_PICKAXE_3, I.CRYSTAL_PICKAXE_INACTIVE_],
  ]);
  chargedByUncharged = new Map([
    [I.CRYSTAL_PICKAXE_INACTIVE_, I.CRYSTAL_PICKAXE],
    [I.CRYSTAL_PICKAXE_INACTIVE__2, I.CRYSTAL_PICKAXE],
  ]);
  chargedIds = new Set(unchargedByCharged.keys());

  api.onItemAction("Crystal pickaxe", { Check: checkCharges });
  api.onItemOnItem("Crystal shard", "Crystal pickaxe", addShardCharges, { noted: false });
  api.onItemOnItem("Crystal shard", "Crystal pickaxe (inactive)", addShardCharges, { noted: false });
}

module.exports = { attach, tryUseCharge, charges, MAX_CHARGES, START_CHARGES };
