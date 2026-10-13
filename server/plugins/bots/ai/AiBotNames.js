"use strict";

const NAME_PARTS = require("../data/ai-bot-names.json");

const MAX_NAME_LENGTH = 12;
const VALID_NAME = /^[A-Za-z0-9]+( [A-Za-z0-9]+)?$/;

const pick = (list, random) => list[Math.floor(random() * list.length)];
const digits = (random, max) => String(1 + Math.floor(random() * max));
const chance = (random, p) => random() < p;

/**
 * Shapes real OSRS names take: "Its Kenny", "Moist Toast", "SaltyPickle", "Dave Slayer",
 * "Tuna Dave", "Kenny07", "Dharok420", "Lord Potato".
 */
const SHAPES = [
  [3, (r) => `${pick(NAME_PARTS.titles, r)} ${pick(chance(r, 0.5) ? NAME_PARTS.firstNames : NAME_PARTS.nouns, r)}`],
  [4, (r) => `${pick(NAME_PARTS.adjectives, r)} ${pick(NAME_PARTS.nouns, r)}`],
  [2, (r) => `${pick(NAME_PARTS.adjectives, r)}${pick(NAME_PARTS.nouns, r)}`],
  [3, (r) => `${pick(NAME_PARTS.firstNames, r)} ${pick(NAME_PARTS.nouns, r)}`],
  [2, (r) => `${pick(NAME_PARTS.nouns, r)} ${pick(NAME_PARTS.firstNames, r)}`],
  [3, (r) => `${pick(NAME_PARTS.firstNames, r)}${chance(r, 0.5) ? " " : ""}${pick(NAME_PARTS.suffixes, r)}`],
  [2, (r) => `${pick(NAME_PARTS.nouns, r)}${digits(r, chance(r, 0.3) ? 999 : 99)}`],
  [1, (r) => `${pick(NAME_PARTS.nouns, r)}${pick(NAME_PARTS.nouns, r)}`],
];
const SHAPE_WEIGHT = SHAPES.reduce((sum, [weight]) => sum + weight, 0);

function pickShape(random) {
  let roll = random() * SHAPE_WEIGHT;
  return SHAPES.find(([weight]) => (roll -= weight) < 0)[1];
}

/** How people actually spell their names: some leet, some a doubled letter, some lowercase words. */
function style(name, random) {
  if (chance(random, 0.12)) name = name.replace(/o/gi, "0");
  else if (chance(random, 0.06)) name = name.replace(/e/g, "3");
  if (chance(random, 0.05)) name = `${name}${name.slice(-1)}`;
  if (chance(random, 0.2)) name = name.toLowerCase();
  return asLoggedIn(name);
}

/** The name as login shows it (Misc.formatText): each word starts with a capital. */
function asLoggedIn(name) {
  return name.replace(/(^|[^A-Za-z0-9])([a-z])/g, (_, before, letter) => `${before}${letter.toUpperCase()}`);
}

/** A player-like name: letters and digits, at most one space, 12 characters at most. */
function realisticName(random = Math.random) {
  for (;;) {
    const name = style(pickShape(random)(random), random);
    if (name.length <= MAX_NAME_LENGTH && VALID_NAME.test(name)) {
      return name;
    }
  }
}

/**
 * A free name for a new AI bot. `taken(name)` says whether a name is in use (an online
 * player, a save of any account, another AI bot); taken names are never reused, so an AI
 * bot can never load a real player's account.
 */
function chooseName(style, index, taken, random = Math.random) {
  if (style === "numbered") {
    for (let number = index + 1; number < index + 10000; number++) {
      const name = `AiBot${number}`;
      if (!taken(name)) return name;
    }
    return null;
  }
  for (let attempt = 0; attempt < 200; attempt++) {
    const name = realisticName(random);
    if (!taken(name)) return name;
  }
  return null;
}

module.exports = { MAX_NAME_LENGTH, chooseName, realisticName };
