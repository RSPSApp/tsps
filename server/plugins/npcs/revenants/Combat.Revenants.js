/**
 * How a revenant fights (https://oldschool.runescape.wiki/w/Revenants/Strategies, OSRS captures):
 *
 * - Next to its target it uses melee, or Magic if the player prays Protect from Melee; further
 *   away, Magic, or Ranged if the player prays Protect from Magic.
 * - Magic (projectile 1415) also hits up to nine other players on the target's tile, and can
 *   freeze (Near-Reality's 1 in 9 for 7 ticks, unverified); Ranged is projectile 206.
 * - Below half health, when its heal is ready, it heals 20 instead of attacking (graphic 1221),
 *   then not again for 15 ticks, 8-25 times per spawn (Mod Ash).
 * - A charged bracelet of ethereum takes 75% off each attack for a charge, and revenants don't
 *   start fights with its wearer (tolerance); they still fight back.
 */
const { REVENANT_IDS, STYLE_ANIMATIONS, ATTACK_SOUNDS, MAGIC, RANGED, HEAL } = require("./Data.Revenants");
const Bracelet = require("./Bracelet.Revenants");

const ATTACK_DISTANCE = 8;
const FREEZE_IMMUNE_ATTRIBUTE = "revenants:freeze-immune-until";

/** Per-spawn heal state: heals left (8-25) and the cycle the next one is ready. Cleared on death. */
const healState = new WeakMap();

function resetHeals(npc) {
  healState.delete(npc);
}

/** Melee next to the target unless it is protected (then Magic); Magic further away unless protected (then Ranged). */
function chooseStyle(adjacent, protects) {
  if (adjacent) return protects.melee ? "magic" : "melee";
  return protects.magic ? "ranged" : "magic";
}

/** Below half health, with heals left and the cooldown over: heal (spending one, starting the cooldown). */
function takeHeal(state, hitpoints, maxHitpoints, cycle) {
  if (hitpoints * 2 >= maxHitpoints || state.left <= 0 || cycle < state.readyAt) return false;
  state.left--;
  state.readyAt = cycle + HEAL.cooldownTicks;
  return true;
}

