/**
 * Shared cache-authentic lockpicking interface 811 (Fallen From Grace, The Final Dawn).
 *
 * Script 6994 renders the active pins, attempt number, previous guess and feedback.
 * The confirm script packs six base-6 pin slots and sends RESUME_COUNTDIALOG, which the
 * server decodes as `dialogue_amount`. Feedback is six base-3 digits: 2 exact position,
 * 1 value present elsewhere (matching only unconsumed target values), 0 absent.
 */
const LOCKPICKING_GROUP = 811;
const LOCKPICKING_CONFIRM = 15;
const LOCKPICKING_SLOTS = 6;
const LOCKPICKING_DIGITS = 6;
const FEEDBACK_DIGITS = 3;

function digitsOf(value, base, count = LOCKPICKING_SLOTS) {
  const digits = [];
  let remaining = value;
  for (let i = 0; i < count; i++) {
    digits.push(remaining % base);
    remaining = Math.floor(remaining / base);
  }
  return digits;
}

function codeOf(digits, base) {
  return digits.reduce((value, digit, index) => value + digit * base ** index, 0);
}

function lockpickFeedback(guess, target) {
  const guessed = digitsOf(guess, LOCKPICKING_DIGITS);
  const wanted = digitsOf(target, LOCKPICKING_DIGITS);
  const feedback = new Array(LOCKPICKING_SLOTS).fill(0);
  const remaining = new Map();
  for (let i = 0; i < LOCKPICKING_SLOTS; i++) {
    if (guessed[i] === wanted[i]) feedback[i] = 2;
    else remaining.set(wanted[i], (remaining.get(wanted[i]) ?? 0) + 1);
  }
  for (let i = 0; i < LOCKPICKING_SLOTS; i++) {
    if (feedback[i] === 2) continue;
    const count = remaining.get(guessed[i]) ?? 0;
    if (count > 0) {
      feedback[i] = 1;
      remaining.set(guessed[i], count - 1);
    }
  }
  return codeOf(feedback, FEEDBACK_DIGITS);
}

function createQuestLockpicking(api, { activePins, target, onSolved }) {
  if (!Number.isInteger(activePins) || activePins < 1 || activePins > LOCKPICKING_SLOTS) {
    throw new Error("lockpicking activePins must be 1..6");
  }
  if (!Number.isInteger(target) || target < 0 || target >= LOCKPICKING_DIGITS ** activePins) {
    throw new Error("lockpicking target is outside the active pin range");
  }
  const { CountdownTask, TaskManager } = api.core;
  const pending = new WeakMap();

  function cancel(player) {
    const state = pending.get(player);
    if (!state) return;
    TaskManager.cancelTasks(state.key);
    if (player.getEnteredAmountAction?.() === state.action) player.setEnteredAmountAction(null);
    pending.delete(player);
  }

  function open(player, attempt = 0, guess = 0, feedback = 0) {
    cancel(player);
    const state = { key: {}, attempt, guess, feedback, action: null, closing: false };
    pending.set(player, state);
    const sender = player.getPacketSender();
    sender.sendInterface(LOCKPICKING_GROUP);
    sender.sendInterfaceScript(6994, [
      (LOCKPICKING_GROUP << 16) | 1,
      (LOCKPICKING_GROUP << 16) | 9,
      (LOCKPICKING_GROUP << 16) | 4,
      (LOCKPICKING_GROUP << 16) | 14,
      (LOCKPICKING_GROUP << 16) | 10,
      (LOCKPICKING_GROUP << 16) | LOCKPICKING_CONFIRM,
      activePins,
      attempt,
      guess,
      feedback,
    ]);
    const action = {
      acceptsZero: true,
      execute: (amount) => handleAmount(player, state, amount),
    };
    state.action = action;
    player.setEnteredAmountAction(action);
  }

  function reopen(player, state, attempt, guess, feedback) {
    state.closing = true;
    player.getPacketSender().sendInterfaceRemoval();
    state.closing = false;
    TaskManager.submit(new CountdownTask(state.key, 1, () => {
      if (pending.get(player) !== state || player.isRegistered?.() === false) return;
      const current = player.getEnteredAmountAction?.();
      if (current && current !== state.action) {
        pending.delete(player);
        return;
      }
      const interfaceId = player.getInterfaceId?.();
      if (Number.isInteger(interfaceId) && interfaceId >= 0 && interfaceId !== LOCKPICKING_GROUP) {
        pending.delete(player);
        return;
      }
      open(player, attempt, guess, feedback);
    }));
  }

  function handleAmount(player, state, amount) {
    if (pending.get(player) !== state || player.getEnteredAmountAction?.() !== state.action) return;
    const max = LOCKPICKING_DIGITS ** activePins;
    if (!Number.isInteger(amount) || amount < 0 || amount >= max) {
      player.sendMessage("That didn't seem to work.");
      reopen(player, state, state.attempt, state.guess, state.feedback);
      return;
    }
    if (amount === target) {
      pending.delete(player);
      player.setEnteredAmountAction(null);
      player.getPacketSender().sendInterfaceRemoval();
      onSolved(player);
      return;
    }
    const feedback = lockpickFeedback(amount, target);
    player.sendMessage("That didn't seem to work.");
    reopen(player, state, state.attempt + 1, amount, feedback);
  }

  api.onPlayerLogout(({ player }) => cancel(player));
  api.onPlayerDeath(({ player }) => cancel(player));
  api.onCustomEvent?.("interface:closed", ({ player, interfaceId }) => {
    if (interfaceId !== LOCKPICKING_GROUP) return;
    const state = pending.get(player);
    if (state && !state.closing) cancel(player);
  });
  return { open, cancel };
}

module.exports = { createQuestLockpicking, lockpickFeedback };
