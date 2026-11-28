/**
 * A Moon's standard attack (docs/moons-of-peril.md), once every 6 ticks while a glyph is up: the
 * combo animation, its sounds a tick before, then three typeless hits a tick apart for each
 * fighter, max 4, 8 and 20, rolled against slash defence with +100 accuracy; once one misses the
 * rest miss, and protection prayers do nothing (Wiki).
 * - Each accurate hit adds the Moon's curse stacks (2, 4, 10; capture) and the first sends its
 *   spam message ("The Blood Moon pierces your defence and saps your vitality!").
 * - The Blood Moon heals 1x the first hit, 2x the second and 30-50 from the third (Wiki).
 * - Standing off the glyph while the hits land burns 1, doubling (Wiki: up to 16), and adds a
 *   stack. The doubling starts again with each attack (estimate: the Wiki doesn't say).
 * - On the attack's tick and each of the two after it, the Moon loses a hundredth of its health
 *   (at least 1) of its own, with no hitsplat (captured on all three Moons).
 */
const Common = require("./Common.MoonsOfPeril");
const Curses = require("./Curses.MoonsOfPeril");

const styleMethods = { method: null };

function meleeMethod() {
  if (styleMethods.method) return styleMethods.method;
  const { CombatMethod, CombatType } = Common.core;
  styleMethods.method = new (class extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    hits() {
      return [];
    }
  })();
  return styleMethods.method;
}

/** One rolled hit from the Moon on the player, landing now. Returns { damage, accurate }. */
function strike(npc, player, maxHit) {
  const { PendingHit, CombatFactory, World } = Common.core;
  const hit = new PendingHit(npc, player, meleeMethod(), { delay: 0, rollAccuracy: true });
  CombatFactory.applyStyleDamage(hit, maxHit, { bypassProtectionPrayer: true });
  const accurate = hit.isAccurate() && hit.getTotalDamage() > 0;
  player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
  return { damage: hit.getTotalDamage(), accurate };
}

/** A missed hit: the block hitsplat, nothing rolled. */
function miss(player) {
  const { HitDamage, HitMask } = Common.core;
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(0, HitMask.BLUE)]);
}

/** The attack's sounds, a tick before it (capture). */
function warn(fight) {
  if (!fight.killed) Common.sounds(fight.player, fight.arena.spec.attack.sounds);
}

/** The Moon attacks: its animation once, then each fighter's three hits. */
function attack(arena) {
  if (!arena.npc?.isRegistered?.()) return;
  Common.animate(arena.npc, arena.spec.attack.anim);
  const focus = arena.focus();
  for (const fight of arena.fights.values()) {
    if (fight.killed || fight.ended || !Common.alive(fight.player)) continue;
    Common.varbit(fight.player, "lastFocus", focus);
    series(fight, focus);
  }
}

function series(fight, focus) {
  const { maxHits } = Common.data.attack;
  const state = { landing: true, first: true };
  fight.offGlyphDamage = 0;
  chip(fight);
  maxHits.forEach((maxHit, index) => {
    // One chip for each hit, a tick before it lands (the first went with the attack itself).
    if (index > 0) Common.later(index, () => chip(fight));
    Common.later(index + 1, () => landHit(fight, focus, index, maxHit, state));
  });
}

/** The Moon's own loss of health, no hitsplat. */
function chip(fight) {
  if (fight.ended || fight.killed) return;
  fight.selfDamage(Math.max(1, Math.floor(fight.hp / Common.data.selfDamage.divisor)));
}

function landHit(fight, focus, index, maxHit, state) {
  const { player, arena } = fight;
  if (fight.ended || fight.killed || !Common.alive(player) || !arena.fights.has(player)) return;
  burnOffGlyph(fight, focus);
  if (!state.landing) {
    miss(player);
    return;
  }
  const { damage, accurate } = strike(arena.npc, player, maxHit);
  if (!accurate) {
    state.landing = false;
    return;
  }
  if (state.first) {
    state.first = false;
    player.getPacketSender().sendMessage(arena.spec.attack.message);
  }
  Curses.add(fight, Common.data.curses.stacks[index] ?? 0);
  if (fight.moon === "blood") bloodHeal(fight, index, damage);
}

/** The Blood Moon's thirst: 1x, 2x, then 30-50 (Wiki), each drawn from the player (capture). */
function bloodHeal(fight, index, damage) {
  const { heal } = fight.arena.spec;
  const amount = index === 2 ? Common.randomInt(heal.third[0], heal.third[1]) : damage * (index + 1);
  if (amount <= 0) return;
  Common.sound(fight.player, heal.sound);
  Common.projectile(fight.player, fight.player, fight.arena.npc, heal.projectile);
  if (index === 2) Common.projectile(fight.player, fight.player, fight.arena.npc, heal.thirdProjectile);
  fight.heal(amount);
}

/** Off the glyph while the hits land: 1, doubling to 16, and a curse stack (Wiki). */
function burnOffGlyph(fight, focus) {
  if (Common.onGlyph(fight.moon, focus, fight.player.getLocation())) {
    fight.offGlyphDamage = 0;
    return;
  }
  const { first, max } = Common.data.attack.offGlyph;
  fight.offGlyphDamage = fight.offGlyphDamage > 0 ? Math.min(max, fight.offGlyphDamage * 2) : first;
  const dealt = fight.hurt(fight.offGlyphDamage);
  Curses.add(fight, 1);
  if (fight.moon === "blood" && dealt > 0) fight.heal(dealt);
}

module.exports = { warn, attack, strike, miss };
