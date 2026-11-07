"use strict";

/** Exact map squares, not tile rectangles. Reject aliases so one square has one key. */
function normalizeRegionDensity(raw, botPool, warn = console.warn) {
  const targets = Object.create(null);
  const maxCount = Number.isSafeInteger(botPool) && botPool >= 0 ? botPool : 0;
  if (raw === undefined) return Object.freeze(targets);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warn("[bot sites] activeRegionBotsByRegion must be a map of plane:regionX:regionY to integer counts; ignored");
    return Object.freeze(targets);
  }
  for (const [key, count] of Object.entries(raw)) {
    const parts = key.split(":");
    const validKey = parts.length === 3 && parts.every((part, index) =>
      /^(0|[1-9][0-9]*)$/.test(part) && Number(part) <= (index === 0 ? 3 : 255));
    if (!validKey || !Number.isInteger(count) || count < 0 || count > maxCount) {
      warn(`[bot sites] activeRegionBotsByRegion.${key} needs a canonical map square and integer count from 0 to botPool; ignored`);
      continue;
    }
    targets[key] = count;
  }
  return Object.freeze(targets);
}

module.exports = { normalizeRegionDensity };
