"use strict";

/**
 * Who gets into a group's storage, and saving what they did there.
 *
 * - Two doors: Grouping's "Group storage" chests (a member's click arrives as "grouping:storage"),
 *   and the bank's Group Storage button (Maggie: "the button in the top-left of your bank
 *   interface"), whose storage has "Back to bank". Only a Group Ironman in a Group Ironman group
 *   gets in, one member at a time; a member in their leaving period gets "Deposit only" (Wiki:
 *   leavers can't withdraw).
 * - What they do changes only the session's copies. Save (or "Save and Close") checks that the
 *   backpack and the storage are still what the copies started from, and that a member who can only
 *   deposit took nothing out, then writes the storage and the backpack together and asks for a
 *   player save. Anything else that ends the session (closing, walking off, logging out, being
 *   removed) drops the copies: nothing moved.
 * - A group can't end while its storage holds items ("grouping:can-end").
 * - Content may limit what a member takes out (Group Ironman's new-member wealth limits):
 *   "group-storage:limit" { player, groupId, remaining } is shown as %if1 (coins' worth, null for
 *   none), "group-storage:can-withdraw" { player, groupId, items, allowed, reason } is asked at Save
 *   with what the Save takes out, and "group-storage:withdrawn" { player, groupId, items } follows it.
 * - Content may give a group more spaces: "group-storage:capacity" { player, groupId, capacity }
 *   is asked at each opening (Group Ironman's storage unlocks), from Store.CAPACITY up to
 *   Store.MAX_CAPACITY.
 *
 * Player saves are written in the background, so a crash between the storage file's write and the
 * player's next save could leave a deposit in both. The window is one save; server/docs/group-storage.md
 * says so.
 */

const Store = require("./Store.GroupStorage");
const Session = require("./Session.GroupStorage");
const View = require("./View.GroupStorage");

const { ACCESS } = Session;
/** The Ironman plugin's Group Ironman modes: Group, Hardcore Group and Unranked Group Ironman. */
const GROUP_IRONMAN_MODES = Object.freeze(["group", "group-hardcore", "group-unranked"]);
const MESSAGE = Object.freeze({
  NOT_IRONMAN: "Only Group Ironmen can use group storage.",
  IN_USE: (name) => `${name} is using the group storage.`,
  NOT_EMPTY: "Empty the group storage first.",
  CHANGED: "Your inventory or the group storage changed while it was open, so nothing was saved.",
  DEPOSIT_ONLY: "You can't take items out of the group storage while you're leaving the group.",
  NO_ACCESS: "You no longer have access to the group storage.",
  NOT_MEMBER: "You need to be in a group to use group storage.",
  // Ours: every member is leaving, so a deposit would outlive the group.
  ALL_LEAVING: "Everyone in your group is leaving it, so the group storage is closed.",
});

let api;

function init(pluginApi) {
  api = pluginApi;
}

function isGroupIronman(player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return GROUP_IRONMAN_MODES.includes(query.mode);
}

function membersWorld() {
  return api.core.WorldDefinition.isMembersWorld() !== false;
}

/**
 * Whether every member is in their leaving period. Then nobody stays to reach the storage once the
 * group ends, so even a deposit is refused (it would be lost with the group).
 */
function allLeaving(group) {
  return group.members.length > 0 && group.members.every((member) => member.leaving);
}

/** The access the store gives this player to group `groupId` now: Session.ACCESS. */
function accessOf(player, groupId) {
  const query = { player };
  api.emitCustomEvent("grouping:get", query);
  if (!query.group || query.group.id !== groupId || !query.group.ironman || !isGroupIronman(player)) return ACCESS.NONE;
  if (allLeaving(query.group)) return ACCESS.NONE;
  return query.member?.leaving ? ACCESS.DEPOSIT_ONLY : ACCESS.FULL;
}

/** "grouping:storage" { player, group, member, handled, fromBank? }: opens the storage, or says why not. */
function open(request) {
  const { player, group, member } = request;
  request.handled = true;
  if (!group?.ironman || !isGroupIronman(player)) {
    player.getPacketSender().sendMessage(MESSAGE.NOT_IRONMAN);
    return;
  }
  if (allLeaving(group)) {
    player.getPacketSender().sendMessage(MESSAGE.ALL_LEAVING);
    return;
  }
  const holder = Session.holder(group.id);
  if (holder && holder.player !== player) {
    player.getPacketSender().sendMessage(MESSAGE.IN_USE(holder.name));
    return;
  }
  const access = member?.leaving ? ACCESS.DEPOSIT_ONLY : ACCESS.FULL;
  const capacity = capacityOf(player, group.id);
  const session = Session.begin(player, group.id, member?.name ?? player.getUsername(), access, request.fromBank, capacity);
  session.limit = limitOf(player, group.id);
  View.open(player, session);
}

/** The bank's Group Storage button: the store says which group, as at a chest. */
function openFromBank(player) {
  const query = { player };
  api.emitCustomEvent("grouping:get", query);
  if (!query.group) {
    player.getPacketSender().sendMessage(MESSAGE.NOT_MEMBER);
    return;
  }
  open({ player, group: query.group, member: query.member, handled: false, fromBank: true });
}

