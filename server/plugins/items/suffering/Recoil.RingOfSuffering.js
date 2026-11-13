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
const MAX_CHARGES = 100000;
const CHARGES_PER_RECOIL = 40;
const CHARGES_META_KEY = "ring-of-suffering:charges";
const LEGACY_CHARGES_META_KEY = "ring-of-suffering";
const DISABLED_ATTRIBUTE = "ring-of-suffering:recoil-disabled";

let core = null;
let recoilIds = new Set();
let baseByRecoil = new Map();
let recoilByBase = new Map();

function charges(item) {
  const saved = Number(item.getMetaValue?.(CHARGES_META_KEY) ?? item.getMetaValue?.(LEGACY_CHARGES_META_KEY));
  return Number.isFinite(saved) ? Math.max(0, Math.min(MAX_CHARGES, Math.floor(saved))) : 0;
}

// Retain existing saved rings, migrating their key when their charges change.
function setCharges(item, value) {
  item.setMetaValue(CHARGES_META_KEY, value);
  item.setMetaValue(LEGACY_CHARGES_META_KEY, undefined);
}

function wornRing(player) {
  const item = player?.getEquipment?.()?.get?.(core.Equipment.RING_SLOT);
  return item && recoilIds.has(Number(item.getId?.() ?? -1)) ? item : null;
}

function refresh(player) {
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function useCharges(player, item, spent) {
  const left = charges(item) - spent;
  if (left > 0) {
    setCharges(item, left);
    return;
  }
  item.setId(baseByRecoil.get(item.getId()));
  setCharges(item, undefined);
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
  if (!core.CombatFactory.canReceiveRecoil(attacker)) return;
  const recoil = Math.min(Math.floor(damage / 10) + 1, charges(ring));
  if (recoil <= 0) {
    return;
  }
  attacker.getCombat?.().getHitQueue().addPendingDamage([
    new core.HitDamage(recoil, core.HitMask.RED).markReflected().setOrigin("recoil").setSource(player),
  ]);
  useCharges(player, ring, recoil);
}

// rsprox (15 recordings): "Your ring currently has N recoil charges remaining. The recoil effect is currently enabled."
function checkCharges({ player, item }) {
  const state = player.getAttribute?.(DISABLED_ATTRIBUTE) === true ? "disabled" : "enabled";
  player.sendMessage(`Your ring currently has ${charges(item).toLocaleString("en-US")} recoil charges remaining. The recoil effect is currently ${state}.`);
}

function chargeRing(event) {
  const { player, usedItem, usedWithItem, usedItemId, usedWithItemId } = event;
  const recoilId = core.ItemIdentifiers.RING_OF_RECOIL;
  const usedIsRecoil = core.ItemDefinition.forId(usedItemId).unNote() === recoilId;
  const otherIsRecoil = core.ItemDefinition.forId(usedWithItemId).unNote() === recoilId;
  if (!usedIsRecoil && !otherIsRecoil) return false;
  const ring = usedIsRecoil ? usedWithItem : usedItem;
  const consumedId = usedIsRecoil ? usedItemId : usedWithItemId;
  const ringId = Number(ring?.getId?.() ?? -1);
  if (!baseByRecoil.has(ringId) && !recoilByBase.has(ringId)) {
    return false;
  }
  event.handled = true;
  if (MAX_CHARGES - charges(ring) < CHARGES_PER_RECOIL) {
    player.sendMessage("Your ring of suffering cannot hold any more charges.");
    return;
  }
  // rsprox 237/01150.txt:596557-596596: with several rings held, "How many rings do you wish to use?", then
  // "You load your ring with 106 rings of recoil. It now has 4,240 recoil charges." One ring loads straight away.
  const held = Number(player.getInventory().getAmount?.(consumedId) ?? 1);
  if (held > 1) {
    player.setEnteredAmountAction?.({ execute: (count) => loadRings(player, ring, consumedId, Math.floor(Number(count) || 0)) });
    player.getPacketSender().sendEnterAmountPrompt("How many rings do you wish to use?");
    return;
  }
  loadRings(player, ring, consumedId, 1);
}

function loadRings(player, ring, consumedId, wanted) {
  const ringId = Number(ring?.getId?.() ?? -1);
  if (!baseByRecoil.has(ringId) && !recoilByBase.has(ringId)) return;
  const held = Number(player.getInventory().getAmount?.(consumedId) ?? 1);
  const count = Math.min(wanted, held, Math.floor((MAX_CHARGES - charges(ring)) / CHARGES_PER_RECOIL));
  if (count < 1) return;
  player.getInventory().deleteNumber(consumedId, count);
  player.setAttribute(core.CombatFactory.RECOIL_DAMAGE_ATTRIBUTE, 0);
  if (recoilByBase.has(ringId)) {
    ring.setId(recoilByBase.get(ringId));
  }
  setCharges(ring, charges(ring) + count * CHARGES_PER_RECOIL);
  refresh(player);
  player.sendMessage(`You load your ring with ${count.toLocaleString("en-US")} ring${count === 1 ? "" : "s"} of recoil. It now has ${charges(ring).toLocaleString("en-US")} recoil charges.`);
}

function toggleRecoil({ player, item }) {
  const disabled = player.getAttribute?.(DISABLED_ATTRIBUTE) === true;
  player.setAttribute?.(DISABLED_ATTRIBUTE, !disabled);
  // rsprox: "You enable the recoil effect of your ring." / "You disable the recoil effect of your ring."
  player.sendMessage(`You ${disabled ? "enable" : "disable"} the recoil effect of your ring.`);
  void item;
}

function discharge({ player, item }) {
  item.setId(baseByRecoil.get(item.getId()) ?? item.getId());
  setCharges(item, undefined);
  refresh(player);
  player.sendMessage("You discharge the ring of suffering; the stored rings are lost.");
  return true;
}

function attach(api) {
  core = api.core;
  const I = core.ItemIdentifiers;
  baseByRecoil = new Map([
    [I.RING_OF_SUFFERING_R_, I.RING_OF_SUFFERING],
    [I.RING_OF_SUFFERING_RI_, I.RING_OF_SUFFERING_I_],
    [I.RING_OF_SUFFERING_RI__3, I.RING_OF_SUFFERING_I__3],
    [I.RING_OF_SUFFERING_RI__5, I.RING_OF_SUFFERING_I__5],
  ]);
  recoilByBase = new Map([...baseByRecoil].map(([recoil, base]) => [base, recoil]));
  recoilIds = new Set(baseByRecoil.keys());
  api.persistAttribute(DISABLED_ATTRIBUTE, false);
  api.onCombatHitResolved(onHitResolved);
  api.onItemAction("Ring of suffering (r)", { Check: checkCharges, "Recoil settings": toggleRecoil, "Recoil Settings": toggleRecoil, Discharge: discharge });
  api.onItemAction("Ring of suffering (ri)", { Check: checkCharges, "Recoil settings": toggleRecoil, "Recoil Settings": toggleRecoil, Discharge: discharge });
  api.onItemOnItem("Ring of recoil", "Ring of suffering", chargeRing);
  api.onItemOnItem("Ring of recoil", "Ring of suffering (i)", chargeRing);
  api.onItemOnItem("Ring of recoil", "Ring of suffering (r)", chargeRing);
  api.onItemOnItem("Ring of recoil", "Ring of suffering (ri)", chargeRing);
}

module.exports = attach;
module.exports._test = { charges, wornRing, useCharges, onHitResolved, chargeRing, loadRings, discharge, MAX_CHARGES };
