/**
 * The Hueycoatl's attacks, as captured (docs/hueycoatl.md):
 *
 * - Rain Fire: every attack the head rears: huey_attack_melee for everyone, and for each target
 *   its own npc_anim_specific huey_attack_<style> (huey_shield_attack_<style> while shielded)
 *   and npc_spotanim_specific charge spotanim in slot 0 (recordings 4052, 4054, 3399). 4
 *   ticks later a feather falls on every player in the arena, from just above them (start
 *   height 900, end 200, angle 80), landing 150 cycles later on the summit and 210 on the
 *   mountainside. The colour tells the style (Wiki): the matching protection prayer holds it to
 *   0-2 damage, else up to 14. Launch and impact sounds are the style's own.
 * - Glowing symbols: a cast lights the fixed tiles of each part of the mountain with players
 *   on it, and some of its other tiles (huey_attack_tiles_loc with vfx_hueycoatl_prayer_02,
 *   delay 120); 4 ticks later lightning strikes whoever still stands on one, up to 16 (Wiki).
 * - Tail slam: a wave of 190-195 tiles out from the tail, identical every time, reaching each
 *   tile 15 cycles per tile of distance later; whoever stands on a tile as it arrives takes
 *   20-25 (Wiki). Moving through it dodges it.
 */
const Shared = require("./Shared.Hueycoatl");
const CombatAchievements = require("./CombatAchievements.Hueycoatl");

const STYLES = Object.freeze(["melee", "missiles", "magic"]);
const FEATHER_DELAY_TICKS = 4;
const FEATHER = Object.freeze({ startHeight: 225, endHeight: 50, angle: 80, distanceOffset: 0 });
const FLIGHT_SUMMIT = 150;
const FLIGHT_MOUNTAINSIDE = 210;
const CYCLES_PER_TICK = 30;
const SYMBOL_STRIKE_TICKS = 4;
const SYMBOL_DELAY = 120;
const SYMBOL_SOUND_RADIUS = 31;
/** Tiles a cast lights per part of the mountain (the captured medians). */
const SYMBOL_COUNT = Object.freeze({ mountainside: 15, summit: 22 });
const SYMBOL_CENTRE = Object.freeze({ mountainside: [1525, 3274], summit: [1512, 3284] });
const SLAM_SOUND_RADIUS = 15;

let core = null;
let PrayerHandler = null;

const PROTECTION = () => ({
  melee: PrayerHandler.PROTECT_FROM_MELEE,
  missiles: PrayerHandler.PROTECT_FROM_MISSILES,
  magic: PrayerHandler.PROTECT_FROM_MAGIC,
});

function hit(player, damage) {
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
}

function graphic(id) {
  return new core.Graphic(id);
}

/** One volley: the head rears in a style and a feather falls on each player. */
function rainFire(session, players, shielded) {
  const { head } = session.fight;
  if (!head?.isRegistered()) return;
  const style = Shared.pick(STYLES);
  // Everyone sees huey_attack_melee; each target also gets the style's own rear and charge.
  head.performAnimation(new core.Animation(Shared.SEQ.HEAD_ATTACK.melee));
  const own = new core.Animation((shielded ? Shared.SEQ.HEAD_SHIELD_ATTACK : Shared.SEQ.HEAD_ATTACK)[style]);
  for (const player of players) {
    if (!player.isRegistered()) continue;
    player.getPacketSender().sendNpcAnimationSpecific(head, own).sendNpcSpotAnimationSpecific(head, graphic(Shared.GFX.CHARGE[style]), 0);
  }
  const generation = session.fight.generation;
  session.schedule(FEATHER_DELAY_TICKS, () => {
    for (const player of players) launchFeather(session, player, style, generation);
  });
}

function launchFeather(session, player, style, generation) {
  if (!player.isRegistered() || !session.inArena(player)) return;
  const at = player.getLocation();
  const from = new core.Location(at.getX(), at.getY() + 1, at.getZ());
  const flight = session.inBounds(player, Shared.MOUNTAINSIDE_BOUNDS) ? FLIGHT_MOUNTAINSIDE : FLIGHT_SUMMIT;
  const sender = player.getPacketSender();
  sender.sendProjectile(from, at, 0, flight, Shared.GFX.FEATHER[style], FEATHER.startHeight, FEATHER.endHeight,
    player, 0, FEATHER.angle, FEATHER.distanceOffset);
  sender.sendSoundEffect(Shared.SOUND.FEATHER_LAUNCH[style], 1, 0);
  session.schedule(Math.floor(flight / CYCLES_PER_TICK), () => {
    if (session.fight.generation !== generation || !Shared.alive(player)) return;
    const prayed = PrayerHandler.isActivated(player, PROTECTION()[style]);
    const damage = prayed ? Shared.randomBetween(0, Shared.RAIN_FIRE_PRAYED_MAX) : Shared.randomBetween(0, Shared.RAIN_FIRE_MAX);
    player.performGraphic(graphic(Shared.GFX.IMPACT[style]));
    sender.sendSoundEffect(Shared.SOUND.FEATHER_IMPACT[style], 1, 0);
    hit(player, damage);
    if (!prayed && damage > 0) CombatAchievements.avoidable(player);
  });
}

