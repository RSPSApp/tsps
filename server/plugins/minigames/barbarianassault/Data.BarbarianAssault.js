"use strict";

/**
 * Barbarian Assault data.
 *
 * Behaviour: OSRS Wiki, Barbarian Assault, Barbarian Assault/Strategies and
 * Barbarian Assault/Gambles. Ids: the active cache's npc/obj/item gamevals.
 *
 * The arena is a private copy of the two map regions the cache already carries:
 *   normal waves  x 1864..1910, y 5448..5490
 *   wave 10       x 1864..1910, y 5384..5426
 * The map objects (launchers, traps, spring, caves) come from that map. The
 * objects the cache does not place (hoppers, trap states) are created by the
 * match at the tiles below.
 */

const ROLE = Object.freeze({
  ATTACKER: "attacker",
  COLLECTOR: "collector",
  DEFENDER: "defender",
  HEALER: "healer",
});

const ROLES = Object.freeze([ROLE.ATTACKER, ROLE.COLLECTOR, ROLE.DEFENDER, ROLE.HEALER]);

const ROLE_LABEL = Object.freeze({
  [ROLE.ATTACKER]: "Attacker",
  [ROLE.COLLECTOR]: "Collector",
  [ROLE.DEFENDER]: "Defender",
  [ROLE.HEALER]: "Healer",
});

/** Each role calls the partner shown on the horn HUD. */
const PARTNER = Object.freeze({
  [ROLE.ATTACKER]: ROLE.COLLECTOR,
  [ROLE.COLLECTOR]: ROLE.ATTACKER,
  [ROLE.DEFENDER]: ROLE.HEALER,
  [ROLE.HEALER]: ROLE.DEFENDER,
});

/** The client overlay group for each role (barbassault_over_*). */
const ROLE_INTERFACE = Object.freeze({
  [ROLE.ATTACKER]: 485,
  [ROLE.COLLECTOR]: 486,
  [ROLE.DEFENDER]: 487,
  [ROLE.HEALER]: 488,
});

/** Text components on those interfaces: wave, what you hear, what you call. */
const ROLE_TEXT = Object.freeze({
  [ROLE.ATTACKER]: { wave: 5, hear: 7, shout: 10, partner: 12 },
  [ROLE.COLLECTOR]: { wave: 5, hear: 7, shout: 9, partner: 11 },
  [ROLE.DEFENDER]: { wave: 5, hear: 7, shout: 9, partner: 11 },
  [ROLE.HEALER]: { wave: 5, hear: 7, shout: 9, partner: 11 },
});

/** role -> level 1..5 horn item. */
const HORN_ITEMS = Object.freeze({
  [ROLE.ATTACKER]: [10516, 10517, 10518, 10519, 10520],
  [ROLE.COLLECTOR]: [10560, 10560, 10560, 10560, 10560],
  [ROLE.DEFENDER]: [10538, 10538, 10538, 10538, 10538],
  [ROLE.HEALER]: [10526, 10527, 10528, 10529, 10530],
});

/** role -> level 1..5 collection bag item. */
const COLLECTION_BAGS = Object.freeze([10521, 10522, 10523, 10524, 10525]);

const ITEM = Object.freeze({
  CRACKERS: 10513,
  TOFU: 10514,
  WORMS: 10515,
  GREEN_EGG: 10531,
  RED_EGG: 10532,
  BLUE_EGG: 10533,
  YELLOW_EGG: 10534,
  POISONED_EGG: 10535,
  SPIKED_POISONED_EGG: 10536,
  OMEGA_EGG: 10537,
  POISONED_TOFU: 10539,
  POISONED_WORMS: 10540,
  POISONED_MEAT: 10541,
  HEALING_VIAL_4: 10542,
  HEALING_VIAL_3: 10543,
  HEALING_VIAL_2: 10544,
  HEALING_VIAL_1: 10545,
  HEALING_VIAL_EMPTY: 10546,
  SPIKES: 10561,
  BULLET_ARROW: 22227,
  FIELD_ARROW: 22228,
  BLUNT_ARROW: 22229,
  BARBED_ARROW: 22230,
});

