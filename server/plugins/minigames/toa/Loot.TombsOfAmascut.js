"use strict";

/**
 * Tombs of Amascut loot. One unique at most per raid, its chance set by the party's total
 * points and raid level and its recipient picked in proportion to points; everyone else
 * rolls the points-scaled common table. Unclaimed loot stays on the player (persisted) until
 * taken from the reward chest or the lobby's retrieval chest.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const ATTR_LOOT = "toa:loot";
const LOOT_SLOTS = 6;
const UNIQUE_CAP_PERCENT = 55;
const POINTS_CAP = 64000;
const DUNG_POINTS = 1500;
/** Whether the player has had a Thread of Elidinis: after the first, it's 1/50 (Wiki). */
const ATTR_THREAD = "toa:thread-obtained";
/** The unique a player found, sealed in Osmumten's sarcophagus until they open it. */
const ATTR_SARCOPHAGUS = "toa:sarcophagus";

/**
 * Wiki (Chest (Tombs of Amascut)): the common table, an item and its points divisor (quantity =
 * points / divisor), three rolls of 1/27 each; the Cache of runes is always one. Captures show the
 * unnoted ids in the chest (inv 811), and the Wiki's "(noted)" items come out noted (`noted`).
 */
function commonTable(I) {
  return [
    [I.CACHE_OF_RUNES, 0], [I.COINS, 1], [I.DEATH_RUNE, 20], [I.SOUL_RUNE, 40], [I.GOLD_ORE, 90, true], [I.DRAGON_DART_TIP, 100],
    [I.MAHOGANY_LOGS, 180, true], [I.SAPPHIRE, 200, true], [I.EMERALD, 250, true], [I.GOLD_BAR, 250, true], [I.POTATO_CACTUS, 250, true],
    [I.RAW_SHARK, 250, true], [I.RUBY, 300, true], [I.DIAMOND, 400, true], [I.RAW_MANTA_RAY, 450, true], [I.CACTUS_SPINE, 600, true],
    [I.DRAGONSTONE, 600, true], [I.BATTLESTAFF, 1100, true], [I.COCONUT_MILK, 1100, true], [I.LILY_OF_THE_SANDS, 1100, true],
    [I.TOADFLAX_SEED, 2000], [I.RANARR_SEED, 2500], [I.TORSTOL_SEED, 3200], [I.SNAPDRAGON_SEED, 3200],
    [I.DRAGON_MED_HELM, 4000, true], [I.MAGIC_SEED, 6500], [I.BLOOD_ESSENCE, 7500],
  ];
}

/**
 * Wiki unique weights, its table's chances as weights: the fang and lightbearer 7 each up to raid
 * level 300; then 6 and 6 at 350, 4 and 5 at 400, 4 and 4 at 450, 3 and 3.5 at 500 ("adjusted every
 * 5 levels" since 20 August 2025, so interpolated in steps of 5, and held past 500). The others
 * don't move. `level`: the rare ones need raid level 150, the rest 50, or a 1/50 roll.
 */
const FANG_LIGHTBEARER_WEIGHTS = [[300, 7, 7], [350, 6, 6], [400, 4, 5], [450, 4, 4], [500, 3, 3.5]];

