"use strict";

/**
 * Who has a group's storage open, and their working copies. One member at a time (Wiki, Group
 * Ironman Mode): the session is the lock, from opening until the interface closes or they log out.
 *
 * A session copies the saved storage and the player's backpack when it opens, with a fingerprint
 * of each (`baseline`), so Save can tell whether either changed behind its back.
 *
 * Session: { player, groupId, name, access, fromBank, storage, inventory,
 *            baseline: { storage, inventory }, edited }
 */

const Store = require("./Store.GroupStorage");

/** What %if2 tells shared_bank_init: 1 shows "Deposit only", 2 the full storage. */
const ACCESS = Object.freeze({ NONE: 0, DEPOSIT_ONLY: 1, FULL: 2 });

/** player -> their session */
const sessions = new Map();
/** groupId -> the session holding that group's storage */
const locks = new Map();

let core;

function init(pluginApi) {
  core = pluginApi.core;
}

/** The backpack's slots as Item clones (null for empty), meta and all. */
function copyItems(items) {
  return items.map((item) => (item && item.getId() > 0 && item.getAmount() > 0 ? item.clone() : null));
}

/** Every slot's id, amount and per-item data, to tell whether two copies are the same. */
function fingerprintItems(items) {
  return JSON.stringify(items.map((item) => (item && item.getId() > 0 && item.getAmount() > 0
    ? [item.getId(), item.getAmount(), item.getMeta?.() ?? null] : null)));
}

function fingerprintSlots(slots) {
  return JSON.stringify(slots.map((item) => (item ? [item.id, item.amount] : null)));
}

/** Copies the saved storage and the backpack afresh, and takes their fingerprints. */
function refill(session) {
  session.storage = Store.slotsOf(session.groupId);
  session.inventory = copyItems(session.player.getInventory().getItems());
  session.baseline = {
    storage: fingerprintSlots(session.storage),
    inventory: fingerprintItems(session.player.getInventory().getItems()),
  };
  session.edited = false;
  return session;
}

/** The group's session, if its holder still has it open; a stale one is dropped. */
function holder(groupId) {
  const session = locks.get(groupId);
  if (!session) return null;
  if (sessions.get(session.player) === session && core.World.getPlayers().search((other) => other === session.player)) {
    return session;
  }
  end(session.player);
  return null;
}

/** `fromBank`: opened with the bank's Group Storage button, so "Back to bank" leads back. */
function begin(player, groupId, name, access, fromBank = false) {
  end(player);
  const session = refill({ player, groupId, name, access, fromBank: fromBank === true });
  sessions.set(player, session);
  locks.set(groupId, session);
  return session;
}

function current(player) {
  return sessions.get(player) ?? null;
}

/** Ends the player's session, keeping nothing: whatever wasn't saved never happened. */
function end(player) {
  const session = sessions.get(player);
  if (!session) return null;
  sessions.delete(player);
  if (locks.get(session.groupId) === session) locks.delete(session.groupId);
  return session;
}

/** The sessions open on this group's storage (at most one). */
function ofGroup(groupId) {
  const session = holder(groupId);
  return session ? [session] : [];
}

module.exports = {
  ACCESS, init, copyItems, fingerprintItems, fingerprintSlots, refill, holder, begin, current, end, ofGroup,
};