function sample(list, count) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy.slice(0, Math.max(0, count));
}

/** The tiles a cast lights: for each part of the mountain with players on it. */
function symbolTiles(session, players) {
  const tiles = new Map();
  for (const [part, bounds] of [["mountainside", Shared.MOUNTAINSIDE_BOUNDS], ["summit", Shared.SUMMIT_BOUNDS]]) {
    if (!players.some((player) => session.inBounds(player, bounds))) continue;
    const { fixed, pool } = Shared.SYMBOLS[part];
    for (const tile of [...fixed, ...sample(pool, SYMBOL_COUNT[part] - fixed.length)]) tiles.set(`${tile[0]},${tile[1]}`, tile);
  }
  return [...tiles.values()];
}

function symbols(session, players) {
  const tiles = symbolTiles(session, players);
  if (tiles.length === 0) return;
  const viewers = session.viewers();
  for (const tile of tiles) {
    session.setLoc(tile, Shared.SCENERY_SHAPE, Shared.randomBetween(0, 3), Shared.LOC.SYMBOL);
    session.graphic(tile, Shared.GFX.SYMBOL, SYMBOL_DELAY, viewers);
  }
  const lit = new Set(tiles.map(([x, y]) => `${x},${y}`));
  session.schedule(SYMBOL_STRIKE_TICKS, () => {
    for (const tile of tiles) session.setLoc(tile, Shared.SCENERY_SHAPE, 0, null);
    for (const part of ["mountainside", "summit"]) {
      if (tiles.some((tile) => Shared.SYMBOLS[part].fixed.some(([x, y]) => x === tile[0] && y === tile[1]))) {
        session.sound(SYMBOL_CENTRE[part], Shared.SOUND.LIGHTNING, { radius: SYMBOL_SOUND_RADIUS });
      }
    }
    for (const player of session.arenaPlayers()) {
      const [x, y] = session.authored(player.getLocation());
      if (!lit.has(`${x},${y}`) || !Shared.alive(player)) continue;
      hit(player, Shared.randomBetween(1, Shared.LIGHTNING_MAX));
      CombatAchievements.avoidable(player);
    }
  });
}

/** For testing (::huey symbol): a cast on the 3x3 around a player, the glow (loc), the strike
 * (delayed graphic) or both, without the damage. */
function testSymbols(session, player, part = "both") {
  const [px, py] = session.authored(player.getLocation());
  const tiles = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.push([px + dx, py + dy]);
  // The player too: the public fight only shows its graphics near the arena, and this runs anywhere.
  const viewers = [...new Set([...session.viewers(), player])];
  for (const tile of tiles) {
    if (part !== "strike") session.setLoc(tile, Shared.SCENERY_SHAPE, Shared.randomBetween(0, 3), Shared.LOC.SYMBOL);
    if (part !== "glow") session.graphic(tile, Shared.GFX.SYMBOL, part === "strike" ? 0 : SYMBOL_DELAY, viewers);
  }
  if (part !== "strike") session.schedule(SYMBOL_STRIKE_TICKS, () => {
    for (const tile of tiles) session.setLoc(tile, Shared.SCENERY_SHAPE, 0, null);
  });
}

/** The tail slams: the wave's graphics, then each player on a tile as it arrives is hit once. */
function slam(session, side) {
  const tiles = Shared.SHOCKWAVES[side];
  const origin = side === "west" ? Shared.TAIL_WEST : Shared.TAIL_EAST;
  for (const sound of Shared.SOUND.SLAM) session.sound(origin, sound, { radius: SLAM_SOUND_RADIUS });
  const viewers = session.viewers();
  const byTick = new Map();
  for (const [x, y, delay, gfx] of tiles) {
    session.graphic([x, y], gfx, delay, viewers);
    const tick = Math.floor(delay / CYCLES_PER_TICK);
    if (!byTick.has(tick)) byTick.set(tick, new Map());
    byTick.get(tick).set(`${x},${y}`, gfx);
  }
  const struck = new Set();
  for (const [tick, wave] of byTick) {
    session.schedule(tick, () => {
      for (const player of session.arenaPlayers()) {
        if (struck.has(player) || !Shared.alive(player)) continue;
        const [x, y] = session.authored(player.getLocation());
        const gfx = wave.get(`${x},${y}`);
        if (gfx == null) continue;
        struck.add(player);
        session.graphic([x, y], Shared.GFX.SHOCKWAVE_IMPACT[gfx]);
        hit(player, Shared.randomBetween(Shared.SHOCKWAVE_MIN, Shared.SHOCKWAVE_MAX));
        CombatAchievements.avoidable(player);
      }
    });
  }
}

function attach(pluginApi) {
  core = pluginApi.core;
  PrayerHandler = core.PrayerHandler;
}

module.exports = { attach, rainFire, symbols, slam, testSymbols, _test: { symbolTiles, sample } };
