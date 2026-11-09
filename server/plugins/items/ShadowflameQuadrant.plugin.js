/**
 * The Shadowflame quadrant (Wiki: Shadowflame quadrant; Leagues VI: Demonic Pacts). Its other
 * passives live in the shared systems: the four elemental runes in ElementalStaves.plugin.js, the
 * autocast spellbooks in Autocasting.
 *
 * - Second hit: a standard-spellbook elemental spell (Strike to Surge) fires a second spell
 *   dealing 40% of the first one's damage. Live (Leagues VI, rsprox_transcripts/237/01161.txt
 *   ticks 15139-15154): the cast sends the spell's projectile twice on the same tick, the second
 *   landing 30 client cycles (a tick) later, and its hitsplat is floor(40%) of the first's a tick
 *   after it (3 -> 1, 12 -> 4, 27 -> 10, 32 -> 12). The cast sound and the impact area sound come
 *   twice too, and the one impact graphic is at the second projectile's end. A cast whose first hit splashed showed no
 *   second hitsplat, so the second spell lands only behind a hit; it rolls no accuracy or damage
 *   of its own (40% of what the first one dealt as it landed) and pays no XP. As a landed spell of
 *   its element it still counts for the Demonic Pacts that act on one (our reading).
 * - Elemental weakness: against an NPC with a weakness the spell counts as that element, for
 *   damage and accuracy, without changing the cast spell (`elemental-spells:weakness`); the NPC
 *   has one weakness, so it is its strongest. Demonic Pacts that check the weakness see it too.
 * - Melee: a melee range of 8 tiles, but no melee: its wielder on a melee style walks into reach,
 *   faces the target and never swings (live, 237/01161.txt tick 15130, 7 tiles from the boss).
 */
const ElementalSpells = require("../combat/elementalspells/Common.ElementalSpells");

const SECOND_HIT_PERCENT = 40;
/** A tick in client cycles: how much later the second projectile lands. */
const SECOND_PROJECTILE_DELAY_CYCLES = 30;
const SECOND_HIT_DELAY_TICKS = 1;
const MELEE_REACH = 8;

let core;
/** The second hits this plugin queued, so they never fire another. */
const secondHits = new WeakSet();
/** Casts' hits whose second spell is in flight. */
const launched = new WeakSet();

function wieldsQuadrant(mobile) {
  if (!mobile?.isPlayer?.()) return false;
  const weapon = mobile.getAsPlayer().getEquipment().get(core.Equipment.WEAPON_SLOT);
  return weapon?.getId?.() === core.ItemIdentifiers.SHADOWFLAME_QUADRANT;
}

/** A standard-spellbook elemental spell (Wind/Water/Earth/Fire Strike to Surge). */
function isStandardElemental(spell) {
  return ElementalSpells.metadata(spell) != null && spell.getSpellbook?.() === core.MagicSpellbook.NORMAL;
}

/** The spell is treated as the element the target is weakest to. */
function countAsWeakness(request) {
  if (!request.weakness || !request.element || !isStandardElemental(request.spell)) return;
  if (!wieldsQuadrant(request.attacker)) return;
  request.weakness.type = request.element;
}

/** The cast's hit on its target is queued: the second spell's projectile flies with it. */
function launchSecondSpell({ player, target, hit }) {
  if (secondHits.has(hit) || hit.getCombatType?.() !== core.CombatType.MAGIC || !hit.getHandleAfterHitEffects()) return;
  const spell = hit.getSpell();
  if (!isStandardElemental(spell) || !wieldsQuadrant(player)) return;
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

function registerMeleeReach(api) {
  core = api.core;
  api.registerWeaponProfile({
    itemIds: [core.ItemIdentifiers.SHADOWFLAME_QUADRANT], attackDistance: MELEE_REACH, meleeAllowed: false,
  });
}

module.exports = {
  name: "ShadowflameQuadrant",
  description: "The Shadowflame quadrant's second elemental spell, its spells counting as the target's weakness, and its 8-tile reach without melee.",
  members: true,
  register(api) {
    registerMeleeReach(api);
    api.onPlayerDealtDamage(launchSecondSpell);
    api.onCombatHitResolved(landSecondSpell);
    api.onCustomEvent("elemental-spells:weakness", countAsWeakness);
  },
};
