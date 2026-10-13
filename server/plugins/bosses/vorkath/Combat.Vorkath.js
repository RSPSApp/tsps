/**
 * Vorkath's combat method: standards, dragonfire pipeline, fireball and special rotation.
 *
 * Shape follows the Deranged/Elvarg methods: start() chooses and performs (animations and
 * projectiles only), hits() builds the PendingHits, and handleAfterHitEffects() lands the
 * impact graphics, messages and breath side-effects exactly when the hit does. Counters and
 * phases live on NPC attributes (the method is rebuilt every attack); the ticking special
 * tasks live in Specials.Vorkath.js. Damage rules (immunity, halving, Crumble Undead,
 * reflected hits) are enforced in modifyHit below, never here.
 */
const Shared = require("./Shared.Vorkath");
const Specials = require("./Specials.Vorkath");
const { getDragonfireProtectionTier, DragonfireProtectionTier } = require("../../combat/DragonfireProtection");

const MELEE_ANIMATION = 7951;
const RANGED_ANIMATION = 7952;
const HIGH_ANIMATION = 7960;

const RANGED_PROJECTILE = 1477;
const MAGIC_PROJECTILE = 1479;
const DRAGONFIRE_PROJECTILE = 393;
const VENOM_PROJECTILE = 1470;
const PRAYER_PROJECTILE = 1471;
const FIREBALL_PROJECTILE = 1481;

const RANGED_IMPACT_GFX = 1478;
const MAGIC_IMPACT_GFX = 1480;
const DRAGONFIRE_IMPACT_GFX = 1466;
const VENOM_IMPACT_GFX = 1472;
const PRAYER_IMPACT_GFX = 1473;

/** The breaths' names in her messages (rsprox captures). */
const BREATH_NAMES = Object.freeze({ dragonfire: "fiery", venom: "venomous", prayer: "corrupting" });
const PRAYERS_DISABLED_MESSAGE = "<col=ff3045>Your prayers have been disabled!</col>";
const IMMUNE_MESSAGE = "The dragon is currently immune to your attacks.";
const IMMUNE_TOLD_ATTRIBUTE = "vorkath:immune-told";
const IMMUNE_MESSAGE_SPACING = 5;
/** CombatSpells.CRUMBLE_UNDEAD spell id: the spawn's instant kill. */
const CRUMBLE_UNDEAD_SPELL_ID = 1169;
/** Multi-hour poison immunity: Vorkath is immune outright (Wiki) and the engine has no
 * innate NPC immunity, so hits keep the timer topped up (see modifyHit). */
const POISON_IMMUNITY_SECONDS = 3600;

let api = null;
let core = null;
let PrayerHandler = null;
let CombatFactory = null;

function afterTicks(ticks, target, execFunc) {
  class DelayedTask extends core.Task {
    constructor() {
      super(Math.max(1, ticks), target, false);
    }

    execute() {
      this.stop();
      execFunc();
    }
  }
  core.TaskManager.submit(new DelayedTask());
}

/** Edge-to-edge Chebyshev distance between the 7x7 body and a 1x1 target. */
function edgeDistance(npc, target) {
  const base = npc.getLocation();
  const pos = target.getLocation();
  const maxX = base.getX() + Shared.SIZE - 1;
  const maxY = base.getY() + Shared.SIZE - 1;
  const dx = pos.getX() < base.getX() ? base.getX() - pos.getX()
    : pos.getX() > maxX ? pos.getX() - maxX : 0;
  const dy = pos.getY() < base.getY() ? base.getY() - pos.getY()
    : pos.getY() > maxY ? pos.getY() - maxY : 0;
  return Math.max(dx, dy);
}

function isAdjacent(npc, target) {
  const pos = target.getLocation();
  const base = npc.getLocation();
  return edgeDistance(npc, target) <= 1 && !Shared.underBoss(base.getX(), base.getY(), pos.getX(), pos.getY());
}

function potionTier(player) {
  const tier = getDragonfireProtectionTier(player);
  if (tier >= DragonfireProtectionTier.SUPER_ANTIFIRE) return "super";
  if (tier >= DragonfireProtectionTier.ANTIFIRE) return "antifire";
  return "none";
}

/**
 * The breath's lines, one per protection, as captured: prayer or shield first ("You're
 * horribly burnt..." with neither), then the potion's.
 */