const HEALING_VIALS = Object.freeze([ITEM.HEALING_VIAL_4, ITEM.HEALING_VIAL_3, ITEM.HEALING_VIAL_2, ITEM.HEALING_VIAL_1]);

/**
 * Everything the arena hands out. Cleanup removes only the copies it gave, so a
 * player's own penance armour or arrows are never touched.
 */
const ROLE_ITEM_IDS = Object.freeze(new Set([
  10513, 10514, 10515, 10516, 10517, 10518, 10519, 10520,
  10521, 10522, 10523, 10524, 10525, 10526, 10527, 10528, 10529, 10530,
  10531, 10532, 10533, 10534, 10535, 10536, 10537, 10538,
  10539, 10540, 10541, 10542, 10543, 10544, 10545, 10546,
  10560, 10561, ITEM.BULLET_ARROW, ITEM.FIELD_ARROW, ITEM.BLUNT_ARROW, ITEM.BARBED_ARROW,
]));

/** Calls. The value is what the partner must do. */
const CALL = Object.freeze({
  RED: "red",
  GREEN: "green",
  BLUE: "blue",
  CONTROLLED: "controlled",
  ACCURATE: "accurate",
  AGGRESSIVE: "aggressive",
  DEFENSIVE: "defensive",
  TOFU: "tofu",
  WORMS: "worms",
  CRACKERS: "crackers",
  MEAT: "meat",
});

const CALL_OPTIONS = Object.freeze({
  [ROLE.ATTACKER]: [CALL.RED, CALL.GREEN, CALL.BLUE],
  [ROLE.COLLECTOR]: [CALL.CONTROLLED, CALL.ACCURATE, CALL.AGGRESSIVE, CALL.DEFENSIVE],
  [ROLE.DEFENDER]: [CALL.TOFU, CALL.WORMS, CALL.MEAT],
  [ROLE.HEALER]: [CALL.TOFU, CALL.CRACKERS, CALL.WORMS],
});

const CALL_LABEL = Object.freeze({
  [CALL.RED]: "Red eggs",
  [CALL.GREEN]: "Green eggs",
  [CALL.BLUE]: "Blue eggs",
  [CALL.CONTROLLED]: "Controlled/Bullet/Wind",
  [CALL.ACCURATE]: "Accurate/Field/Water",
  [CALL.AGGRESSIVE]: "Aggressive/Blunt/Earth",
  [CALL.DEFENSIVE]: "Defensive/Barbed/Fire",
  [CALL.TOFU]: "Tofu",
  [CALL.WORMS]: "Worms",
  [CALL.CRACKERS]: "Crackers",
  [CALL.MEAT]: "Poisoned meat",
});

const HORN_ACTION_CALL = Object.freeze({
  "Tell-red": CALL.RED,
  "Tell-green": CALL.GREEN,
  "Tell-blue": CALL.BLUE,
  "Tell-controlled": CALL.CONTROLLED,
  "Tell-accurate": CALL.ACCURATE,
  "Tell-aggressive": CALL.AGGRESSIVE,
  "Tell-defensive": CALL.DEFENSIVE,
  "Tell-tofu": CALL.TOFU,
  "Tell-worms": CALL.WORMS,
  "Tell-crackers": CALL.CRACKERS,
  "Tell-meat": CALL.MEAT,
});

/** Attack style -> the call that permits it. */
const STYLE_CALL = Object.freeze({
  CONTROLLED: CALL.CONTROLLED,
  ACCURATE: CALL.ACCURATE,
  AGGRESSIVE: CALL.AGGRESSIVE,
  DEFENSIVE: CALL.DEFENSIVE,
});

