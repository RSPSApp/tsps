"use strict";

/**
 * Tombs of Amascut loot. One unique at most per raid, its chance set by the party's total
 * points and raid level and its recipient picked in proportion to points; everyone else
 * rolls the points-scaled common table. Unclaimed loot stays on the player (persisted) until
 * taken from the reward chest or the lobby's retrieval chest.
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const ATTR_LOOT = "toa:loot";
const LOOT_SLOTS = 6;
const UNIQUE_CAP_PERCENT = 55;
const POINTS_CAP = 64000;
const DUNG_POINTS = 1500;
/** Whether the player has had a Thread of Elidinis: after the first, it's 1/50 (Wiki). */
const ATTR_THREAD = "toa:thread-obtained";
/** The unique a player found, sealed in Osmumten's sarcophagus until they open it. */
const ATTR_SARCOPHAGUS = "toa:sarcophagus";

/** Common table: an item and its points divisor (quantity = points / divisor). NR RewardEncounter. */
function commonTable(I) {
  return [
    [I.COINS, 1], [I.DEATH_RUNE, 20], [I.SOUL_RUNE, 40], [I.GOLD_ORE, 90], [I.DRAGON_DART_TIP, 100],
    [I.MAHOGANY_LOGS, 100], [I.SAPPHIRE, 200], [I.EMERALD, 250], [I.GOLD_BAR, 250], [I.POTATO_CACTUS, 250],
    [I.RAW_SHARK, 250], [I.RUBY, 300], [I.DIAMOND, 400], [I.RAW_MANTA_RAY, 450], [I.CACTUS_SPINE, 600],
    [I.DRAGONSTONE, 600], [I.BATTLESTAFF, 1100], [I.COCONUT_MILK, 1100], [I.LILY_OF_THE_SANDS, 1100],
    [I.TOADFLAX_SEED, 1400], [I.RANARR_SEED, 1800], [I.TORSTOL_SEED, 2200], [I.SNAPDRAGON_SEED, 2200],
    [I.DRAGON_MED_HELM, 4000], [I.MAGIC_SEED, 6500], [I.BLOOD_ESSENCE, 7500],
  ];
}

/**
 * Wiki unique weights: out of 24 up to raid level 300, out of 19 at 400 and 16.5 at 500 as the
 * fang and lightbearer get rarer (interpolated between, and held past 500). `level`: the rare
 * ones need raid level 150, the rest 50, or a 1/50 roll.
 */
function uniqueTable(I, raidLevel) {
  const between = (at300, at400, at500) => {
    if (raidLevel <= 300) return at300;
    if (raidLevel <= 400) return at300 + (at400 - at300) * (raidLevel - 300) / 100;
    return at400 + (at500 - at400) * (Math.min(500, raidLevel) - 400) / 100;
  };
  return [
    { id: I.LIGHTBEARER, weight: between(7, 5, 3.5), level: 50 },
    { id: I.OSMUMTENS_FANG, weight: between(7, 4, 3), level: 50 },
    { id: I.ELIDINIS_WARD, weight: 3, level: 150 },
    { id: I.MASORI_MASK, weight: 2, level: 150 },
    { id: I.MASORI_BODY, weight: 2, level: 150 },
    { id: I.MASORI_CHAPS, weight: 2, level: 150 },
    { id: I.TUMEKENS_SHADOW_UNCHARGED_, weight: 1, level: 150 },
  ];
}

/** The keris partisan jewels, each with the partisan it makes (owning either counts). */
function jewels(I) {
  return [
    [I.BREACH_OF_THE_SCARAB, I.KERIS_PARTISAN_OF_BREACHING],
    [I.JEWEL_OF_THE_SUN, I.KERIS_PARTISAN_OF_THE_SUN],
    [I.EYE_OF_THE_CORRUPTOR, I.KERIS_PARTISAN_OF_CORRUPTION],
    [I.JEWEL_OF_AMASCUT, I.KERIS_PARTISAN_OF_AMASCUT],
  ];
}

