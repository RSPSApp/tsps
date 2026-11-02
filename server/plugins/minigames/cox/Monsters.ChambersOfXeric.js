"use strict";

/**
 * The raid's monsters: their base stats and how the raid scales them.
 *
 * Wiki: base levels, hitpoints and bonuses as the Wiki's DPS calculator holds them
 * (weirdgloop/osrs-dps-calc cdn/json/monsters.json), and its Chambers of Xeric scaling
 * (src/lib/scaling/ChambersOfXeric.ts):
 * - Levels scale with the party's highest Hitpoints level (55 + 44 x hp/99, 55-99), hitpoints
 *   with its highest combat level (60-126).
 * - Party size n: offence x (100 + 7 x isqrt(n-1) + (n-1))%, defence x (100 + isqrt(n-1) +
 *   (n-1) x 7/10)%, hitpoints x (1 + n/2) (rounded down).
 * - Challenge Mode: +50% offence, hitpoints and defence (Tekton's defence +20% under four
 *   raiders, else +35%; the glowing crystal's hitpoints and defence aren't raised).
 * - Scavenger beasts and vespine soldiers scale as solo monsters: only by the highest
 *   combat (hitpoints) and Hitpoints (levels), +50% in Challenge Mode.
 * - Guardians' base hitpoints are 151 + the party's average Mining level.
 * - The Great Olm: head 800 + 400 x k, claws 600 + 300 x k, k = min(n-1, 50) - 3 x (min(n, 50)/8);
 *   the right (mage) claw's Magic halved.
 * Not from a source: max hits grow with the scaled offence ((level + 9) ratio), as a max hit
 * follows effective strength; the Wiki gives them at the base scale only.
 */

/** Base stats, in NpcDefinition.getStats order: levels att/str/def/rng/mag, accuracy 5 melee 7 magic 9 ranged, defences 10-14 stab/slash/crush/magic/ranged. */
const MONSTERS = [
  { name: "Abyssal portal", ids: [7533], hp: 250, stats: [1, 1, 176, 1, 176, 0, 0, 0, 0, 0, 0, 0, 0, 60, 140], maxHit: 0 },
  { name: "Deathly mage", ids: [7560], hp: 120, stats: [1, 1, 155, 1, 210, 0, 0, 120, 0, 0, 0, 0, 0, 0, 0], maxHit: 22 },
  { name: "Deathly ranger", ids: [7559], hp: 120, stats: [1, 1, 155, 210, 155, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0], maxHit: 70 },
  { name: "Glowing crystal", ids: [7568], hp: 120, stats: [1, 1, 100, 1, 100, 0, 0, 0, 0, 0, -5, 180, 180, 0, 0], maxHit: 0 },
  { name: "Great Olm (Head (Normal))", ids: [7551, 7554], hp: 800, stats: [250, 250, 150, 250, 250, 0, 0, 60, 0, 60, 200, 200, 200, 200, 50], maxHit: 27 },
  { name: "Great Olm (Left claw (Normal))", ids: [7552, 7555], hp: 600, stats: [250, 250, 175, 250, 175, 0, 0, 60, 0, 60, 50, 50, 50, 200, 200], maxHit: 0 },
  { name: "Great Olm (Right claw (Normal))", ids: [7550, 7553], hp: 600, stats: [250, 250, 175, 250, 87, 0, 0, 60, 0, 60, 200, 200, 200, 50, 200], maxHit: 0 },
  { name: "Guardian (Chambers of Xeric)", ids: [7569, 7570, 7571, 7572], hp: 250, stats: [140, 140, 100, 1, 1, 0, 0, 0, 0, 0, 80, 180, -10, 0, 0], maxHit: 20 },
  { name: "Ice demon", ids: [7584, 7585], hp: 140, stats: [1, 1, 160, 390, 390, 0, 0, 0, 0, 0, 70, 70, 110, 40, 140], maxHit: 0 },
  { name: "Lizardman shaman (Chambers of Xeric)", ids: [7573, 7574], hp: 190, stats: [130, 130, 210, 130, 130, 58, 0, 0, 0, 56, 102, 160, 150, 160, 0], maxHit: 65 },
  { name: "Muttadile (Large)", ids: [7561, 7563], hp: 250, stats: [250, 250, 220, 250, 250, 88, 0, 0, 0, 82, -5, 82, 60, 75, 0], maxHit: 72 },
  { name: "Muttadile (Small)", ids: [7562], hp: 250, stats: [150, 150, 138, 150, 1, 71, 0, 0, 0, 83, -5, 72, 50, 60, 0], maxHit: 28 },
  { name: "Scavenger beast", ids: [7548, 7549], hp: 30, stats: [120, 120, 45, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], maxHit: 13 },
  { name: "Skeletal Mystic", ids: [7604, 7605, 7606], hp: 160, stats: [140, 140, 187, 1, 140, 85, 0, 40, 0, 0, 155, 155, 75, 140, 115], maxHit: 0 },
  { name: "Tekton (Normal)", ids: [7540, 7541, 7542, 7545], hp: 300, stats: [390, 390, 205, 1, 205, 64, 0, 0, 0, 0, 155, 165, 105, 0, 0], maxHit: 52 },
  { name: "Tekton (Enraged)", ids: [7543, 7544], hp: 300, stats: [390, 390, 205, 1, 205, 64, 0, 0, 0, 0, 280, 290, 180, 0, 0], maxHit: 59 },
  { name: "Vanguard (Magic)", ids: [7529], hp: 180, stats: [150, 150, 160, 150, 150, 0, 0, 40, 0, 0, 315, 340, 400, 110, 50], maxHit: 22 },
  { name: "Vanguard (Melee)", ids: [7527, 7525, 7526], hp: 180, stats: [150, 150, 160, 150, 150, 20, 0, 0, 0, 0, 150, 150, 150, 20, 400], maxHit: 18 },
  { name: "Vanguard (Ranged)", ids: [7528], hp: 180, stats: [150, 150, 160, 150, 150, 0, 0, 0, 0, 40, 55, 60, 100, 400, 300], maxHit: 22 },
  { name: "Vasa Nistirio", ids: [7565, 7566, 7567], hp: 300, stats: [1, 1, 175, 230, 230, 0, 0, 0, 0, 100, 170, 190, 40, 400, 40], maxHit: 0 },
  { name: "Vespine soldier", ids: [7538, 7539], hp: 100, stats: [150, 150, 40, 1, 40, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0], maxHit: 14 },
  { name: "Vespula", ids: [7530, 7531, 7532], hp: 200, stats: [150, 150, 88, 150, 88, 0, 0, 0, 0, 0, 0, 0, 0, 70, 60], maxHit: 14 },
];
const BY_ID = new Map(MONSTERS.flatMap((monster) => monster.ids.map((id) => [id, monster])));