const ARROW_CALL = Object.freeze({
  [ITEM.BULLET_ARROW]: CALL.CONTROLLED,
  [ITEM.FIELD_ARROW]: CALL.ACCURATE,
  [ITEM.BLUNT_ARROW]: CALL.AGGRESSIVE,
  [ITEM.BARBED_ARROW]: CALL.DEFENSIVE,
});

const EGG_ITEM = Object.freeze({
  [CALL.RED]: ITEM.RED_EGG,
  [CALL.GREEN]: ITEM.GREEN_EGG,
  [CALL.BLUE]: ITEM.BLUE_EGG,
});

const EGG_CALL = Object.freeze({
  [ITEM.RED_EGG]: CALL.RED,
  [ITEM.GREEN_EGG]: CALL.GREEN,
  [ITEM.BLUE_EGG]: CALL.BLUE,
});

/** Poison call -> the poisoned food that damages Penance Healers. */
const POISON_ITEM = Object.freeze({
  [CALL.TOFU]: ITEM.POISONED_TOFU,
  [CALL.WORMS]: ITEM.POISONED_WORMS,
  [CALL.MEAT]: ITEM.POISONED_MEAT,
});

const POISON_CALL = Object.freeze({
  [ITEM.POISONED_TOFU]: CALL.TOFU,
  [ITEM.POISONED_WORMS]: CALL.WORMS,
  [ITEM.POISONED_MEAT]: CALL.MEAT,
});

/** Bait call -> the unpoisoned food defenders drop. */
const BAIT_ITEM = Object.freeze({
  [CALL.TOFU]: ITEM.TOFU,
  [CALL.CRACKERS]: ITEM.CRACKERS,
  [CALL.WORMS]: ITEM.WORMS,
});

const BAIT_CALL = Object.freeze({
  [ITEM.TOFU]: CALL.TOFU,
  [ITEM.CRACKERS]: CALL.CRACKERS,
  [ITEM.WORMS]: CALL.WORMS,
});

const NPC = Object.freeze({
  FIGHTER: 1667,
  RANGER: 1668,
  RUNNER: 1669,
  HEALER: 1670,
  QUEEN: 5775,
  QUEEN_SPAWN: 5776,
});

/** Wave 1..10 ids. Index 0 is unused. */
const PENANCE_IDS = Object.freeze({
  fighter: [5739, 5740, 5741, 5742, 5743, 5744, 5745, 5746, 5747],
  ranger: [5757, 5758, 5759, 5760, 5761, 5762, 5763, 5764, 5765],
  runner: [5748, 5749, 5750, 5751, 5752, 5753, 5754, 5755, 5756],
  healer: [5766, 5767, 5768, 5769, 5770, 5771, 5772, 5773, 5774],
});

/**
 * Wave table (Wiki: Barbarian Assault/Strategies#Wave information). `initial`
 * spawns at once, `reserve` spawns as those die; `hp` is the wave's hitpoints.
 */
