/**
 * The Bank PIN settings (bankpin_settings), from a Banker's "I'd like to check my PIN settings."
 * (the transcript's open_interface "Bank PIN"), and the bank's lock:
 * - no PIN: Set a PIN (entered twice; it takes effect after the recovery delay), the delay;
 * - a PIN: Change it (the current one, then the new one twice), Delete it (the current one, then
 *   a yes/no), the recovery delay (3 or 7 days), the logout behaviour (always lock, or stay
 *   unlocked for 5 minutes offline);
 * - a PIN coming, or one being deleted ("I don't know it." on the keypad): Cancel.
 * - The bank: while the PIN is locked it asks for it first ("You have correctly entered your
 *   PIN."), then opens; the PIN stays unlocked until logout, or for 5 minutes offline if chosen.
 */
const Common = require("./Common.BankPin");
const Keypad = require("./Keypad.BankPin");

const OPEN_TARGET = "Bank PIN";
/** The can-bank check's sources (Bank.open, and the deposit boxes). */
const OPEN_SOURCE = "open";
const DEPOSIT_BOX_SOURCE = "deposit-box";
// Ultimate Seed Vault refusal checks can-bank before the vault's separate PIN guard.
const SEED_VAULT_SOURCE = "seed-vault";

function days(player) {
  return Common.fill(Common.data.texts.days, { days: Common.delayDays(player) });
}

/** Draws the settings for the player's state; `message` replaces the message box. */
function show(player, message = null) {
  Common.settle(player);
  const { groups, uids } = Common.ids;
  const { texts } = Common.data;
  const u = uids.settings;
  const sender = player.getPacketSender();
  const has = Common.hasPin(player);
  const pending = Common.pendingPin(player) || Common.pendingDelete(player);
  sender.sendInterfaceRemoval();
  sender.sendInterface(groups.settings);
  sender.sendInterfaceDisplayState(u.root, false);
  sender.sendInterfaceDisplayState(u.warning, true);
  const status = Common.pendingDelete(player) ? texts.pendingDelete : Common.pendingPin(player) ? texts.pendingPin : has ? texts.hasPin : texts.noPin;
  sender.sendString(status, u.status);
  sender.sendString(days(player), u.delay);
  sender.sendString(Common.get(player, "stayUnlocked") === true ? texts.lockAfter : texts.alwaysLock, u.logout);
  const fallback = Common.pendingDelete(player)
    ? Common.fill(texts.pendingDeleteMessage, { days: Common.delayDays(player) })
    : Common.pendingPin(player) ? Common.fill(texts.pendingMessage, { days: Common.delayDays(player) }) : texts.message;
  sender.sendString(message ?? fallback, u.message);
  sender.sendInterfaceDisplayState(u.noPin, pending || has);
  sender.sendInterfaceDisplayState(u.hasPin, pending || !has);
  sender.sendInterfaceDisplayState(u.pending, !pending);
}

/** A new PIN entered twice; `done(pin)` when both match. */
function enterNew(player, title, done) {
  Keypad.show(player, title, (first) => {
    // The entered-amount action is cleared after this answer; the second prompt opens next tick.
    Common.later(player, 1, () => Keypad.show(player, title, (second) => {
      if (first !== second) return show(player, Common.data.messages.mismatch);
      done(first);
    }, { instruction: Common.data.keypad.again }));
  });
}

/** The current PIN first; `then()` once it is right. */
function verify(player, then) {
  Keypad.show(player, Common.data.keypad.settingsTitle, (pin) => {
    if (Keypad.check(player, pin)) Common.later(player, 1, then);
    else show(player);
  }, { onForgotten: () => forgot(player) });
}

/** "I don't know it.": the PIN is deleted after the recovery delay, unless cancelled. */
function forgot(player) {
  if (!Common.hasPin(player) || Common.pendingDelete(player)) return;
  Common.set(player, "deleteAt", Common.now() + Common.delayDays(player) * Common.MS_PER_DAY);
  player.sendMessage(Common.fill(Common.data.messages.forgot, { days: Common.delayDays(player) }));
}

