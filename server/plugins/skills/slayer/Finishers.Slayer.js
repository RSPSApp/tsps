"use strict";

/**
 * Finishing items (data/slayer-finishers.json): gargoyles, rockslugs, desert lizards and
 * zygomites stay alive at 0 hitpoints until an item finishes them (used on them at or below
 * the threshold). With the matching unlock (Gargoyle Smasher, Slug Salter, Reptile Freezer,
 * 'Shroom Sprayer) and the item in the inventory, the killing hit does it on its own; a brine
 * sabre kills rockslugs outright. Fungicide refills a spray.
 */
const DATA = require("../data/slayer-finishers.json");
const Tasks = require("./Tasks.Slayer");

/** Set on an NPC an item has finished, so its death goes ahead. */
const FINISHED_ATTRIBUTE = "slayer:finished";

let core = null;
const byName = new Map();
const items = new Map();

function init(api) {
  core = api.core;
  for (const finisher of DATA.finishers) {
    for (const name of finisher.names) byName.set(name, finisher);
    for (const id of [...(finisher.items ?? []), ...(finisher.consumed ?? []), ...(finisher.sprays ?? []), finisher.emptySpray]) {
      if (id != null) items.set(id, finisher);
    }
  }
}

function npcName(npc) {
  return (npc?.getCurrentDefinition?.() ?? npc?.getDefinition?.())?.getName?.() ?? "";
}

function finisherFor(npc) {
  return byName.get(npcName(npc)) ?? null;
}

/** The item in the inventory that finishes this monster: { id, consumed, spray }, or null. */
function carried(player, finisher) {
  const inventory = player.getInventory();
  const find = (ids, kind) => ids?.find((id) => inventory.contains(id)) != null
    ? { id: ids.find((id) => inventory.contains(id)), kind } : null;
  return find(finisher.items, "tool") ?? find(finisher.consumed, "consumed") ?? find(finisher.sprays, "spray");
}

/** Uses up what the finish costs: a consumed item, or a spray's charge. */
function spend(player, finisher, item) {
  const inventory = player.getInventory();
  if (item.kind === "consumed") {
    inventory.deleteNumber(item.id, 1);
  } else if (item.kind === "spray") {
    const slot = inventory.getSlotForItemId(item.id);
    const next = finisher.sprays[finisher.sprays.indexOf(item.id) + 1] ?? finisher.emptySpray;
    inventory.setItem(slot, new core.Item(next, 1)).refreshItems();
  }
}

function finish(player, npc, finisher, item) {
  spend(player, finisher, item);
  if (finisher.animation) player.performAnimation(new core.Animation(finisher.animation));
  player.sendMessage(finisher.finished);
  npc.setAttribute?.(FINISHED_ATTRIBUTE, true);
  npc.setHitpoints(0);
}

function wieldsAny(player, ids) {
  const weapon = player.getEquipment?.()?.getItems?.()?.[core.Equipment.WEAPON_SLOT];
  return weapon != null && ids?.includes(weapon.getId());
}

/** At 0 hitpoints: finished by an item, the autokill unlock, a brine sabre, or kept alive. */
function beforeDeath(event) {
  const { npc } = event;
  const finisher = finisherFor(npc);
  if (!finisher || npc.getAttribute?.(FINISHED_ATTRIBUTE) === true) return;
  const player = npc.getCombat?.()?.getKiller?.(false);
  if (player && wieldsAny(player, finisher.weapons)) return;
  if (player && Tasks.hasUnlockBit(player, finisher.unlockBit)) {
    const item = carried(player, finisher);
    if (item) {
      spend(player, finisher, item);
      player.sendMessage(finisher.finished);
      return;
    }
  }
  event.preventDeath = true;
  if (player && finisher.lastLegs && npc.getAttribute?.(LAST_LEGS_ATTRIBUTE) !== true) {
    npc.setAttribute?.(LAST_LEGS_ATTRIBUTE, true);
    player.sendMessage(finisher.lastLegs);
  }
}

const LAST_LEGS_ATTRIBUTE = "slayer:last-legs";

/** Using a finishing item on its monster. */
function itemOnNpc(event) {
  const finisher = items.get(event.itemId);
  if (!finisher || finisherFor(event.target) !== finisher) return;
  event.handled = true;
  const { player, target } = event;
  if (event.itemId === finisher.emptySpray) {
    player.sendMessage(finisher.empty);
    return;
  }
  if (target.getHitpoints() > finisher.threshold) {
    player.sendMessage(finisher.tooStrong);
    return;
  }
  const item = { id: event.itemId, kind: finisher.sprays?.includes(event.itemId) ? "spray" : finisher.consumed?.includes(event.itemId) ? "consumed" : "tool" };
  finish(player, target, finisher, item);
}

/** Fungicide on a spray: a full spray. */
function refill(event) {
  const ids = [event.usedItemId, event.usedWithItemId];
  if (!ids.includes(DATA.fungicide)) return;
  const zygomite = DATA.finishers.find((finisher) => finisher.sprays);
  const spray = ids.find((id) => id === zygomite.emptySpray || zygomite.sprays.includes(id));
  if (spray == null || spray === zygomite.sprays[0]) return;
  event.handled = true;
  const inventory = event.player.getInventory();
  inventory.deleteNumber(DATA.fungicide, 1);
  inventory.setItem(inventory.getSlotForItemId(spray), new core.Item(zygomite.sprays[0], 1)).refreshItems();
}

function attach(api) {
  api.onNpcBeforeDeath(beforeDeath);
  api.onItemOnNpc(itemOnNpc);
  api.onItemOnItem(refill);
}

module.exports = { init, attach, beforeDeath, itemOnNpc, refill, FINISHED_ATTRIBUTE };
