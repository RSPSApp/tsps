let core;

const DESCENT_OF_DRAGONS = { multiplier: 1.5, minimum: 8, cap: 48 };
const DESCENT_OF_DARKNESS = { multiplier: 1.3, minimum: 5, cap: Infinity };
const HIT_COUNT = 2;
const DRAIN = 55;
const SPECIAL_ID = "dark_bow";

function isDragonArrow(player) {
  const { Ammunition } = core;
  return [Ammunition.DRAGON_ARROW, Ammunition.SEEKING_DRAGON_ARROW].includes(player.getCombat().getAmmunition());
}

function descentOf(player) {
  const { Equipment, ItemIdentifiers } = core;
  const descent = isDragonArrow(player) ? DESCENT_OF_DRAGONS : DESCENT_OF_DARKNESS;
  const bountyHunter = player.getEquipment().get(Equipment.WEAPON_SLOT).getId() === ItemIdentifiers.DARK_BOW_BH_;
  return { ...descent, minimum: descent.minimum + (bountyHunter ? 2 : 0), bountyHunter };
}

function rollDescent({ attacker, target, damage, accurate }) {
  const { CombatFactory, CombatType, DamageFormulas, PluginManager } = core;
  if (!attacker.isPlayer() || !attacker.isSpecialActivated() || attacker.getCombatSpecial()?.getId() !== SPECIAL_ID) {
    return;
  }
  const { multiplier, minimum, cap, bountyHunter } = descentOf(attacker);
  const boosted = Math.floor(PluginManager.modifyRangedMaxHit(attacker, target, DamageFormulas.sourceMaxHit(attacker, CombatType.RANGED)) * multiplier);
  const maximum = accurate ? Math.max(minimum, boosted) : minimum;
  const bounds = { minimumMultiplier: 0, maximumMultiplier: 0, minimumBonus: bountyHunter ? minimum : 0, maximumBonus: maximum };
  damage.setDamage(Math.max(minimum, Math.min(cap, CombatFactory.getHitDamage(attacker, target, CombatType.RANGED, false, bounds).getDamage())));
}

function buildDarkBowSpecialAttack(core) {
  const { Ammunition, Animation, CombatFactory, CombatSpecial, CombatType, DamageFormulas, Equipment, Graphic, GraphicHeight, ItemIdentifiers, PendingHit, PluginManager, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds, WeaponProfiles } = core;
  const ANIMATION = new Animation(426);
  const GRAPHIC = new Graphic(1100, GraphicHeight.HIGH);

  class DarkBowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const distance = character.getLocation().getDistance(target.getLocation());
      const delays = WeaponProfiles.hitDelays(character.getAsPlayer(), distance);
      return delays.map((delay) => new PendingHit(character, target, this, { delay, hitAmount: 1 }));
    }

    canAttack(character, target) {
      let player = character.getAsPlayer();
      if (player.getCombat().getRangedWeapon() != RangedWeapon.DARK_BOW) {
        return false;
      }
      if (!CombatFactory.checkAmmo(player, HIT_COUNT)) {
        return false;
      }
      return true;
    }

    start(character, target) {
      let player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      Sounds.sendSound(character, Sound.SHOOT_BOW_QUIET);
      let projectileId = 1099;
      if (!isDragonArrow(player)) {
        projectileId = 1101;
      }
      Projectile.createProjectile(player, target, projectileId, 40, 70, 43, 31).sendProjectile();
      Projectile.createProjectile(character, target, projectileId, 33, 74, 48, 31).sendProjectile();
      CombatFactory.decrementAmmo(player, target.getLocation(), HIT_COUNT);
    }

    attackSpeed(character) {
      return super.attackSpeed(character) + 1;
    }

    handleAfterHitEffects(hit) {
      hit.getTarget().performGraphic(GRAPHIC);
    }
  }


  return {
    id: SPECIAL_ID,
    itemIds: [
      ItemIdentifiers.DARK_BOW,
      ItemIdentifiers.DARK_BOW_3,
      ItemIdentifiers.DARK_BOW_4,
      ItemIdentifiers.DARK_BOW_5,
      ItemIdentifiers.DARK_BOW_6,
      ItemIdentifiers.DARK_BOW_7,
      ItemIdentifiers.DARK_BOW_BH_,
      ItemIdentifiers.CORRUPTED_DARK_BOW,
      ItemIdentifiers.DARK_BOW_DEADMAN_,
    ],
    drainAmount: DRAIN,
    strengthMultiplier: DESCENT_OF_DARKNESS.multiplier,
    accuracyMultiplier: 1,
    traits: {
      hitCount: 1,
      accuracyMultiplier: 1,
      rollAttackType: "ranged",
      damageType: "ranged",
    },
    combatMethod: new DarkBowCombatMethod(),
    metadata: { finisherDamageMultiplier: 2 },
  };
}

module.exports = function registerDarkBowSpecialAttack(api) {
  core = api.core;
  api.onCombatHitDamage(rollDescent);
  api.registerCombatSpecial(buildDarkBowSpecialAttack(core));
};
