"use strict";

const { ObjectIds } = require("../../../src/main/typescript/elvarg/util/IdEnums");
const {
  ObjectDefinition,
} = require("../../../src/main/typescript/elvarg/game/definition/ObjectDefinition");

const BANK_BOOTH_IDS = new Set(
  Object.entries(ObjectIds)
    .filter(
      ([name, id]) =>
        typeof name === "string" &&
        name.includes("BANK_BOOTH") &&
        Number.isInteger(id)
    )
    .map(([, id]) => id)
);

const usableCache = new Map();

/**
 * BANK_BOOTH_IDS is name-derived and includes non-interactable variants (Draynor
 * 10527, closed booths). Only booths whose definition offers Bank or Use can open
 * the bank, so anything else is a dead click and must not be targeted.
 */
function isUsableBankBooth(objectId) {
  if (!BANK_BOOTH_IDS.has(objectId)) {
    return false;
  }
  const cached = usableCache.get(objectId);
  if (cached !== undefined) {
    return cached;
  }
  const interactions = ObjectDefinition.forId(objectId)?.getInteractions?.() ?? null;
  const usable =
    Array.isArray(interactions) &&
    interactions.some((action) => action === "Bank" || action === "Use");
  usableCache.set(objectId, usable);
  return usable;
}

module.exports = {
  BANK_BOOTH_IDS,
  isUsableBankBooth,
};
