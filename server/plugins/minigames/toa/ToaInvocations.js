"use strict";

/**
 * Invocations: the party leader's difficulty toggles. Each one is a cache struct; its params
 * give the bit the party interface reads (1159), its category (1161) and the raid level it is
 * worth (1162). The active set is three 31-bit words, the same shape the interface's init
 * script (6729) takes, so presets and the interface share one representation.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Invocations
 */

const Shared = require("./ToaShared");

const PARAM_INDEX = 1159;
const PARAM_CATEGORY = 1161;
const PARAM_LEVEL = 1162;
const BITS_PER_WORD = 31;

const CATEGORY = [
  "ATTEMPTS", "TIME_LIMIT", "HELPFUL_SPIRIT", "PATH_LEVEL", "PRAYER", "RESTORATION", "PATHS",
  "AKKHA", "KEPHRI", "ZEBAK", "BA_BA", "THE_WARDENS",
];
// Categories where only one invocation may be on at a time.
const EXCLUSIVE = new Set(["ATTEMPTS", "TIME_LIMIT", "HELPFUL_SPIRIT", "PATH_LEVEL"]);

/** Struct id per invocation, in the interface's order. */
const STRUCTS = {
  TRY_AGAIN: 417,
  PERSISTENCE: 418,
  SOFTCORE_RUN: 419,
  HARDCORE_RUN: 420,
  WALK_FOR_IT: 421,
  JOG_FOR_IT: 422,
  RUN_FOR_IT: 423,
  SPRINT_FOR_IT: 424,
  NEED_SOME_HELP: 425,
  NEED_LESS_HELP: 426,
  NO_HELP_NEEDED: 427,
  WALK_THE_PATH: 428,
  PATHSEEKER: 429,
  PATHFINDER: 430,
  PATHMASTER: 431,
  QUIET_PRAYERS: 432,
  DEADLY_PRAYERS: 433,
  ON_A_DIET: 434,
  DEHYDRATION: 435,
  OVERLY_DRAINING: 436,
  LIVELY_LARVAE: 437,
  MORE_OVERLORDS: 438,
  BLOWING_MUD: 439,
  MEDIC: 440,
  AERIAL_ASSAULT: 441,
  NOT_JUST_A_HEAD: 442,
  ARTERIAL_SPRAY: 444,
  BLOOD_THINNERS: 445,
  UPSET_STOMACH: 447,
  DOUBLE_TROUBLE: 448,
  KEEP_BACK: 449,
  STAY_VIGILANT: 542,
  FEELING_SPECIAL: 543,
  MIND_THE_GAP: 603,
  GOTTA_HAVE_FAITH: 752,
  JUNGLE_JAPES: 949,
  SHAKING_THINGS_UP: 1275,
  BOULDERDASH: 1276,
  ANCIENT_HASTE: 1278,
  ACCELERATION: 1688,
  PENETRATION: 2874,
  OVERCLOCKED: 2933,
  OVERCLOCKED_2: 2934,
  INSANITY: 2971,
};
const KEYS = Object.keys(STRUCTS);

/** Invocations that need another on first, and are switched off with it. */
const REQUIRES = {
  OVERCLOCKED_2: "OVERCLOCKED",
  INSANITY: "OVERCLOCKED_2",
  ARTERIAL_SPRAY: "NOT_JUST_A_HEAD",
  BLOOD_THINNERS: "NOT_JUST_A_HEAD",
};
const DISPLAY_NAMES = {
  OVERCLOCKED: "Overclocked",
  OVERCLOCKED_2: "Overclocked 2",
  NOT_JUST_A_HEAD: "Not Just a Head",
};

let table = null;

/** Reads every invocation's struct once: { key, index, category, level }. */
function definitions() {
  if (table) return table;
  const { CacheDefinitions } = Shared.core();
  table = KEYS.map((key, order) => {
    const params = CacheDefinitions.getStructParams(STRUCTS[key]);
    const category = Number(params.get(PARAM_CATEGORY) ?? 3) - 3;
    return {
      key,
      order,
      index: Number(params.get(PARAM_INDEX) ?? order),
      category: CATEGORY[category] ?? "PATHS",
      level: Number(params.get(PARAM_LEVEL) ?? 0),
    };
  });
  return table;
}

function byKey(key) {
  return definitions().find((definition) => definition.key === key);
}

function wordOf(index) {
  return index > 61 ? 2 : index > 30 ? 1 : 0;
}

function bitOf(index) {
  return 1 << (index % BITS_PER_WORD);
}

