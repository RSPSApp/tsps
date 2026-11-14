"use strict";

/**
 * Every group's storage, written whole to data/saves/group-storage.json (TSPS_GROUP_STORAGE_FILE
 * overrides it) at each save, as the groups' own store is: one write per Save, atomically through
 * a temporary file. A storage is keyed by its Grouping group id and is a row of up to MAX_CAPACITY slots,
 * each { id, amount } or empty (null); withdrawing leaves the slot empty until "Shuffle items up".
 *
 * Nothing is thrown away: a group that ends with items still stored (Grouping refuses that, but a
 * leaver's deposit could still land in a group as it ends) keeps its record, marked ended, for an
 * administrator to return.
 */

const fs = require("fs");
const path = require("path");

const FILE_ENV = "TSPS_GROUP_STORAGE_FILE";
const DEFAULT_FILE = path.join("data", "saves", "group-storage.json");
/** Wiki (Group Ironman Mode): "Initially, there are 80 bank spaces", unlocked "up to a maximum of 200". */
const CAPACITY = 80;
const MAX_CAPACITY = 200;

/** groupId -> { slots: Array<{ id, amount } | null>, ended: ms (0 while the group lasts) } */
let storages = null;

function file() {
  return process.env[FILE_ENV] || path.join(process.cwd(), DEFAULT_FILE);
}

function emptySlots(length = CAPACITY) {
  return Array.from({ length }, () => null);
}

function revive(record) {
  const slots = emptySlots(MAX_CAPACITY);
  for (const [slot, id, amount] of record.items ?? []) {
    if (Number.isInteger(slot) && slot >= 0 && slot < MAX_CAPACITY && id > 0 && amount > 0) slots[slot] = { id, amount };
  }
  return { slots, ended: Number(record.ended) || 0 };
}

function load() {
  if (storages) return storages;
  const loaded = new Map();
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    storages = loaded;
    return storages;
  }
  for (const record of saved.storages ?? []) loaded.set(Number(record.groupId), revive(record));
  // Only once it has all been read: a file that can't be read keeps throwing, so save() can't replace it.
  storages = loaded;
  return storages;
}

function serialise(groupId, { slots, ended }) {
  const items = [];
  slots.forEach((item, slot) => item && items.push([slot, item.id, item.amount]));
  return { groupId, items, ...(ended ? { ended } : {}) };
}

function save() {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  const records = [...load()].filter(([, storage]) => storage.slots.some(Boolean)).map(([id, storage]) => serialise(id, storage));
  fs.writeFileSync(temporary, JSON.stringify({ storages: records }, null, 2));
  fs.renameSync(temporary, target);
}

/**
 * A copy of the group's slots, empty ones null: `size` of them (CAPACITY at least), or more when
 * items sit further on (a storage never hides what it holds).
 */
function slotsOf(groupId, size = CAPACITY) {
  const stored = load().get(Number(groupId))?.slots ?? [];
  const last = stored.reduce((at, item, slot) => (item ? slot : at), -1);
  const length = Math.min(MAX_CAPACITY, Math.max(CAPACITY, size, last + 1));
  return Array.from({ length }, (_, slot) => (stored[slot] ? { ...stored[slot] } : null));
}

function isEmpty(groupId) {
  return !load().get(Number(groupId))?.slots.some(Boolean);
}

/** Replaces the group's slots with `slots` and saves. */
function commit(groupId, slots) {
  const kept = emptySlots(MAX_CAPACITY);
  slots.slice(0, MAX_CAPACITY).forEach((item, slot) => {
    if (item && item.amount > 0) kept[slot] = { id: item.id, amount: item.amount };
  });
  load().set(Number(groupId), { slots: kept, ended: 0 });
  save();
}

/** The group has ended: an empty storage goes, one with items is kept and marked ended. */
function end(groupId, now = Date.now()) {
  const storage = load().get(Number(groupId));
  if (!storage) return;
  if (storage.slots.some(Boolean)) storage.ended = now;
  else storages.delete(Number(groupId));
  save();
}

function endedAt(groupId) {
  return load().get(Number(groupId))?.ended ?? 0;
}

/** Forgets what is in memory, so tests can read the file again as a restart would. */
function reset() {
  storages = null;
}

module.exports = { FILE_ENV, CAPACITY, MAX_CAPACITY, slotsOf, isEmpty, commit, end, endedAt, reset };