function setPin(player) {
  const { keypad, messages } = Common.data;
  enterNew(player, keypad.settingsTitle, (pin) => {
    Common.set(player, "pendingHash", Common.hash(player, pin));
    Common.set(player, "pendingAt", Common.now() + Common.delayDays(player) * Common.MS_PER_DAY);
    const line = Common.fill(messages.set, { days: Common.delayDays(player) });
    player.sendMessage(line);
    show(player, line);
  });
}

function changePin(player) {
  const { keypad, messages } = Common.data;
  verify(player, () => enterNew(player, keypad.settingsTitle, (pin) => {
    Common.set(player, "hash", Common.hash(player, pin));
    player.sendMessage(messages.changed);
    show(player, messages.changed);
  }));
}

function deletePin(player) {
  verify(player, () => {
    show(player);
    const { uids } = Common.ids;
    const sender = player.getPacketSender();
    sender.sendInterfaceDisplayState(uids.settings.warning, false);
    sender.sendString(Common.data.texts.deleteQuestion, uids.settings.question);
    confirming.add(player);
  });
}

const confirming = new WeakSet();

function confirmDelete(player, yes) {
  if (!confirming.has(player)) return;
  confirming.delete(player);
  if (yes) {
    Common.set(player, "hash", "");
    Common.set(player, "deleteAt", 0);
    Common.lock(player);
    player.sendMessage(Common.data.messages.deleted);
    return show(player, Common.data.messages.deleted);
  }
  show(player);
}

/** With a PIN, the change needs it first; with none (a PIN still coming), it doesn't. */
function guarded(player, action) {
  if (Common.hasPin(player)) verify(player, action);
  else action();
}

function cancelPending(player) {
  Common.set(player, "pendingHash", "");
  Common.set(player, "pendingAt", 0);
  Common.set(player, "deleteAt", 0);
  player.sendMessage(Common.data.messages.cancelled);
  show(player, Common.data.messages.cancelled);
}

function toggleDelay(player) {
  const { delays } = Common.data;
  const next = delays[(delays.indexOf(Common.delayDays(player)) + 1) % delays.length];
  Common.set(player, "delay", next);
  show(player);
}

function toggleLogout(player) {
  const stay = Common.get(player, "stayUnlocked") !== true;
  Common.set(player, "stayUnlocked", stay);
  show(player, stay ? Common.data.texts.lockAfterMessage : Common.data.texts.alwaysLockMessage);
}

/**
 * A settings button, only with the screen open and only from the layer the player's state shows;
 * a player with a PIN gives it before changing the delay, the logout behaviour or a pending change.
 */
function onClick(event) {
  const { groups, uids } = Common.ids;
  if (event.groupId !== groups.settings) return;
  const player = event.player;
  event.handled = true;
  if (player.getInterfaceId?.() !== groups.settings) return;
  Common.settle(player);
  const u = uids.settings;
  const uid = (groups.settings << 16) | event.childId;
  const has = Common.hasPin(player);
  const pending = Common.pendingPin(player) || Common.pendingDelete(player);
  const layer = pending ? "pending" : has ? "hasPin" : "noPin";
  const actions = new Map([
    [u.setPin, ["noPin", () => setPin(player)]],
    [u.noPinDelay, ["noPin", () => toggleDelay(player)]],
    [u.hasPinDelay, ["hasPin", () => guarded(player, () => toggleDelay(player))]],
    [u.changePin, ["hasPin", () => changePin(player)]],
    [u.deletePin, ["hasPin", () => deletePin(player)]],
    [u.logoutToggle, ["hasPin", () => guarded(player, () => toggleLogout(player))]],
    [u.cancelPending, ["pending", () => guarded(player, () => cancelPending(player))]],
    [u.yes, [null, () => confirmDelete(player, true)]],
    [u.no, [null, () => confirmDelete(player, false)]],
  ]);
  const entry = actions.get(uid);
  if (!entry) return;
  const [needs, action] = entry;
  if (needs && needs !== layer) return;
  action();
}

