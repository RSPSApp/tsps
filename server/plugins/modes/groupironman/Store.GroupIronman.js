"use strict";

/**
 * What Group Ironman keeps about a group beyond its membership (which is Grouping's), written whole
 * to data/saves/group-ironman.json (TSPS_GROUP_IRONMAN_FILE overrides it) at every change:
 *
 * Record: { groupId, variant: "ranked" | "hardcore" | "unranked", formed: ms (0 while forming),
 *           prestige: boolean, lives: number (Hardcore), originals: [account keys],
 *           received: { account key: coins' worth received from the group },
 *           unlocks: [the storage unlock tasks' bits the group has done] }
 *
 * and the accounts that have left a group and not yet chosen what they become (pending).
 */

const fs = require("fs");
const path = require("path");

const FILE_ENV = "TSPS_GROUP_IRONMAN_FILE";
const DEFAULT_FILE = path.join("data", "saves", "group-ironman.json");

let records = null;
let pending = null;

function file() {
  return process.env[FILE_ENV] || path.join(process.cwd(), DEFAULT_FILE);
}

function load() {
  if (records) return;
  const loadedRecords = new Map();
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    records = loadedRecords;
    pending = new Set();
    return;
  }
  for (const record of saved.groups ?? []) {
    loadedRecords.set(Number(record.groupId), {
      groupId: Number(record.groupId),
      variant: record.variant ?? "ranked",
      formed: Number(record.formed) || 0,
      prestige: record.prestige === true,
      lives: Number(record.lives) || 0,
      originals: [...(record.originals ?? [])],
      received: { ...(record.received ?? {}) },
      unlocks: (record.unlocks ?? []).map(Number).filter(Number.isInteger),
    });
  }
  records = loadedRecords;
  pending = new Set(saved.pending ?? []);
}

function save() {
  load();
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ groups: [...records.values()], pending: [...pending] }, null, 2));
  fs.renameSync(temporary, target);
}

function get(groupId) {
  load();
  return records.get(Number(groupId)) ?? null;
}

/** The group's record, made for a forming group of `variant` the first time it is asked for. */
function ensure(groupId, variant) {
  load();
  let record = records.get(Number(groupId));
  if (!record) {
    record = { groupId: Number(groupId), variant, formed: 0, prestige: false, lives: 0, originals: [], received: {}, unlocks: [] };
    records.set(record.groupId, record);
    save();
  }
  return record;
}

/** Saves after the caller changed `record`. */
/** Called with each record that update() saves (the Group Ironman tab redraws its members'). */
let listener = null;

function onUpdate(fn) {
  listener = fn;
}

function update(record) {
  load();
  records.set(record.groupId, record);
  save();
  listener?.(record);
}

function remove(groupId) {
  load();
  if (records.delete(Number(groupId))) save();
}

function hasPendingChoice(account) {
  load();
  return pending.has(account);
}

function setPendingChoice(account, waiting) {
  load();
  if (waiting === pending.has(account)) return;
  if (waiting) pending.add(account);
  else pending.delete(account);
  save();
}

/** Forgets what is in memory, so tests can read the file again as a restart would. */
function reset() {
  records = null;
  pending = null;
}

module.exports = { FILE_ENV, get, ensure, onUpdate, update, remove, hasPendingChoice, setPendingChoice, reset };
