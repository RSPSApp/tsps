"use strict";

/**
 * Cave horrors (docs/slayer.md, "Cave horrors"): magical melee, and a scream.
 *
 * - Unless a witchwood icon is worn, every attack is the scream: it always hits for a tenth of the
 *   player's base Hitpoints level (rounded down), whatever their armour, and only Protect from
 *   Melee stops it. The horror plays its howl, the player the steam-head animation, on the tick
 *   the hit lands, every 4 ticks.
 * - With the icon the horror picks between a kick (4 ticks) and the scream (5 ticks) at random,
 *   and the scream rolls as a regular attack.
 * - A regular attack is magical melee: it rolls accuracy against the player's Magic defence and
 *   is blocked by Protect from Melee (Wiki: Magical melee).
 */
const HOWL_ANIMATION = 4237;
const SCREAM_PLAYER_ANIMATION = 2835;
/** The sound that goes with the howl (recordings 4053 and 4066: on every howl tick, not on a kick). */
const SCREAM_SOUND = 497;
const SCREAM_DAMAGE_DIVISOR = 10;
const ICON_ATTACK_SPEED = { kick: 4, scream: 5 };
const UNPROTECTED_ATTACK_SPEED = 4;
const SCREAM_CHANCE_WITH_ICON = 0.5;
const WITCHWOOD_ICON = "Witchwood icon";

let core = null;
/** NPC -> whether its next attack is the scream, decided when its attack speed is asked for (icon only). */
const upcoming = new WeakMap();

function init(api) {
  core = api.core;
}

function wearsIcon(player) {
  const amulet = player?.getEquipment?.()?.get?.(core.Equipment.AMULET_SLOT);
  return amulet != null && amulet.getId() > 0 && core.ItemDefinition.forId(amulet.getId())?.getName?.() === WITCHWOOD_ICON;
}

function isPlayer(target) {
  return target?.isPlayer?.() === true;
}

/** The scream's damage: a tenth of the base Hitpoints level, rounded down. */
function screamDamage(player) {
  return Math.floor(player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS) / SCREAM_DAMAGE_DIVISOR);
}

function createMethod() {
  const { MeleeCombatMethod, CombatType, PendingHit, Animation, Sounds, Sound } = core;
  return class CaveHorrorCombatMethod extends MeleeCombatMethod {
    constructor() {
      super();
      this.scream = false;
      this.guaranteed = false;
    }

    /** Which attack comes next: without the icon always the scream, with it a coin toss. */
    nextIsScream(npc, target) {
      if (!isPlayer(target)) return false;
      if (!wearsIcon(target)) return true;
      if (!upcoming.has(npc)) upcoming.set(npc, Math.random() < SCREAM_CHANCE_WITH_ICON);
      return upcoming.get(npc);
    }

    attackSpeed(npc) {
      const target = npc.getCombat?.()?.getTarget?.();
      if (!isPlayer(target) || !wearsIcon(target)) return UNPROTECTED_ATTACK_SPEED;
      return this.nextIsScream(npc, target) ? ICON_ATTACK_SPEED.scream : ICON_ATTACK_SPEED.kick;
    }

    /** A regular attack rolls against Magic defence; the protection prayer stays Protect from Melee. */
    accuracyDefenceType() {
      return CombatType.MAGIC;
    }

    start(npc, target) {
      this.scream = this.nextIsScream(npc, target);
      this.guaranteed = this.scream && !wearsIcon(target);
      upcoming.delete(npc);
      if (!this.scream) {
        super.start(npc, target);
        return;
      }
      npc.performAnimation(new Animation(HOWL_ANIMATION));
      Sounds.sendSound(target, new Sound(SCREAM_SOUND, 1, 0, 0));
      target.performAnimation(new Animation(SCREAM_PLAYER_ANIMATION));
    }

    hits(npc, target) {
      if (!this.guaranteed) return [new PendingHit(npc, target, this)];
      return [new PendingHit(npc, target, this, { damage: screamDamage(target.getAsPlayer()), rollAccuracy: false })];
    }
  };
}

function attach(api) {
  const { NpcIdentifiers } = api.core;
  const ids = [
    NpcIdentifiers.CAVE_HORROR,
    NpcIdentifiers.CAVE_HORROR_2,
    NpcIdentifiers.CAVE_HORROR_3,
    NpcIdentifiers.CAVE_HORROR_4,
    NpcIdentifiers.CAVE_HORROR_5,
  ];
  api.registerNpcCombatMethodProvider(ids, createMethod(), { singleton: false });
}

module.exports = { init, attach, screamDamage, wearsIcon };
