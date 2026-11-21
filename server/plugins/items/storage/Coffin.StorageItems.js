/**
 * Coffins (https://oldschool.runescape.wiki/w/Broken_coffin, Bronze/Steel/Black/Silver/Gold coffin;
 * docs/storage-items.md): a broken coffin from Dampe becomes a bronze, steel, black, silver or gold
 * coffin when he fits locks, storing 3, 8, 14, 20 or 28 shade remains. Options are Fill, Wear,
 * Configure (Check Shade Count, Open/Close, Remove lock), Empty and Destroy. An open coffin also
 * takes picked-up remains. Only one coffin can be owned, so the contents live in one store.
 *
 * Dampe's transcript gives the words; the hand-outs and the lock fitting are here. Fill, Empty,
 * Check, Open/Close and Remove-lock wording is ours (not captured).
 */
const Storage = require("./Common.StorageItems");

const BROKEN = "Broken coffin";
const LOCK_TIERS = [
  { metal: "bronze", lock: "Bronze locks", closed: "Bronze coffin", open: "Open bronze coffin", capacity: 3, lockGameval: "shades_lock_bronze", closedGameval: "shades_coffin_bronze", openGameval: "shades_coffin_bronze_open" },
  { metal: "steel", lock: "Steel locks", closed: "Steel coffin", open: "Open steel coffin", capacity: 8, lockGameval: "shades_lock_steel", closedGameval: "shades_coffin_steel", openGameval: "shades_coffin_steel_open" },
  { metal: "black", lock: "Black locks", closed: "Black coffin", open: "Open black coffin", capacity: 14, lockGameval: "shades_lock_black", closedGameval: "shades_coffin_black", openGameval: "shades_coffin_black_open" },
  { metal: "silver", lock: "Silver locks", closed: "Silver coffin", open: "Open silver coffin", capacity: 20, lockGameval: "shades_lock_silver", closedGameval: "shades_coffin_silver", openGameval: "shades_coffin_silver_open" },
  { metal: "gold", lock: "Gold locks", closed: "Gold coffin", open: "Open gold coffin", capacity: 28, lockGameval: "shades_lock_gold", closedGameval: "shades_coffin_gold", openGameval: "shades_coffin_gold_open" },
];
const BROKEN_GAMEVAL = "shades_coffin_broken";
const TIER_BY_COFFIN = new Map(LOCK_TIERS.flatMap((tier, index) => [[tier.closed, index], [tier.open, index]]));
const NAMES = [BROKEN, ...LOCK_TIERS.flatMap((tier) => [tier.closed, tier.open])];
const OPEN_NAMES = LOCK_TIERS.map((tier) => tier.open);
const MESSAGE = {
  EMPTY: "Your coffin is empty.",
  FULL: "Your coffin is full.",
  NOTHING: "You have no shade remains to put in the coffin.",
  OPENED: "You open the coffin.",
  CLOSED: "You close the coffin.",
  NO_ROOM: "You don't have enough inventory space to remove the lock.",
  BETTER_LOCK: "That lock is no better than the one already on your coffin.",
  REMOVED: "You remove the lock from the coffin. Any shade remains inside are lost.",
  CONFIGURE: "How would you like to configure your coffin?",
  REMOVE_CONFIRM: "Are you sure you want to remove the lock? Any shade remains stored will be lost.",
  HANDED: "You hand over the coffin and lock to Dampe.",
  FITTED: "You hear him clumsily attach the lock to the coffin.",
  FINISHED: "Finished, take it.",
};

let remains = null;

/** Every shade-remains id, weakest first (shade_bones1..6). */
function remainsIds() {
  if (remains) return remains;
  remains = ["shade_bones1", "shade_bones2", "shade_bones3", "shade_bones4", "shade_bones5", "shade_bones6"]
    .map((name) => Storage.core.CacheDefinitions.getObjId(name));
  return remains;
}

function nameOf(id) {
  return Storage.itemName(id);
}

/** A cache gameval's item id, read when used (the unit may load before the cache). */
function objId(gameval) {
  return Storage.core.CacheDefinitions.getObjId(gameval);
}