/** The Banker's "I'd like to check my PIN settings.". */
function onAction(event) {
  if (event.action !== "open_interface" || event.target !== OPEN_TARGET) return;
  event.handled = true;
  event.end = true;
  // The conversation closes its window as it ends; the settings open on the next tick.
  Common.later(event.player, 1, () => show(event.player));
}

/**
 * The bank asks for a locked PIN first, then opens. Deposit boxes need no PIN (Wiki); any other
 * check while locked (a servant's trip to the bank) is refused - only the bank asks for it.
 */
function canBank(event) {
  const { player, source } = event;
  if (source === DEPOSIT_BOX_SOURCE || source === SEED_VAULT_SOURCE || Common.core.Bank.isOpen(player)) return;
  Common.settle(player);
  if (!Common.hasPin(player) || Common.isUnlocked(player)) return;
  event.allow = false;
  if (source !== OPEN_SOURCE) {
    player.sendMessage(Common.data.messages.enterFirst);
    return;
  }
  Keypad.show(player, Common.data.keypad.bankTitle, (pin) => {
    if (!Keypad.check(player, pin)) return;
    Common.unlock(player);
    player.sendMessage(Common.data.messages.correct);
    Common.later(player, 1, () => player.getBank(player.getCurrentBankTab()).open());
  }, { onForgotten: () => forgot(player) });
}

/** Unlocked again only within the grace window offline, when chosen. */
function login({ player }) {
  Common.settle(player);
  const logoutAt = Number(Common.get(player, "logoutAt")) || 0;
  const graceMs = Common.data.offlineGraceMinutes * 60 * 1000;
  if (Common.get(player, "stayUnlocked") === true && logoutAt && Common.now() - logoutAt < graceMs) Common.unlock(player);
}

/** The offline window starts only from a session that entered the PIN. */
function logout({ player }) {
  Common.set(player, "logoutAt", Common.isUnlocked(player) ? Common.now() : 0);
  Common.lock(player);
}

/** agent:advance-time: a pending PIN or deletion, a lockout and the offline window move forward. */
function advanceTime(event) {
  const { player, ms } = event;
  let moved = false;
  for (const key of ["pendingAt", "deleteAt", "lockedUntil", "logoutAt"]) {
    const at = Number(Common.get(player, key)) || 0;
    if (!at) continue;
    Common.set(player, key, at - ms);
    moved = true;
  }
  if (!moved) return;
  Common.settle(player);
  event.handledBy?.push?.("BankPin");
}

/** bank-pin:status `{ player, set }`: whether the player's PIN is in effect (one still coming is not). */
function status(query) {
  Common.settle(query.player);
  query.set = Common.hasPin(query.player);
}

function closed({ player, interfaceId }) {
  if (interfaceId === Common.ids.groups.settings) confirming.delete(player);
}

function attach(api) {
  const { ATTRIBUTES } = Common;
  api.persistAttribute(ATTRIBUTES.hash, "");
  api.persistAttribute(ATTRIBUTES.pendingHash, "");
  api.persistAttribute(ATTRIBUTES.pendingAt, 0);
  api.persistAttribute(ATTRIBUTES.deleteAt, 0);
  api.persistAttribute(ATTRIBUTES.delay, Common.data.defaultDelay);
  api.persistAttribute(ATTRIBUTES.stayUnlocked, false);
  api.persistAttribute(ATTRIBUTES.failures, 0);
  api.persistAttribute(ATTRIBUTES.lockedUntil, 0);
  api.persistAttribute(ATTRIBUTES.logoutAt, 0);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onInterfaceActionClick(onClick);
  api.onCustomEvent("interface:closed", closed);
  api.onCustomEvent("bank-pin:status", status);
  api.onCanBank(canBank);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onCustomEvent("agent:advance-time", advanceTime);
}

module.exports = {
  attach, show, onClick, onAction, canBank, login, logout, forgot, advanceTime,
};