/** A party's invocation choice: bitmaps plus the derived raid level. */
class InvocationSettings {
  constructor(bitmaps = [0, 0, 0], kcRequirement = 0) {
    this.bitmaps = [...bitmaps];
    this.kcRequirement = kcRequirement;
  }

  copy() {
    return new InvocationSettings(this.bitmaps, this.kcRequirement);
  }

  isActive(key) {
    const definition = byKey(key);
    return !!definition && (this.bitmaps[wordOf(definition.index)] & bitOf(definition.index)) !== 0;
  }

  set(key, on) {
    const definition = byKey(key);
    if (!definition) return;
    const word = wordOf(definition.index);
    if (on) this.bitmaps[word] |= bitOf(definition.index);
    else this.bitmaps[word] &= ~bitOf(definition.index);
  }

  active() {
    return definitions().filter((definition) => this.isActive(definition.key));
  }

  get raidLevel() {
    return this.active().reduce((total, definition) => total + definition.level, 0);
  }

  get activeCount() {
    return this.active().length;
  }

  get mode() {
    return Shared.modeName(this.raidLevel);
  }

  clear() {
    this.bitmaps = [0, 0, 0];
  }

  load(bitmaps) {
    this.bitmaps = [bitmaps[0] | 0, bitmaps[1] | 0, bitmaps[2] | 0];
  }

  /**
   * Flips one invocation the way the board does: exclusive categories swap, dependants follow
   * their prerequisite off, and a dependant can't go on before it. Returns a refusal message.
   */
  toggle(key) {
    const definition = byKey(key);
    if (!definition) return null;
    if (this.isActive(key)) {
      for (const [dependant, prerequisite] of Object.entries(REQUIRES)) {
        if (prerequisite === key && this.isActive(dependant)) this.toggleOff(dependant);
      }
      this.set(key, false);
      return null;
    }
    const prerequisite = REQUIRES[key];
    if (prerequisite && !this.isActive(prerequisite)) {
      return `You cannot activate this invocation without first enabling <col=ff0000>${DISPLAY_NAMES[prerequisite]}</col>.`;
    }
    if (EXCLUSIVE.has(definition.category)) {
      for (const other of definitions()) {
        if (other.category === definition.category) this.set(other.key, false);
      }
    }
    this.set(key, true);
    return null;
  }

  toggleOff(key) {
    for (const [dependant, prerequisite] of Object.entries(REQUIRES)) {
      if (prerequisite === key && this.isActive(dependant)) this.toggleOff(dependant);
    }
    this.set(key, false);
  }

  /** Team deaths allowed before the raid fails, or -1 for unlimited. */
  permittedTeamDeaths() {
    if (this.isActive("TRY_AGAIN")) return 10;
    if (this.isActive("PERSISTENCE")) return 5;
    if (this.isActive("SOFTCORE_RUN")) return 3;
    if (this.isActive("HARDCORE_RUN")) return 1;
    return -1;
  }

  /** Target completion time in minutes, or -1 for none. */
  timeLimitMinutes() {
    if (this.isActive("WALK_FOR_IT")) return 40;
    if (this.isActive("JOG_FOR_IT")) return 35;
    if (this.isActive("RUN_FOR_IT")) return 30;
    if (this.isActive("SPRINT_FOR_IT")) return 25;
    return -1;
  }

  /** Raid levels lost by missing the target time. */
  timePenalty() {
    if (this.isActive("WALK_FOR_IT")) return 10;
    if (this.isActive("JOG_FOR_IT")) return 15;
    if (this.isActive("RUN_FOR_IT")) return 20;
    if (this.isActive("SPRINT_FOR_IT")) return 25;
    return 0;
  }

  /** Fraction of the helpful spirit's supplies on offer. */
  supplyFactor() {
    if (this.isActive("NEED_SOME_HELP")) return 0.66;
    if (this.isActive("NEED_LESS_HELP")) return 0.33;
    if (this.isActive("NO_HELP_NEEDED")) return 0.1;
    return 1;
  }

  /** Starting boss level on every path. */
  startingPathLevel() {
    if (this.isActive("PATHMASTER")) return 3;
    if (this.isActive("PATHFINDER")) return 2;
    if (this.isActive("PATHSEEKER")) return 1;
    return 0;
  }
}

function keyAtSlot(slot) {
  return KEYS[slot] ?? null;
}

module.exports = {
  KEYS,
  definitions,
  byKey,
  keyAtSlot,
  InvocationSettings,
};
