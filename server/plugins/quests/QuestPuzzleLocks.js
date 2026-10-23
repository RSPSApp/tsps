/**
 * Shared cache-authentic 809 combination-lock and 810 directional-lock puzzles.
 * 809: setup script 6963, confirm 6969 (varcs 1113..1118).
 * 810: onLoad 6974, confirm 6987 (varcs 1119/1120).
 * Both confirm through RESUME_COUNTDIALOG; callers guard their own stages in onSolved.
 */
const COMBINATION_GROUP = 809;
const COMBINATION_SCRIPT = 6963;
const COMBINATION_CONTENTS = (COMBINATION_GROUP << 16) | 1;
const COMBINATION_LOCK = (COMBINATION_GROUP << 16) | 4;
const COMBINATION_DIALS = 6;
const DIRECTIONAL_GROUP = 810;
const DIRECTIONAL_MAX = 10;

const COMBINATION_DATASET_NUMERIC = 2339;
const COMBINATION_DATASET_ALPHABETIC = 2340;
const DIRECTION_UP = 0;
const DIRECTION_RIGHT = 1;
const DIRECTION_DOWN = 2;
const DIRECTION_LEFT = 3;

function combinationLockAmount(digits) {
  if (!Array.isArray(digits) || digits.length < 1 || digits.length > COMBINATION_DIALS) {
    throw new Error("combination lock digits must be 1..6");
  }
  let value = 0;
  for (const digit of digits) {
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
      throw new Error("combination lock digits must be 0..9");
    }
    value = value * 10 + digit;
  }
  return value * 10 ** (COMBINATION_DIALS - digits.length);
}

function directionalLockAmount(solution) {
  if (!Array.isArray(solution) || solution.length < 1 || solution.length > DIRECTIONAL_MAX) {
    throw new Error("directional lock solution must be 1..10 directions");
  }
  let packed = 0;
  for (let index = 0; index < solution.length; index++) {
    const direction = solution[index];
    if (!Number.isInteger(direction) || direction < 0 || direction > 3) {
      throw new Error("directional lock directions must be 0..3");
    }
    packed += direction * 4 ** index;
  }
  return packed * 10 + solution.length;
}

function createLock(api, group, expected, openInterface, onSolved) {
  const pending = new WeakMap();

  function currentInterface(player) {
    const interfaceId = player.getInterfaceId?.();
    return Number.isInteger(interfaceId) ? interfaceId : null;
  }

  function closeInterface(player) {
    if (currentInterface(player) === group) player.getPacketSender().sendInterfaceRemoval();
  }

  function clear(player, state, { removeInterface = false } = {}) {
    if (pending.get(player) === state) pending.delete(player);
    if (player.getEnteredAmountAction?.() === state.action) player.setEnteredAmountAction(null);
    if (removeInterface) closeInterface(player);
  }

  function cancel(player, { removeInterface = false } = {}) {
    const state = pending.get(player);
    if (!state) return;
    clear(player, state, { removeInterface });
  }

  function finish(player, state, solved, { removeInterface = true } = {}) {
    if (pending.get(player) !== state || state.finished) return;
    state.finished = true;
    clear(player, state, { removeInterface });
    if (solved) state.onSolved(player);
  }

  function handleAmount(player, state, amount) {
    if (pending.get(player) !== state || state.finished) return;
    if (player.getEnteredAmountAction?.() !== state.action) return;
    const interfaceId = currentInterface(player);
    if (interfaceId !== null && interfaceId !== group) return;
    if (!Number.isInteger(amount) || amount !== expected) {
      player.sendMessage("That doesn't seem to work.");
      finish(player, state, false, { removeInterface: true });
      return;
    }
    finish(player, state, true, { removeInterface: true });
  }

  function open(player) {
    cancel(player, { removeInterface: true });
    const state = { action: null, finished: false, onSolved };
    pending.set(player, state);
    openInterface(player);
    const action = { acceptsZero: true, execute: (amount) => handleAmount(player, state, amount) };
    state.action = action;
    player.setEnteredAmountAction(action);
  }

  api.onPlayerLogout(({ player }) => cancel(player, { removeInterface: true }));
  api.onPlayerDeath(({ player }) => cancel(player, { removeInterface: true }));
  api.onCustomEvent?.("interface:closed", ({ player, interfaceId }) => {
    if (interfaceId !== group) return;
    cancel(player, { removeInterface: false });
  });

  return { open, cancel };
}

function createCombinationLock(api, { digits, datasetRow, onSolved }) {
  if (!Number.isInteger(datasetRow) || datasetRow < 0) {
    throw new Error("combination lock datasetRow must be a non-negative integer");
  }
  if (typeof onSolved !== "function") throw new Error("combination lock onSolved must be a function");
  const expected = combinationLockAmount(digits);
  return createLock(api, COMBINATION_GROUP, expected, (player) => {
    const sender = player.getPacketSender();
    sender.sendInterface(COMBINATION_GROUP);
    sender.sendInterfaceScript(COMBINATION_SCRIPT, [
      COMBINATION_CONTENTS,
      COMBINATION_LOCK,
      digits.length,
      datasetRow,
      1,
      -1,
    ]);
  }, onSolved);
}

function createDirectionalLock(api, { solution, onSolved }) {
  if (typeof onSolved !== "function") throw new Error("directional lock onSolved must be a function");
  const expected = directionalLockAmount(solution);
  return createLock(api, DIRECTIONAL_GROUP, expected, (player) => {
    player.getPacketSender().sendInterface(DIRECTIONAL_GROUP);
  }, onSolved);
}

module.exports = {
  createCombinationLock,
  createDirectionalLock,
  combinationLockAmount,
  directionalLockAmount,
  COMBINATION_GROUP,
  DIRECTIONAL_GROUP,
  COMBINATION_DATASET_NUMERIC,
  COMBINATION_DATASET_ALPHABETIC,
  DIRECTION_UP,
  DIRECTION_RIGHT,
  DIRECTION_DOWN,
  DIRECTION_LEFT,
};
