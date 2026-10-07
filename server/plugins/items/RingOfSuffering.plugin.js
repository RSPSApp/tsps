/**
 * Ring of suffering (https://oldschool.runescape.wiki/w/Ring_of_suffering).
 *
 * Charged with rings of recoil (40 charges each, 100,000 max), becoming the
 * ring of suffering (r); the imbued variants become (ri). While worn and not
 * toggled off, it recoils like a ring of recoil - 10% + 1 of each damaging hit,
 * rounded down, when the hit lands - and a charge is a point of recoil damage,
 * as a ring of recoil's 40 are; the last recoil deals only what is left.
 * Discharging the ring loses the stored rings. The core ring of recoil leaves
 * these rings to this plugin.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");

const MAX_CHARGES = 100000;
const CHARGES_PER_RECOIL = 40;
const CHARGES_META_KEY = "ring-of-suffering";
const DISABLED_ATTRIBUTE = "ring-of-suffering:recoil-disabled";

let core = null;
let recoilIds = new Set();
let baseByRecoil = new Map();
let recoilByBase = new Map();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

function wornRing(player) {
  const item = player?.getEquipment?.()?.get?.(Equipment.RING_SLOT);
  return item && recoilIds.has(Number(item.getId?.() ?? -1)) ? item : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharges(player, item, spent) {
  const left = charges(item) - spent;
  if (left > 0) {
    item.setMetaValue(CHARGES_META_KEY, left);
    return;
  }
  item.setId(baseByRecoil.get(item.getId()));
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("Your ring of suffering has run out of charges.");
}

/** A landed hit on the wearer: recoil 10% + 1 of it, up to the charges left. */
function onHitResolved({ attacker, target, hit }) {
  if (!target?.isPlayer?.() || !attacker) {
    return;
  }
  const damage = Number(hit?.getTotalDamage?.() ?? 0);
  if (!(damage > 0)) {
    return;
  }
  const player = target.getAsPlayer();
  const ring = wornRing(player);
  if (!ring || player.getAttribute?.(DISABLED_ATTRIBUTE) === true) {
    return;
  }
  const recoil = Math.min(Math.floor(damage / 10) + 1, charges(ring));
  if (recoil <= 0) {
    return;
  }
  attacker.getCombat?.().getHitQueue().addPendingDamage([
    new HitDamage(recoil, HitMask.RED).markReflected().setSource(player),
  ]);
  useCharges(player, ring, recoil);
}

function checkCharges({ player, item }) {
  player.sendMessage(`Your ring of suffering has ${charges(item).toLocaleString("en-US")} charges left.`);
}

function chargeRing(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const otherIsRecoil = Number(usedItemId) === core.ItemIdentifiers.RING_OF_RECOIL ||
    Number(usedWithItemId) === core.ItemIdentifiers.RING_OF_RECOIL;
  if (!otherIsRecoil) {
    return;
  }
  const ring = Number(usedItemId) === core.ItemIdentifiers.RING_OF_RECOIL ? usedWithItem : usedItem;
  const ringId = Number(ring?.getId?.() ?? -1);
  if (!baseByRecoil.has(ringId) && !recoilByBase.has(ringId)) {
    return;
  }
  const room = MAX_CHARGES - charges(ring);
  if (room < CHARGES_PER_RECOIL) {
    player.sendMessage("Your ring of suffering cannot hold any more charges.");
    event.handled = true;
    return;
  }
  player.getInventory().deleteNumber(core.ItemIdentifiers.RING_OF_RECOIL, 1);
  if (recoilByBase.has(ringId)) {
    ring.setId(recoilByBase.get(ringId));
  }
  ring.setMetaValue(CHARGES_META_KEY, charges(ring) + CHARGES_PER_RECOIL);
  refresh(player);
  player.sendMessage("You add the ring of recoil to your ring of suffering.");
  event.handled = true;
}

function toggleRecoil({ player, item }) {
  const disabled = player.getAttribute?.(DISABLED_ATTRIBUTE) === true;
  player.setAttribute?.(DISABLED_ATTRIBUTE, !disabled);
  player.sendMessage(`The recoil effect is now ${disabled ? "enabled" : "disabled"}.`);
  void item;
}

function discharge({ player, item }) {
  item.setId(baseByRecoil.get(item.getId()) ?? item.getId());
  item.setMetaValue(CHARGES_META_KEY, undefined);
  refresh(player);
  player.sendMessage("You discharge the ring of suffering; the stored rings are lost.");
  return true;
}

module.exports = {
  name: "RingOfSuffering",
  members: true,
  _test: { charges, wornRing, useCharges, onHitResolved, chargeRing, discharge, MAX_CHARGES },
  register(api) {
    core = api.core;
    const I = core.ItemIdentifiers;
    baseByRecoil = new Map([
      [I.RING_OF_SUFFERING_R_, I.RING_OF_SUFFERING],
      [I.RING_OF_SUFFERING_RI_, I.RING_OF_SUFFERING_I_],
      [I.RING_OF_SUFFERING_RI__3, I.RING_OF_SUFFERING_I__3],
      [I.RING_OF_SUFFERING_RI__5, I.RING_OF_SUFFERING_I__5],
      [I.RING_OF_SUFFERING_RI__6, I.RING_OF_SUFFERING_I__6],
    ]);
    recoilByBase = new Map([...baseByRecoil].map(([recoil, base]) => [base, recoil]));
    recoilIds = new Set(baseByRecoil.keys());
    api.persistAttribute(DISABLED_ATTRIBUTE);
    api.onCombatHitResolved(onHitResolved);
    api.onItemAction((event) => {
      const isRecoil = recoilIds.has(event.itemId);
      const isBase = recoilByBase.has(event.itemId);
      if (!isRecoil && !isBase) {
        return;
      }
      const option = String(event.option ?? "").toLowerCase();
      if (option === "check") {
        event.handled = true;
        checkCharges(event);
      } else if (option.includes("recoil")) {
        event.handled = true;
        toggleRecoil(event);
      } else if (option === "discharge" && isRecoil) {
        event.handled = discharge(event);
      }
    });
    api.onItemOnItem(chargeRing, { noted: false });
  },
};