const ID = {
  TEKTON: new Set([7540, 7541, 7542, 7543, 7544, 7545]),
  GUARDIAN: new Set([7569, 7570, 7571, 7572]),
  GLOWING_CRYSTAL: new Set([7568]),
  OLM_HEAD: new Set([7551, 7554]),
  OLM_CLAWS: new Set([7550, 7552, 7553, 7555]),
  OLM_MAGE_CLAW: new Set([7550, 7553]),
  SINGLES: new Set([7548, 7549, 7538, 7539]),
  /** Their Magic level is defensive (scaled as Defence). */
  MAGIC_DEFENSIVE: new Set([7559, 7540, 7541, 7542, 7543, 7544, 7545, 7533, 7530, 7531, 7532, 7538, 7539, 7550, 7552, 7553, 7555]),
};
const CM_PERCENT = 50;
const LEVELS = { ATTACK: 0, STRENGTH: 1, DEFENCE: 2, RANGED: 3, MAGIC: 4 };

const iSqrt = (x) => Math.trunc(Math.sqrt(x));
const addPercent = (x, percent) => x + Math.trunc((x * percent) / 100);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The party's figures the scaling reads: size, highest combat and Hitpoints levels, average Mining, mode. */
function inputsOf({ size, maxCombat, maxHitpoints, averageMining, challenge }) {
  return { size: clamp(size, 1, 100), maxCombat, maxHitpoints, averageMining: averageMining ?? 1, challenge: !!challenge };
}

function roles(id, base) {
  const offensives = [LEVELS.ATTACK, LEVELS.STRENGTH, LEVELS.RANGED];
  const defensives = [LEVELS.DEFENCE];
  (ID.MAGIC_DEFENSIVE.has(id) ? defensives : offensives).push(LEVELS.MAGIC);
  // Levels of 1 stay 1.
  const keep = (list) => list.filter((index) => base.stats[index] !== 1);
  const scaled = { offensives: keep(offensives), defensives: keep(defensives) };
  scaled.baseOffensive = Math.max(1, ...scaled.offensives.map((index) => base.stats[index]));
  scaled.baseDefensive = Math.max(1, ...scaled.defensives.map((index) => base.stats[index]));
  return scaled;
}