function breathMessages({ shield, prayer, potion }, variant) {
  const name = BREATH_NAMES[variant] ?? BREATH_NAMES.dragonfire;
  const lines = [];
  if (prayer) lines.push(`Your prayers resist some of the dragon's ${name} breath!`);
  if (shield) lines.push(`Your shield absorbs most of the dragon's ${name} breath!`);
  if (!prayer && !shield) lines.push(`You're horribly burnt by the dragon's ${name} breath!`);
  if (potion === "super") lines.push(`Your super antifire potion helps to protect you from the dragon's ${name} breath!`);
  else if (potion === "antifire") lines.push("Your antifire potion helps to protect you from the dragon's breath!");
  return lines;
}

/** Rolled breath damage plus its messages. */
function breathOutcome(npc, player, variant) {
  const protection = {
    shield: core.CombatEquipment.hasDragonProtectionGear(player),
    prayer: PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC),
    potion: potionTier(player),
  };
  const caps = Shared.dragonfireCaps({ ...protection, variant });
  const accurate = core.AccuracyFormulasDpsCalc.rollAccuracy(npc, player, core.CombatType.MAGIC);
  const max = accurate ? caps.cap : caps.resistedCap;
  const damage = Math.max(0, core.Misc.getRandom(max) - caps.reduction - caps.variantPenalty);
  return { damage, accurate, messages: breathMessages(protection, variant) };
}

/**
 * Tile-targeted shots use the captured flight values (delay, duration, arc), with
 * heights quartered like DoomShared does: this engine's height params run 4x
 * below capture units. They leave from her middle, not the corner of her 7x7 body.
 */
function sendTileProjectile(npc, tile, projectileId, flight) {
  new core.Projectile(
    core.Projectile.centreOf(npc),
    new core.Location(tile.x, tile.y, npc.getLocation().getZ()),
    null,
    projectileId,
    flight.delay,
    flight.duration,
    flight.startHeight,
    flight.endHeight,
    npc.getPrivateArea(),
  ).withAngle(flight.angle).sendProjectile();
}

const FIREBALL_FLIGHT = { delay: 0, duration: 120, angle: 46, startHeight: 85, endHeight: 9 };
const FIREBALL_IMPACT_HEIGHT = 38;

function globalGraphic(npc, gfxId, height, tile) {
  return Shared.tileGraphic(core, npc, gfxId, height, tile);
}

function launchFireball(npc, target) {
  npc.performAnimation(new core.Animation(HIGH_ANIMATION));
  Shared.playSound(target, Shared.SOUND.FIREBALL_LAUNCH, 20);
  afterTicks(1, target, () => {
    if (!npc.isRegistered?.() || (npc.getHitpoints?.() ?? 1) <= 0) return;
    const location = target.getLocation();
    const tile = { x: location.getX(), y: location.getY() };
    sendTileProjectile(npc, tile, FIREBALL_PROJECTILE, FIREBALL_FLIGHT);
    // Captured: the impact shows on the tile 4 ticks after the projectile, at height 38.
    afterTicks(4, target, () => explodeFireball(npc, tile));
  });
}

function explodeFireball(npc, tile) {
  const viewers = globalGraphic(npc, DRAGONFIRE_IMPACT_GFX, FIREBALL_IMPACT_HEIGHT, tile);
  Shared.areaSound(npc, Shared.SOUND.FIREBALL_IMPACT, tile, Shared.SOUND_RANGE.FIREBALL_IMPACT);
  const roll = core.Misc.getRandom(Shared.FIREBALL_MAX);
  for (const viewer of viewers) {
    const position = viewer.getLocation();
    if ((viewer.getHitpoints?.() ?? 1) <= 0) continue;
    const distance = Math.max(Math.abs(position.getX() - tile.x), Math.abs(position.getY() - tile.y));
    const damage = Shared.fireballDamage(roll, distance);
    if (damage > 0) {
      viewer.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
    }
  }
}

function startSpecial(npc, target) {
  const next = npc.getAttribute(Shared.ATTR_NEXT_SPECIAL) ?? Shared.SPECIAL_ACID;
  npc.setAttribute(Shared.ATTR_ATTACKS, 0);
  npc.setAttribute(Shared.ATTR_NEXT_SPECIAL, next === Shared.SPECIAL_ACID ? Shared.SPECIAL_SPAWN : Shared.SPECIAL_ACID);
  if (next === Shared.SPECIAL_ACID) {
    Specials.startAcid(npc, target);
  } else {
    Specials.startSpawn(npc, target);
  }
}

/**
 * Damage rules for everything hitting Vorkath and her spawn: phase immunity/halving,
 * Crumble Undead one-shotting the spawn, recoil/vengeance and non-player damage ning,
 * and Vorkath's outright poison immunity (see the timer note above).
 */