function tierOfName(name) {
  const tier = TIER_BY_COFFIN.get(name);
  return tier === undefined ? null : tier;
}

function tierOfCoffin(player) {
  const coffin = Storage.carried(player, family)[0];
  return coffin ? tierOfName(nameOf(coffin.getId())) : null;
}

function capacity(player) {
  const tier = tierOfCoffin(player);
  return tier === null ? 0 : LOCK_TIERS[tier].capacity;
}

const family = {
  key: "coffin",
  names: NAMES,
  pairs: LOCK_TIERS.map((tier) => [tier.closedGameval, tier.openGameval]),
  openNames: OPEN_NAMES,
  worn: true,
  accepts: (id) => remainsIds().includes(id),
  room: (player, _id, held) => Math.max(0, capacity(player) - held.reduce((sum, entry) => sum + entry.amount, 0)),
  gathers: (player) => Storage.hasOpen(player, family),
};

function fill({ player }) {
  if (capacity(player) === 0) return;
  if (Storage.total(player, family) >= capacity(player)) {
    player.sendMessage(MESSAGE.FULL);
    return;
  }
  const held = Storage.inventoryIds(player).filter(family.accepts);
  if (!held.length) {
    player.sendMessage(MESSAGE.NOTHING);
    return;
  }
  let moved = 0;
  for (const id of held) moved += Storage.fillFrom(player, family, id);
  if (moved === 0) player.sendMessage(MESSAGE.FULL);
}

function check({ player }) {
  const count = Storage.total(player, family);
  player.sendMessage(count === 0 ? MESSAGE.EMPTY : `Your coffin is currently holding ${count} shade remains.`);
}

/** Wiki: Empty withdraws the highest-tier remains first. */
function empty({ player }) {
  if (Storage.total(player, family) === 0) {
    player.sendMessage(MESSAGE.EMPTY);
    return;
  }
  const ordered = remainsIds()
    .map((id) => ({ id, amount: Storage.amountOf(player, family, id) }))
    .filter((entry) => entry.amount > 0)
    .reverse();
  Storage.setContents(player, family, ordered);
  Storage.emptyToInventory(player, family);
}

function toggle({ player, item }) {
  Storage.toggle(player, family, item);
  player.sendMessage(Storage.isOpen(family, item) ? MESSAGE.OPENED : MESSAGE.CLOSED);
}

/** Removes the lock: the coffin becomes broken and its remains are lost (Wiki, Configure). */
function removeLock(player) {
  const coffin = Storage.carried(player, family)[0];
  const tier = coffin ? tierOfName(nameOf(coffin.getId())) : null;
  if (!coffin || tier === null) return;
  const lockId = objId(LOCK_TIERS[tier].lockGameval);
  const brokenId = objId(BROKEN_GAMEVAL);
  const equippedSlot = player.getEquipment().getItems().indexOf(coffin);
  const needed = new Storage.core.Item(lockId, 1);
  const broken = new Storage.core.Item(brokenId, 1);
  if (player.getInventory().getAddableAmount(needed) < 1
    || (equippedSlot >= 0 && player.getInventory().getAddableAmount(broken) < 1)) {
    player.sendMessage(MESSAGE.NO_ROOM);
    return;
  }
  // A worn coffin comes off first; a broken coffin cannot be worn.
  if (equippedSlot >= 0) {
    player.getEquipment().setItem(equippedSlot, new Storage.core.Item(-1, 0));
    player.getInventory().add(broken, false);
  } else {
    coffin.setId(brokenId);
  }
  Storage.setContents(player, family, []);
  player.getInventory().add(needed, false);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  player.sendMessage(MESSAGE.REMOVED);
}

function configure({ player }) {
  const tier = tierOfCoffin(player);
  if (tier === null) return;
  const item = Storage.carried(player, family)[0];
  const stillOpen = item ? Storage.isOpen(family, item) : false;
  const options = [
    "Check Shade Count", () => check({ player }),
    stillOpen ? "Close Coffin" : "Open Coffin", () => toggle({ player, item }),
    "Remove lock", () => confirmRemoveLock(player),
    "Cancel", () => {},
  ];
  api.sendMultiChatboxPrompt(player, MESSAGE.CONFIGURE, ...options);
}

