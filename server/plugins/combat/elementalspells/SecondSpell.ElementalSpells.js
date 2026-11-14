/**
 * A second elemental spell behind each standard-spellbook elemental cast (Strike to Surge), as the
 * Shadowflame quadrant and the Twinflame staff fire (Wiki: Multi-hit weapons). Live (Leagues VI,
 * rsprox_transcripts/237/01161.txt ticks 15139-15154, the quadrant): the cast sends the spell's
 * projectile twice on the same tick, the second landing 30 client cycles (a tick) later, and its
 * hitsplat is floor(40%) of the first's a tick after it (3 -> 1, 12 -> 4, 27 -> 10, 32 -> 12). The
 * cast sound and the impact area sound come twice too, and the one impact graphic is at the second
 * projectile's end. A cast whose first hit splashed showed no second hitsplat, so the second spell
 * lands only behind a hit; it rolls no accuracy or damage of its own (40% of what the first one
 * dealt as it landed), pays no XP and spends no runes or tome charges.
 *
 * `register(api, wields, fires)` hooks it up for the weapons `wields(player)` names, for the spells
 * `fires(spell)` allows (all of them by default; the Twinflame staff leaves out Strike and Surge).
 */
const ElementalSpells = require("./Common.ElementalSpells");

const SECOND_HIT_PERCENT = 40;
/** A tick in client cycles: how much later the second projectile lands. */
const SECOND_PROJECTILE_DELAY_CYCLES = 30;
const SECOND_HIT_DELAY_TICKS = 1;

let core;
/** The second hits queued here, so they never fire another. */
const secondHits = new WeakSet();
/** Casts' hits whose second spell is in flight. */
const launched = new WeakSet();
/** Each registration's { wields(player), fires(spell) }: a player wielding one fires the second spell for its spells. */
const wielders = [];

function firesSecondSpell(mobile, spell) {
  if (!mobile?.isPlayer?.()) return false;
  const player = mobile.getAsPlayer();
  return wielders.some(({ wields, fires }) => wields(player) && fires(spell));
}

/** A standard-spellbook elemental spell (Wind/Water/Earth/Fire Strike to Surge). */
function isStandardElemental(spell) {
  return ElementalSpells.metadata(spell) != null && spell.getSpellbook?.() === core.MagicSpellbook.NORMAL;
}

/** The cast's hit on its target is queued: the second spell's projectile flies with it. */
function launchSecondSpell({ player, target, hit }) {
  if (secondHits.has(hit) || hit.getCombatType?.() !== core.CombatType.MAGIC || !hit.getHandleAfterHitEffects()) return;
  const spell = hit.getSpell();
  if (!isStandardElemental(spell) || !firesSecondSpell(player, spell)) return;
  const projectile = spell.castProjectile(player, target)?.withEndDelay(SECOND_PROJECTILE_DELAY_CYCLES);
  if (projectile) {
    projectile.sendProjectile();
    sendSecondImpact(target, spell, hit.isAccurate(), projectile.getTiming().endCycleOffset);
  }
  core.Sounds.sendSound(player, core.MagicCombatMethod.castSoundFor(spell));
  launched.add(hit);
}

/**
 * The second spell's impact, queued at the cast for its projectile's end cycle as the first
 * spell's is (MagicCombatMethod.queueNpcProjectileGraphic): an area sound of its own, and the
 * impact graphic, which takes the place of the first one's (live: one fireblast_impact at the
 * second projectile's end, and sound_area 156 at both ends).
 */
function sendSecondImpact(target, spell, accurate, endCycle) {
  const { MagicCombatMethod, Sound, Sounds } = core;
  const sound = accurate ? MagicCombatMethod.impactSoundFor(spell) : Sound.SPELL_FAIL_SPLASH;
  const at = target.getLocation();
  if (sound && at) {
    Sounds.playAreaSound({
      soundId: sound.getId(), source: target, x: at.getX(), y: at.getY(), level: at.getZ(),
      loops: sound.getLoopType(), delay: endCycle + sound.getDelay(), radius: MagicCombatMethod.IMPACT_SOUND_RADIUS,
    });
  }
  const graphic = accurate ? spell.endGraphic() : MagicCombatMethod.SPLASH_GRAPHIC;
  if (graphic && typeof graphic.withDelay === "function") target.performGraphic(graphic.withDelay(endCycle + graphic.getDelay()));
}

/**
 * The cast's hit lands: the second spell's hitsplat follows a tick later with 40% of what it dealt
 * (a hit that splashed has none). The first hit's own tick already counts against an NPC
 * (CombatFactory.hitProcessingDelay), so the delay is the rest of that tick.
 */
function landSecondSpell({ attacker, target, hit }) {
  if (!launched.has(hit)) return;
  launched.delete(hit);
  // The first hit's damage is still queued on the target (HitQueue.pendingDamage) as it resolves.
  const remaining = target.getHitpoints() - target.getCombat().getHitQueue().getQueuedDamage();
  if (!hit.isAccurate() || remaining <= 0) return;
  // Fixed damage with no rolls of its own, and no XP: live pays a cast's XP for its first hit only
  // (237/01161.txt ticks 15139, 15144, 15149: 24x (base + 2 per first-hit damage) each).
  const second = new core.PendingHit(attacker, target, core.CombatFactory.MAGIC_COMBAT, {
    delay: Math.max(0, SECOND_HIT_DELAY_TICKS - core.CombatFactory.hitProcessingDelay(hit)),
    statusDamage: true,
    damage: Math.min(remaining, Math.floor((hit.getTotalDamage() * SECOND_HIT_PERCENT) / 100)),
    handleAfterHitEffects: false,
  }, undefined, hit.getSpellContext()).setSpell(hit.getSpell());
  secondHits.add(second);
  core.CombatFactory.addPendingHit(second);
}

function register(api, wields, fires = () => true) {
  core = api.core;
  if (wielders.length === 0) {
    api.onPlayerDealtDamage(launchSecondSpell);
    api.onCombatHitResolved(landSecondSpell);
  }
  wielders.push({ wields, fires });
}

module.exports = { register, isStandardElemental, _test: { launchSecondSpell, landSecondSpell, secondHits, launched } };
