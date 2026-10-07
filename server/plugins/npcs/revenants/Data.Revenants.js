/**
 * Revenant ids and visuals. Animations are each revenant's own cache sequences (the attack,
 * block and death ones are in npc-combat-defs.json); the per-style ones and every projectile,
 * graphic and sound below are from OSRS captures (docs/revenants.md) unless marked otherwise.
 */
const REVENANTS = {
  IMP: 7881,
  GOBLIN: 7931,
  PYREFIEND: 7932,
  HOBGOBLIN: 7933,
  CYCLOPS: 7934,
  HELLHOUND: 7935,
  DEMON: 7936,
  ORK: 7937,
  DARK_BEAST: 7938,
  KNIGHT: 7939,
  DRAGON: 7940,
};

const REVENANT_IDS = Object.values(REVENANTS);

/** The Revenant Caves (as areas/RevenantCaves.plugin.js and world.json's pvp zone). */
function inCaves(location) {
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  const z = location?.getZ?.() ?? location?.z ?? 0;
  return z === 0 && x >= 3136 && x <= 3271 && y >= 10036 && y <= 10249;
}

/**
 * Animations for the styles a revenant has its own sequence for; any other style uses its
 * attack animation. Pyrefiend (pyrefiend_casting) is captured; the rest come from the
 * revenant's cache animation list: demon_casting, the ork's godwars ranger and mage attacks, the
 * knight's dart throw and zaros_casting.
 */
const STYLE_ANIMATIONS = {
  [REVENANTS.PYREFIEND]: { magic: 7820 },
  [REVENANTS.DEMON]: { magic: 69 },
  [REVENANTS.ORK]: { ranged: 6972, magic: 6982 },
  [REVENANTS.KNIGHT]: { ranged: 6600, magic: 1978 },
};

/** Captured attack sounds (synth) per revenant; others play none of their own. */
const ATTACK_SOUNDS = {
  [REVENANTS.HELLHOUND]: 3717,
  [REVENANTS.PYREFIEND]: 696,
};

const MAGIC = {
  projectile: 1415, // revenant_magic_travel: delay 51, heights 172 -> 124 (43 -> 31 here)
  delay: 51,
  startHeight: 43,
  endHeight: 31,
  castSound: 162, // area sound at the revenant
  impact: 1454, // revenant_magic_impact, delay 56, height 124
  impactSound: 163,
  splash: 85, // failedspell_impact
  splashSound: 227,
  graphicDelay: 56,
  graphicHeight: 124,
  /** The freeze: Near-Reality's numbers, unverified (docs/revenants.md). */
  freezeChance: 9,
  freezeTicks: 7,
  freezeImmunityMs: 20_000,
  freezeGraphic: 369, // Ice Barrage's impact, on the ground (height 0)
  /** Others on the target's tile the spell also hits (Wiki: up to nine). */
  extraTargets: 9,
};

const RANGED = {
  projectile: 206, // heights 80 -> 124, progress 32, launched at cycle 35
  delay: 35,
  startHeight: 20,
  endHeight: 31,
  progress: 32,
};

/** Wiki (Revenants/Strategies, Mod Ash): +20 per heal, every 15 ticks at most, 8-25 heals. */
const HEAL = {
  amount: 20,
  cooldownTicks: 15,
  minHeals: 8,
  maxHeals: 25,
  graphic: 1221, // godwars_saradomin_light_attk_spot
  sound: 3887,
};

/** The Revenant maledictus, the caves' superior revenant. */
const MALEDICTUS_ID = 11246;

const ITEMS = {
  COINS: 995,
  ETHER: 21820,
  BRACELET_CHARGED: 21816,
  BRACELET_UNCHARGED: 21817,
  AMULET_OF_AVARICE: 22557,
};

module.exports = { REVENANTS, REVENANT_IDS, MALEDICTUS_ID, inCaves, STYLE_ANIMATIONS, ATTACK_SOUNDS, MAGIC, RANGED, HEAL, ITEMS };