function confirmRemoveLock(player) {
  api.sendMultiChatboxPrompt(player, MESSAGE.REMOVE_CONFIRM,
    "Yes", () => removeLock(player),
    "No", () => {});
}

/** The best upgrade lock the player carries, or null. */
function bestLock(player) {
  let best = null;
  for (const [index, tier] of LOCK_TIERS.entries()) {
    if (player.getInventory().getAmount(objId(tier.lockGameval)) < 1) continue;
    if (!best || index > best.index) best = { index, id: objId(tier.lockGameval) };
  }
  return best;
}

function carriedLockIds(player) {
  return LOCK_TIERS.map((tier) => objId(tier.lockGameval)).filter((id) => player.getInventory().getAmount(id) > 0);
}

/** Fits the best carried lock to the carried coffin. Returns whether anything changed. */
function fitLock(player) {
  const coffin = Storage.carried(player, family)[0];
  if (!coffin) return false;
  const current = nameOf(coffin.getId()) === BROKEN ? -1 : tierOfName(nameOf(coffin.getId()));
  const lock = bestLock(player);
  if (current === null || !lock) return false;
  if (current > 0 && lock.index <= current) {
    player.sendMessage(MESSAGE.BETTER_LOCK);
    return false;
  }
  coffin.setId(objId(LOCK_TIERS[lock.index].closedGameval));
  player.getInventory().deleteNumber(lock.id, 1);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
  return true;
}

/** Whether the player owns `id` in the inventory, equipment or bank (Wiki: one coffin at a time). */
function ownsItem(player, id) {
  if (player.getInventory().getAmount(id) > 0) return true;
  if (player.getEquipment().getItems().some((item) => item?.getId?.() === id)) return true;
  const { Bank } = Storage.core;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if ((player.getBank?.(tab)?.getAmount?.(id) ?? 0) > 0) return true;
  }
  return false;
}

function ownsCoffin(player) {
  return Storage.owns(player, family) || ownsItem(player, objId(BROKEN_GAMEVAL));
}

function ownsBrokenCoffin(player) {
  return ownsItem(player, objId(BROKEN_GAMEVAL));
}

function handOutBroken(player) {
  const id = objId(BROKEN_GAMEVAL);
  if (player.getInventory().getAddableAmount(new Storage.core.Item(id, 1)) < 1) {
    player.getInventory().full?.();
    return false;
  }
  player.getInventory().add(new Storage.core.Item(id, 1), false);
  player.getInventory().refreshItems();
  return true;
}

let dampeId = null;
const DAMPE_INTRODUCED = "shades-of-mortton:dampe-introduced";

function isDampe(npcId) {
  return npcId === dampeId;
}

function dampeVariant({ player, npcId }) {
  if (!isDampe(npcId)) return null;
  if (player.getAttribute(DAMPE_INTRODUCED) === true || ownsCoffin(player)) return "subsequent-dialogue";
  return "initial-dialogue";
}

function dampeCondition({ player, npcId, text }) {
  if (!isDampe(npcId)) return null;
  const locks = carriedLockIds(player).length > 0;
  switch (text) {
    case "If the player has no locks in their inventory:": return !locks;
    case "If the player has locks in their inventory:": return locks;
    case "If the player does not have a broken coffin:": return !ownsBrokenCoffin(player);
    case "If the player has a broken coffin:": return ownsBrokenCoffin(player);
    case "If the player already has one:": return ownsCoffin(player);
    case "If the player does not have one:": return !ownsCoffin(player);
    default: return null;
  }
}

/** The transcript's message steps: the broken-coffin hand-out and the lock hand-over. */
function dampeAction(action) {
  if (action.kind !== "message" || !isDampe(action.npcId)) return;
  if (action.text === "Dampe hands you a broken coffin.") {
    action.handled = true;
    if (ownsCoffin(action.player) || !handOutBroken(action.player)) return;
    action.box = { items: [objId(BROKEN_GAMEVAL)] };
    action.player.setAttribute(DAMPE_INTRODUCED, true);
    return;
  }
  if (action.text === MESSAGE.HANDED) {
    action.handled = true;
    fitLock(action.player);
  }
}

