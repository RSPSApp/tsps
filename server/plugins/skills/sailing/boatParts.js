// A boat's core parts (hull, keel, sails, helm) and what they make of it, read from the cache's
// sailing tables: each boat type's row (table 166) lists its part options by tier, and each
// option row gives the part's loc, Sailing and Construction levels, materials and stats row
// (table 164). Construction XP isn't in the cache; it comes from the OSRS Wiki
// (sailing-parts.json). Column meanings are in docs/sailing-osrs-reference.md.
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { content, boatType } = require("./sailingContent");

/**
 * Where each part's option list and fields are, per part table. The lists are table 166's
 * keel_option (24), hull_option (25), sail_option (26) and steering_option (28; rev 241 added
 * sail_pattern_option at 27).
 */
const PART_COLUMNS = {
  hull: { list: 25, sailing: 7, construction: 8, materials: 12, stats: 13 },
  keel: { list: 24, sailing: 6, construction: 7, materials: 11, stats: 12, loc: [3, 1] },
  // Table 179 lost its three interact_* columns in rev 241: loc 15 -> 12, facility_stats 16 -> 13.
  sails: { list: 26, sailing: 6, construction: 7, materials: 11, stats: 13, loc: [12, 0] },
  helm: { list: 28, sailing: 9, construction: 10, materials: 14, stats: 15, loc: [6, 1] },
};
const PARTS = Object.keys(PART_COLUMNS);
/** Boat type row column: the recovery fee. */
const TYPE_RECOVERY_FEE = 18;
/** Stats row (table 164) columns. */
const STAT = {
  hitpoints: 0,
  armour: 10,
  stormResistance: 21,
  rapidResistance: 22,
  baseSpeed: 24,
  speedCap: 25,
  extraAcceleration: 26,
  speedBoostDuration: 27,
  crystalFleckedResistance: 30,
};
/** Acceleration without camphor-or-better sails (0.5 tiles). */
const BASE_ACCELERATION = 64;

function typeRow(type) {
  const row = boatType(type)?.sidepanelBoatType;
  return row === undefined ? undefined : CacheDefinitions.getDbRow(row);
}

/** A boat type's options for a part, by tier (empty when it has none, like a raft's keel). */
function partOptions(type, part) {
  return typeRow(type)?.column(PART_COLUMNS[part].list) ?? [];
}

function tierOf(boat, part) {
  return boat.parts?.[part] ?? 0;
}

/** The option row a boat has built for a part, or undefined. */
function builtPart(boat, part) {
  const option = partOptions(boat.type, part)[tierOf(boat, part)];
  return option === undefined ? undefined : CacheDefinitions.getDbRow(option);
}

function partStats(boat, part) {
  const row = builtPart(boat, part);
  const stats = row && row.int(PART_COLUMNS[part].stats, -1);
  return stats >= 0 ? CacheDefinitions.getDbRow(stats) : undefined;
}

/** The boat's stats from its parts: HP is the hull's plus the keel's, and so on. */
function boatStats(boat) {
  const hull = partStats(boat, "hull");
  const keel = partStats(boat, "keel");
  const sails = partStats(boat, "sails");
  const helm = partStats(boat, "helm");
  const stat = (row, column) => row?.int(column) ?? 0;
  return {
    hitpoints: stat(hull, STAT.hitpoints) + stat(keel, STAT.hitpoints),
    armour: stat(keel, STAT.armour),
    baseSpeed: stat(hull, STAT.baseSpeed),
    speedCap: stat(hull, STAT.speedCap),
    acceleration: BASE_ACCELERATION + stat(sails, STAT.extraAcceleration),
    speedBoostDuration: stat(sails, STAT.speedBoostDuration),
    stormResistance: stat(sails, STAT.stormResistance),
    rapidResistance: stat(helm, STAT.rapidResistance),
    crystalFleckedResistance: stat(keel, STAT.crystalFleckedResistance),
  };
}

/** The sidepanel's and login's part tier values; the trim follows the hull, as captured. */
function partTiers(boat) {
  return {
    hull: tierOf(boat, "hull"),
    keel: tierOf(boat, "keel"),
    sail: tierOf(boat, "sails"),
    steering: tierOf(boat, "helm"),
    trim: tierOf(boat, "hull"),
  };
}

function recoveryFee(boat) {
  return typeRow(boat.type)?.int(TYPE_RECOVERY_FEE) ?? 0;
}

/**
 * Builds a boat's spec from its parts: the deck template's column is the hull tier (8 tiles a
 * tier), each part loc is its option's, and the trim's model follows the hull.
 */
function specFor(boat, base) {
  const hull = tierOf(boat, "hull");
  const locs = base.locs.map((loc) => {
    if (loc.part === "trim") return { ...loc, id: loc.id + hull };
    const columns = PART_COLUMNS[loc.part];
    if (!columns?.loc) return loc;
    const id = builtPart(boat, loc.part)?.column(columns.loc[0])[columns.loc[1]];
    return typeof id === "number" ? { ...loc, id } : loc;
  });
  const baseSpeed = boatStats(boat).baseSpeed || base.stats?.baseSpeed;
  return { ...base, templateChunkX: base.templateChunkX + hull, locs, stats: { ...base.stats, baseSpeed } };
}

/** The part and tier a customisation option row (the Build trigger's argument) is for. */
function optionFor(boat, optionRow) {
  for (const part of PARTS) {
    const tier = partOptions(boat.type, part).indexOf(optionRow);
    if (tier >= 0) return { part, tier };
  }
  return undefined;
}

/** What building an option needs: levels and materials as [item, count] pairs. */
function requirementsOf(part, optionRow) {
  const row = CacheDefinitions.getDbRow(optionRow);
  const columns = PART_COLUMNS[part];
  const flat = row?.column(columns.materials) ?? [];
  const materials = [];
  for (let i = 0; i + 1 < flat.length; i += 2) materials.push([flat[i], flat[i + 1]]);
  return {
    name: row?.string(0) ?? "",
    sailing: row?.int(columns.sailing, 1) ?? 1,
    construction: row?.int(columns.construction, 1) ?? 1,
    materials,
  };
}

function constructionXp(type, part, tier) {
  return content().parts?.construction_xp?.[type]?.[part]?.[tier] ?? 0;
}

module.exports = {
  PARTS,
  PART_COLUMNS,
  STAT,
  TYPE_RECOVERY_FEE,
  partOptions,
  boatStats,
  partTiers,
  recoveryFee,
  specFor,
  optionFor,
  requirementsOf,
  constructionXp,
};
