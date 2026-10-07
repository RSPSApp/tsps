"use strict";

/**
 * The modifiers Minimus offers between waves.
 *
 * Cache: enum 5312 lists them (its keys are what the intermission script takes), each a struct
 * with its name (param 1896), tier texts (1897-1899), whether it has tiers (1901) and Glory per
 * wave (1903). Script 4980 reads each tiered one's tier from its own varbit, so those are what
 * the screen shows. The capture's wave-1 offer was keys 4, 5 and 12; picking Blasphemy set
 * varbit 9790 to 1.
 * Wiki: wave 1 always offers Relentless, Blasphemy and Frailty; Red Flag and Dynamic Duo become
 * available before wave 7 (Dynamic Duo never after wave 11); the rest are random, with a
 * preference for upgrading tiers already picked.
 */

const Shared = require("./ColosseumShared");

const PARAM = { NAME: 1896, TIERED: 1901, GLORY: 1903 };
const MAX_TIER = 3;

/**
 * By enum key: its struct (enum 5312's value; `yarn dump:enum 5312`), our name for it and, for
 * tiered ones, the varbit holding its tier (script 4980).
 */
const MODIFIERS = [
  { key: 0, struct: 915, id: "mantimayhem", varbit: 4588 },
  { key: 1, struct: 891, id: "reentry", varbit: 9792 },
  { key: 2, struct: 892, id: "bees", varbit: 9791 },
  { key: 3, struct: 893, id: "volatility", varbit: 9799 },
  { key: 4, struct: 894, id: "blasphemy", varbit: 9790 },
  { key: 5, struct: 897, id: "relentless", varbit: 9798 },
  { key: 6, struct: 898, id: "quartet" },
  { key: 7, struct: 899, id: "totemic" },
  { key: 8, struct: 900, id: "doom", varbit: 10681 },
  { key: 9, struct: 901, id: "dynamic-duo" },
  { key: 10, struct: 902, id: "solarflare", varbit: 9797 },
  { key: 11, struct: 903, id: "myopia", varbit: 9795 },
  { key: 12, struct: 906, id: "frailty", varbit: 9796 },
  { key: 13, struct: 907, id: "red-flag" },
];
const FIRST_OFFER = [4, 5, 12];
const LATE_MODIFIERS = new Set(["red-flag", "dynamic-duo"]);
const LATE_FROM_WAVE = 7;
const DYNAMIC_DUO_LAST_WAVE = 11;
/** How much likelier an upgrade is than a new modifier (the Wiki gives no figure). */
const UPGRADE_WEIGHT = 2;

let structs = null;

/** Name, tiers and Glory from the cache, once. */
function definitions() {
  if (structs) return structs;
  const { CacheDefinitions } = Shared.core();
  structs = new Map();
  for (const modifier of MODIFIERS) {
    const params = CacheDefinitions.getStructParams(modifier.struct);
    structs.set(modifier.key, {
      ...modifier,
      name: params.get(PARAM.NAME) ?? modifier.id,
      tiered: params.size > 0 ? params.get(PARAM.TIERED) === 1 : modifier.varbit != null,
      glory: Number(params.get(PARAM.GLORY) ?? 0),
    });
  }
  return structs;
}

function byKey(key) {
  return definitions().get(key) ?? null;
}

function byId(id) {
  return [...definitions().values()].find((modifier) => modifier.id === id) ?? null;
}

/** A run's modifiers: their tiers by key. */
class ModifierSet {
  constructor() {
    this.tiers = new Map();
  }

  tier(key) {
    return this.tiers.get(key) ?? 0;
  }

  has(id) {
    const modifier = byId(id);
    return modifier != null && this.tier(modifier.key) > 0;
  }

  tierOf(id) {
    const modifier = byId(id);
    return modifier ? this.tier(modifier.key) : 0;
  }

  maxed(key) {
    const modifier = byKey(key);
    return this.tier(key) >= (modifier?.tiered ? MAX_TIER : 1);
  }

  add(key) {
    this.tiers.set(key, Math.min(MAX_TIER, this.tier(key) + 1));
  }

  /** Every tiered modifier's varbit, so the intermission screen shows the next tier. */
  sync(player) {
    const sender = player.getPacketSender();
    for (const modifier of definitions().values()) {
      if (modifier.varbit != null) sender.sendVarbit(modifier.varbit, this.tier(modifier.key));
    }
  }

  /** The three keys offered before `wave`, in the enum's order as the capture shows them. */
  offer(wave, random = Math.random) {
    if (wave === 1) return [...FIRST_OFFER];
    const pool = [];
    for (const modifier of definitions().values()) {
      if (this.maxed(modifier.key)) continue;
      if (LATE_MODIFIERS.has(modifier.id) && wave < LATE_FROM_WAVE) continue;
      if (modifier.id === "dynamic-duo" && wave > DYNAMIC_DUO_LAST_WAVE) continue;
      pool.push({ key: modifier.key, weight: this.tier(modifier.key) > 0 ? UPGRADE_WEIGHT : 1 });
    }
    const picked = [];
    while (picked.length < 3 && pool.length > 0) {
      const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
      let roll = random() * total;
      const index = pool.findIndex((entry) => (roll -= entry.weight) < 0);
      picked.push(pool.splice(index < 0 ? pool.length - 1 : index, 1)[0].key);
    }
    return picked.sort((a, b) => a - b);
  }
}

module.exports = { MODIFIERS, FIRST_OFFER, definitions, byKey, byId, ModifierSet };