/** A monster's scaled { hitpoints, stats, maxHit }, or null for one without base stats. */
function scale(id, raidInputs) {
  const base = BY_ID.get(id);
  if (!base) return null;
  const inputs = inputsOf(raidInputs);
  const { offensives, defensives, baseOffensive, baseDefensive } = roles(id, base);
  const baseHp = ID.GUARDIAN.has(id) ? 151 + Math.trunc(inputs.averageMining) : base.hp;
  let offensive;
  let defensive;
  let hp;
  if (ID.SINGLES.has(id)) {
    let hpScaler = clamp(inputs.maxCombat, 60, 126);
    let statScaler = clamp(inputs.maxHitpoints, 55, 99);
    if (inputs.challenge) {
      statScaler = addPercent(statScaler, CM_PERCENT);
      hpScaler = addPercent(hpScaler, CM_PERCENT);
    }
    hp = Math.max(Math.trunc((baseHp * hpScaler) / 126), 5);
    offensive = Math.max(Math.trunc((baseOffensive * statScaler) / 99), 1);
    defensive = Math.max(Math.trunc((baseDefensive * statScaler) / 99), 1);
  } else {
    const others = inputs.size - 1;
    const highestCombat = clamp(inputs.maxCombat, 60, 126);
    const highestHp = clamp(55 + Math.trunc((44 * inputs.maxHitpoints) / 99), 55, 99);
    offensive = Math.trunc((baseOffensive * highestHp) / 99);
    defensive = Math.trunc((baseDefensive * highestHp) / 99);
    hp = Math.trunc((baseHp * highestCombat) / 126);
    offensive = Math.trunc((offensive * (100 + iSqrt(others) * 7 + others)) / 100);
    defensive = Math.trunc((defensive * (100 + iSqrt(others) + Math.trunc((others * 7) / 10))) / 100);
    hp += hp * Math.trunc((inputs.size * 50) / 100);
    if (inputs.challenge) {
      offensive = addPercent(offensive, CM_PERCENT);
      if (!ID.GLOWING_CRYSTAL.has(id)) hp = addPercent(hp, CM_PERCENT);
      if (ID.TEKTON.has(id)) defensive = addPercent(defensive, inputs.size < 4 ? 20 : 35);
      else if (!ID.GLOWING_CRYSTAL.has(id)) defensive = addPercent(defensive, CM_PERCENT);
    }
    hp = clamp(hp, 50, 30000);
    offensive = clamp(offensive, 50, 5000);
    defensive = clamp(defensive, 50, 20000);
  }
  const stats = [...base.stats];
  for (const index of offensives) stats[index] = offensive;
  for (const index of defensives) stats[index] = defensive;
  if (ID.OLM_HEAD.has(id) || ID.OLM_CLAWS.has(id)) {
    const k = Math.min(inputs.size - 1, 50) - 3 * Math.trunc(Math.min(inputs.size, 50) / 8);
    hp = ID.OLM_HEAD.has(id) ? 800 + 400 * k : 600 + 300 * k;
    if (ID.OLM_MAGE_CLAW.has(id)) stats[LEVELS.MAGIC] = Math.trunc(stats[LEVELS.MAGIC] / 2);
  }
  const maxHit = base.maxHit > 0 ? Math.floor((base.maxHit * (offensive + 9)) / (baseOffensive + 9)) : 0;
  return { hitpoints: hp, stats, maxHit };
}

/**
 * Wiki (Mod Ash, 9 July 2026): how often their drained stats come back a level. Tekton, the
 * Muttadiles and Vasa set theirs in their rooms; grubs never restore, and aren't scaled here.
 */
const STAT_RESTORE_TICKS = new Map([
  [7569, 8], [7570, 8], [7571, 8], [7572, 8],
  [7573, 20], [7574, 20],
  [7604, 25], [7605, 25], [7606, 25],
  [7530, 10], [7531, 10], [7532, 10],
  [7533, 45],
  [7538, 16], [7539, 16],
]);

/** Scales a spawned NPC for its raid. */
function apply(npc, raidInputs) {
  const scaled = scale(npc.getId(), raidInputs);
  if (!scaled) return null;
  npc.setMaxHitpoints(scaled.hitpoints);
  npc.setHitpoints(scaled.hitpoints);
  npc.setCombatOverride?.({ stats: scaled.stats, maxHit: scaled.maxHit || undefined });
  const restore = STAT_RESTORE_TICKS.get(npc.getId());
  if (restore) npc.setStatRestoreTicks(restore);
  return scaled;
}

/**
 * A max hit given at the base scale (the Wiki's, or an unverified one for attacks the Wiki lists as
 * "varies"), grown with the NPC's scaled level of a stat as the max hit follows it.
 */
function maxHitFor(npc, base, statIndex) {
  const entry = BY_ID.get(npc.getId());
  if (!entry) return base;
  const level = npc.getDefinition().getStats()[statIndex] ?? entry.stats[statIndex];
  return Math.max(1, Math.floor((base * (level + 9)) / (entry.stats[statIndex] + 9)));
}

/** Gives a spawned NPC another form's scaled stats and max hit (Tekton enraged), keeping its hitpoints. */
function restat(npc, id, raidInputs) {
  const scaled = scale(id, raidInputs);
  if (scaled) npc.setCombatOverride?.({ stats: scaled.stats, maxHit: scaled.maxHit || undefined });
  return scaled;
}

module.exports = { MONSTERS, ID, LEVELS, scale, apply, restat, maxHitFor, inputsOf };
