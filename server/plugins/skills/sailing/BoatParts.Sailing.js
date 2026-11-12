// A boat's core parts (hull, keel, sails, helm), its cosmetic ones (trim, flag, eternal brazier)
// and what they make of it, read from the cache's
// sailing tables: each boat type's row (table 166) lists its part options by tier, and each
// option row gives the part's loc, Sailing and Construction levels, materials and stats row
// (table 164). Construction XP isn't in the cache; it comes from the OSRS Wiki
// (sailing-parts.json). Column meanings are in docs/sailing-osrs-reference.md.
const { CacheDefinitions } = require("../../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { content, boatType } = require("./SailingContent.Sailing");

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
/**
 * The parts built once rather than by tier: table 166's flag_option (29), trim_option (30) and
 * brazier_option (31), and their rows' fields (tables 184, 186, 185). `loc` is the
 * [coord, id, rotation, shape] tuple's column. A trim's value is its position in the list (the
 * first seven are "No trim", one per hull tier); a flag's is its row's column 13; the brazier's 1.
 */
const COSMETIC_COLUMNS = {
  trim: { list: 30, sailing: 5, construction: 6, materials: 10, loc: 2 },
  flag: { list: 29, sailing: 6, construction: 7, materials: 11, loc: 5, value: 13 },
  brazier: { list: 31, sailing: 7, construction: 8, materials: 12, loc: 6, stats: 13 },
};
const COSMETIC_PARTS = Object.keys(COSMETIC_COLUMNS);
/** "No trim" rows, one per hull tier, come first in a trim list. */
const UNPAINTED_TRIMS = 7;
/** The flags' fabric rolls are needed to build one, and kept (Wiki: Flags). */
const KEPT_MATERIALS = new Set([31734, 31746, 31758]);
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
  icySeasResistance: 32,
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

/** The built eternal brazier's stats row, if the boat has one. */
function brazierStats(boat) {
  const row = builtCosmetic(boat, "brazier");
  const stats = row?.int(COSMETIC_COLUMNS.brazier.stats, -1) ?? -1;
  return stats >= 0 ? CacheDefinitions.getDbRow(stats) : undefined;
}

/** The boat's stats from its parts: HP is the hull's plus the keel's, and so on. */
function statsFromParts(hull, keel, sails, helm, brazier) {
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
    icySeasResistance: stat(brazier, STAT.icySeasResistance),
  };
}

function boatStats(boat) {
  return statsFromParts(...["hull", "keel", "sails", "helm"].map(part => partStats(boat, part)), brazierStats(boat));
}

/** A temporary boat's authored type row has parts, without any owned boat slot or tiers. */
function boatStatsForRow(typeRowId) {
  const row = CacheDefinitions.getDbRow(typeRowId);
  if (!row) return undefined;
  const parts = [];
  for (const part of ["hull", "keel", "sails", "helm"]) {
    const columns = PART_COLUMNS[part];
    const optionId = row.column(columns.list)[0];
    if (typeof optionId !== "number") return undefined;
    const option = CacheDefinitions.getDbRow(optionId);
    if (!option) return undefined;
    const statsId = option.int(columns.stats, -1);
    // Like partStats, an existing option can have no stats reference.
    if (statsId < 0) {
      parts.push(undefined);
      continue;
    }
    const stats = CacheDefinitions.getDbRow(statsId);
    if (!stats) return undefined;
    parts.push(stats);
  }
  return statsFromParts(...parts);
}

/** The sidepanel's and login's part values; an unpainted trim follows the hull, as captured. */
function partTiers(boat) {
  return {
    hull: tierOf(boat, "hull"),
    keel: tierOf(boat, "keel"),
    sail: tierOf(boat, "sails"),
    steering: tierOf(boat, "helm"),
    trim: trimOf(boat),
    flag: boat.parts?.flag ?? 0,
    brazier: boat.parts?.brazier ?? 0,
  };
}

/** The trim's position in the type's trim list: the paint applied, or the hull's own "No trim". */
function trimOf(boat) {
  return boat.parts?.trim ?? tierOf(boat, "hull");
}

/** A cosmetic part's option list for a boat type (empty when it has none, like a raft's trims). */
function cosmeticOptions(type, part) {
  return typeRow(type)?.column(COSMETIC_COLUMNS[part].list) ?? [];
}

/** What an option sets its part to: a trim's list position, a flag's number, the brazier's 1. */
function cosmeticValue(part, optionRow, options) {
  if (part === "trim") return options.indexOf(optionRow);
  if (part === "flag") return CacheDefinitions.getDbRow(optionRow)?.int(COSMETIC_COLUMNS.flag.value, 0) ?? 0;
  return 1;
}