function modifyHit(event) {
  const { npc, hit } = event;
  if (!npc) return;
  const npcId = npc.getId?.();
  if (npcId === Shared.SPAWN_ID) {
    crumbleSpawn(npc, hit);
    return;
  }
  if (npcId !== Shared.AWAKE_ID) return;
  keepPoisonImmune(npc);
  const hits = hit.getHits?.() ?? [];
  if (hits.length === 0) return;
  if (hits.length === 0) return;
  if (hits.some((part) => part.isReflected?.() === true)) {
    zeroHits(hit, hits);
    return;
  }
  const attacker = hit.getAttacker?.();
  if (attacker && !attacker.isPlayer?.()) {
    zeroHits(hit, hits);
    return;
  }
  if (core.World.getProcessCycle() < (npc.getAttribute?.(Shared.ATTR_WAKE_UNTIL) ?? 0)) {
    zeroHits(hit, hits);
    return;
  }
  const phase = npc.getAttribute?.(Shared.ATTR_PHASE) ?? Shared.PHASE_ACTIVE;
  if (phase === Shared.PHASE_SPAWN) {
    zeroHits(hit, hits);
    tellImmune(attacker);
    return;
  }
  if (phase === Shared.PHASE_ACID) {
    for (const part of hits) {
      part.setDamage(Math.floor((part.getDamage?.() ?? 0) / 2));
    }
    hit.updateTotalDamage?.();
  }
}

/**
 * During the spawn her hits land as 0 with "The dragon is currently immune to your attacks."
 * (rsprox captures). The message shows on about 2 in 5 of those hits; the 5-tick spacing
 * is ours.
 */
function tellImmune(attacker) {
  const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
  if (!player) return;
  const now = core.World.getProcessCycle();
  if (now < (player.getAttribute(IMMUNE_TOLD_ATTRIBUTE) ?? 0)) return;
  player.setAttribute(IMMUNE_TOLD_ATTRIBUTE, now + IMMUNE_MESSAGE_SPACING);
  player.sendMessage(IMMUNE_MESSAGE);
}

function zeroHits(hit, hits) {
  for (const part of hits) part.setDamage(0);
  hit.updateTotalDamage?.();
}

function keepPoisonImmune(npc) {
  if (npc.isVenomed?.() || npc.isPoisoned?.()) {
    npc.setVenomed?.(false);
    npc.setPoisonDamage?.(0);
  }
  npc.getCombat?.().getPoisonImmunityTimer?.().start?.(POISON_IMMUNITY_SECONDS);
}

function crumbleSpawn(npc, hit) {
  const attacker = hit.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  const spellId = attacker.getCombat?.().getCastSpell?.()?.spellId?.() ?? null;
  if (spellId !== CRUMBLE_UNDEAD_SPELL_ID) return;
  const hits = hit.getHits?.() ?? [];
  if (hits.length === 0) return;
  const hp = npc.getHitpoints?.() ?? 0;
  if (hp <= 0) return;
  for (let i = 0; i < hits.length; i++) {
    hits[i].setDamage(i === 0 ? Math.max(1, hp) : 0);
  }
  hit.updateTotalDamage?.();
}

