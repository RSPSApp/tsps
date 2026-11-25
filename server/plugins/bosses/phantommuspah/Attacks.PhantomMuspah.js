/**
 * The Phantom Muspah's attacks (docs/phantom-muspah.md), as captured:
 * - Ranged (ranged, shielded and post-shield forms): seq 9922, projectile 2329, the hit two ticks
 *   later. Magic, about one attack in five: seq 9918 and spot 2319, the projectile (2327) two ticks
 *   later, the hit four ticks after the attack; Protect from Magic blocks it, else it corrupts.
 *   Protection prayers are checked as the hit lands, so a late switch still blocks it (Wiki).
 * - Melee (melee form): seq 9920 and spot 2320, a stab a tick later. The longer it has stood still
 *   the harder it hits, through Protect from Melee too (Wiki; how much: estimate).
 * - Shielded: each attack drains its shield by 2 as it lands, and Soul Split heals it half of the
 *   damage (Wiki).
 */
const Common = require("./Common.PhantomMuspah");
const Hits = require("./Hits.PhantomMuspah");
const Corruption = require("./Corruption.PhantomMuspah");
const Shield = require("./Shield.PhantomMuspah");

/** Whether the Muspah can hit the player from where it stands with `style`. */
function inReach(fight, style) {
  const { muspah, player } = fight;
  const at = muspah.getLocation();
  const p = player.getLocation();
  if (p.getZ() !== at.getZ()) return false;
  const size = muspah.getSize();
  const dx = p.getX() < at.getX() ? at.getX() - p.getX() : Math.max(0, p.getX() - (at.getX() + size - 1));
  const dy = p.getY() < at.getY() ? at.getY() - p.getY() : Math.max(0, p.getY() - (at.getY() + size - 1));
  if (style === "melee") return dx + dy === 1;
  if (Math.max(dx, dy) === 0 || Math.max(dx, dy) > Common.data.boss.range) return false;
  const { RegionManager } = Common.core;
  return RegionManager.canProjectileAttackTarget(muspah, player);
}

/** The style this form attacks with now. */
function chooseStyle(fight) {
  if (fight.form === "melee") return "melee";
  return Math.random() < Common.data.magicChance ? "magic" : "ranged";
}

/** One attack, if the player is in reach. Returns whether it attacked. */
function attack(fight) {
  let style = chooseStyle(fight);
  // Out of a clear line for magic, the ranged attack is no different; wait for either.
  if (!inReach(fight, style)) return false;
  fight.muspah.setPositionToFace(fight.player.getLocation());
  if (style === "melee") melee(fight);
  else if (style === "magic") magic(fight);
  else ranged(fight);
  return true;
}

function ranged(fight) {
  const { muspah, player } = fight;
  const spec = Common.data.attacks.ranged;
  const max = Common.data.forms[fight.form].rangedMax;
  Common.animate(muspah, spec.anim);
  Common.sounds(player, spec.sounds);
  Hits.projectile(fight.session.area, muspah, player, spec.projectile);
  fight.at(spec.hitDelay, () => land(fight, "ranged", max, () => {
    player.performGraphic(Common.graphic(spec.impact.spot));
    Common.sound(player, spec.impact.sound[0]);
  }));
}

function magic(fight) {
  const { muspah, player } = fight;
  const spec = Common.data.attacks.magic;
  const max = Common.data.forms[fight.form].magicMax;
  Common.animate(muspah, spec.anim);
  muspah.performGraphic(Common.graphic(spec.spot));
  Common.sounds(player, spec.sounds);
  fight.at(spec.projectileTicks, () => {
    if (fight.stopped || !muspah.isRegistered()) return;
    Hits.projectile(fight.session.area, muspah, player, spec.projectile);
    Common.sound(player, spec.projectileSound);
  });
  fight.at(spec.hitDelay, () => {
    player.performGraphic(Common.graphic(spec.impact.spot, { height: spec.impact.height }));
    const blocked = Hits.protectedFrom(player, "magic");
    land(fight, "magic", max);
    if (!blocked && Common.alive(player)) Corruption.corrupt(player, Common.data.corruption.magicBase);
  });
}

function melee(fight) {
  const { muspah, player } = fight;
  const spec = Common.data.attacks.melee;
  const still = fight.stillTicks;
  const max = Common.data.forms.melee.meleeMax + Math.min(spec.stillMaxBonusCap, still * spec.stillMaxBonus);
  const throughPrayer = Math.min(spec.stillThroughPrayerCap, still * spec.stillThroughPrayer);
  Common.animate(muspah, spec.anim);
  muspah.performGraphic(Common.graphic(spec.spot));
  Common.sound(player, spec.sound);
  fight.at(spec.hitDelay, () => land(fight, "melee", max, null, throughPrayer));
}

/** The hit lands: rolled now, against the prayer the player has on now. */
function land(fight, style, max, onHit, throughPrayer = 0) {
  const { muspah, player } = fight;
  if (fight.stopped || !muspah.isRegistered() || !Common.alive(player)) return;
  const hit = Hits.strike(muspah, player, style, max, 0, { throughPrayer });
  const dealt = hit.getTotalDamage();
  if (dealt > 0) onHit?.();
  if (fight.form === "shielded") {
    Shield.soulSplit(fight, dealt);
    Shield.drain(fight, Common.data.shield.drainPerAttack);
  }
}

module.exports = { attack, inReach };