function createRevenantCombat(core) {
  const { Animation, CombatFactory, CombatMethod, CombatType, Graphic, PendingHit, PrayerHandler, Projectile, Sound, Sounds } = core;

  function heals(npc) {
    let state = healState.get(npc);
    if (!state) {
      state = { left: HEAL.minHeals + Math.floor(Math.random() * (HEAL.maxHeals - HEAL.minHeals + 1)), readyAt: 0 };
      healState.set(npc, state);
    }
    return state;
  }

  function tryHeal(npc) {
    if (!takeHeal(heals(npc), npc.getHitpoints(), npc.getMaxHitpoints(), core.World.getProcessCycle())) return false;
    npc.heal(HEAL.amount);
    npc.performGraphic(new Graphic(HEAL.graphic));
    npc.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
    Sounds.sendSound(npc, new Sound(HEAL.sound, 1, 0, 0));
    return true;
  }

  const prays = (target, prayer) => target.isPlayer() && PrayerHandler.isActivated(target, prayer);

  const STYLES = { melee: CombatType.MELEE, magic: CombatType.MAGIC, ranged: CombatType.RANGED };

  function styleAgainst(npc, target) {
    return STYLES[chooseStyle(npc.calculateDistance(target) <= 1, {
      melee: prays(target, PrayerHandler.PROTECT_FROM_MELEE),
      magic: prays(target, PrayerHandler.PROTECT_FROM_MAGIC),
    })];
  }

  function animationFor(npc, style) {
    const own = STYLE_ANIMATIONS[npc.getId()];
    const id = style === CombatType.MAGIC ? own?.magic : style === CombatType.RANGED ? own?.ranged : null;
    return new Animation(id ?? npc.getDefinition().getAttackAnim());
  }

  function freeze(target) {
    if (!target.isPlayer() || Math.floor(Math.random() * MAGIC.freezeChance) !== 0) return false;
    const player = target.getAsPlayer();
    if (Date.now() < Number(player.getAttribute(FREEZE_IMMUNE_ATTRIBUTE) ?? 0)) return false;
    player.setAttribute(FREEZE_IMMUNE_ATTRIBUTE, Date.now() + MAGIC.freezeImmunityMs);
    CombatFactory.freeze(player, MAGIC.freezeTicks * 0.6);
    return true;
  }

  class RevenantCombat extends CombatMethod {
    constructor() {
      super();
      this.style = CombatType.MAGIC;
      this.healing = false;
    }

    type() {
      return this.style;
    }

    attackDistance() {
      return ATTACK_DISTANCE;
    }

    /** Tolerant to a charged bracelet: never starts the fight, but fights back. */
    canAttack(npc, target) {
      if (!target.isPlayer() || !Bracelet.wearsCharged(target.getAsPlayer())) return true;
      return npc.getCombat().getAttacker() === target || target.getCombat().getTarget() === npc;
    }

    start(npc, target) {
      this.healing = tryHeal(npc);
      if (this.healing) return;
      this.style = styleAgainst(npc, target);
      npc.performAnimation(animationFor(npc, this.style));
      const attackSound = ATTACK_SOUNDS[npc.getId()];
      if (attackSound) Sounds.sendSound(npc, new Sound(attackSound, 1, 0, 0));
      if (this.style === CombatType.MAGIC) {
        Sounds.sendSound(npc, new Sound(MAGIC.castSound, 1, 0, 0));
        Projectile.createProjectile(npc, target, MAGIC.projectile, MAGIC.delay,
          Projectile.arrivalCycles(npc, target, MAGIC.delay - 5), MAGIC.startHeight, MAGIC.endHeight).sendProjectile();
      } else if (this.style === CombatType.RANGED) {
        Projectile.createProjectile(npc, target, RANGED.projectile, RANGED.delay,
          Projectile.arrivalCycles(npc, target, RANGED.delay + 7), RANGED.startHeight, RANGED.endHeight)
          .withProgress(RANGED.progress).sendProjectile();
      }
    }

    hits(npc, target) {
      if (this.healing) return [];
      if (this.style === CombatType.MELEE) return [this.hit(npc, target, 0)];
      const distance = npc.calculateDistance(target);
      const delay = this.style === CombatType.MAGIC
        ? 1 + Math.floor((1 + distance) / 3)
        : 1 + Math.floor((3 + distance) / 6);
      if (this.style === CombatType.RANGED) return [this.hit(npc, target, delay)];
      const victims = [target, ...othersOnTile(target)];
      return victims.map((victim) => this.magicHit(npc, victim, delay));
    }

    hit(npc, target, delay) {
      const pending = new PendingHit(npc, target, this, delay);
      if (target.isPlayer()) {
        pending.setTotalDamage(Bracelet.reduceRevenantDamage(target.getAsPlayer(), pending.getTotalDamage()));
      }
      return pending;
    }

    magicHit(npc, target, delay) {
      const pending = this.hit(npc, target, delay);
      const frozen = pending.isAccurate() && freeze(target);
      const graphic = !pending.isAccurate() ? MAGIC.splash : frozen ? MAGIC.freezeGraphic : MAGIC.impact;
      // Ice Barrage's impact sits on the ground. Graphic(id, delay, 0) would read the 0 as
      // Priority.LOW and the delay as a height, so the ground-level form takes two arguments.
      target.performGraphic(frozen
        ? new Graphic(graphic, MAGIC.graphicDelay)
        : new Graphic(graphic, MAGIC.graphicDelay, MAGIC.graphicHeight));
      const sound = pending.isAccurate() ? MAGIC.impactSound : MAGIC.splashSound;
      if (target.isPlayer()) target.getAsPlayer().getPacketSender().sendSound(sound, 1, MAGIC.graphicDelay);
      return pending;
    }
  }

  function othersOnTile(target) {
    if (!target.isPlayer()) return [];
    const at = target.getLocation();
    return [...core.World.getPlayers()].filter((p) => p && p !== target && p.getLocation().equals(at)).slice(0, MAGIC.extraTargets);
  }

  return RevenantCombat;
}

module.exports = function attachCombat(api) {
  api.registerNpcCombatMethodProvider(REVENANT_IDS, createRevenantCombat(api.core), { singleton: false });
};

Object.assign(module.exports, { createRevenantCombat, resetHeals, chooseStyle, takeHeal });