/** Each boss's invocations; all of one set at raid level 450+ earns its remnant. */
const REMNANT_SETS = [
  ["REMNANT_OF_AKKHA", ["DOUBLE_TROUBLE", "KEEP_BACK", "STAY_VIGILANT", "FEELING_SPECIAL"]],
  ["REMNANT_OF_ZEBAK", ["NOT_JUST_A_HEAD", "ARTERIAL_SPRAY", "BLOOD_THINNERS", "UPSET_STOMACH"]],
  ["REMNANT_OF_BA_BA", ["MIND_THE_GAP", "GOTTA_HAVE_FAITH", "JUNGLE_JAPES", "SHAKING_THINGS_UP", "BOULDERDASH"]],
  ["REMNANT_OF_KEPHRI", ["LIVELY_LARVAE", "MORE_OVERLORDS", "BLOWING_MUD", "MEDIC", "AERIAL_ASSAULT"]],
  ["ANCIENT_REMNANT", ["ANCIENT_HASTE", "ACCELERATION", "PENETRATION", "OVERCLOCKED", "OVERCLOCKED_2", "INSANITY"]],
];

function lootOf(player) {
  const loot = player.getAttribute(ATTR_LOOT);
  return Array.isArray(loot) ? loot : [];
}

function setLoot(player, loot) {
  player.setAttribute(ATTR_LOOT, loot.length > 0 ? loot : null);
}

function hasLoot(player) {
  return lootOf(player).length > 0;
}

/** The unique waiting in the sarcophagus for this player, or -1. */
function sealedUnique(player) {
  const id = player.getAttribute(ATTR_SARCOPHAGUS);
  return Number.isInteger(id) && id > 0 ? id : -1;
}

/** Moves the sarcophagus's unique to the front of the player's loot; returns its id or -1. */
function unsealUnique(player) {
  const id = sealedUnique(player);
  if (id === -1) return -1;
  player.setAttribute(ATTR_SARCOPHAGUS, null);
  setLoot(player, [{ id, amount: 1 }, ...lootOf(player)]);
  return id;
}

/** Anything still to collect: chest loot or an unopened sarcophagus. */
function hasRewards(player) {
  return hasLoot(player) || sealedUnique(player) !== -1;
}

/**
 * Wiki: 1% per 10,500 - 20 x RL total points, RL being the raid level up to 310, a third of it
 * from 310 to 430 and a sixth beyond; points capped at 64,000 and the chance at 55%.
 */
function uniqueChancePercent(points, raidLevel) {
  const rl = raidLevel <= 310 ? raidLevel
    : raidLevel <= 430 ? 310 + (raidLevel - 310) / 3
      : 350 + (raidLevel - 430) / 6;
  return Math.min(UNIQUE_CAP_PERCENT, Math.min(POINTS_CAP, points) / (10500 - 20 * rl));
}

/** Wiki: 1% per 350,000 - 700 x RL total points, RL scaled at 400 and 550. */
function petChancePercent(points, raidLevel) {
  const rl = Math.min(400, raidLevel) + Math.max(0, Math.min(150, raidLevel - 400)) / 3;
  return Math.min(POINTS_CAP, points) / (350000 - 700 * rl);
}

/** Wiki: the thread and the jewels go from their base rate to three times it with kill count. */
function scaledRate(base, completions, fullAt) {
  return base * (1 + 2 * Math.min(1, completions / fullAt));
}

function weightedPick(entries, weightOf) {
  const total = entries.reduce((sum, entry) => sum + weightOf(entry), 0);
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

function owns(player, id) {
  const { Bank } = Shared.core();
  if (player.getInventory().contains(id) || player.getEquipment().contains(id)) return true;
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (player.getBank(tab)?.contains?.(id)) return true;
  }
  return false;
}

/**
 * Rolls every player's chest for a finished raid. Returns { uniqueWinner, uniqueId, petWinner }.
 * `raid.forcedLoot` ({ player, unique, pet }, set by ::toaskiptoreward) guarantees that player a
 * unique (`unique`: an item id, or true for one picked by the usual weights) and/or the pet.
 */
