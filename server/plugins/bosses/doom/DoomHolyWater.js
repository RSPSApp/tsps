"use strict";

/**
 * Killing the Doom with a melee punish (Wiki, "Doom of Mokhaiotl/Strategies"): at delves 1-8,
 * projectiles resembling holy water are launched around it, restoring 28 hitpoints, 14 prayer
 * points and 25% special attack energy, and clearing acid blood in a 3x3 around where each lands.
 * The changelog has it guaranteed when the Doom dies during the melee punish phase. A capture
 * shows none when the killing blow was an arrow loosed before the charge, so here it takes the
 * punishing melee hit, or its bonus the tick after.
 * In game (player report): only a player standing where one lands (its 3x3) is restored.
 * Guesses: seven projectiles (holy water's, 192) from its centre to tiles up to four from it,
 * landing a tick apart; the restore given once, by the first that lands on the player.
 */

const Shared = require("./DoomShared");

const HOLY_WATER = {
  projectile: 192,
  count: 7,
  spread: 4,
  flight: { delay: 0, end: 40, startHeight: 120, endHeight: 0 },
  hitpoints: 28,
  prayer: 14,
  special: 25,
  lastDelve: 8,
};

/** Whether the Doom just died to a melee punish (the hit, or its bonus the tick after). */
function punishKill(run) {
  return run.level <= HOLY_WATER.lastDelve && Number.isFinite(run.punishedAt) && run.ticks - run.punishedAt <= 1;
}

/** The holy water flies out; acid around each landing tile goes, and a player in a splash is restored once. */
function launch(run, boss) {
  const { Projectile } = Shared.core();
  const centre = Projectile.centreOf(boss);
  const tiles = [];
  for (let attempt = 0; tiles.length < HOLY_WATER.count && attempt < 200; attempt++) {
    const tile = {
      x: centre.getX() + Shared.random(-HOLY_WATER.spread, HOLY_WATER.spread),
      y: centre.getY() + Shared.random(-HOLY_WATER.spread, HOLY_WATER.spread),
      z: centre.getZ(),
    };
    if (!Shared.onFloor(tile) || tiles.some((other) => other.x === tile.x && other.y === tile.y)) continue;
    tiles.push(tile);
  }
  let restored = false;
  tiles.forEach((tile, index) => {
    const flight = { ...HOLY_WATER.flight, end: HOLY_WATER.flight.end + index * 30 };
    const lands = Shared.projectile(run.area, centre, Shared.loc(tile), HOLY_WATER.projectile, flight);
    Shared.later(run, lands, () => {
      for (let x = tile.x - 1; x <= tile.x + 1; x++) {
        for (let y = tile.y - 1; y <= tile.y + 1; y++) run.acid.clearAt(x, y);
      }
      const at = run.player.getLocation();
      const inSplash = Math.abs(at.getX() - tile.x) <= 1 && Math.abs(at.getY() - tile.y) <= 1;
      if (restored || !inSplash) return;
      restored = true;
      restore(run.player);
    });
  });
  return tiles;
}

function restore(player) {
  const { Skill } = Shared.core();
  player.heal(HOLY_WATER.hitpoints);
  const skills = player.getSkillManager();
  skills.increaseCurrentLevel?.(Skill.PRAYER, HOLY_WATER.prayer, skills.getMaxLevel(Skill.PRAYER));
  player.setSpecialPercentage(Math.min(100, player.getSpecialPercentage() + HOLY_WATER.special));
}

module.exports = { HOLY_WATER, punishKill, launch, restore };
