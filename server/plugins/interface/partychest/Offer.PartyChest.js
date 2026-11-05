/**
 * The party-drop chest screen: offer items from the inventory, take them back, confirm them into a
 * chest. Clan Halls and the Falador Party Room use the same cache screens (partydrop_main, group 265
 * or its clan hall twin 783, and the side inventory 266), so the flow is written once here and each
 * owner supplies its chest and its rules.
 *
 * What's offered and not yet confirmed is kept in the player's save, beside every change: only there
 * do the items still exist (they have left the inventory), and restoreOffer returns them at login.
 *
 * A chest that has to wait for a save before it takes the items (Falador's) confirms in two steps:
 * beginPending marks the offer, then settle ends it. While pending, nothing about the offer changes.
 */

const SIDE_GROUP = 266;
const OFFER_INV = 92; // partyroom_tempinv
const OFFER_SIZE = 8;
const MAX_STACK = 2147483647;
const LAST_INV_SLOT = 27;
const SIDE_MODAL = (161 << 16) | 74;
const OPS_1_TO_5 = 0b111110;
const OFFER_FLAGS_RANGE = OFFER_SIZE - 1;
/** Bits 14-15 of canoeing_menu are farming_tools_selectedquantity: 0 one, 1 five, 2 all, 3 X. */
const QUANTITY_VARP = 675;
const QUANTITY_SHIFT = 14;

/** What settleRestore answers for "leave the saved offer exactly as it is". */
const HOLD = Symbol("hold");

function invItems(items, size) {
  return Array.from({ length: size }, (_, slot) => {
    const item = items[slot];
    return item ? { id: item.id, amount: item.amount } : null;
  });
}

/**
 * The chest holds only an id and an amount, so an item with state is refused rather than stripped of
 * it: a preset's untradeable, unbankable and preset flags (Item.isTradeable checks the instance), or
 * a degrading item's charges.
 */
function fitsChest(item) {
  return item.isTradeable() && item.getMeta() == null;
}

/**
 * config:
 *   mainGroup, offerList, confirmComponent, chestInv, chestSize, offerAttribute: the screen and its saves;
 *   chestOf(context): the chest array, {id, amount} stacks;
 *   canDeposit(player, context): true, or says why not itself; canOpen? overrides it for opening;
 *   afterConfirm?(player, context, items): called once the items are in the chest;
 *   confirm?(player, state, tools): replaces the synchronous confirm;
 *   newConfirmId?(): the id a pending offer carries;
 *   serialize?(state) / settleRestore?(player, raw): the saved form of an offer, and what a login does
 *     with it: the items to return, or HOLD;
 *   restored?(player, raw, items): after a saved offer was settled and cleared in the player;
 *   welcome?: a message on opening.
 * A context is whatever the owner passes to open(): it's held and handed back, never inspected.
 */