function combatClass() {
  const { CombatMethod, CombatType } = core;

  return class VorkathCombat extends CombatMethod {
    hits(character, target) {
      if (!character || !target) return [];
      // The engine asks for hits right after start(); a turn start() skipped has none.
      if (!this.attack || this.attack === Shared.Attack.FIREBALL) return [];
      if (this.attack === Shared.Attack.MELEE) {
        // Captured: the melee hit lands on the animation's tick.
        const hit = new core.PendingHit(character, target, this, 0);
        hit.setTotalDamage(Math.min(Shared.MELEE_MAX, hit.getTotalDamage()));
        return [hit];
      }
      if (this.attack === Shared.Attack.RANGED || this.attack === Shared.Attack.MAGIC) {
        const ranged = this.attack === Shared.Attack.RANGED;
        const delay = Shared.shotHitDelay(this.shotEnd);
        const hit = new core.PendingHit(character, target, this, delay);
        hit.setTotalDamage(Math.min(ranged ? Shared.RANGED_MAX : Shared.MAGIC_MAX, hit.getTotalDamage()));
        return [hit];
      }
      const variant = this.attack ?? Shared.Attack.DRAGONFIRE;
      const delay = Shared.shotHitDelay(this.shotEnd);
      const outcome = target.isPlayer?.()
        ? breathOutcome(character, target.getAsPlayer(), variant)
        : { damage: core.Misc.getRandom(Shared.MAGIC_MAX), messages: [] };
      const hit = new core.PendingHit(character, target, this, { delay, rollAccuracy: false });
      hit.setTotalDamage(outcome.damage);
      hit.vorkathBreath = { variant, messages: outcome.messages };
      return [hit];
    }

    start(character, target) {
      this.attack = null;
      if (!character || !target) return;
      const npc = character.getAsNpc();
      if (!npc || npc.getId() !== Shared.AWAKE_ID) return;
      // Her first attack comes 6 ticks after she wakes (captured), even if hit sooner.
      if (core.World.getProcessCycle() < (npc.getAttribute(Shared.ATTR_FIRST_ATTACK_AT) ?? 0)) {
        character.getCombat().setAttackDelay(1);
        return;
      }
      if ((npc.getAttribute(Shared.ATTR_PHASE) ?? Shared.PHASE_ACTIVE) !== Shared.PHASE_ACTIVE) {
        character.getCombat().setAttackDelay(2);
        return;
      }
      const attacks = npc.getAttribute(Shared.ATTR_ATTACKS) ?? 0;
      if (attacks >= Shared.STANDARDS_BEFORE_SPECIAL) {
        startSpecial(npc, target);
        return;
      }
      this.attack = Shared.chooseStandard({
        adjacent: isAdjacent(npc, target),
        roll: (n) => core.Misc.getRandom(n),
      });
      npc.setAttribute(Shared.ATTR_ATTACKS, attacks + 1);
      if (this.attack === Shared.Attack.MELEE) {
        npc.performAnimation(new core.Animation(MELEE_ANIMATION));
        Shared.playSound(target, Shared.SOUND.MELEE);
      } else if (this.attack === Shared.Attack.FIREBALL) {
        launchFireball(npc, target);
      } else {
        npc.performAnimation(new core.Animation(RANGED_ANIMATION));
        const [projectileId, impactGfx] = this.attack === Shared.Attack.RANGED ? [RANGED_PROJECTILE, RANGED_IMPACT_GFX]
          : this.attack === Shared.Attack.MAGIC ? [MAGIC_PROJECTILE, MAGIC_IMPACT_GFX]
          : this.attack === Shared.Attack.VENOM ? [VENOM_PROJECTILE, VENOM_IMPACT_GFX]
          : this.attack === Shared.Attack.PRAYER ? [PRAYER_PROJECTILE, PRAYER_IMPACT_GFX]
          : [DRAGONFIRE_PROJECTILE, DRAGONFIRE_IMPACT_GFX];
        this.shotEnd = Shared.sendShot(core, npc, target, projectileId, impactGfx);
        Shared.playShotSounds(target, this.attack, this.shotEnd);
      }
    }

    handleAfterHitEffects(hit) {
      const target = hit?.getTarget?.();
      if (!target?.isPlayer?.()) return;
      // The impact graphics went out with the shots (Shared.sendShot).
      const breath = hit.vorkathBreath;
      if (!breath) return;
      for (const line of breath.messages ?? []) target.sendMessage(line);
      if (breath.variant === Shared.Attack.VENOM && Math.random() < 0.5) {
        CombatFactory.poisonEntity(target, 6, 2);
      }
      if (breath.variant === Shared.Attack.PRAYER) {
        PrayerHandler.deactivatePrayers(target);
        target.sendMessage(PRAYERS_DISABLED_MESSAGE);
        // Captured a tick after the hit.
        afterTicks(1, target, () => Shared.playSound(target, Shared.SOUND.PRAYERS_DISABLED));
      }
    }

    attackDistance() {
      return Shared.ATTACK_DISTANCE;
    }

    attackSpeed() {
      return Shared.ATTACK_SPEED_TICKS;
    }

    type() {
      if (this.attack === Shared.Attack.MELEE) return CombatType.MELEE;
      if (this.attack === Shared.Attack.RANGED) return CombatType.RANGED;
      return CombatType.MAGIC;
    }
  };
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  PrayerHandler = pluginApi.getPrayerHandler();
  CombatFactory = pluginApi.getCombatFactory();
  pluginApi.onNpcHitModify(modifyHit);
  pluginApi.registerNpcCombatMethodProvider(
    [core.NpcIdentifiers.VORKATH_5],
    combatClass(),
    { singleton: false },
  );
}

module.exports = {
  attach,
  modifyHit,
  combatClass,
  edgeDistance,
  isAdjacent,
  breathOutcome,
  _test: { edgeDistance, isAdjacent, breathMessages },
};
