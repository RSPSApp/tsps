"use strict";

// The Wiki rates here are unconditional probabilities. Splitting pre-roll and
// common rows into independent rolls would discount the common rewards twice.
const { ATTEMPTS } = require("./State.Mimic");

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function probability(raw) {
  const match = /^(\d+)\/(\d+)$/.exec(raw ?? "");
  if (!match) throw new Error(`Invalid Mimic reward probability: ${raw}`);
  const numerator = BigInt(match[1]), denominator = BigInt(match[2]);
  if (numerator <= 0n || denominator < numerator) throw new Error("Invalid Mimic reward probability");
  return { numerator, denominator };
}

function quantity(row, attempts, spent) {
  let amount;
  if (row.quantity_options) {
    if (row.quantity_options.length !== attempts) throw new Error("Incomplete Mimic reward quantity options");
    amount = row.quantity_options[spent];
  } else if (row.quantity?.length === 2 && row.quantity[0] === row.quantity[1]) {
    amount = row.quantity[0];
  }
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Ambiguous Mimic reward quantity");
  if (!Number.isSafeInteger(row.item_id) || row.item_id < 0) throw new Error("Unresolved Mimic reward item");
  return { itemId: row.item_id, amount, noted: row.noted === true };
}

/** Pure bonus generation: no inventory mutations, original clue loot or eligibility decisions. */
function roll(tables, tier, remaining, { random = Math.random, includeScrollCase = false } = {}) {
  const attempts = ATTEMPTS[tier];
  if (!attempts) throw new Error("Unsupported Mimic reward tier");
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > attempts) throw new Error("Invalid Mimic attempt state");
  const entries = tables?.[`the_mimic_${tier}`]?.entries;
  if (!Array.isArray(entries) || !entries.length) throw new Error("Missing Mimic reward table");
  const spent = attempts - remaining;
  const always = [], tertiary = [], pool = [];
  for (const row of entries) {
    // Validate every outcome before selecting, so a bad import cannot fail only
    // when the player happens to win an invalid item.
    const drop = quantity(row, attempts, spent);
    if (row.section === "Tertiary") {
      if (row.rarity_raw !== "Always") throw new Error("Unsupported Mimic tertiary reward probability");
      tertiary.push(drop);
    } else if (row.rarity_raw === "Always") always.push(drop);
    else pool.push({ drop, ...probability(spent ? row.alternate_rarity_raw : row.rarity_raw) });
  }
  let denominator = 1n;
  for (const row of pool) denominator = denominator / gcd(denominator, row.denominator) * row.denominator;
  let total = 0n;
  for (const row of pool) {
    row.weight = row.numerator * (denominator / row.denominator);
    total += row.weight;
  }
  if (total !== denominator || total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Incomplete Mimic reward probability pool");
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Invalid Mimic reward random value");
  let hit = value * Number(total);
  const selected = pool.find(row => (hit -= Number(row.weight)) < 0);
  if (!selected) throw new Error("Invalid Mimic reward selection");
  return [...always, selected.drop, ...(includeScrollCase ? tertiary : [])];
}

module.exports = { roll };
