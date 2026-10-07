"use strict";

/**
 * The Wintertodt's five attacks.
 *
 * Wiki ("Wintertodt/Strategies"): none reach the safe area by the doors. A standard attack is
 * tried against a random roll up to the full energy and goes ahead if the roll is under the
 * energy left (so it fades as the round goes on), with a 10-tick cooldown; it interrupts
 * fletching and feeding but not chopping. Brazier and pyromancer attacks go ahead when the roll
 * is over the energy left, so they grow as it falls. The area attack covers a 3x3 around a
 * player and can't target anyone next to an obstacle.
 * Captures: area attacks start on a 20-tick beat and the others on a 5-tick one; the timings and
 * graphics of each are recorded in docs/wintertodt.md. The cold's hits in them come every 10-15
 * ticks at high energy but 25-65 apart below 60%: a linear roll fits them badly, the energy share
 * cubed fits them well (10 ticks apart at full energy, about 28 at 60%, 80 at 40%).
 */

const Shared = require("./WintertodtShared");
const Corners = require("./WintertodtCorners");
const Effects = require("./WintertodtEffects");
const Warmth = require("./WintertodtWarmth");

const ATTEMPT_TICKS = 5;
const AREA_TICKS = 20;
const COLD_COOLDOWN = 10;
/** Share of area-attack rolls that go ahead for each player (the captures show about half). */
const AREA_CHANCE = 0.5;
const LARGE_BRAZIER_CHANCE = 0.25;
const PYROMANCER_DAMAGE = { min: 7, max: 13 };
const STANDARD_FALLOFF = 3;

const COLD_MESSAGE = "The cold of the Wintertodt seeps into your bones.";
const AREA_MESSAGE = "The freezing cold attack of the Wintertodt's magic hits you.";
const SHRAPNEL_MESSAGE = "The brazier is broken and shrapnel damages you.";
const GONE_OUT_MESSAGE = "The brazier has gone out.";

/** Tiles under an area attack that hasn't landed yet: no new one may overlap them. */
const areaTiles = new Set();

let random = Math.random;

function useRandom(source) {
  random = source;
}

function key(x, y) {
  return `${x},${y}`;
}

function between(min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function onTiles(player, tiles) {
  const at = player.getLocation();
  return tiles.some((tile) => tile.x === at.getX() && tile.y === at.getY());
}

// ------------------------------------------------------------------ standard

/** The chance a standard attack goes ahead on its beat: the energy's share, cubed. */
function standardChance(energy) {
  return Math.max(0, Math.min(1, energy / Shared.MAX_ENERGY)) ** STANDARD_FALLOFF;
}

function standardAttack(player) {
  player.__wintertodtColdAt = player.__wintertodtTick;
  Warmth.hurt(player, "standard", COLD_MESSAGE);
  const action = Shared.actionOf(player);
  if (action === "fletch" || action?.startsWith("feed")) Shared.stopAction(player);
}

// ------------------------------------------------------------------ braziers and pyromancers

function brazierCentre(index) {
  const { brazier } = Corners.corner(index).corner;
  return { x: brazier.x + 1, y: brazier.y + 1 };
}

/** Light snow, then the brazier goes out. */
function smallBrazierAttack(index, ctx) {
  const c = Corners.corner(index);
  c.brazierTargeted = true;
  Effects.snowfall(brazierCentre(index), 2);
  Effects.stormBolt(c.corner.brazier, 90);
  Effects.graphic(Shared.GFX.SNOW_IMPACT, c.corner.brazier, { delay: 90, height: 60 });
  Shared.later(`wintertodt-brazier-${index}`, 4, () => {
    c.brazierTargeted = false;
    if (!ctx.isActive() || c.brazier !== Shared.BRAZIER.LIT) return;
    Corners.setBrazier(index, Shared.BRAZIER.UNLIT);
    ctx.broadcast();
    for (const player of ctx.players()) {
      if (Shared.actionOf(player) !== `feed:${index}`) continue;
      Shared.stopAction(player);
      player.sendMessage(GONE_OUT_MESSAGE);
    }
  });
}

/** Heavy snow, then the brazier shatters on everyone beside it. */
function largeBrazierAttack(index, ctx) {
  const c = Corners.corner(index);
  const centre = brazierCentre(index);
  c.brazierTargeted = true;
  Effects.snowfall(centre, 3);
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) Effects.snowfall({ x: centre.x + dx, y: centre.y + dy }, 3);
  Effects.projectile(Shared.STORM_SOURCE, c.corner.brazier, Shared.PROJECTILE.STORM_BOLT, { end: 120, startHeight: 150 });
  Effects.graphic(Shared.GFX.SNOW_IMPACT, c.corner.brazier, { delay: 120, height: 70 });
  Shared.later(`wintertodt-brazier-${index}`, 4, () => {
    c.brazierTargeted = false;
    if (!ctx.isActive() || c.brazier !== Shared.BRAZIER.LIT) return;
    Corners.setBrazier(index, Shared.BRAZIER.BROKEN);
    ctx.broadcast();
    for (const player of ctx.players()) {
      if (Shared.distance(player.getLocation(), centre) > 2) continue;
      if (Shared.actionOf(player) === `feed:${index}`) Shared.stopAction(player);
      Warmth.hurt(player, "brazier", SHRAPNEL_MESSAGE);
    }
  });
}