function rollRaidLoot(raid) {
  const I = Shared.core().ItemIdentifiers;
  const players = raid.players.slice();
  const pointsOf = (player) => raid.lootPoints(player);
  const raidLevel = raid.raidLevel;
  const total = players.reduce((sum, player) => sum + pointsOf(player), 0);
  const chance = uniqueChancePercent(total, raidLevel);
  const forced = raid.forcedLoot && players.includes(raid.forcedLoot.player) ? raid.forcedLoot : null;
  let uniqueWinner = null;
  let uniqueId = -1;
  if (forced?.unique) {
    uniqueWinner = forced.player;
    uniqueId = forced.unique === true ? weightedPick(uniqueTable(I, raidLevel), (entry) => entry.weight).id : forced.unique;
  } else if (Math.random() * 100 < chance) {
    const unique = weightedPick(uniqueTable(I, raidLevel), (entry) => entry.weight);
    if (raidLevel >= unique.level || Shared.random(0, 49) === 0) {
      uniqueWinner = weightedPick(players, (player) => Math.max(0, pointsOf(player)));
      uniqueId = unique.id;
    }
  }
  const petChance = petChancePercent(total, raidLevel);
  const petWinner = forced?.pet ? forced.player
    : Math.random() * 100 < petChance ? weightedPick(players, (player) => Math.max(0, pointsOf(player))) : null;
  for (const player of players) {
    // Wiki: the unique waits in Osmumten's sarcophagus, and its finder's chest has no common
    // rolls (its tertiaries still come).
    if (player === uniqueWinner) player.setAttribute(ATTR_SARCOPHAGUS, uniqueId);
    const loot = rollPlayer(raid, player, player === uniqueWinner);
    if (player === petWinner) loot.push({ id: I.TUMEKENS_GUARDIAN, amount: 1 });
    setLoot(player, loot.slice(0, LOOT_SLOTS));
  }
  return { uniqueWinner, uniqueId, petWinner };
}

function rollPlayer(raid, player, foundUnique) {
  const I = Shared.core().ItemIdentifiers;
  const points = raid.lootPoints(player);
  const raidLevel = raid.raidLevel;
  const loot = [];
  const add = (id, amount = 1) => {
    if (loot.length >= LOOT_SLOTS || amount <= 0) return;
    const existing = loot.find((entry) => entry.id === id);
    if (existing) existing.amount += amount;
    else loot.push({ id, amount });
  };
  if (points < DUNG_POINTS && !foundUnique) {
    add(I.FOSSILISED_DUNG);
    return loot;
  }
  if (raid.totalDeaths < 1) {
    if (raidLevel >= 350 && !owns(player, I.MASORI_CRAFTING_KIT)) add(I.MASORI_CRAFTING_KIT);
    if (raidLevel >= 400 && !owns(player, I.MENAPHITE_ORNAMENT_KIT)) add(I.MENAPHITE_ORNAMENT_KIT);
    if (raidLevel >= 450) {
      const remnant = REMNANT_SETS.find(([key, invocations]) =>
        invocations.every((name) => raid.settings.isActive(name)) && !owns(player, I[key]));
      if (remnant) add(I[remnant[0]]);
    }
    if (raidLevel >= 500) add(I.CURSED_PHALANX);
  }
  if (!foundUnique) {
    const factor = raidLevel < 300 ? 1 : 1.15 + 0.01 * ((raidLevel - 300) / 5);
    const table = commonTable(I).filter(([, divisor]) => points >= divisor);
    for (let roll = 0; roll < 3 && table.length > 0; roll++) {
      const [id, divisor] = Shared.randomOf(table);
      add(id, Math.floor(Math.floor(points / divisor) * factor));
    }
  }
  const counts = Raid.killCounts(player);
  const completions = counts.entry + counts.normal + counts.expert;
  // Wiki: 1/10 rising to 3/10 at 15 completions, then 1/50 once one has been had.
  const threadRate = player.getAttribute(ATTR_THREAD) ? 1 / 50 : scaledRate(1 / 10, completions, 15);
  if (Math.random() < threadRate) {
    add(I.THREAD_OF_ELIDINIS);
    player.setAttribute(ATTR_THREAD, true);
  }
  // Wiki: 1/50 for each of the four jewels, up to three times that at 75 completions; no
  // duplicate until all have been had (the jewel or its partisan held).
  if (Math.random() < scaledRate(4 / 50, completions, 75)) {
    const all = jewels(I);
    const missing = all.filter(([jewel, partisan]) => !owns(player, jewel) && !owns(player, partisan));
    add(Shared.randomOf(missing.length > 0 ? missing : all)[0]);
  }
  // Wiki: 1/100 per 2,000 points, up to 25/100.
  if (Math.random() * 100 < Math.min(25, points / 2000)) add(I.CLUE_SCROLL_ELITE_);
  return loot;
}

module.exports = {
  ATTR_LOOT,
  ATTR_THREAD,
  ATTR_SARCOPHAGUS,
  LOOT_SLOTS,
  lootOf,
  setLoot,
  hasLoot,
  sealedUnique,
  unsealUnique,
  hasRewards,
  uniqueChancePercent,
  petChancePercent,
  rollRaidLoot,
};
