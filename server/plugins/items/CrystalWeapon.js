"use strict";

/**
 * Charged crystal weapons (docs/crystal-weapons.md): the Bow of Faerdhinen and the Blade of Saeldor.
 * A new one holds 10,000 charges, one is used by every shot or swing, hit or miss, and crystal shards
 * add 100 each up to 20,000. An emptied weapon becomes its inactive form, which has no bonuses
 * until it is charged again. Shared by the two weapon plugins in this directory.
 *
 * `defineCrystalWeapon(api, config)`:
 * - `name`: the weapon in messages ("bow of Faerdhinen"); `chargesKey`: the item meta holding
 *   `{ charges, used }`; `chargedName` / `inactiveName`: the cache names the Check and shard hooks bind.
 * - `pairs`: [[chargedId, inactiveId]]; `usedPerPercent`: charges used per 1% of corruption progress.
 */

const NEW_CHARGES = 10000;
const MAX_CHARGES = 20000;
const CHARGES_PER_SHARD = 100;
const SHARD_NAME = "Crystal shard";

function defineCrystalWeapon(api, config) {
  const core = api.core;
  const inactiveByCharged = new Map(config.pairs);
  const chargedByInactive = new Map(config.pairs.map(([charged, inactive]) => [inactive, charged]));

  const isCharged = (id) => inactiveByCharged.has(Number(id));
  const isWeapon = (id) => isCharged(id) || chargedByInactive.has(Number(id));
  /** Player -> the weapon whose last charge their current shot or swing spent. */
  const spent = new WeakMap();
  const weaponOf = (player) => player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT] ?? null;

  function saved(item) {
    const value = item?.getMetaValue?.(config.chargesKey);
    return value && typeof value === "object" ? value : null;
  }

  /** A weapon with no saved count is new: full if charged, empty if inactive. */
  function chargesOf(item) {
    const value = Number(saved(item)?.charges);
    if (Number.isFinite(value)) return Math.max(0, Math.min(MAX_CHARGES, Math.floor(value)));
    return isCharged(item?.getId?.()) ? NEW_CHARGES : 0;
  }

  function usedOf(item) {
    const value = Number(saved(item)?.used);
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }

  function progressOf(item) {
    return Math.min(100, Math.floor(usedOf(item) / config.usedPerPercent));
  }

  /** Stores the count and swaps between the charged and inactive form to match. */
  function store(item, charges, used) {
    item.setMetaValue(config.chargesKey, { charges, used });
    const id = item.getId();
    if (charges > 0 && chargedByInactive.has(id)) item.setId(chargedByInactive.get(id));
    if (charges <= 0 && inactiveByCharged.has(id)) item.setId(inactiveByCharged.get(id));
  }

  function refresh(player) {
    player.getInventory().refreshItems();
    player.getEquipment().refreshItems();
    core.BonusManager.update(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
    core.WeaponInterfaceManager.assign(player);
  }

  /** The worn weapon pays for the shot or swing; the last charge turns it inactive. */
  function useCharge(player) {
    const item = weaponOf(player);
    if (!item || !isCharged(item.getId())) return;
    // Content may spare the charge (a league relic): the question every charged weapon asks.
    // `extra`: charges given back on top (Demonic Pacts' Regenerate above 100%), up to 20,000.
    const consume = { player, itemId: item.getId(), skip: false, extra: 0 };
    api.emitCustomEvent("combat:consume-charge", consume);
    if (consume.skip) {
      if (consume.extra > 0) store(item, Math.min(MAX_CHARGES, chargesOf(item) + consume.extra), usedOf(item));
      return;
    }
    const left = Math.max(0, chargesOf(item) - 1);
    if (left === 0) {
      // The shot or swing is rolled with the charged bonuses; the weapon turns inactive after it.
      item.setMetaValue(config.chargesKey, { charges: 0, used: usedOf(item) + 1 });
      spent.set(player, item);
      return;
    }
    store(item, left, usedOf(item) + 1);
  }

  /** The last charge's attack is over: the emptied weapon becomes its inactive form. */
  function onAttackFinished({ attacker }) {
    const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
    const item = player ? spent.get(player) : null;
    if (!item) return;
    spent.delete(player);
    if (isCharged(item.getId()) && chargesOf(item) === 0) {
      store(item, 0, usedOf(item));
      refresh(player);
    }
  }

  function check({ player, item }) {
    if (!item || !isCharged(item.getId())) return false;
    const charges = chargesOf(item).toLocaleString("en-US");
    player.sendMessage(`Your ${config.name} has ${charges} charges remaining, and ${progressOf(item)}% progress towards corruption.`);
    return true;
  }

  /** Each shard is 100 charges, as many as fit under the cap. */
  function addShards(event) {
    const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
    const weapon = isWeapon(usedItemId) ? usedItem : isWeapon(usedWithItemId) ? usedWithItem : null;
    const shards = weapon === usedItem ? usedWithItem : usedItem;
    if (!weapon || !shards) return;
    const inventory = player.getInventory();
    const room = Math.floor((MAX_CHARGES - chargesOf(weapon)) / CHARGES_PER_SHARD);
    event.handled = true;
    if (room < 1) {
      player.sendMessage(`Your ${config.name} cannot hold any more charges.`);
      return;
    }
    const used = Math.min(room, inventory.getAmount(shards.getId()));
    inventory.deleteNumber(shards.getId(), used);
    store(weapon, chargesOf(weapon) + used * CHARGES_PER_SHARD, usedOf(weapon));
    refresh(player);
    player.sendMessage(`You add ${used.toLocaleString("en-US")} crystal shard${used === 1 ? "" : "s"} to your ${config.name}.`);
  }

  function attach() {
    api.onCustomEvent("combat:attack-finished", onAttackFinished);
    api.onItemAction(config.chargedName, { Check: check });
    api.onItemOnItem(SHARD_NAME, config.chargedName, addShards, { noted: false });
    api.onItemOnItem(SHARD_NAME, config.inactiveName, addShards, { noted: false });
  }

  return { attach, useCharge, onAttackFinished, check, addShards, chargesOf, progressOf, isCharged, isWeapon, weaponOf };
}

module.exports = { defineCrystalWeapon, NEW_CHARGES, MAX_CHARGES, CHARGES_PER_SHARD };
