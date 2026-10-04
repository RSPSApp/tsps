"use strict";

/**
 * Killing the Doom with a melee punish (Wiki, "Doom of Mokhaiotl/Strategies"): at delves 1-8,
 * projectiles resembling holy water are launched around it, restoring 28 hitpoints, 14 prayer
 * points and 25% special attack energy, and clearing acid blood in a 3x3 around where each lands.
 * The changelog has it guaranteed when the Doom dies during the melee punish phase. A capture
 * shows none when the killing blow was an arrow loosed before the charge, so here it takes the
 * punishing melee hit, or its bonus the tick after.
 * Guesses: four projectiles (holy water's, 192) from its centre to tiles two to four away, about
 * a tick in flight; the restore given once, as the first lands.
 */

const Shared = require("./DoomShared");

const HOLY_WATER = {
  projectile: 192,
  count: 4,
  reach: [2, 4],
  flight: { delay: 0, end: 40, startHeight: 120, endHeight: 0 },
  hitpoints: 28,
  prayer: 14,
  special: 25,
  lastDelve: 8,
};
const DIRECTIONS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 1]];

/** Whether the Doom just died to a melee punish (the hit, or its bonus the tick after). */
function punishKill(run) {
  return run.level <= HOLY_WATER.lastDelve && Number.isFinite(run.punishedAt) && run.ticks - run.punishedAt <= 1;
}

/** The holy water flies out; acid around each landing tile goes, and the player is restored once. */
function launch(run, boss) {
  const { Projectile } = Shared.core();
  const centre = Projectile.centreOf(boss);
  const half = boss.getSize() >> 1;
  const directions = DIRECTIONS.slice().sort(() => run.random() - 0.5).slice(0, HOLY_WATER.count);
  let restored = false;
  for (const [dx, dy] of directions) {
    const out = half + Shared.random(...HOLY_WATER.reach);
    const tile = { x: centre.getX() + dx * out, y: centre.getY() + dy * out, z: centre.getZ() };
    const lands = Shared.projectile(run.area, centre, Shared.loc(tile), HOLY_WATER.projectile, HOLY_WATER.flight);
    Shared.later(run, lands, () => {
      for (let x = tile.x - 1; x <= tile.x + 1; x++) {
        for (let y = tile.y - 1; y <= tile.y + 1; y++) run.acid.clearAt(x, y);
      }
      if (restored) return;
      restored = true;
      restore(run.player);
    });
  }
}

function restore(player) {
  const { Skill } = Shared.core();
  player.heal(HOLY_WATER.hitpoints);
  const skills = player.getSkillManager();
  skills.increaseCurrentLevel?.(Skill.PRAYER, HOLY_WATER.prayer, skills.getMaxLevel(Skill.PRAYER));
  player.setSpecialPercentage(Math.min(100, player.getSpecialPercentage() + HOLY_WATER.special));
}

module.exports = { HOLY_WATER, punishKill, launch, restore };
