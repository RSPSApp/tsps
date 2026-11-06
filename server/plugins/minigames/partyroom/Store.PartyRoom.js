/**
 * The Falador Party Room's chest, the one chest of the world: what's in it, and which players' offers
 * it has taken (confirmed), kept in data/saves/party-room[.<profile>].json.
 *
 * The file is the commit point of a deposit. A change is built as a new value, written (temp file,
 * fsync, rename) and only then assigned, so a failed write leaves the memory and the file as they were.
 * A file that can't be read is kept as it is (a copy named .corrupt-<time>) and the chest refuses every
 * change until it reads again: starting empty and writing would destroy what's in it.
 *
 * "216 individual items" (Wiki: Party chest): a stackable id is one item however many there are
 * (coins, noted items); anything else counts each. Stacks of one id merge.
 */

const fs = require("fs");
const path = require("path");

const CAPACITY = 216;
const MAX_STACK = 2147483647;

let fileSource = null;
let file = null;
let isStackable = () => false;
let state = null; // { status: "ok" | "corrupt", chest: [], confirmed: {} }

/** The file is chosen on first use: the world's profile isn't known while plugins register. */
function filePath() {
  if (!file) file = typeof fileSource === "function" ? fileSource() : fileSource;
  return file;
}

function configure(options) {
  fileSource = options.file;
  file = null;
  isStackable = options.isStackable ?? isStackable;
  state = null;
}

function validEntry(entry) {
  return entry && Number.isInteger(entry.id) && entry.id >= 0 && Number.isInteger(entry.amount) && entry.amount >= 1 && entry.amount <= MAX_STACK;
}

function readFile(keepCopy) {
  let text;
  try {
    text = fs.readFileSync(filePath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { status: "ok", chest: [], confirmed: {} };
    return { status: "corrupt", error };
  }
  try {
    const saved = JSON.parse(text);
    if (!Array.isArray(saved?.chest) || !saved.chest.every(validEntry)) throw new Error("the chest is not a list of {id, amount}");
    const confirmed = saved.confirmed && typeof saved.confirmed === "object" && !Array.isArray(saved.confirmed) ? saved.confirmed : {};
    return { status: "ok", chest: saved.chest.map(({ id, amount }) => ({ id, amount })), confirmed: { ...confirmed } };
  } catch (error) {
    if (keepCopy) {
      try {
        fs.copyFileSync(filePath(), `${filePath()}.corrupt-${Date.now()}`);
      } catch {
        // The original stays where it is either way.
      }
    }
    return { status: "corrupt", error };
  }
}

/** The current state; an unreadable file is looked at again each time, as it may have been fixed. */
function current() {
  if (!state || state.status !== "ok") state = readFile(!state);
  return state;
}

function available() {
  return current().status === "ok";
}

function error() {
  return current().error ?? null;
}

function chest() {
  return current().chest;
}

function used(items = current().chest) {
  return items.reduce((sum, { id, amount }) => sum + (isStackable(id) ? 1 : amount), 0);
}

function confirmedId(account) {
  return current().confirmed?.[account] ?? null;
}

/** Temp file, fsync, rename: a crash leaves the old file or the new one, never half of either. */
function write(next) {
  fs.mkdirSync(path.dirname(filePath()), { recursive: true });
  const temp = `${filePath()}.tmp`;
  const fd = fs.openSync(temp, "w");
  try {
    fs.writeSync(fd, JSON.stringify({ version: 1, chest: next.chest, confirmed: next.confirmed }, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, filePath());
  try {
    const dir = fs.openSync(path.dirname(filePath()), "r");
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
  } catch {
    // Directory fsync isn't available everywhere; the rename is already done.
  }
}

/** Write first, assign only on success. */
function commit(next) {
  write(next);
  state = { status: "ok", chest: next.chest, confirmed: next.confirmed };
}

/**
 * The offer goes into the chest and the account's offer id is recorded, in one write. Synchronous, so
 * two deposits can't both pass the capacity check. { ok } or { ok: false, reason: "full"|"unavailable"|"write" }.
 */
function deposit(account, confirmId, items) {
  const now = current();
  if (now.status !== "ok") return { ok: false, reason: "unavailable" };
  const next = now.chest.map(({ id, amount }) => ({ id, amount }));
  for (const { id, amount } of items) {
    const stack = next.find((entry) => entry.id === id);
    if (stack) {
      if (stack.amount + amount > MAX_STACK) return { ok: false, reason: "full" };
      stack.amount += amount;
    } else {
      next.push({ id, amount });
    }
  }
  if (used(next) > CAPACITY) return { ok: false, reason: "full" };
  try {
    commit({ chest: next, confirmed: { ...now.confirmed, [account]: confirmId } });
  } catch (cause) {
    return { ok: false, reason: "write", cause };
  }
  return { ok: true };
}

/**
 * One balloon's item: a uniformly chosen individual item, one of a non-stackable and a uniform 1..all of
 * a stackable (Wiki: Party chest). The chest is written before the item is handed over.
 * Returns { id, amount }, or null when the chest is empty, unreadable or the write failed.
 */
function take(random = Math.random) {
  const now = current();
  if (now.status !== "ok") return null;
  const total = used(now.chest);
  if (total === 0) return null;
  let pick = Math.floor(random() * total);
  const next = now.chest.map(({ id, amount }) => ({ id, amount }));
  let index = 0;
  for (; index < next.length; index++) {
    const weight = isStackable(next[index].id) ? 1 : next[index].amount;
    if (pick < weight) break;
    pick -= weight;
  }
  const entry = next[index];
  const amount = isStackable(entry.id) ? 1 + Math.floor(random() * entry.amount) : 1;
  entry.amount -= amount;
  if (entry.amount === 0) next.splice(index, 1);
  try {
    commit({ chest: next, confirmed: now.confirmed });
  } catch {
    return null;
  }
  return { id: entry.id, amount };
}

/** The chest has the account's offer and the player's save no longer does: the record can go. */
function forget(account, confirmId) {
  const now = current();
  if (now.status !== "ok" || now.confirmed[account] !== confirmId) return;
  const confirmed = { ...now.confirmed };
  delete confirmed[account];
  try {
    commit({ chest: now.chest, confirmed });
  } catch {
    // Left in the file: it only means a later login finds the same answer.
  }
}

function reset() {
  state = null;
  file = null;
}

module.exports = { CAPACITY, MAX_STACK, available, chest, configure, confirmedId, deposit, error, forget, reset, take, used };
