"use strict";

const { randomUUID } = require("node:crypto");
const CASKETS = require("../../../data/definitions/clue-caskets.json").tables;
const META_KEY = "mimic-rolls"; // Existing item metadata key, retained for migration.
const LEDGER_ATTRIBUTE = "mimic:caskets";
const LEGACY_ROLLS_ATTRIBUTE = "mimic:rolls";
const LEGACY_DEFEATED_ATTRIBUTE = "mimic:defeated";
const ATTEMPTS = Object.freeze({ elite: 5, master: 6 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid() { throw new Error("Invalid Mimic casket state"); }

function validate(record) {
  const attempts = ATTEMPTS[record?.tier];
  const range = CASKETS[record?.tier]?.rolls;
  if (!Number.isInteger(attempts) || typeof record.tier !== "string" || record.version !== 1 ||
      typeof record.id !== "string" || !UUID.test(record.id) ||
      !Number.isInteger(record.rolls) || record.rolls < 0 || record.rolls > attempts ||
      !Number.isInteger(record.clueRolls) || !range || record.clueRolls < range[0] || record.clueRolls > range[1] ||
      typeof record.defeated !== "boolean") invalid();
  return { ...record };
}

function ledger(player) {
  const records = player.getAttribute(LEDGER_ATTRIBUTE) ?? {};
  if (typeof records !== "object" || Array.isArray(records)) invalid();
  return records;
}

function save(player, item, record) {
  const checked = validate(record);
  const records = ledger(player);
  if (item) item.setMetaValue(META_KEY, checked);
  player.setAttribute(LEDGER_ATTRIBUTE, { ...records, [checked.id]: checked });
  return checked;
}

/** Conversion creates metadata only; the caller owns inventory consumption. */
function initialize(item, tier, clueRolls) {
  if (!item || item.getMetaValue(META_KEY) != null) invalid();
  const record = validate({ version: 1, id: randomUUID(), tier, rolls: ATTEMPTS[tier], clueRolls, defeated: false });
  item.setMetaValue(META_KEY, record);
  return record;
}

/** Item and ledger reconcile downward, so ground/grave recovery cannot refund a loss. */
function ensure(player, item) {
  if (!item) invalid();
  const raw = item.getMetaValue(META_KEY);
  let record, migrated = false;
  if (raw == null || raw.id == null) {
    // Old items knew only an elite-style attempt count. Their original reward
    // count cannot be recovered; preserve the previous default of five.
    if (raw != null && (typeof raw !== "object" || Array.isArray(raw) ||
        !Number.isInteger(raw.rolls) || raw.rolls < 0 || raw.rolls > ATTEMPTS.elite ||
        raw.tier != null || raw.clueRolls != null || raw.version != null)) invalid();
    const mirror = player.getAttribute(LEGACY_ROLLS_ATTRIBUTE);
    const rolls = Math.min(raw?.rolls ?? ATTEMPTS.elite,
      Number.isInteger(mirror) && mirror >= 0 && mirror <= ATTEMPTS.elite ? mirror : ATTEMPTS.elite);
    record = validate({ version: 1, id: randomUUID(), tier: "elite", rolls, clueRolls: 5,
      defeated: player.getAttribute(LEGACY_DEFEATED_ATTRIBUTE) === true });
    migrated = true;
  } else record = validate(raw);
  const records = ledger(player);
  if (Object.prototype.hasOwnProperty.call(records, record.id)) {
    const previous = validate(records[record.id]);
    if (previous.id !== record.id || previous.tier !== record.tier || previous.clueRolls !== record.clueRolls) invalid();
    record.rolls = Math.min(record.rolls, previous.rolls);
    record.defeated ||= previous.defeated;
  }
  record = save(player, item, record);
  if (migrated) player.setAttribute(LEGACY_DEFEATED_ATTRIBUTE, false);
  return record;
}

function selected(player, item, id) {
  if (item) {
    const record = ensure(player, item);
    if (id != null && record.id !== id) invalid();
    return record;
  }
  if (typeof id !== "string" || !UUID.test(id)) invalid();
  const records = ledger(player);
  if (!Object.prototype.hasOwnProperty.call(records, id)) invalid();
  const record = validate(records[id]);
  if (record.id !== id) invalid();
  return record;
}

function spend(player, item, id) {
  const record = selected(player, item, id);
  if (!record.defeated) record.rolls = Math.max(0, record.rolls - 1);
  return save(player, item, record);
}

function defeat(player, item, id) {
  const record = selected(player, item, id);
  if (record.rolls < 1) invalid();
  record.defeated = true;
  return save(player, item, record);
}

function forOpen(player, item) {
  const record = ensure(player, item);
  const spent = ATTEMPTS[record.tier] - record.rolls;
  return { id: record.id, tier: record.tier, attemptsLeft: record.rolls, attemptsSpent: spent,
    normalRolls: Math.max(0, record.clueRolls - spent), defeated: record.defeated };
}

function forget(player, id) {
  if (typeof id !== "string" || !UUID.test(id)) invalid();
  const records = { ...ledger(player) };
  delete records[id];
  player.setAttribute(LEDGER_ATTRIBUTE, records);
}

module.exports = { META_KEY, LEDGER_ATTRIBUTE, LEGACY_ROLLS_ATTRIBUTE, LEGACY_DEFEATED_ATTRIBUTE, ATTEMPTS,
  initialize, ensure, get: selected, spend, defeat, forOpen, forget };
