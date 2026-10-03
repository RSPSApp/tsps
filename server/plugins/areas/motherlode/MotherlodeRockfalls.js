/**
 * Motherlode Mine's rockfalls: mined out of the way for Mining XP, they come down again later and
 * hurt whoever stands under them.
 */
const { Animation } = require("../../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { HitDamage } = require("../../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { RegionManager } = require("../../../src/main/typescript/elvarg/game/collision/RegionManager");
const { findBestPickaxe } = require("../../skills/Mining.plugin");
const { ObjectManager, nearbyPlayers, areaSound } = require("./MotherlodeWorld");

const ROCKFALLS = new Set([26679, 26680]);
/** As captured: it's gone 2 ticks after the swing, for 10 XP (Wiki). */
const MINE_TICKS = 2;
const ROCKFALL_XP = 10;
const MINED_SOUND = 3600;
/** Captured 78 ticks; OpenRune's (ISC) 80-100. */
const RESPAWN_TICKS = [78, 100];
/** The collapse as captured: two falling rocks (projectile 645) from up to 2 tiles away, and a crash. */
const FALLING_ROCK = 645;
const FALL_CYCLES = 30;
const FALLS = [{ delay: 0, height: 1000 }, { delay: 10, height: 900 }];
const FALL_END_HEIGHT = 25;
const CRASH_SOUND = 360;
/** Wiki: 1-4 damage to players on the tile. */
const DAMAGE = [1, 4];
const NEIGHBOURS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/** Rockfalls mined away: { object, collapsesAt, landsAt } */
const cleared = [];
/** player -> { object, minedAt } */
const miners = new Map();

function random([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** A rockfall's Mine. */
function mineRockfall({ player, object, objectId }, now) {
  if (!ROCKFALLS.has(objectId)) return false;
  const pickaxe = findBestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage("You need a pickaxe to mine this rock.");
    return;
  }
  player.performAnimation(pickaxe.animation);
  miners.set(player, { object, minedAt: now + MINE_TICKS });
}

function clearRockfall(player, object, now) {
  if (cleared.some((entry) => entry.object === object)) return;
  ObjectManager.deregister(object, true);
  cleared.push({ object, collapsesAt: now + random(RESPAWN_TICKS), landsAt: -1 });
  player.getSkillManager().addExperiences(Skill.MINING, ROCKFALL_XP);
  areaSound(MINED_SOUND, [object.getLocation().getX(), object.getLocation().getY()], { radius: 3 });
}

/** The rocks start falling; they land a tick later. */
function collapse(entry, now) {
  const target = entry.object.getLocation();
  for (const player of nearbyPlayers(target.getX(), target.getY())) {
    for (const fall of FALLS) {
      const source = new Location(target.getX() + random([-2, 2]), target.getY() + random([-2, 2]), 0);
      player.getPacketSender().sendProjectile(
        source, target, 0, FALL_CYCLES, FALLING_ROCK, fall.height / 4, FALL_END_HEIGHT / 4, 0, fall.delay, 0, 0,
      );
    }
  }
  areaSound(CRASH_SOUND, [target.getX(), target.getY()], { delay: FALL_CYCLES, radius: 2 });
  entry.landsAt = now + 1;
}

function land(entry) {
  const target = entry.object.getLocation();
  ObjectManager.register(entry.object, true);
  for (const player of nearbyPlayers(target.getX(), target.getY(), 0, 0)) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(random(DAMAGE), HitMask.RED)]);
    const free = NEIGHBOURS
      .map(([dx, dy]) => new Location(target.getX() + dx, target.getY() + dy, 0))
      .find((tile) => RegionManager.getClipping(tile.getX(), tile.getY(), 0, null) === 0);
    if (free) player.moveTo(free);
  }
}

function tick(now) {
  for (const [player, mining] of miners) {
    if (!player.isRegistered?.() || player.getMovementQueue().size() > 0) {
      miners.delete(player);
      continue;
    }
    if (now < mining.minedAt) continue;
    miners.delete(player);
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    clearRockfall(player, mining.object, now);
  }
  for (const entry of [...cleared]) {
    if (entry.landsAt < 0 && now >= entry.collapsesAt) collapse(entry, now);
    else if (entry.landsAt >= 0 && now >= entry.landsAt) {
      cleared.splice(cleared.indexOf(entry), 1);
      land(entry);
    }
  }
}

function forget(player) {
  miners.delete(player);
}

module.exports = { mineRockfall, tick, forget, cleared, ROCKFALLS };