function uniqueTable(I, raidLevel) {
  const level = Math.floor(Math.min(500, Math.max(300, raidLevel)) / 5) * 5;
  let index = 0;
  while (index < FANG_LIGHTBEARER_WEIGHTS.length - 2 && level > FANG_LIGHTBEARER_WEIGHTS[index + 1][0]) index++;
  const [fromLevel, fromFang, fromLight] = FANG_LIGHTBEARER_WEIGHTS[index];
  const [toLevel, toFang, toLight] = FANG_LIGHTBEARER_WEIGHTS[index + 1];
  const part = (level - fromLevel) / (toLevel - fromLevel);
  return [
    { id: I.LIGHTBEARER, weight: fromLight + (toLight - fromLight) * part, level: 50 },
    { id: I.OSMUMTENS_FANG, weight: fromFang + (toFang - fromFang) * part, level: 50 },
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

/**
 * Wiki's challenge rewards: at raid level 450+, with no deaths, all of a boss's invocations and its
 * path at level 4 earn its remnant (the Wardens need only theirs). One per raid, in Mod Ash's order.
 */
const REMNANT_SETS = [
  ["REMNANT_OF_AKKHA", "HET", ["DOUBLE_TROUBLE", "KEEP_BACK", "STAY_VIGILANT", "FEELING_SPECIAL"]],
  ["REMNANT_OF_ZEBAK", "CRONDIS", ["NOT_JUST_A_HEAD", "ARTERIAL_SPRAY", "BLOOD_THINNERS", "UPSET_STOMACH"]],
  ["REMNANT_OF_BA_BA", "APMEKEN", ["MIND_THE_GAP", "GOTTA_HAVE_FAITH", "JUNGLE_JAPES", "SHAKING_THINGS_UP", "BOULDERDASH"]],
  ["REMNANT_OF_KEPHRI", "SCABARAS", ["LIVELY_LARVAE", "MORE_OVERLORDS", "BLOWING_MUD", "MEDIC", "AERIAL_ASSAULT"]],
  ["ANCIENT_REMNANT", null, ["ANCIENT_HASTE", "ACCELERATION", "PENETRATION", "OVERCLOCKED", "OVERCLOCKED_2", "INSANITY"]],
];
const REMNANT_LEVEL = 450;
const REMNANT_PATH_LEVEL = 4;
const KIT_LEVEL = 350;
const ORNAMENT_LEVEL = 425;
const PHALANX_LEVEL = 500;

function lootOf(player) {
  const loot = player.getAttribute(ATTR_LOOT);
  return Array.isArray(loot) ? loot : [];
}

function setLoot(player, loot) {
  player.setAttribute(ATTR_LOOT, loot.length > 0 ? loot : null);
}

/**
 * The loot is opened (the sarcophagus searched, a chest opened): as in OSRS, that is when it
 * reaches the collection log. Each entry is marked, so reopening a part-claimed chest adds nothing.
 */
function logClaimed(player) {
  const loot = lootOf(player);
  let changed = false;
  for (const entry of loot) {
    if (entry.logged) continue;
    Shared.api().emitCustomEvent("collection-log:obtain", { player, itemId: entry.id, amount: entry.amount });
    entry.logged = true;
    changed = true;
  }
  if (changed) setLoot(player, loot);
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

/** Wiki (Rewards Niche): entering another raid destroys what's unclaimed. */
function destroyRewards(player) {
  player.setAttribute(ATTR_LOOT, null);
  player.setAttribute(ATTR_SARCOPHAGUS, null);
  player.getPacketSender().sendVarbit(Shared.VARBIT.SHOULD_HAVE_LOOT, 0);
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

/** The noted form of an item, where it has one (Wiki's "(noted)"). */
function notedId(id) {
  const noted = Shared.core().ItemDefinition.forId(id)?.getNoteId?.() ?? -1;
  return noted > 0 ? noted : id;
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
  // Wiki (Mod Ash): the points of those who left still count towards the unique; if it's theirs,
  // nobody here gets it.
  const present = players.reduce((sum, player) => sum + pointsOf(player), 0);
  const departed = raid.departedPoints ?? 0;
  const total = present + departed;
  const chance = uniqueChancePercent(total, raidLevel);
  const forced = raid.forcedLoot && players.includes(raid.forcedLoot.player) ? raid.forcedLoot : null;
  let uniqueWinner = null;
  let uniqueId = -1;
  if (forced?.unique) {
    uniqueWinner = forced.player;
    uniqueId = forced.unique === true ? weightedPick(uniqueTable(I, raidLevel), (entry) => entry.weight).id : forced.unique;
  } else if (Math.random() * 100 < chance) {
    const unique = weightedPick(uniqueTable(I, raidLevel), (entry) => entry.weight);
    if ((raidLevel >= unique.level || Shared.random(0, 49) === 0) && Math.random() * total < present) {
      uniqueWinner = weightedPick(players, (player) => Math.max(0, pointsOf(player)));
      uniqueId = unique.id;
    }
  }
  const petChance = petChancePercent(present, raidLevel);
  const petWinner = forced?.pet ? forced.player
    : Math.random() * 100 < petChance ? weightedPick(players, (player) => Math.max(0, pointsOf(player))) : null;
  for (const player of players) {
    // Wiki: the unique waits in Osmumten's sarcophagus, and its finder's chest has no common
    // rolls (its tertiaries still come).
    if (player === uniqueWinner) player.setAttribute(ATTR_SARCOPHAGUS, uniqueId);
    const loot = rollPlayer(raid, player, player === uniqueWinner);
    const capped = loot.slice(0, player === petWinner ? LOOT_SLOTS - 1 : LOOT_SLOTS);
    if (player === petWinner) capped.push({ id: I.TUMEKENS_GUARDIAN, amount: 1 });
    setLoot(player, capped);
    if (player === petWinner) {
      // The pet appears at raid completion rather than waiting in the chest; Pets owns
      // the duplicate policy and the follower spawn. Only the pet is rolled here: the rest of
      // the loot reaches the collection log when it is claimed (logClaimed).
      const pet = [{ id: I.TUMEKENS_GUARDIAN, amount: 1 }];
      Shared.api().emitCustomEvent("npc-drops:roll", { player, drops: pet });
      if (pet.length === 0) setLoot(player, lootOf(player).filter((entry) => entry.id !== I.TUMEKENS_GUARDIAN));
    }
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
  if (raid.totalDeaths < 1) {
    if (raidLevel >= KIT_LEVEL && !owns(player, I.MASORI_CRAFTING_KIT)) add(I.MASORI_CRAFTING_KIT);
    if (raidLevel >= ORNAMENT_LEVEL && !owns(player, I.MENAPHITE_ORNAMENT_KIT)) add(I.MENAPHITE_ORNAMENT_KIT);
    if (raidLevel >= REMNANT_LEVEL) {
      const remnant = REMNANT_SETS.find(([key, path, invocations]) =>
        invocations.every((name) => raid.settings.isActive(name))
        && (!path || raid.pathLevels[Shared.PATH_BY_KEY[path].index] >= REMNANT_PATH_LEVEL)
        && !owns(player, I[key]));
      if (remnant) add(I[remnant[0]]);
    }
    if (raidLevel >= PHALANX_LEVEL && !owns(player, I.CURSED_PHALANX) && !owns(player, I.OSMUMTENS_FANG_OR_)) add(I.CURSED_PHALANX);
  }
  if (points < DUNG_POINTS && !foundUnique) {
    add(notedId(I.FOSSILISED_DUNG));
  } else if (!foundUnique) {
    const factor = raidLevel < 300 ? 1 : 1.15 + 0.01 * ((raidLevel - 300) / 5);
    const table = commonTable(I);
    for (let roll = 0; roll < 3; roll++) {
      const [id, divisor, noted] = Shared.randomOf(table);
      add(noted ? notedId(id) : id, divisor === 0 ? 1 : Math.max(1, Math.floor((points * factor) / divisor + 1e-9)));
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
  // duplicate until all have been had (the jewel or its partisan held), and then back to the base.
  const all = jewels(I);
  const missing = all.filter(([jewel, partisan]) => !owns(player, jewel) && !owns(player, partisan));
  if (Math.random() < (missing.length > 0 ? scaledRate(4 / 50, completions, 75) : 4 / 50)) {
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
  logClaimed,
  hasRewards,
  destroyRewards,
  commonTable,
  uniqueTable,
  uniqueChancePercent,
  petChancePercent,
  rollRaidLoot,
};