/** Light snow over a pyromancer, and she takes a hit. */
function pyromancerAttack(index, ctx) {
  const c = Corners.corner(index);
  const tile = c.corner.pyromancer;
  c.pyromancerTargeted = true;
  Effects.snowfall(tile, 3);
  Effects.stormBolt(tile, 120);
  Effects.graphic(Shared.GFX.SNOW_IMPACT, tile, { delay: 115 });
  Shared.later(`wintertodt-pyromancer-${index}`, 3, () => {
    c.pyromancerTargeted = false;
    if (!ctx.isActive()) return;
    if (Corners.damagePyromancer(index, between(PYROMANCER_DAMAGE.min, PYROMANCER_DAMAGE.max))) ctx.broadcast();
  });
}

/** A random corner, brazier or pyromancer; an attack only lands on a lit brazier or a healthy pyromancer. */
function specialAttack(ctx) {
  const index = Math.floor(random() * Shared.CORNERS.length);
  const c = Corners.corner(index);
  if (random() < 0.5) {
    if (c.brazier !== Shared.BRAZIER.LIT || c.brazierTargeted) return;
    if (random() < LARGE_BRAZIER_CHANCE) largeBrazierAttack(index, ctx);
    else smallBrazierAttack(index, ctx);
    return;
  }
  if (!c.pyromancerHealthy || c.pyromancerTargeted) return;
  pyromancerAttack(index, ctx);
}

// ------------------------------------------------------------------ area

function areaFor(centre) {
  const tiles = [centre];
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) tiles.push({ x: centre.x + dx, y: centre.y + dy });
  return tiles;
}

function square(centre) {
  const tiles = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.push({ x: centre.x + dx, y: centre.y + dy });
  return tiles;
}

/** A 3x3 with nothing in it, outside the safe area and clear of any other area attack. */
function canTarget(centre) {
  const { RegionManager, Location } = Shared.core();
  return square(centre).every((tile) => !areaTiles.has(key(tile.x, tile.y))
    && !Shared.inSafeArea(new Location(tile.x, tile.y, 0))
    && RegionManager.getClipping(tile.x, tile.y, 0, null) === 0);
}

function areaAttack(target, ctx) {
  const at = target.getLocation();
  const centre = { x: at.getX(), y: at.getY() };
  if (!canTarget(centre)) return false;
  const marked = square(centre);
  for (const tile of marked) areaTiles.add(key(tile.x, tile.y));
  const tiles = areaFor(centre);
  target.getPacketSender().sendVarbit(Shared.VARBIT.AREA_ATTACK, 1);
  Shared.later(target, 1, () => target.getPacketSender().sendVarbit(Shared.VARBIT.AREA_ATTACK, 0));
  for (const tile of tiles) Effects.snowfall(tile, 6);
  Effects.stormBolt(centre, 200);
  Shared.later(`wintertodt-area-${centre.x},${centre.y}`, 3, () => {
    tiles.forEach((tile, i) => {
      const from = { x: tile.x + between(-3, 3), y: tile.y + between(-3, 3) };
      Effects.projectile(from, tile, Shared.PROJECTILE.AREA_SPOT, { delay: 50, end: 90, startHeight: 400, endHeight: 0, slope: 0 });
      Effects.graphic(i === 0 ? Shared.GFX.SNOW_IMPACT : Shared.GFX.AREA_IMPACT, tile, { delay: 90 });
    });
  });
  Shared.later(`wintertodt-area-${centre.x},${centre.y}`, 6, () => {
    for (const tile of marked) areaTiles.delete(key(tile.x, tile.y));
    if (!ctx.isActive()) return;
    tiles.forEach((tile, i) => Effects.tempLoc(i === 0 ? Shared.OBJECT.ICICLE : Shared.OBJECT.SNOW, tile, Math.floor(random() * 4), 7));
    for (const player of ctx.players()) {
      if (onTiles(player, marked)) Warmth.hurt(player, "area", AREA_MESSAGE);
    }
    Corners.state.forEach((c, index) => {
      if (marked.some((tile) => tile.x === c.corner.pyromancer.x && tile.y === c.corner.pyromancer.y)
        && Corners.damagePyromancer(index, between(PYROMANCER_DAMAGE.min, PYROMANCER_DAMAGE.max))) ctx.broadcast();
    });
  });
  return true;
}

// ------------------------------------------------------------------ the beat

/**
 * `ctx`: ticks, energy, players() (everyone in the prison), isActive() and broadcast() (resend
 * the HUD), from the round.
 */
function tick(ctx) {
  const { ticks, energy } = ctx;
  const players = ctx.players().filter((player) => !Shared.inSafeArea(player.getLocation()));
  for (const player of players) player.__wintertodtTick = ticks;
  if (ticks % ATTEMPT_TICKS === 0) {
    for (const player of players) {
      const last = player.__wintertodtColdAt;
      if (last != null && last <= ticks && ticks - last < COLD_COOLDOWN) continue;
      if (random() < standardChance(energy)) standardAttack(player);
    }
    if (random() * Shared.MAX_ENERGY > energy) specialAttack(ctx);
  }
  if (ticks % AREA_TICKS === 0) {
    for (const player of players) {
      if (random() * Shared.MAX_ENERGY < energy && random() < AREA_CHANCE) areaAttack(player, ctx);
    }
  }
}

function reset() {
  areaTiles.clear();
}

module.exports = {
  tick, reset, useRandom, standardChance, canTarget, areaAttack, smallBrazierAttack, largeBrazierAttack, pyromancerAttack,
  standardAttack, COLD_MESSAGE, AREA_MESSAGE, SHRAPNEL_MESSAGE, GONE_OUT_MESSAGE,
};
