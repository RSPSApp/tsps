"use strict";

// Wiki: 69 ranged, 21 magic, 25 melee claw, attack speed 3 from the definition.
const RANGED_MAX_HIT = 69;
const MAGIC_MAX_HIT = 21;
const MELEE_MAX_HIT = 25;
// "Both of these attacks hit all players in the room."
// ponytail: no room rectangle is modelled, radius is the room size.
const ROOM_RADIUS = 15;

// Cache: GODWARS_ARMADYL_AVATAR_WIND_ATTACK/CLAW_ATTACK, _WIND_/_MAGIC_ATTACK_SPOTANIM.
const WIND_ANIMATION = 6980;
const CLAW_ANIMATION = 6981;
const WIND_PROJECTILE = 1199;
const MAGIC_PROJECTILE = 1200;

module.exports = function registerKreeArra(api) {
  const {
    Animation,
    CombatFactory,
    CombatMethod,
    CombatType,
    Equipment,
    ItemDefinition,
    Misc,
    NpcIdentifiers,
    PendingHit,
    Projectile,
  } = api.core;

  const NPC_IDS = [
    NpcIdentifiers.KREEARRA,
    NpcIdentifiers.KREEARRA_2,
    NpcIdentifiers.WINGMAN_SKREE,
    NpcIdentifiers.FLOCKLEADER_GEERIN,
    NpcIdentifiers.FLIGHT_KILISA,
  ];
  const NPC_ID_SET = new Set(NPC_IDS);

  function isArmadylean(npc) {
    return NPC_ID_SET.has(npc?.getId?.()) || NPC_ID_SET.has(npc?.getRealId?.());
  }

  // Melee is only legal with a halberd or salamander, matched by the cache's
  // own item name so every variant is covered without an id list.
  function wieldsReachMelee(player) {
    const weaponId = player.getEquipment().get(Equipment.WEAPON_SLOT).getId();
    const name = ItemDefinition.forId(weaponId)?.getName?.()?.toLowerCase?.() ?? "";
    return name.includes("halberd") || name.includes("salamander");
  }

  function denyMelee(event) {
    if (event.allow !== null) {
      return;
    }
    const { attacker, target, method } = event;
    if (!attacker?.isPlayer?.() || !target?.isNpc?.() || !isArmadylean(target)) {
      return;
    }
    if (method?.type?.() !== CombatType.MELEE || wieldsReachMelee(attacker)) {
      return;
    }
    const name = target.getCurrentDefinition?.()?.getName?.() ?? "Kree'arra";
    attacker.sendMessage(`${name} is flying too high for you to reach with melee.`);
    event.allow = false;
  }

  class KreeArraCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.stance = CombatType.RANGED;
    }

    type() {
      return this.stance;
    }

    attackDistance() {
      return 8;
    }

    // Ranged magic: the magic attack rolls Magic accuracy against Ranged defence.
    accuracyDefenceType(type) {
      return this.stance === CombatType.MAGIC ? CombatType.RANGED : type;
    }

    start(character, target) {
      // 6/10 wind, 2/10 magic, 2/10 claw when the target is in reach.
      const roll = Misc.randomInclusive(0, 9);
      const inMeleeRange = character.calculateDistance(target) <= 1;
      if (roll < 6) {
        this.stance = CombatType.RANGED;
      } else if (roll < 8 || !inMeleeRange) {
        this.stance = CombatType.MAGIC;
      } else {
        this.stance = CombatType.MELEE;
      }
      if (this.stance === CombatType.MELEE) {
        character.performAnimation(new Animation(CLAW_ANIMATION));
        return;
      }
      character.performAnimation(new Animation(WIND_ANIMATION));
      Projectile.createProjectile(
        character,
        target,
        this.stance === CombatType.RANGED ? WIND_PROJECTILE : MAGIC_PROJECTILE,
        40,
        Projectile.arrivalCycles(character, target),
        43,
        31
      ).sendProjectile();
    }

    hits(character, target) {
      const maxHit =
        this.stance === CombatType.RANGED
          ? RANGED_MAX_HIT
          : this.stance === CombatType.MAGIC
            ? MAGIC_MAX_HIT
            : MELEE_MAX_HIT;
      const delay = this.stance === CombatType.MELEE ? 1 : Projectile.arrivalTicks(character, target);
      const hits = [new PendingHit(character, target, this, delay)];
      CombatFactory.applyStyleDamage(hits[0], maxHit);
      if (this.stance === CombatType.MELEE) {
        return hits;
      }
      for (const player of character.getAsNpc().getPlayersWithinDistance(ROOM_RADIUS)) {
        if (player === target || player.getHitpoints() <= 0) {
          continue;
        }
        const hit = new PendingHit(character, player, this, delay);
        CombatFactory.applyStyleDamage(hit, maxHit);
        hits.push(hit);
      }
      return hits;
    }
  }

  api.onCanAttack(denyMelee);
  api.registerNpcCombatMethodProvider(NPC_IDS, KreeArraCombatMethod, { singleton: false });
};