const WAVES = Object.freeze([
  null,
  { fighter: { initial: 2, reserve: 2, hp: 28 }, ranger: { initial: 2, reserve: 2, hp: 20 }, healer: { initial: 2, reserve: 0, hp: 27 }, runner: { initial: 2, reserve: 0, hp: 5 } },
  { fighter: { initial: 2, reserve: 3, hp: 29 }, ranger: { initial: 3, reserve: 1, hp: 28 }, healer: { initial: 3, reserve: 0, hp: 32 }, runner: { initial: 2, reserve: 1, hp: 5 } },
  { fighter: { initial: 5, reserve: 0, hp: 32 }, ranger: { initial: 3, reserve: 3, hp: 29 }, healer: { initial: 2, reserve: 1, hp: 37 }, runner: { initial: 2, reserve: 2, hp: 5 } },
  { fighter: { initial: 5, reserve: 1, hp: 37 }, ranger: { initial: 3, reserve: 3, hp: 34 }, healer: { initial: 3, reserve: 1, hp: 43 }, runner: { initial: 3, reserve: 1, hp: 5 } },
  { fighter: { initial: 3, reserve: 3, hp: 38 }, ranger: { initial: 5, reserve: 1, hp: 41 }, healer: { initial: 4, reserve: 1, hp: 49 }, runner: { initial: 4, reserve: 1, hp: 5 } },
  { fighter: { initial: 5, reserve: 1, hp: 49 }, ranger: { initial: 5, reserve: 2, hp: 50 }, healer: { initial: 4, reserve: 2, hp: 55 }, runner: { initial: 4, reserve: 2, hp: 5 } },
  { fighter: { initial: 5, reserve: 2, hp: 50 }, ranger: { initial: 6, reserve: 1, hp: 50 }, healer: { initial: 4, reserve: 3, hp: 60 }, runner: { initial: 5, reserve: 1, hp: 5 } },
  { fighter: { initial: 7, reserve: 0, hp: 55 }, ranger: { initial: 5, reserve: 3, hp: 54 }, healer: { initial: 5, reserve: 2, hp: 67 }, runner: { initial: 5, reserve: 2, hp: 5 } },
  { fighter: { initial: 6, reserve: 2, hp: 56 }, ranger: { initial: 7, reserve: 1, hp: 58 }, healer: { initial: 6, reserve: 2, hp: 76 }, runner: { initial: 5, reserve: 4, hp: 5 } },
  { fighter: { initial: 5, reserve: 2, hp: 50 }, ranger: { initial: 6, reserve: 1, hp: 50 }, healer: { initial: 4, reserve: 3, hp: 60 }, runner: { initial: 5, reserve: 1, hp: 5 } },
]);

const ROLE_CAPACITY = 2;
const TEAM_SIZE = 5;
const START_COUNTDOWN_SECONDS = 10;
const INTERMISSION_SECONDS = 60;
const CALL_CHANGE_TICKS = 50; // 30 seconds
const QUEEN_SPAWN_TICKS = 400; // four minutes after wave 10 starts
const QUEEN_EGG_TICKS = 10; // a yellow egg every six seconds
const QUEEN_HITS = 8;