function create(config) {
  const { mainGroup, offerList, confirmComponent, chestInv, chestSize, offerAttribute } = config;
  const mainModal = (161 << 16) | 16;
  const openChests = new Map();
  const selectedQuantity = new WeakMap();
  let core = null;

  function init(pluginApi, pluginCore) {
    core = pluginCore;
    pluginApi.persistAttribute(offerAttribute, config.serialize ? null : []);
  }

  function offerOf(player) {
    return openChests.get(player);
  }

  /** Beside every change to the offer, so no save can hold the inventory without the items. */
  function saveOffer(player, items, state) {
    const copy = items.map(({ id, amount }) => ({ id, amount }));
    player.setAttribute(offerAttribute, config.serialize ? config.serialize({ ...state, items: copy }) : copy);
  }

  /** After a restart or crash the offer is all that's left of the items: they go back at login. */
  function restoreOffer(player) {
    const raw = player.getAttribute(offerAttribute);
    const items = config.settleRestore ? config.settleRestore(player, raw) : (raw ?? []);
    if (items === HOLD) return;
    saveOffer(player, [], undefined);
    for (const { id, amount } of items) giveBack(player, id, amount);
    config.restored?.(player, raw, items);
  }

  /** What a saved offer holds, in either saved form. */
  function savedItems(raw) {
    return Array.isArray(raw) ? raw : (Array.isArray(raw?.items) ? raw.items : []);
  }

  /** Never lost: what doesn't fit in the inventory lands at the player's feet. */
  function giveBack(player, id, amount) {
    player.getInventory().forceAdd(player, new core.Item(id, amount));
  }

  function sendChest(player, context) {
    player.getPacketSender().sendInventory(chestInv, chestSize, invItems(config.chestOf(context), chestSize));
  }

  function sendOffer(player) {
    player.getPacketSender().sendInventory(OFFER_INV, OFFER_SIZE, invItems(offerOf(player)?.items ?? [], OFFER_SIZE));
  }

  /** Every screen showing this chest, after it changed. */
  function refreshViewers(chest) {
    for (const [viewer, open] of openChests) {
      if (!open.closed && config.chestOf(open.context) === chest) sendChest(viewer, open.context);
    }
  }

  function open(player, context) {
    // A pending offer still holds the player's items in its save: a reopen would overwrite it.
    if (offerOf(player)?.pending) {
      player.sendMessage("Your last donation is still being counted.");
      return;
    }
    // An offer held at login (its chest wasn't readable) is still the only record of those items: it is
    // settled before anything can be written over it.
    if (!offerOf(player) && savedItems(player.getAttribute(offerAttribute)).length > 0) {
      restoreOffer(player);
      if (savedItems(player.getAttribute(offerAttribute)).length > 0) {
        player.sendMessage("Your last donation can't be settled yet.");
        return;
      }
    }
    if (!(config.canOpen ?? config.canDeposit)(player, context)) return;
    close(player);
    openChests.set(player, { context, items: [], pending: false, closed: false, gone: false, confirmId: null });
    // Before the mount: partydrop_main_init sizes its rows from the inventories' capacity.
    sendChest(player, context);
    sendOffer(player);
    const sender = player.getPacketSender();
    // As the main interface, so "interface:closed" tells of it going by any route, walking away included.
    sender.sendInterface(mainGroup);
    sender.sendSubInterface(SIDE_MODAL, SIDE_GROUP, 3);
    sender.sendInterfaceFlagsRange((SIDE_GROUP << 16), 0, LAST_INV_SLOT, OPS_1_TO_5);
    sender.sendInterfaceFlagsRange((mainGroup << 16) | offerList, 0, OFFER_FLAGS_RANGE, OPS_1_TO_5);
    if (config.welcome) player.sendMessage(config.welcome);
  }

  /** Op 2 is one, 3 five, 4 X, 5 all; op 1 is whichever the screen has selected (partydrop_main_offeritems). */
  function amountFor(player, op, held, onAmount) {
    const selected = selectedQuantity.get(player) ?? 0;
    const choice = op === 1 ? [2, 3, 5, 4][selected] : op;
    if (choice === 2) onAmount(1);
    else if (choice === 3) onAmount(Math.min(5, held));
    else if (choice === 5) onAmount(held);
    else if (choice === 4) {
      player.setEnteredAmountAction({ execute: (amount) => onAmount(Math.min(amount, held)) });
      player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
    }
  }

  function offerableAmount(inventory, id) {
    return inventory.getItems().reduce((sum, item) => (item?.getId() === id && fitsChest(item) ? sum + item.getAmount() : sum), 0);
  }

  /** By slot, as inventory.delete(id) would take the first of that id, which could be a preset. */
  function removeOffered(inventory, id, amount, clickedSlot) {
    const fits = (item) => item?.getId() === id && fitsChest(item);
    let left = amount;
    while (left > 0) {
      const items = inventory.getItems();
      const slot = fits(items[clickedSlot]) ? clickedSlot : items.findIndex(fits);
      if (slot < 0) break;
      const taken = Math.min(left, items[slot].getAmount());
      inventory.deletedItem(new core.Item(id, taken), slot, false);
      left -= taken;
    }
    inventory.refreshItems();
    return amount - left;
  }

  function offer(player, slot, op) {
    const state = offerOf(player);
    const inventory = player.getInventory();
    const item = inventory.getItems()[slot];
    if (!state || state.pending || state.closed || !item || item.getId() < 0) return;
    const id = item.getId();
    if (!fitsChest(item)) {
      player.sendMessage("That item can't go in the chest.");
      return;
    }
    const held = offerableAmount(inventory, id);
    amountFor(player, op, held, (amount) => {
      if (offerOf(player) !== state || state.pending || state.closed || !config.canDeposit(player, state.context)) return;
      const stack = state.items.find((entry) => entry.id === id);
      const wanted = Math.min(amount, offerableAmount(inventory, id), MAX_STACK - (stack?.amount ?? 0));
      if (wanted <= 0 || (!stack && state.items.length >= OFFER_SIZE)) return;
      const moved = removeOffered(inventory, id, wanted, slot);
      if (stack) stack.amount += moved;
      else state.items.push({ id, amount: moved });
      saveOffer(player, state.items, state);
      sendOffer(player);
    });
  }

  function takeBack(player, slot, op) {
    const state = offerOf(player);
    const stack = state?.items[slot];
    if (!stack || state.pending || state.closed) return;
    amountFor(player, op, stack.amount, (amount) => {
      const moved = Math.min(amount, stack.amount);
      if (moved <= 0 || offerOf(player) !== state || state.pending || state.closed || !state.items.includes(stack)) return;
      giveBack(player, stack.id, moved);
      stack.amount -= moved;
      if (stack.amount === 0) state.items = state.items.filter((entry) => entry !== stack);
      saveOffer(player, state.items, state);
      sendOffer(player);
    });
  }

  function confirm(player) {
    const state = offerOf(player);
    if (!state || state.pending || state.closed || state.items.length === 0 || !config.canDeposit(player, state.context)) return;
    if (config.confirm) {
      config.confirm(player, state, tools);
      return;
    }
    const chest = config.chestOf(state.context);
    const stacks = new Set(chest.map((entry) => entry.id));
    for (const { id } of state.items) stacks.add(id);
    if (stacks.size > chestSize) {
      player.sendMessage("The chest can't hold that many different items.");
      return;
    }
    const held = (id) => chest.find((entry) => entry.id === id)?.amount ?? 0;
    if (state.items.some(({ id, amount }) => held(id) + amount > MAX_STACK)) {
      player.sendMessage("The chest can't hold any more of that.");
      return;
    }
    const confirmed = state.items;
    for (const { id, amount } of confirmed) {
      const stack = chest.find((entry) => entry.id === id);
      if (stack) stack.amount += amount;
      else chest.push({ id, amount });
    }
    state.items = [];
    saveOffer(player, [], state);
    sendOffer(player);
    refreshViewers(chest);
    config.afterConfirm?.(player, state.context, confirmed);
  }

  /** Anything not confirmed goes back to who offered it. A pending offer is left to its confirm. */
  function close(player, gone = false) {
    const state = offerOf(player);
    if (!state) return;
    if (state.pending) {
      // The items are in the saved offer, and a confirm is waiting on that save: it settles them.
      state.closed = true;
      state.gone = state.gone || gone;
      return;
    }
    openChests.delete(player);
    saveOffer(player, [], state);
    for (const { id, amount } of state.items) giveBack(player, id, amount);
  }

  /** The player logs out or is removed. */
  function playerGone(player) {
    close(player, true);
  }

  /** A confirm that waits for a save: the offer is marked pending, with the id the chest will record. */
  function beginPending(player, state) {
    if (offerOf(player) !== state || state.pending || state.closed || state.items.length === 0) return false;
    state.pending = true;
    state.confirmId = config.newConfirmId();
    saveOffer(player, state.items, state);
    return true;
  }

  /** Still the same offer, untouched, and its screen still up: the only case where the chest may take it. */
  function isCurrent(player, state, confirmId, snapshot) {
    return (
      offerOf(player) === state && state.pending && !state.closed && state.confirmId === confirmId &&
      state.items.length === snapshot.length &&
      state.items.every((entry, index) => entry.id === snapshot[index].id && entry.amount === snapshot[index].amount)
    );
  }

  /**
   * Every way a pending confirm ends. Taken: the chest has the items. Otherwise pending is cleared: an
   * open screen keeps the offer, a closed one gives the items back, and a player who is gone keeps it
   * in the save for restoreOffer.
   */
  function settle(player, state, taken) {
    state.pending = false;
    state.confirmId = null;
    if (taken) {
      state.items = [];
      saveOffer(player, [], state);
      if (!state.closed) sendOffer(player);
      refreshViewers(config.chestOf(state.context));
    } else if (!state.gone) {
      saveOffer(player, state.items, state);
    }
    if (state.closed && offerOf(player) === state) {
      openChests.delete(player);
      if (!state.gone) {
        const left = state.items;
        saveOffer(player, [], state);
        for (const { id, amount } of left) giveBack(player, id, amount);
      }
    }
    if (!state.gone) core.GameConstants.PLAYER_PERSISTENCE.requestSave(player, "party-chest");
  }

  const tools = { beginPending, isCurrent, settle, giveBack };

  /** The screens are main interfaces, so this hears them close by any route. */
  function interfaceClosed({ player, interfaceId }) {
    if (interfaceId === mainGroup) close(player);
  }

  /** A plugin can mount over the main modal without closing it. */
  function interfaceOpened({ player, targetUid, groupId }) {
    if (targetUid === mainModal && groupId !== mainGroup) close(player);
  }

  /** Marks the event handled when it belongs to this screen. */
  function click(event) {
    const { player, groupId, childId, slot, action } = event;
    if (groupId !== SIDE_GROUP && groupId !== mainGroup) return;
    // The side screen is shared by every chest: only the one this player has open answers it.
    if (groupId === SIDE_GROUP && !openChests.has(player)) return;
    event.handled = true;
    if (!player.getPacketSender().isSubInterfaceOpen(mainGroup)) {
      close(player);
      return;
    }
    if (groupId === SIDE_GROUP) {
      offer(player, slot, action);
    } else {
      if (childId === offerList) takeBack(player, slot, action);
      else if (childId === confirmComponent) confirm(player);
    }
  }

  function varpTransmitted(event) {
    if (event.varpId !== QUANTITY_VARP || !openChests.has(event.player)) return;
    selectedQuantity.set(event.player, (event.value >> QUANTITY_SHIFT) & 3);
    event.handled = true;
  }

  function reset() {
    openChests.clear();
  }

  return {
    init,
    open,
    close,
    playerGone,
    click,
    interfaceClosed,
    interfaceOpened,
    varpTransmitted,
    restoreOffer,
    refreshViewers,
    reset,
    offerOf,
    tools,
    viewers: () => openChests,
  };
}

module.exports = { create, fitsChest, invItems, HOLD, MAX_STACK };