/** "Back to bank": what was changed is saved, as by Save and Close, then the bank opens. */
function backToBank(player) {
  const session = Session.current(player);
  if (!session?.fromBank || !save(player, true)) return;
  player.getBank(player.getCurrentBankTab()).open();
}

/** The player's session while it may still be used; otherwise it ends and the interface closes. */
function live(player) {
  const session = Session.current(player);
  if (!session) return null;
  const access = accessOf(player, session.groupId);
  if (access === ACCESS.NONE || !View.isOpen(player)) {
    discard(player, access === ACCESS.NONE ? MESSAGE.NO_ACCESS : null);
    return null;
  }
  if (access !== session.access) {
    session.access = access;
    View.sendAccess(player, session);
  }
  return session;
}

function discard(player, message = null) {
  if (!Session.end(player)) return;
  if (message) player.getPacketSender().sendMessage(message);
  View.close(player);
}

/** How many spaces content gives the group (asked at each opening, when tasks may unlock more). */
function capacityOf(player, groupId) {
  const request = { player, groupId, capacity: Store.CAPACITY };
  api.emitCustomEvent("group-storage:capacity", request);
  const capacity = Math.floor(Number(request.capacity));
  return Number.isFinite(capacity) ? Math.max(Store.CAPACITY, Math.min(Store.MAX_CAPACITY, capacity)) : Store.CAPACITY;
}

/** What content says the player may still take out (coins' worth), or null for no limit. */
function limitOf(player, groupId) {
  const request = { player, groupId, remaining: null };
  api.emitCustomEvent("group-storage:limit", request);
  return Number.isFinite(request.remaining) ? request.remaining : null;
}

/** What the session takes out of storage, as [{ id, amount }] by item (moving slots isn't taking). */
function takenOut(session) {
  const totals = (slots) => slots.reduce((sum, item) => (item ? sum.set(item.id, (sum.get(item.id) ?? 0) + item.amount) : sum), new Map());
  const before = totals(Store.slotsOf(session.groupId));
  const after = totals(session.storage);
  return [...before].filter(([id, amount]) => (after.get(id) ?? 0) < amount)
    .map(([id, amount]) => ({ id, amount: amount - (after.get(id) ?? 0) }));
}

/** Save / Save and Close: writes the copies if nothing changed behind them. */
function save(player, closeAfter = false) {
  const session = live(player);
  if (!session) return false;
  if (session.edited) {
    const backpack = Session.fingerprintItems(player.getInventory().getItems());
    const stored = Session.fingerprintSlots(Store.slotsOf(session.groupId, session.capacity));
    if (backpack !== session.baseline.inventory || stored !== session.baseline.storage) {
      player.getPacketSender().sendMessage(MESSAGE.CHANGED);
      View.refresh(player, Session.refill(session));
      return false;
    }
    const taken = takenOut(session);
    if (session.access !== ACCESS.FULL && taken.length) {
      player.getPacketSender().sendMessage(MESSAGE.DEPOSIT_ONLY);
      View.refresh(player, Session.refill(session));
      return false;
    }
    const check = { player, groupId: session.groupId, items: taken, allowed: true, reason: null };
    if (taken.length) api.emitCustomEvent("group-storage:can-withdraw", check);
    if (check.allowed === false) {
      if (check.reason) player.getPacketSender().sendMessage(check.reason);
      View.refresh(player, Session.refill(session));
      return false;
    }
    Store.commit(session.groupId, session.storage);
    const items = session.inventory.map((item) => item ?? new api.core.Item(-1, 0));
    const inventory = player.getInventory();
    inventory.getItems().splice(0, items.length, ...items);
    inventory.refreshItems();
    if (taken.length) api.emitCustomEvent("group-storage:withdrawn", { player, groupId: session.groupId, items: taken });
    api.emitCustomEvent("persistence:save", { player, reason: "group-storage" });
    Session.refill(session);
    session.limit = limitOf(player, session.groupId);
    View.sendLimit(player, session);
  }
  if (closeAfter) discard(player);
  else View.refresh(player, session);
  return true;
}

/** "group-storage:popup-closed" { player }: the storage's own varps again, under a closed popup. */
function popupClosed({ player }) {
  const session = Session.current(player);
  if (session) View.sendScratchVarps(player, session);
}

/** "grouping:can-end": a group whose storage holds items stays. */
function canEnd(request) {
  if (!Store.isEmpty(request.groupId)) {
    request.allowed = false;
    request.reason = MESSAGE.NOT_EMPTY;
  }
}

/** "grouping:changed": an ended group's storage is closed and ended; a removed member is shut out. */
function groupChanged(event) {
  for (const session of Session.ofGroup(event.groupId)) {
    if (event.type === "disbanded") discard(session.player, MESSAGE.NO_ACCESS);
    else live(session.player);
  }
  if (event.type === "disbanded") Store.end(event.groupId);
}

/** "interface:closed": the storage closed by any route; whatever wasn't saved is dropped. */
function interfaceClosed({ player, interfaceId }) {
  if (interfaceId === View.MAIN()) Session.end(player);
}

function logout({ player }) {
  Session.end(player);
}

module.exports = {
  MESSAGE, init, isGroupIronman, membersWorld, accessOf, open, openFromBank, backToBank, live, discard, save, popupClosed, canEnd, groupChanged,
  interfaceClosed, logout,
};