const ARENA = Object.freeze({
  normal: Object.freeze({
    name: "Barbarian Assault",
    bounds: { minX: 1864, maxX: 1910, minY: 5448, maxY: 5490, z: 0 },
    spawn: { x: 1889, y: 5458, z: 0 },
    caves: [{ x: 1873, y: 5487, z: 0 }, { x: 1879, y: 5488, z: 0 }, { x: 1891, y: 5488, z: 0 }, { x: 1897, y: 5487, z: 0 }],
    launchers: [{ x: 1877, y: 5474, z: 0 }, { x: 1896, y: 5474, z: 0 }],
    hoppers: [{ x: 1878, y: 5474, z: 0 }, { x: 1897, y: 5474, z: 0 }],
    traps: [{ x: 1871, y: 5473, z: 0 }, { x: 1901, y: 5474, z: 0 }],
    spring: { x: 1882, y: 5454, z: 0 },
    lureCave: { x: 1885, y: 5452, z: 0 },
    machines: { attacker: { x: 1889, y: 5454, z: 0 }, defender: { x: 1890, y: 5454, z: 0 }, healer: { x: 1891, y: 5454, z: 0 } },
    converter: { x: 1889, y: 5454, z: 0 },
    horn: { x: 1905, y: 5460, z: 0 },
    mushrooms: [],
    craters: [],
    trapdoor: null,
  }),
  queen: Object.freeze({
    name: "Barbarian Assault - Penance Queen",
    bounds: { minX: 1864, maxX: 1910, minY: 5384, maxY: 5426, z: 0 },
    spawn: { x: 1889, y: 5394, z: 0 },
    caves: [{ x: 1873, y: 5423, z: 0 }, { x: 1879, y: 5424, z: 0 }, { x: 1891, y: 5424, z: 0 }, { x: 1897, y: 5423, z: 0 }],
    launchers: [{ x: 1877, y: 5410, z: 0 }],
    hoppers: [{ x: 1878, y: 5410, z: 0 }],
    traps: [{ x: 1871, y: 5409, z: 0 }, { x: 1901, y: 5410, z: 0 }],
    spring: { x: 1882, y: 5390, z: 0 },
    lureCave: { x: 1885, y: 5388, z: 0 },
    machines: { attacker: { x: 1889, y: 5390, z: 0 }, defender: { x: 1890, y: 5390, z: 0 }, healer: { x: 1891, y: 5390, z: 0 } },
    converter: { x: 1889, y: 5390, z: 0 },
    horn: { x: 1905, y: 5396, z: 0 },
    mushrooms: [
      { x: 1869, y: 5405, z: 0 }, { x: 1869, y: 5410, z: 0 }, { x: 1870, y: 5413, z: 0 },
      { x: 1873, y: 5397, z: 0 }, { x: 1874, y: 5417, z: 0 }, { x: 1876, y: 5395, z: 0 },
      { x: 1879, y: 5393, z: 0 }, { x: 1892, y: 5393, z: 0 }, { x: 1896, y: 5396, z: 0 },
      { x: 1899, y: 5401, z: 0 }, { x: 1900, y: 5397, z: 0 }, { x: 1902, y: 5404, z: 0 },
      { x: 1903, y: 5415, z: 0 }, { x: 1905, y: 5408, z: 0 },
    ],
    craters: [
      { id: 20233, x: 1866, y: 5406, z: 0 }, { id: 20233, x: 1868, y: 5401, z: 0 },
      { id: 20233, x: 1868, y: 5414, z: 0 }, { id: 20233, x: 1874, y: 5393, z: 0 },
      { id: 20233, x: 1897, y: 5393, z: 0 }, { id: 20233, x: 1900, y: 5400, z: 0 },
      { id: 20233, x: 1901, y: 5414, z: 0 }, { id: 20233, x: 1908, y: 5408, z: 0 },
      { id: 20235, x: 1866, y: 5408, z: 0 }, { id: 20235, x: 1870, y: 5398, z: 0 },
      { id: 20235, x: 1902, y: 5401, z: 0 }, { id: 20235, x: 1904, y: 5412, z: 0 },
      { id: 20232, x: 1868, y: 5411, z: 0 }, { id: 20232, x: 1871, y: 5401, z: 0 },
      { id: 20232, x: 1872, y: 5395, z: 0 }, { id: 20232, x: 1872, y: 5419, z: 0 },
      { id: 20232, x: 1901, y: 5419, z: 0 }, { id: 20232, x: 1905, y: 5403, z: 0 },
      { id: 20232, x: 1906, y: 5410, z: 0 }, { id: 20234, x: 1867, y: 5403, z: 0 },
      { id: 20234, x: 1870, y: 5415, z: 0 }, { id: 20234, x: 1894, y: 5393, z: 0 },
      { id: 20234, x: 1901, y: 5416, z: 0 }, { id: 20234, x: 1906, y: 5406, z: 0 },
    ],
    trapdoor: { x: 1886, y: 5408, z: 0 },
  }),
});

const OBJECT = Object.freeze({
  ENTRY_LADDER: 20226,
  EGG_LAUNCHER: [20133, 20259, 20263],
  EGG_HOPPER: [20264, 20265, 20266, 20267],
  RUNNER_TRAP_2: 20135,
  RUNNER_TRAP_1: 20230,
  RUNNER_TRAP_0: 20231,
  HEALER_SPRING: 20150,
  LURE_CAVE: 20151,
  PENANCE_CAVE: [20237, 20238, 20239],
  ATTACKER_MACHINE: 20241,
  DEFENDER_MACHINE: 20242,
  HEALER_MACHINE: 20243,
  HORN_OF_GLORY: 20247,
  PETRIFIED_MUSHROOM: [20250, 20251],
  LAVA_CRATER: [20232, 20234],
  POISON_CRATER: [20233, 20235],
  COLLECTOR_CONVERTER: 21250,
});

