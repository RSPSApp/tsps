/**
 * The arena's hazards (docs/yama.md):
 * - Shadow waves (captured): a diagonal wall sweeping the arena from the south-east or
 *   south-west, 2 tiles a tick, every tile's map animation sent at once with its delay. A
 *   player on a tile as it passes takes up to 20 and loses their protection prayers (Wiki).
 * - Fire streaks (captured): rows lit at the east or west edge for 3 ticks, then crossing at 2
 *   tiles a tick. Walking through is safe; standing in one burns and binds (Wiki).
 * - Shadow Crash (phase 3, captured): three rocks in a line through the player, their shadows
 *   closing in on the middle one in a bowtie 3 ticks later, up to 20 there (Wiki).
 */
const Common = require("./Common.Yama");
const Hits = require("./Hits.Yama");

const CYCLES_PER_STEP = 15;
const STREAK_CYCLES = [15, 30];
const PROTECTION = ["PROTECT_FROM_MAGIC", "PROTECT_FROM_MISSILES", "PROTECT_FROM_MELEE"];

let arenaTiles = null;

/** Every arena floor tile, as [x, y] on the cache map. */
function tiles() {
  if (!arenaTiles) {
    arenaTiles = [];
    for (const [y, ranges] of Common.data.arena.rows) {
      for (const [minX, maxX] of ranges) for (let x = minX; x <= maxX; x++) arenaTiles.push([x, y]);
    }
  }
  return arenaTiles;
}

function onFloor(x, y) {
  const row = Common.data.arena.rows.find(([rowY]) => rowY === y);
  return Boolean(row) && row[1].some(([minX, maxX]) => x >= minX && x <= maxX);
}

const shuffled = (list) => list.map((item) => [Math.random(), item]).sort((a, b) => a[0] - b[0]).map(([, item]) => item);

// ------------------------------------------------------------------ shadow waves

/** `shift` moves where a pair of waves crosses by that many columns (Wiki: phase 3). */
function waveStep(corner, x, y, shift = 0) {
  const offset = Common.data.hazards.wave.from[corner];
  return corner === "southEast" ? y - x + offset + shift : x + y + offset - shift;
}

/** One wave from a corner: every tile's animation now, with its delay (as captured). */
function wave(fight, corner, shift = 0) {
  const spot = Common.data.hazards.wave.spot[corner];
  const { player, session } = fight;
  let last = 0;
  for (const [x, y] of tiles()) {
    const step = waveStep(corner, x, y, shift);
    if (step < 0) continue;
    last = Math.max(last, step);
    Hits.tileGraphic(player, session.tile([x, y, 0]), spot, { delay: step * CYCLES_PER_STEP });
  }
  fight.waves.push({ corner, shift, start: fight.tick, last });
}

function processWaves(fight) {
  const { player, session } = fight;
  const [x, y] = session.worldTile(player.getLocation());
  fight.waves = fight.waves.filter((wave) => {
    const elapsed = fight.tick - wave.start;
    if (elapsed > wave.last / 2 + 1) return false;
    const step = waveStep(wave.corner, x, y, wave.shift);
    if (!wave.hit && onFloor(x, y) && Math.floor(step / 2) === elapsed) {
      wave.hit = true;
      shadowBurn(fight);
    }
    return true;
  });
}

function shadowBurn(fight) {
  const { PrayerHandler } = Common.core;
  const { player } = fight;
  Hits.damage(player, Hits.randomInt(Math.ceil(Common.data.hazards.wave.maxHit * 0.8), Common.data.hazards.wave.maxHit));
  for (const prayer of PROTECTION) {
    if (PrayerHandler.isActivated(player, PrayerHandler[prayer])) PrayerHandler.deactivatePrayer(player, PrayerHandler[prayer]);
  }
}

// ------------------------------------------------------------------ fire streaks

/** `count` streaks on distinct random rows, each from a random edge. */
function streaks(fight, count) {
  const { warnTicks, sound } = Common.data.hazards.streak;
  const rows = shuffled(Common.data.arena.rows.filter(([, ranges]) => ranges.length === 1)).slice(0, count);
  for (const [y, [[minX, maxX]]] of rows) {
    const fromWest = Math.random() < 0.5;
    fight.streaks.push({ y, x: fromWest ? minX : maxX, dir: fromWest ? 1 : -1, minX, maxX, wait: warnTicks, tiles: [] });
  }
  Hits.sound(fight.player, sound);
}

