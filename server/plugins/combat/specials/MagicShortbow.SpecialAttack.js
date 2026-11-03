let core;

const ACCURACY_MULTIPLIER = 10 / 7;
const RANGED_STRENGTH_BONUS_INDEX = 11;
const IMBUED_DRAIN = 50;
const DRAIN = 55;
const SPECIAL_ID = "magic_shortbow";
// RSProx 412/4008: Snapshot's arrows leave a tick apart and land 20 cycles apart.
const PROJECTILES = [
  { delay: 20, lengthAdjustment: 10, stepMultiplier: 3 },
  { delay: 50, lengthAdjustment: 0, stepMultiplier: 3 },
];

function snapshotMaxHit(player) {
  const { Equipment, Skill } = core;
  const level = player.getSkillManager().getCurrentLevel(Skill.RANGED);
  const ammo = player.getEquipment().get(Equipment.AMMUNITION_SLOT);
  const strength = ammo?.getDefinition?.()?.getBonuses?.()?.[RANGED_STRENGTH_BONUS_INDEX] ?? 0;
  return Math.max(0, Math.floor(0.5 + ((level + 10) * (strength + 64)) / 640));
}

function rollSnapshot({ attacker, target, damage, accurate }) {
  const { CombatFactory, CombatType } = core;
  if (!accurate || !attacker.isPlayer() || !attacker.isSpecialActivated() || attacker.getCombatSpecial()?.getId() !== SPECIAL_ID) {
    return;
  }
  const bounds = { minimumMultiplier: 0, maximumMultiplier: 0, minimumBonus: 0, maximumBonus: snapshotMaxHit(attacker) };
  damage.setDamage(CombatFactory.getHitDamage(attacker, target, CombatType.RANGED, false, bounds).getDamage());
}

function buildMagicShortbowSpecialAttack(core) {
  const { Animation, CombatFactory, CombatPosition, CombatSpecial, Equipment, Graphic, ItemIdentifiers, PendingHit, Projectile, RangedCombatMethod, RangedWeapon, Sound, Sounds } = core;
  const ANIMATION = new Animation(1074);
  const GRAPHIC = new Graphic(256, 30, 92);

  class MagicShortbowCombatMethod extends RangedCombatMethod {
    hits(character, target) {
      const distance = CombatPosition.distance(character, target);
      return PROJECTILES.map((shot) => {
        const end = RangedCombatMethod.projectileEnd(shot, distance);
        // The core adds a processing tick for NPC targets.
        const delay = Math.ceil(end / 30) - (target.isNpc() ? 1 : 0);
        return new PendingHit(character, target, this, { delay, hitAmount: 1 });
      });
    }

    canAttack(character, target) {
      const player = character.getAsPlayer();
      if (player.getCombat().getRangedWeapon() != RangedWeapon.MAGIC_SHORTBOW) {
        return false;
      }
      if (!CombatFactory.checkAmmo(player, 2)) {
        return false;
      }
      return true;
    }

    start(character, target) {
      const player = character.getAsPlayer();
      CombatSpecial.drain(player, player.getCombatSpecial().getDrainAmountForWeaponId(player.getEquipment().get(Equipment.WEAPON_SLOT).getId()));
      player.performAnimation(ANIMATION);
      player.performGraphicInSlot(1, GRAPHIC);
      Sounds.sendSound(player, Sound.MAGIC_SHORTBOW_SPECIAL);
      const distance = CombatPosition.distance(character, target);
      for (const shot of PROJECTILES) {
        const end = RangedCombatMethod.projectileEnd(shot, distance);
        Projectile.createProjectile(player, target, 249, shot.delay, end, 40.75, 36.5)
          .withAngle(15).withProgress(11).sendProjectile();
      }
      CombatFactory.decrementAmmo(player, target.getLocation(), 2);
    }

    attackSpeed(character) {
      return super.attackSpeed(character) + 1;
    }
  }


  return {
    id: SPECIAL_ID,
    itemIds: [
      ItemIdentifiers.MAGIC_SHORTBOW,
      ItemIdentifiers.MAGIC_SHORTBOW_I_,
      ItemIdentifiers.MAGIC_SHORTBOW_3,
    ],
    drainAmount: DRAIN,
    drainAmountByItemId: { [ItemIdentifiers.MAGIC_SHORTBOW_I_]: IMBUED_DRAIN },
    strengthMultiplier: 1,
    accuracyMultiplier: ACCURACY_MULTIPLIER,
    traits: {
      hitCount: 1,
      accuracyMultiplier: ACCURACY_MULTIPLIER,
      damageMultiplier: 1,
    },
    combatMethod: new MagicShortbowCombatMethod(),
    metadata: { finisherDamageMultiplier: 2 },
  };
}

module.exports = function registerMagicShortbowSpecialAttack(api) {
  core = api.core;
  api.onCombatHitDamage(rollSnapshot);
  api.registerCombatSpecial(buildMagicShortbowSpecialAttack(core));
};
