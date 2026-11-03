let core;

const DESCENT_OF_DRAGONS = { multiplier: 1.5, minimum: 8, cap: 48 };
const DESCENT_OF_DARKNESS = { multiplier: 1.3, minimum: 5, cap: Infinity };
const HIT_COUNT = 2;
const DRAIN = 55;
const SPECIAL_ID = "dark_bow";
const DRAGON_PROJECTILE = 1099;
const SHADOW_PROJECTILE = 1101;
const BROAD_SHADOW_PROJECTILE = 1102;
const DRAGON_IMPACT = 1100;
const SHADOW_IMPACT = 1103;
const GRAPHIC_HEIGHT = 96;

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
  const { Ammunition, Animation, CombatFactory, CombatPosition, CombatSpecial, Graphic, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds, WeaponProfiles } = core;
  const ANIMATION = new Animation(426);

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
      const player = character.getAsPlayer();
      CombatSpecial.drain(player, DRAIN);
      player.performAnimation(ANIMATION);
      const ammo = player.getCombat().getAmmunition();
      const launch = ammo.getDoubleStartGraphic();
      if (launch) player.performGraphicInSlot(1, new Graphic(launch.getId(), 0, GRAPHIC_HEIGHT));
      // Descent of Dragons / Descent of Darkness (rsprox 273: 3731 then 3733 for dragon arrows).
      Sounds.sendSound(character, Sound.DARK_BOW_DOUBLEFIRE);
      const dragon = isDragonArrow(player);
      Sounds.sendSound(character, dragon ? Sound.DARK_BOW_DRAGON_SPECIAL : Sound.DARK_BOW_SHADOW_SPECIAL);
      const projectileId = dragon ? DRAGON_PROJECTILE : ammo === Ammunition.BROAD_ARROW ? BROAD_SHADOW_PROJECTILE : SHADOW_PROJECTILE;
      const distance = CombatPosition.distance(character, target);
      // RSProx 273/2510: the visible arrow travels inside each special effect.
      const flights = [
        { end: 46 + (target.isNpc() ? 5 : 6) * distance, angle: 5 },
        { end: 55 + 10 * distance, angle: 25 },
      ];
      for (const { end, angle } of flights) {
        for (const id of [projectileId, ammo.getProjectileId()]) {
          Projectile.createProjectile(player, target, id, 41, end, 40, 36)
            .withAngle(angle).withProgress(11).sendProjectile();
        }
      }
      target.performGraphic(new Graphic(dragon ? DRAGON_IMPACT : SHADOW_IMPACT, flights[1].end, GRAPHIC_HEIGHT));
      CombatFactory.decrementAmmo(player, target.getLocation(), HIT_COUNT);
    }

    attackSpeed(character) {
      return super.attackSpeed(character) + 1;
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
