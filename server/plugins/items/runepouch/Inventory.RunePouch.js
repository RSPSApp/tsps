/**
 * The pouch in the inventory (docs/rune-pouch.md): using a rune on it stores the whole stack
 * that fits, "Empty" puts every rune back in the inventory, and spells take the runes the
 * inventory is short of from it. Login sends the pouch's varbits, which the spellbook, the
 * pouch interface and the bank's pouch view all read.
 */
const Pouch = require("./Common.RunePouch");

/** Captured: no prompt, every rune of the stack that fits goes in on the same tick. */
function useRuneOnPouch(event) {
  const { player, usedItem, usedWithItem } = event;
  const pouch = Pouch.isPouch(usedItem) ? usedItem : Pouch.isPouch(usedWithItem) ? usedWithItem : null;
  const rune = pouch === usedItem ? usedWithItem : usedItem;
  if (!pouch || !Pouch.isRune(rune?.getId?.())) return;
  event.handled = true;
  if (!Pouch.isPlainRune(rune)) {
    player.sendMessage(Pouch.MESSAGE.PRESET);
    return;
  }
  const runeId = rune.getId();
  const inventory = player.getInventory();
  const moved = Pouch.store(player, runeId, Pouch.plainInInventory(player, runeId));
  if (moved <= 0) {
    player.sendMessage(Pouch.MESSAGE.CANT_HOLD);
    return;
  }
  Pouch.takeFromInventory(player, runeId, moved);
  inventory.refreshItems();
}

/**
 * Captured: every slot is cleared into the inventory. With the bank open, or with no room,
 * "It was not possible to empty the pouch." Runes with no room stay in the pouch.
 */
function empty({ player }) {
  const { Bank } = Pouch.core;
  if (Bank.isOpen(player)) {
    player.sendMessage(Pouch.MESSAGE.CANT_EMPTY);
    return true;
  }
  if (Pouch.isEmpty(player)) {
    player.sendMessage(Pouch.MESSAGE.EMPTY);
    return true;
  }
  let stuck = false;
  Pouch.slots(player).forEach((entry, slot) => {
    if (!entry) return;
    if (!Pouch.inventoryFits(player, entry.id, entry.amount)) {
      stuck = true;
      return;
    }
    const taken = Pouch.take(player, slot, entry.amount);
    Pouch.addToInventory(player, taken.id, taken.amount);
  });
  if (stuck) player.sendMessage(Pouch.MESSAGE.CANT_EMPTY);
  return true;
}

/** True when the carried pouch holds the whole shortfall the inventory could not cover. */
function checkSpellRunes(player, missingItems) {
  if (!Pouch.findPouch(player)) return false;
  return missingItems.every((item) => Pouch.amountOf(player, item.getId()) >= item.getAmount());
}

function consumeSpellRunes(player, missingItems) {
  if (!checkSpellRunes(player, missingItems)) return;
  for (const item of missingItems) Pouch.spend(player, item.getId(), item.getAmount());
}

/**
 * `magic:rune-refund` { player, runeId, amount, stored }: runes a spell gives back (a league's
 * Regenerate) go to the carried pouch's slot already holding that rune, up to 16,000, and `stored`
 * says how many. A full slot takes none; the caller places the rest. Ours: an empty slot is never
 * filled.
 */
function refundSpellRunes(refund) {
  const { player, runeId } = refund ?? {};
  const wanted = Math.max(0, Math.floor(refund?.amount ?? 0) - Math.max(0, refund?.stored | 0));
  if (!player || !(wanted > 0) || !Pouch.findPouch(player)) return;
  refund.stored = Math.max(0, refund.stored | 0) + Pouch.refill(player, runeId, wanted);
}

function login({ player }) {
  Pouch.login(player);
}

/** Physical rune supplies for non-spell costs; saved runes require a carried pouch.
 * `rune-pouch:supply` { player, runeIds, available, costs?, consumed? }.
 * A costs array is validated in full before anything is spent; callers spend their inventory
 * portion synchronously after consumed=true. Staff/infinite spell supplies never participate.
 */
function supplyRunes(request) {
  if (!request?.player || !Pouch.findPouch(request.player)) return;
  const usable = new Set(Pouch.slots(request.player).slice(0, Pouch.slotCount(request.player)).filter(Boolean).map((entry) => entry.id));
  const available = (id) => usable.has(id) ? Pouch.amountOf(request.player, id) : 0;
  request.available = Object.fromEntries((request.runeIds ?? []).map((id) => [id, available(id)]));
  if (!Array.isArray(request.costs) || request.consumed) return;
  const costs = new Map();
  for (const { id, amount } of request.costs) {
    if (!Pouch.isRune(id) || !Number.isInteger(amount) || amount < 0) return;
    costs.set(id, (costs.get(id) ?? 0) + amount);
  }
  if ([...costs].some(([id, amount]) => available(id) < amount)) return;
  for (const [id, amount] of costs) Pouch.spend(request.player, id, amount);
  request.consumed = true;
}

module.exports = function attach(api) {
  api.persistAttribute(Pouch.RUNES_ATTRIBUTE);
  api.persistAttribute(Pouch.SELECTED_QUANTITY_ATTRIBUTE);
  api.persistAttribute(Pouch.CUSTOM_QUANTITY_ATTRIBUTE);
  api.onPlayerLogin(login);
  api.onItemOnItem(useRuneOnPouch);
  for (const { name } of Pouch.POUCHES) api.onItemAction(name, { Empty: empty });
  api.registerSpellRuneSource({ check: checkSpellRunes, consume: consumeSpellRunes });
  api.onCustomEvent("magic:rune-refund", refundSpellRunes);
  api.onCustomEvent("rune-pouch:supply", supplyRunes);
};

module.exports._test = { useRuneOnPouch, empty, checkSpellRunes, consumeSpellRunes, refundSpellRunes };
