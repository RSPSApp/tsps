"use strict";

/**
 * Sorceress's Garden (https://oldschool.runescape.wiki/w/Sorceress%27s_Garden).
 *
 * The garden is five areas: the central garden with the fountain, and the four seasonal
 * mazes around it. A garden may only be entered at its Thieving level (the current, i.e.
 * boosted, level), each tree yields one fruit and then teleports the picker back to the
 * central garden, and the fruit brews into juice handed to Osman.
 *
 * Cache ids (verified with scripts/dump-loc.ts against the active cache): trees 13407
 * (winter), 13405 (spring), 13406 (autumn), 12943 (summer), fountain 12941, and the gates
 * between the central garden and each maze 12617/12639/12719/11987 by which maze they
 * open into. Fruit 10847/10844/10846/10845 and juice 10851/10848/10850/10849 follow the
 * same winter/spring/autumn/summer order.
 *
 * Wiki numbers: winter 5 fruit + 350 XP/hand-in, spring 4 + 1,350, autumn 3 + 2,350,
 * summer 2 + 3,000; each glass brews for 5 Cooking XP and the tree gives 30/40/50/60
 * Farming XP. The elemental patrol routes are image-only on the Wiki; see
 * Maze.SorceresssGarden.js for how the tracks are derived from the map's clipping.
 */

const PLANE = 0;

/** Where picking a fruit and an elemental's catch teleport a player. */
const CENTRAL_GARDEN = { x: 2912, y: 5472 };
/** Where drinking from the fountain takes the player, by the Apprentice. */
const APPRENTICE_TILE = { x: 3321, y: 3139 };

const FOUNTAIN_ID = 12941;

const PESTLE_AND_MORTAR_ID = 233;
const BEER_GLASS_ID = 1919;
const COOKING_XP_PER_BREW = 5;

/**
 * `area` is the maze's walkable bounding box (from a flood fill of the cache's clipping
 * with the gate tiles removed); `elementals` are its spawned patrol NPC ids.
 */
const SEASONS = {
  winter: {
    key: "winter",
    name: "winter",
    level: 1,
    treeId: 13407,
    gateId: 12617,
    fruitId: 10847,
    fruitName: "Winter sq'irk",
    juiceId: 10851,
    juiceName: "Winter sq'irkjuice",
    fruits: 5,
    farmingXp: 30,
    handInXp: 350,
    boost: 0,
    energy: 5,
    area: [2887, 2902, 5466, 5485],
    elementals: [5796, 5797, 5798, 5799, 5800, 5801],
  },
  spring: {
    key: "spring",
    name: "spring",
    level: 25,
    treeId: 13405,
    gateId: 12719,
    fruitId: 10844,
    fruitName: "Spring sq'irk",
    juiceId: 10848,
    juiceName: "Spring sq'irkjuice",
    fruits: 4,
    farmingXp: 40,
    handInXp: 1350,
    boost: 1,
    energy: 10,
    area: [2921, 2936, 5458, 5477],
    elementals: [2956, 2957, 2958, 2959, 2960, 2961, 2962, 2963],
  },
  autumn: {
    key: "autumn",
    name: "autumn",
    level: 45,
    treeId: 13406,
    gateId: 12639,
    fruitId: 10846,
    fruitName: "Autumn sq'irk",
    juiceId: 10850,
    juiceName: "Autumn sq'irkjuice",
    fruits: 3,
    farmingXp: 50,
    handInXp: 2350,
    boost: 2,
    energy: 15,
    area: [2897, 2918, 5448, 5462],
    elementals: [5802, 5803, 5804, 5805, 5806, 5807],
  },
  summer: {
    key: "summer",
    name: "summer",
    level: 65,
    treeId: 12943,
    gateId: 11987,
    fruitId: 10845,
    fruitName: "Summer sq'irk",
    juiceId: 10849,
    juiceName: "Summer sq'irkjuice",
    fruits: 2,
    farmingXp: 60,
    handInXp: 3000,
    boost: 3,
    energy: 20,
    area: [2905, 2926, 5482, 5495],
    elementals: [1801, 1802, 1803, 1804, 1805, 1806],
  },
};

/** Hand-in picks the first type found in this order when a player carries several. */
const SEASON_ORDER = ["winter", "spring", "autumn", "summer"];

for (const season of Object.values(SEASONS)) {
  season.elementalIds = new Set(season.elementals);
}

const SEASONS_BY_TREE = new Map(Object.values(SEASONS).map((season) => [season.treeId, season]));
const SEASONS_BY_GATE = new Map(Object.values(SEASONS).map((season) => [season.gateId, season]));
const SEASONS_BY_FRUIT = new Map(Object.values(SEASONS).map((season) => [season.fruitId, season]));
const SEASONS_BY_JUICE = new Map(Object.values(SEASONS).map((season) => [season.juiceId, season]));

const seasonForTree = (objectId) => SEASONS_BY_TREE.get(objectId) ?? null;
const seasonForGate = (objectId) => SEASONS_BY_GATE.get(objectId) ?? null;
const seasonForFruit = (itemId) => SEASONS_BY_FRUIT.get(itemId) ?? null;
const seasonForJuice = (itemId) => SEASONS_BY_JUICE.get(itemId) ?? null;
const levelRequired = (season) => season.level;
const farmingXp = (season) => season.farmingXp;
const handInXp = (season) => season.handInXp;
const fruitsNeeded = (season) => season.fruits;

/** The current (boosted) Thieving level gates entry, per the Wiki. */
function meetsLevel(season, thievingLevel) {
  return Number(thievingLevel) >= season.level;
}

module.exports = {
  PLANE,
  CENTRAL_GARDEN,
  APPRENTICE_TILE,
  FOUNTAIN_ID,
  PESTLE_AND_MORTAR_ID,
  BEER_GLASS_ID,
  COOKING_XP_PER_BREW,
  SEASONS,
  SEASON_ORDER,
  seasonForTree,
  seasonForGate,
  seasonForFruit,
  seasonForJuice,
  levelRequired,
  farmingXp,
  handInXp,
  fruitsNeeded,
  meetsLevel,
  _test: {
    SEASONS,
    SEASON_ORDER,
    seasonForTree,
    seasonForGate,
    seasonForFruit,
    seasonForJuice,
    levelRequired,
    farmingXp,
    handInXp,
    fruitsNeeded,
    meetsLevel,
  },
};