const SURFACE_RETURN = Object.freeze({ x: 2534, y: 3571, z: 0 });
const LOBBY_BOUNDS = Object.freeze({ minX: 2514, maxX: 2548, minY: 3554, maxY: 3586, z: 0 });

const OVERLAY_HUD_UID = (161 << 16) | 8;
const HORN_INTERFACE = 484;
const TIMER_INTERFACE = 494;
const WAVE_COMPLETE_INTERFACE = 497;
const SHOP_INTERFACE = 491;

const VARBIT = Object.freeze({
  POINTS: { attacker: 4759, collector: 4760, healer: 4761, defender: 4762 },
  LEVEL: { attacker: 3251, defender: 3253, collector: 3254, healer: 3255 },
  QUEEN_KILLS: 4767,
  GAMBLE_COUNT: 4768,
});

const ATTRIBUTE = Object.freeze({
  POINTS: { attacker: "barbarian-assault:honour-attacker", collector: "barbarian-assault:honour-collector", defender: "barbarian-assault:honour-defender", healer: "barbarian-assault:honour-healer" },
  LEVEL: { attacker: "barbarian-assault:level-attacker", collector: "barbarian-assault:level-collector", defender: "barbarian-assault:level-defender", healer: "barbarian-assault:level-healer" },
  QUEEN_KILLS: "barbarian-assault:queen-kills",
});

const MAX_HONOUR_PER_ROLE = 5000;
const LEVEL_COSTS = Object.freeze([200, 300, 400, 500]);

const COLLECTOR_CAPACITY = Object.freeze([2, 4, 6, 7, 8]);
const ATTACKER_BONUS = Object.freeze([1, 2, 3, 4, 5]);
const HEALER_HEAL = Object.freeze([10, 15, 20, 25, 35]);
const DEFENDER_LURE_RANGE = Object.freeze([4, 5, 5, 5, 5]);

/** Shop price (honour points in each role) and whether a Queen kill is needed. */
const SHOP_STOCK = Object.freeze([
  { id: 10547, price: 275, queen: true }, // Healer hat
  { id: 10548, price: 275, queen: true }, // Fighter hat
  { id: 10549, price: 275, queen: true }, // Runner hat
  { id: 10550, price: 275, queen: true }, // Ranger hat
  { id: 10551, price: 375, queen: true }, // Fighter torso
  { id: 10555, price: 375, queen: true }, // Penance skirt
  { id: 10552, price: 100, queen: false }, // Runner boots
  { id: 10553, price: 150, queen: false }, // Penance gloves
]);

module.exports = {
  ROLE, ROLES, ROLE_LABEL, PARTNER, ROLE_INTERFACE, ROLE_TEXT,
  HORN_ITEMS, COLLECTION_BAGS, ITEM, HEALING_VIALS, ROLE_ITEM_IDS,
  CALL, CALL_OPTIONS, CALL_LABEL, HORN_ACTION_CALL, STYLE_CALL, ARROW_CALL,
  EGG_ITEM, EGG_CALL, POISON_ITEM, POISON_CALL, BAIT_ITEM, BAIT_CALL,
  NPC, PENANCE_IDS, WAVES, ROLE_CAPACITY, TEAM_SIZE,
  START_COUNTDOWN_SECONDS, INTERMISSION_SECONDS, CALL_CHANGE_TICKS,
  QUEEN_SPAWN_TICKS, QUEEN_EGG_TICKS, QUEEN_HITS,
  ARENA, OBJECT, SURFACE_RETURN, LOBBY_BOUNDS,
  OVERLAY_HUD_UID, HORN_INTERFACE, TIMER_INTERFACE, WAVE_COMPLETE_INTERFACE, SHOP_INTERFACE,
  VARBIT, ATTRIBUTE, MAX_HONOUR_PER_ROLE, LEVEL_COSTS,
  COLLECTOR_CAPACITY, ATTACKER_BONUS, HEALER_HEAL, DEFENDER_LURE_RANGE,
  SHOP_STOCK,
};
