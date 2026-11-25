/**
 * Her standard attacks, as captured: magic and ranged (her animation, the projectile three ticks
 * later, the hit on the fourth) at anyone in the dream, and melee (the hit two ticks after her
 * animation) at whoever stands in front of or under her, which always hits.
 *
 * Prayer (Wiki): The Nightmare's hits land at 20% through the right protection and at 120% into the
 * wrong one; Phosani's are stopped by the right one and land in full otherwise, and in her third
 * phase she switches a protection off as she attacks. Her curse changes which protection is the
 * right one (Curse in Specials.Nightmare).
 */
const Common = require("./Common.Nightmare");

/** Her body's footprint as tiles, and whether `location` is in it or one tile around it. */
function bodyBounds(npc) {
  const at = npc.getLocation();
  const size = Math.max(1, npc.getSize?.() ?? 5);
  return { minX: at.getX(), minY: at.getY(), maxX: at.getX() + size - 1, maxY: at.getY() + size - 1 };
}

function underOrBeside(npc, location) {
  const { minX, minY, maxX, maxY } = bodyBounds(npc);
  const x = location.getX();
  const y = location.getY();
  return x >= minX - 1 && x <= maxX + 1 && y >= minY - 1 && y <= maxY + 1;
}

/** In her claws' reach: under her, or beside her on the side she faces (the target's). */
function inMeleeReach(npc, target, location) {
  if (!underOrBeside(npc, location)) return false;
  const { minX, minY, maxX, maxY } = bodyBounds(npc);
  const x = location.getX();
  const y = location.getY();
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
  const t = target.getLocation();
  const side = (px, py) => [px < minX ? -1 : px > maxX ? 1 : 0, py < minY ? -1 : py > maxY ? 1 : 0];
  const [tx, ty] = side(t.getX(), t.getY());
  const [sx, sy] = side(x, y);
  return (tx !== 0 && sx === tx) || (ty !== 0 && sy === ty);
}

/** The damage multiplier for a style against the player's prayer (and her curse). */
function prayerFactor(fight, player, style, prayer) {
  const blocked = prayer ? require("./Specials.Nightmare").blockedBy(fight, player, prayer) : null;
  const { attacks } = Common.data;
  if (fight.phosani) return blocked === style ? 0 : 1;
  if (!prayer) return 1;
  return blocked === style ? attacks.rightPrayer : attacks.wrongPrayer;
}

const PROTECTIONS = { magic: "PROTECT_FROM_MAGIC", ranged: "PROTECT_FROM_MISSILES", melee: "PROTECT_FROM_MELEE" };

/**
 * Phosani's third phase: the protection that would stop this attack is switched off on her
 * animation's tick; any other stays on (rsprox 1148 6837-7138, 1156 29250-29530: Magic off on her
 * magic, Missiles off on her ranged, Magic left on through ranged and melee). While cursed, the
 * protection that stops the style is the shuffled one (not captured).
 */
function breakProtection(fight, players, style) {
  if (!fight.phosani || fight.phase !== 3) return;
  const { PrayerHandler } = Common.core;
  const Specials = require("./Specials.Nightmare");
  for (const player of players) {
    const prayer = Object.keys(PROTECTIONS).find((name) => Specials.blockedBy(fight, player, name) === style);
    const handle = PrayerHandler[PROTECTIONS[prayer]];
    if (!prayer || !PrayerHandler.isActivated(player, handle)) continue;
    PrayerHandler.deactivatePrayer(player, handle);
    require("./CombatAchievements.Nightmare").prayerDisabled(fight, player);
  }
}

/**
 * Flight time grows with distance (captured, every revision: magic 30, ranged 20, plus the
 * Chebyshev distance from her centre tile; a player beside her is 3 away, so 33 and 23).
 */
function flight(boss, player, spec) {
  const { minX, minY, maxX, maxY } = bodyBounds(boss);
  const cx = Math.floor((minX + maxX) / 2);
  const cy = Math.floor((minY + maxY) / 2);
  const at = player.getLocation();
  const distance = Math.max(Math.abs(at.getX() - cx), Math.abs(at.getY() - cy));
  return { ...spec.projectile, end: spec.projectile.base + distance };
}

function maxHit(fight, style) {
  const hits = fight.phosani ? Common.data.attacks.phosaniMaxHits : Common.data.attacks.maxHits;
  return hits[style];
}

/** One standard attack at `target`'s side of the arena. */
function attack(fight, target) {
  const boss = fight.boss;
  const players = fight.players();
  const { meleeChance } = Common.data.attacks;
  const chance = fight.phosani && fight.phase === fight.phaseCount ? meleeChance.phosaniLast : meleeChance.normal;
  const style = inMeleeReach(boss, target, target.getLocation()) && Math.random() < chance
    ? "melee"
    : Math.random() < 0.5 ? "magic" : "ranged";
  const spec = Common.data.attacks[style];
  boss.performAnimation(Common.animation(spec.anim));
  for (const player of players) Common.sounds(player, spec.sounds);
  breakProtection(fight, players, style);
  if (style === "melee") {
    fight.at(spec.hitTicks, () => {
      if (fight.stopped || !boss.isRegistered()) return;
      for (const player of fight.players()) {
        if (!inMeleeReach(boss, target, player.getLocation())) continue;
        Common.strike(boss, player, "melee", maxHit(fight, "melee"), 0, {
          accurate: true,
          prayed: (s, prayer) => prayerFactor(fight, player, s, prayer),
        });
        Common.sounds(player, [spec.hitSound]);
      }
    });
    return;
  }
  fight.at(spec.projectileTicks, () => {
    if (fight.stopped || !boss.isRegistered()) return;
    for (const player of fight.players()) {
      const shot = flight(boss, player, spec);
      Common.projectile(fight.dream.area, boss, player, shot);
      if (spec.impact) player.performGraphic(Common.graphic(spec.impact.id, { delay: shot.end, height: spec.impact.height }));
      Common.sounds(player, [[spec.impactSound ?? 223, shot.end]]);
      Common.strike(boss, player, style, maxHit(fight, style), spec.hitTicks - spec.projectileTicks, {
        prayed: (s, prayer) => prayerFactor(fight, player, s, prayer),
      });
    }
  });
}

module.exports = { attack, underOrBeside, bodyBounds, inMeleeReach, prayerFactor };
