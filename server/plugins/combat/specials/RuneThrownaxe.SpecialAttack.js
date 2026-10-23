/**
 * Rune thrownaxe - Chainhit (Wiki: Rune thrownaxe). 10% energy per hit. In multicombat the axe
 * hits up to five opponents within three tiles of the first target, never back to it;
 * an accuracy roll follows each hit and a miss ends the chain. Its max hit ignores offensive
 * prayers and gear: floor(0.5 + (visible Ranged + 10) * (axe Ranged strength + 64) / 640).
 * It swings one tick slower than the axe's normal attack.
 */
// RSProx 1851/1856/1863: durations use the gap between occupied tiles, not SW corners.
function footprintDistance(from, to) {
  const a = from.getLocation(), b = to.getLocation();
  const aSize = from.isNpc?.() ? from.getSize?.() ?? 1 : 1;
  const bSize = to.isNpc?.() ? to.getSize?.() ?? 1 : 1;
  return Math.max(0, b.getX() - a.getX() - aSize + 1, a.getX() - b.getX() - bSize + 1,
    b.getY() - a.getY() - aSize + 1, a.getY() - b.getY() - bSize + 1);
}

function primaryProjectileEnd(from, to) {
  return 41 + Math.max(10, 5 * (footprintDistance(from, to) + 1));
}

function bounceCycles(from, to) {
  return 10 + 3 * footprintDistance(from, to);
}

function buildRuneThrownaxeSpecialAttack(api) {
  const { Animation, CombatFactory, CombatSpecial, Equipment, Graphic, ItemIdentifiers, Misc, PendingHit, Projectile, RangedCombatMethod, Skill, Sound, Sounds, WeaponProfiles } = api.core;
  const BonusManager = api.core.BonusManager;

  const DRAIN = 10;
  const MAX_TARGETS = 5;
  const BOUNCE_RADIUS = 3;
  const SPECIAL_ANIMATION = new Animation(1068);
  const LAUNCH_HEIGHT = 96;
  const SPECIAL_VFX = new Graphic(257, 0, LAUNCH_HEIGHT);
  const PROJECTILE_ID = 258;
  const CHAINHIT_SOUND = new Sound(2528, 1, 0, 0);
  const RANGED_STRENGTH_BONUS = 10 + BonusManager.RANGED_STRENGTH;
  const STANCE_BONUS = 10;
  const CLIENT_CYCLES_PER_TICK = 30;
  const PROJECTILE_DELAY = 41;
  const BOUNCE_START_HEIGHT = 40;
  const BOUNCE_END_HEIGHT = 36;

  function chainhitMaxHit(player) {
    const axe = player.getEquipment().get(Equipment.WEAPON_SLOT);
    const strength = Number(axe?.getDefinition?.()?.getBonuses?.()?.[RANGED_STRENGTH_BONUS] ?? 0);
    const ranged = player.getSkillManager().getCurrentLevel(Skill.RANGED);
    return Math.floor(0.5 + ((ranged + STANCE_BONUS) * (strength + 64)) / 640);
  }

  function nearbyMobiles(player) {
    return [...player.getLocalNpcs().values(), ...player.getLocalPlayers().values()];
  }

  /** Wiki / Mod Ash: random unused targets, without tactical routing. */
  function nextTarget(player, primary, struck) {
    const candidates = nearbyMobiles(player).filter((candidate) =>
      !struck.has(candidate) && CombatFactory.canAttackSecondaryTarget(player, primary, candidate, BOUNCE_RADIUS));
    return Misc.randomElement(candidates) ?? null;
  }

  class RuneThrownaxeCombatMethod extends RangedCombatMethod {
    attackSpeed(character) {
      return super.attackSpeed(character) + 1;
    }

    start(character, target) {
      CombatSpecial.drain(character, DRAIN);
      const end = primaryProjectileEnd(character, target);
      Projectile.createProjectile(character, target, PROJECTILE_ID, PROJECTILE_DELAY, end, BOUNCE_START_HEIGHT, BOUNCE_END_HEIGHT)
        .withAngle(0).withProgress(11).sendProjectile();
      Sounds.sendSound(character, CHAINHIT_SOUND);
      const player = character.getAsPlayer();
      const distance = character.getLocation().getDistance(target.getLocation());
      const delay = WeaponProfiles.hitDelays(player, distance)[0] + (target.isNpc() ? 1 : 0);
      CombatFactory.decrementAmmo(player, target.getLocation(), 1, delay);
      character.performAnimation(SPECIAL_ANIMATION);
      character.performGraphic(SPECIAL_VFX);
    }

    hits(character, target) {
      const hits = super.hits(character, target);
      const player = character.getAsPlayer();
      const maxHit = chainhitMaxHit(player);
      const first = hits[0];
      CombatFactory.applyStyleDamage(first, maxHit);
      if (!CombatFactory.multiCombatBetween(player, target)) {
        return hits;
      }
      const struck = new Set([target]);
      let origin = target;
      let previous = first;
      let elapsedCycles = primaryProjectileEnd(player, target);
      for (let bounce = 1; bounce < MAX_TARGETS && previous.isAccurate() && player.getSpecialPercentage() >= DRAIN; bounce++) {
        const next = nextTarget(player, target, struck);
        if (!next) {
          break;
        }
        CombatSpecial.drain(player, DRAIN);
        const flight = bounceCycles(origin, next);
        const start = elapsedCycles;
        elapsedCycles += flight;
        Projectile.createProjectile(origin, next, PROJECTILE_ID, start, elapsedCycles, BOUNCE_START_HEIGHT, BOUNCE_END_HEIGHT)
          .withAngle(0).withProgress(11).sendProjectile();
        Sounds.sendSound(player, CHAINHIT_SOUND);
        previous = new PendingHit(player, next, this, Math.ceil(elapsedCycles / CLIENT_CYCLES_PER_TICK));
        CombatFactory.applyStyleDamage(previous, maxHit);
        hits.push(previous);
        struck.add(next);
        origin = next;
      }
      return hits;
    }

  }

  return {
    id: "rune_thrownaxe",
    itemIds: [ItemIdentifiers.RUNE_THROWNAXE, ItemIdentifiers.RUNE_THROWNAXE_2],
    drainAmount: DRAIN,
    strengthMultiplier: 1,
    accuracyMultiplier: 1,
    traits: { hitCount: 1 },
    combatMethod: new RuneThrownaxeCombatMethod(),
  };
}

module.exports = function registerRuneThrownaxeSpecialAttack(api) {
  api.registerCombatSpecial(buildRuneThrownaxeSpecialAttack(api));
};

module.exports._test = { footprintDistance, primaryProjectileEnd, bounceCycles };