function processStreaks(fight) {
  const { player, session } = fight;
  const { spot, damage, bindTicks } = Common.data.hazards.streak;
  const here = session.worldTile(player.getLocation());
  const moved = !fight.lastTile || fight.lastTile[0] !== here[0] || fight.lastTile[1] !== here[1];
  fight.streaks = fight.streaks.filter((streak) => {
    if (streak.wait > 0) {
      streak.wait--;
      streak.tiles = [streak.x];
      Hits.tileGraphic(player, session.tile([streak.x, streak.y, 0]), spot, { delay: STREAK_CYCLES[0] });
    } else {
      const next = [streak.x + streak.dir, streak.x + streak.dir * 2].filter((x) => x >= streak.minX && x <= streak.maxX);
      if (next.length === 0) return false;
      next.forEach((x, i) => Hits.tileGraphic(player, session.tile([x, streak.y, 0]), spot, { delay: STREAK_CYCLES[i] }));
      streak.tiles = next;
      streak.x = next[next.length - 1];
    }
    if (!moved && here[1] === streak.y && streak.tiles.includes(here[0])) {
      Hits.damage(player, damage);
      Hits.root(player, bindTicks);
    }
    return true;
  });
  fight.lastTile = here;
}

// ------------------------------------------------------------------ Shadow Crash

const CARDINAL_AXES = [[0, 1], [1, 0]];
const DIAGONAL_AXES = [[1, 1], [1, -1]];
const SHADOW_DELAYS = [30, 23, 15, 8];

/** The bowtie a crash's shadows cover around its centre, with each tile's delay. */
function bowtie([ux, uy], reach) {
  const cells = [];
  const diagonal = ux !== 0 && uy !== 0;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const along = diagonal ? (dx * ux + dy * uy) / 2 : dx * ux + dy * uy;
      const across = diagonal ? (dx * uy - dy * ux) / 2 : dx * uy - dy * ux;
      if (Math.abs(along) > reach || Math.abs(across) > Math.abs(along)) continue;
      const ring = Math.min(SHADOW_DELAYS.length - 1, Math.round(Math.abs(along) * (diagonal ? 1.5 : 1)));
      cells.push({ dx, dy, delay: SHADOW_DELAYS[ring] });
    }
  }
  return cells;
}

/** One crash on the player's tile along `axis` ("cardinal" or "diagonal"), the cardinal turned 90 degrees from `previous`. */
function crash(fight, axis, previous) {
  const { crash: spec } = Common.data.phase3;
  const { player, session } = fight;
  const [cx, cy] = session.worldTile(player.getLocation());
  const axes = axis === "diagonal" ? DIAGONAL_AXES : CARDINAL_AXES.filter((a) => !previous || a[0] !== previous[0]);
  const direction = axes[Math.floor(Math.random() * axes.length)];
  const reach = axis === "diagonal" ? 2 : spec.reach;
  const [ux, uy] = direction;
  Hits.tileGraphic(player, session.tile([cx, cy, 0]), spec.rock);
  Hits.tileGraphic(player, session.tile([cx + ux * reach, cy + uy * reach, 0]), spec.rock, { delay: 3 });
  Hits.tileGraphic(player, session.tile([cx - ux * reach, cy - uy * reach, 0]), spec.rock, { delay: 3 });
  for (const [id, delay] of spec.sounds) Hits.sound(player, { id, delay });
  const cells = bowtie(direction, reach).filter(({ dx, dy }) => onFloor(cx + dx, cy + dy));
  fight.at(spec.shadowTicks, () => {
    for (const { dx, dy, delay } of cells) Hits.tileGraphic(player, session.tile([cx + dx, cy + dy, 0]), spec.shadow, { delay });
  });
  fight.at(spec.shadowTicks + 1, () => {
    const [px, py] = session.worldTile(player.getLocation());
    const hit = cells.some(({ dx, dy }) => cx + dx === px && cy + dy === py);
    if (hit) Hits.damage(player, Hits.randomInt(0, spec.maxHit));
  });
  return direction;
}

/** A Shadow Crash: cardinal, diagonal, cardinal, 3 ticks apart (Wiki, captured). */
function shadowCrash(fight) {
  const { spacingTicks } = Common.data.phase3.crash;
  const first = crash(fight, "cardinal");
  fight.at(spacingTicks, () => crash(fight, "diagonal"));
  fight.at(spacingTicks * 2, () => crash(fight, "cardinal", first));
}

function process(fight) {
  processWaves(fight);
  processStreaks(fight);
}

function clear(fight) {
  fight.waves = [];
  fight.streaks = [];
}

module.exports = { wave, streaks, shadowCrash, process, clear, bowtie, waveStep, onFloor, tiles };