function isCoffinName(name) {
  return NAMES.includes(name);
}

/** Dampe's own "Locks" option: the same hand-in his item-on-NPC transcript plays. */
function dampeLocks(event) {
  const { player, target, npcId } = event;
  let variant;
  if (!ownsCoffin(player)) {
    variant = "using-locks-on-dampe-without-a-broken-coffin";
  } else if (carriedLockIds(player).length === 0) {
    variant = "using-broken-coffin-on-dampe-without-locks";
  } else {
    variant = "using-locks-on-dampe-with-a-broken-coffin";
  }
  api.emitCustomEvent("npc-dialogue:start", { player, npc: target, npcId, variant, exact: true });
}

/** Item on Dampe: his transcript has a variant for each hand-in. */
function dampeItem(event) {
  if (!isDampe(event.npcId)) return;
  const used = nameOf(event.item?.getId?.());
  if (!isCoffinName(used) && !LOCK_TIERS.some((tier) => nameOf(objId(tier.lockGameval)) === used)) return;
  const lock = LOCK_TIERS.findIndex((tier) => nameOf(objId(tier.lockGameval)) === used);
  let variant;
  if (lock >= 0) {
    variant = ownsCoffin(event.player) ? "using-locks-on-dampe-with-a-broken-coffin" : "using-locks-on-dampe-without-a-broken-coffin";
  } else if (carriedLockIds(event.player).length === 0) {
    variant = "using-broken-coffin-on-dampe-without-locks";
  } else {
    // The transcript's Yes jumps "above"; the prompt and hand-over are kept, the jump is not.
    event.handled = true;
    api.sendMultiChatboxPrompt(event.player, "Give Dampe a lock?",
      "Yes", () => {
        if (!fitLock(event.player)) return;
        event.player.sendMessage(MESSAGE.HANDED);
        event.player.sendMessage(MESSAGE.FITTED);
        event.player.sendMessage(MESSAGE.FINISHED);
      },
      "No", () => {});
    return;
  }
  event.handled = true;
  api.emitCustomEvent("npc-dialogue:start", { player: event.player, npc: event.target, npcId: event.npcId, variant, exact: true });
}

function useOnCoffin(event) {
  const { player, usedItem, usedWithItem } = event;
  const coffin = [usedItem, usedWithItem].find((item) => family.names.includes(nameOf(item?.getId?.())));
  if (!coffin) return;
  event.handled = true;
  fill({ player });
}

function pickup(event) {
  Storage.pickupInto(event, (player, itemId) => {
    if (!family.accepts(itemId)) return null;
    return Storage.hasOpen(player, family) ? { family, message: "You put the remains straight into your open coffin." } : null;
  });
}

let api = null;

module.exports = (pluginApi) => {
  api = pluginApi;
  Storage.register(family);
  dampeId = Storage.core.CacheDefinitions.getNpcId("shades_coffin_keeper");
  api.persistAttribute(DAMPE_INTRODUCED, false);
  for (const name of NAMES.filter((name) => name !== BROKEN)) {
    api.onItemAction(name, { Fill: fill, Configure: configure, Empty: empty, Open: toggle, Close: toggle });
  }
  api.onItemOnItem(useOnCoffin);
  api.onGroundItemPickup(pickup);
  api.onNpcDialogueVariant(dampeVariant);
  api.onNpcDialogueCondition(dampeCondition);
  api.onNpcInteraction("Dampe", { Locks: dampeLocks });
  api.onCustomEvent("npc-dialogue:action", dampeAction);
  api.onItemOnNpc(dampeItem);
};

Object.assign(module.exports, {
  BROKEN, LOCK_TIERS, MESSAGE, family,
  _test: { remainsIds, tierOfName, tierOfCoffin, capacity, check, fitLock, removeLock, ownsCoffin, ownsBrokenCoffin, handOutBroken, bestLock, dampeCondition, dampeAction, dampeLocks },
});