/** The row of the cosmetic part a boat has built, or undefined. */
function builtCosmetic(boat, part) {
  const options = cosmeticOptions(boat.type, part);
  const value = part === "trim" ? trimOf(boat) : boat.parts?.[part] ?? 0;
  const option = part === "trim" ? options[value]
    : value > 0 ? options.find((row) => cosmeticValue(part, row, options) === value) : undefined;
  return option === undefined ? undefined : CacheDefinitions.getDbRow(option);
}

/**
 * A cosmetic part's loc on the deck, from its row's [coord, id, rotation, shape]: the coord is a
 * tile of the type's base template, so the deck tile is it less the template's corner.
 */
function cosmeticLoc(base, part, row) {
  const [coord, id, rotation, shape] = row.column(COSMETIC_COLUMNS[part].loc);
  if (typeof id !== "number") return undefined;
  return {
    id,
    x: ((coord >> 14) & 0x3fff) - base.templateChunkX * 8,
    y: (coord & 0x3fff) - base.templateChunkY * 8,
    level: coord >>> 28,
    shape,
    rotation,
    part,
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
  const paint = boat.parts?.trim === undefined ? undefined : builtCosmetic(boat, "trim");
  const locs = base.locs.map((loc) => {
    if (loc.part === "trim") return { ...loc, id: paint?.column(COSMETIC_COLUMNS.trim.loc)?.[1] ?? loc.id + hull };
    if (loc.part === "sailCloth") return { ...loc, id: sailClothFor(boat, base) ?? loc.id };
    const columns = PART_COLUMNS[loc.part];
    if (!columns?.loc) return loc;
    const id = builtPart(boat, loc.part)?.column(columns.loc[0])[columns.loc[1]];
    return typeof id === "number" ? { ...loc, id } : loc;
  });
  for (const part of ["flag", "brazier"]) {
    const row = builtCosmetic(boat, part);
    const loc = row && cosmeticLoc(base, part, row);
    if (loc) locs.push(loc);
  }
  const stats = boatStats(boat);
  const baseSpeed = stats.baseSpeed || base.stats?.baseSpeed;
  return {
    ...base,
    templateChunkX: base.templateChunkX + hull,
    locs,
    stats: {
      ...base.stats, baseSpeed, speedCap: stats.speedCap || undefined, speedBoostDuration: stats.speedBoostDuration || undefined,
      acceleration: stats.acceleration,
    },
  };
}

/**
 * The sail cloth that goes with the built sails: the option's name says its material ("Teak mast
 * and canvas sails"), and boats.json `sailCloths` has that material's cloth loc for the boat's size.
 */
function sailClothFor(boat, base) {
  const material = /and (\w+) sails/i.exec(builtPart(boat, "sails")?.string(0) ?? "")?.[1]?.toLowerCase();
  return material ? base.sailCloths?.[material] : undefined;
}

/**
 * The part and tier (a cosmetic part's value) a customisation option row (the Build trigger's
 * argument) is for. A "No trim" option has no tier: building it takes the paint off.
 */
function optionFor(boat, optionRow) {
  for (const part of PARTS) {
    const tier = partOptions(boat.type, part).indexOf(optionRow);
    if (tier >= 0) return { part, tier };
  }
  for (const part of COSMETIC_PARTS) {
    const options = cosmeticOptions(boat.type, part);
    if (!options.includes(optionRow)) continue;
    const tier = cosmeticValue(part, optionRow, options);
    return { part, tier: part === "trim" && tier < UNPAINTED_TRIMS ? undefined : tier };
  }
  return undefined;
}

/** Whether the boat already has that option built. */
function hasBuilt(boat, option) {
  if (option.part === "trim") return boat.parts?.trim === option.tier;
  return (boat.parts?.[option.part] ?? 0) === option.tier;
}

/** The boat's parts once an option is built. */
function withOption(boat, option) {
  const parts = { ...boat.parts, [option.part]: option.tier };
  if (option.tier === undefined) delete parts[option.part];
  return parts;
}

/** What building an option needs: levels and materials as [item, count] pairs. */
function requirementsOf(part, optionRow) {
  const row = CacheDefinitions.getDbRow(optionRow);
  const columns = PART_COLUMNS[part] ?? COSMETIC_COLUMNS[part];
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

/** A build's Construction XP (Wiki); taking a trim's paint off gives none (ours). */
function constructionXp(type, part, tier) {
  if (COSMETIC_COLUMNS[part]) return tier === undefined ? 0 : content().parts?.cosmetic_construction_xp?.[type]?.[part] ?? 0;
  return content().parts?.construction_xp?.[type]?.[part]?.[tier] ?? 0;
}

module.exports = {
  PARTS,
  PART_COLUMNS,
  COSMETIC_PARTS,
  KEPT_MATERIALS,
  STAT,
  TYPE_RECOVERY_FEE,
  partOptions,
  boatStats,
  boatStatsForRow,
  partTiers,
  recoveryFee,
  specFor,
  optionFor,
  hasBuilt,
  withOption,
  requirementsOf,
  constructionXp,
};
