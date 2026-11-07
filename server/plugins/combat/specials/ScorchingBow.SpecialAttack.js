// Scorching shackles (https://oldschool.runescape.wiki/w/Scorching_bow): 25% special energy; against a
// demon it binds the target for 20 ticks whether or not it is hit, deals 1 burn damage at once and
// 1 more every 4 ticks, 5 in all. Against anything else the special is refused, no energy is spent,
// and the swing is an ordinary shot. Live captures (rsprox recordings 572, 1756, 1762, 3315) show
// the special swing fires no arrow and deals no hit; the ordinary shot follows on the next attack.
module.exports = function registerScorchingBowSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Graphic, ItemIdentifiers, Misc, PendingHit, Projectile, RangedCombatMethod, Sound, Sounds } = api.core;

  const DRAIN = 25;
  const BIND_TICKS = 20;
  const BURN_DAMAGE = 4; // ticking burn damage; the fifth is dealt with the special
  const BURN_HITSPLAT = 74;
  const REFUSAL = "Scorching shackles won't work against a non-demon enemy.";
  const ANIMATION = new Animation(11133); // human_weapon_bow_scorched_01_spec
  const CASTER_GRAPHIC = new Graphic(2806); // vfx_human_scorching_bow_special_attack_01
  const PROJECTILE = 2807; // vfx_scorching_bow_projectile
  const PROJECTILE_DELAY = 46;
  const PROJECTILE_CYCLES_PER_TILE = 5;
  const PROJECTILE_START_HEIGHT = 40;
  const PROJECTILE_END_HEIGHT = 36;
  const PROJECTILE_ANGLE = 255;
  const PROJECTILE_PROGRESS = 80;
  const IMPACT_GRAPHIC = 2908; // vfx_scorching_bow_impact_01
  const SOUNDS = [[9327, 11], [9328, 46]];
  const END_SOUNDS = [9325, 9326];

  // Attackers whose special has just applied a burn, until its first damage is queued.
  const burned = new WeakSet();

  function isDemon(target) {
    return target?.isNpc?.() === true && target.getAsNpc().getCurrentDefinition().hasAttribute("demon");
  }

  class ScorchingBowCombatMethod extends RangedCombatMethod {
    start(character, target) {
      if (!isDemon(target)) {
        character.sendMessage(REFUSAL);
        super.start(character, target);
        return;
      }
      CombatSpecial.drain(character, DRAIN);
      character.performAnimation(ANIMATION);
      character.performGraphic(CASTER_GRAPHIC);

      const end = Projectile.arrivalCycles(character, target, PROJECTILE_DELAY, PROJECTILE_CYCLES_PER_TILE);
      Projectile.createProjectile(character, target, PROJECTILE, PROJECTILE_DELAY, end, PROJECTILE_START_HEIGHT, PROJECTILE_END_HEIGHT)
        .withAngle(PROJECTILE_ANGLE).withProgress(PROJECTILE_PROGRESS).sendProjectile();
      target.performGraphic(new Graphic(IMPACT_GRAPHIC, end));
      Sounds.sendSound(character, Sound.SHOOT_ARROW);
      for (const [id, delay] of SOUNDS) Sounds.sendSound(character, new Sound(id, 1, delay, 0));
      for (const id of END_SOUNDS) Sounds.sendSound(character, new Sound(id, 1, end, 0));

      // The bind and the burn apply on a miss too: there is no roll.
      CombatFactory.freeze(target, Misc.getSeconds(BIND_TICKS), undefined, character);
      const burn = { attacker: character, target, damage: BURN_DAMAGE, severity: "normal", applied: false };
      api.emitCustomEvent("combat:burn", burn);
      if (burn.applied) burned.add(character);
    }

    hits(character, target) {
      if (!isDemon(target)) return super.hits(character, target);
      // The first of the five burn damage lands with the special, when the burn took hold (a target
      // immune to burns takes none); the burn adds the rest.
      if (!burned.delete(character)) return [];
      const burn = new PendingHit(character, target, this, {
        damage: 1, delay: 1, rollAccuracy: false, experience: false, statusDamage: true, handleAfterHitEffects: false,
      });
      for (const damage of burn.getHits()) damage.setSplatTypes(BURN_HITSPLAT, BURN_HITSPLAT);
      return [burn];
    }
  }

  api.registerCombatSpecial({
    id: "scorching_bow",
    itemIds: [ItemIdentifiers.SCORCHING_BOW],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1 },
    combatMethod: new ScorchingBowCombatMethod(),
  });
};
