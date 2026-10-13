/**
 * Araxxor's combat method: melee/magic/ranged standards, the every-seventh-attack special,
 * enrage at 25% (cleave replaces melee) and the prayer caps and on-hit drains.
 *
 * Shape follows the Vorkath method: start() chooses and performs (animations and
 * projectiles only), hits() builds the PendingHits, handleAfterHitEffects() lands the
 * side-effects when the hit does. Counters live on NPC attributes (the method is rebuilt
 * every attack); egg hatching is attack-counted via Specials.checkStandardHatch, while
 * the ticking fight engine (pools, the ball) is in Specials.Araxxor.js.
 *
 * As captured: standards every 6 ticks, the special replaces every 7th attack (first at
 * attack 7), melee lands the next tick with its 9413 swing, ranged (11493, projectile 2360)
 * and magic (11479, projectile 1622) both land four ticks after the cast whatever the
 * distance, and no hit lands through Protect from Melee for more than 5 (Wiki).
 */
const Shared = require("./Shared.Araxxor");
const Specials = require("./Specials.Araxxor");
const CombatAchievements = require("./CombatAchievements.Araxxor");

const BOSS_ANIMATIONS = Object.freeze({ melee: 11480, magic: 11479, ranged: 11493, cleave: 11487, enrage: 11488, enraged: 11489 });
/** Captured: the cleave's hit and its pools land two ticks after the swing. */
const CLEAVE_LAND_TICKS = 2;

let api = null;
let core = null;
let PrayerHandler = null;

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

function alive(entity) {
  return !!entity?.isRegistered?.() && (entity.getHitpoints?.() ?? 1) > 0;
}

function isAdjacent(npc, target) {
  const base = npc.getLocation();
  const pos = target.getLocation();
  return Shared.edgeDistance(base.getX(), base.getY(), pos.getX(), pos.getY()) <= 1
    && !Shared.underBoss(base.getX(), base.getY(), pos.getX(), pos.getY());
}

/** Protect prayers currently up on the target. */
function protections(target) {
  if (!target?.isPlayer?.()) return { melee: false, ranged: false, magic: false };
  const player = target.getAsPlayer();
  return {
    melee: PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MELEE),
    ranged: PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MISSILES),
    magic: PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC),
  };
}

/**
 * Out of melee reach she attacks with magic or ranged, whichever of the player's defensive
 * rolls is lower (Wiki). Prayers shift it indirectly, through the rolls they boost - Rigour
 * raises the ranged roll, so it can turn her onto magic.
 */
function chooseDistantAttack(player) {
  const calculator = core.AccuracyFormulasDpsCalc;
  const rangedRoll = calculator.defenseRangedRoll(player);
  const magicRoll = calculator.defenseMagicRoll(player);
  return rangedRoll < magicRoll ? Shared.Attack.RANGED : Shared.Attack.MAGIC;
}

/**
 * The captured ranged or magic shot: a fixed 30-120 cycle flight from her middle, so the hit
 * is queued to land with it (melee lands on delay 0, a tick after the swing; these on 3).
 */
function sendShot(npc, target, shape) {
  new core.Projectile(
    core.Projectile.centreOf(npc), target.getLocation(), target, shape.id, shape.start,
    shape.end, shape.startHeight, shape.endHeight, npc.getPrivateArea(),
  ).withSource(npc).withAngle(shape.angle).withProgress(shape.progress).sendProjectile();
  return Shared.DISTANT_HIT_TICKS - 1;
}

function drainSkill(player, skill, factor) {
  const skills = player?.getSkillManager?.();
  if (!skills) return;
  const current = skills.getCurrentLevel?.(skill);
  if (!Number.isFinite(current) || current <= 0) return;
  skills.setCurrentLevels?.(skill, Math.max(0, current - Math.ceil(current * factor)));
}

/** Hits that would take Araxxor past the threshold flip her into the enrage. */
function checkEnrage(npc, incomingDamage = 0) {
  if (!alive(npc) || npc.getAttribute?.(Shared.ATTR_DYING) === true) return;
  if (npc.getAttribute?.(Shared.ATTR_ENRAGED) === true) return;
  const hp = npc.getHitpoints?.() ?? 0;
  // onNpcHitModify runs before the hit lands, so project past it: the crossing hit
  // itself enrages, not the hit after. Lethal hits skip it and go to the corpse.
  const projected = hp - (Number.isFinite(incomingDamage) ? incomingDamage : 0);
  if (projected <= 0) return;
  if (projected > Math.floor(Shared.MAX_HITPOINTS * Shared.ENRAGE_THRESHOLD)) return;
  npc.setAttribute(Shared.ATTR_ENRAGED, true);
  // Captured: 11488, then 11489 two ticks later with the body change (the two front legs
  // coat in venom). The screech is in the animations themselves: no sound packet goes out.
  npc.performAnimation(new core.Animation(BOSS_ANIMATIONS.enrage));
  npc.getMovementQueue?.().setBlockMovement?.(true);
  afterTicks(2, npc, () => {
    if (!alive(npc)) return;
    npc.setModelCustomisation?.(Shared.ENRAGE_MODELS);
    npc.performAnimation(new core.Animation(BOSS_ANIMATIONS.enraged));
    npc.getMovementQueue?.().setBlockMovement?.(false);
  });
}

/**
 * The enraged melee: "Skree!", then two ticks later the crush on the tile the target stood
 * on (step away to dodge), with a line of acid pools across the blow (captured).
 */
function startCleave(npc, target) {
  const tile = { x: target.getLocation().getX(), y: target.getLocation().getY() };
  npc.performAnimation(new core.Animation(BOSS_ANIMATIONS.cleave));
  npc.forceChat?.("Skree!");
  npc.getMovementQueue?.().setBlockMovement?.(true);
  // The raw offset from her middle, not its sign: the longer axis sets the line (captured
  // (-4, +3) gave a north-south line, (-3, +4) an east-west one).
  const base = npc.getLocation();
  const dx = tile.x - (base.getX() + 3);
  const dy = tile.y - (base.getY() + 3);
  afterTicks(CLEAVE_LAND_TICKS, target, () => {
    npc.getMovementQueue?.().setBlockMovement?.(false);
    if (!alive(npc)) return;
    if (alive(target)) {
      const now = target.getLocation();
      if (now.getX() === tile.x && now.getY() === tile.y) {
        // The cleave is reduced ~66% by Protect from Melee (Wiki), not capped at 5 like the jab.
        const protect = protections(target).melee;
        const rolled = core.Misc.getRandom(Shared.MELEE_MAX);
        const damage = protect ? Math.floor(rolled * Shared.CLEAVE_PROTECT_FACTOR) : rolled;
        if (damage > 0) {
          target.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(damage, core.HitMask.RED)]);
          // Perfect Araxxor forbids melee taken off prayer; the cleave is her melee.
          if (!protect && target.isPlayer?.()) CombatAchievements.avoidableDamage(target.getAsPlayer(), damage);
        }
      }
    }
    // Wiki step-under: the recorded tile inside his own footprint hits him for 8-12,
    // like a Ruptura burst (direct queue, no Mirrorback redirect on self-hits).
    const feet = npc.getLocation();
    if (Shared.underBoss(feet.getX(), feet.getY(), tile.x, tile.y)) {
      const self = Shared.CLEAVE_SELF_MIN + core.Misc.getRandom(Shared.CLEAVE_SELF_MAX - Shared.CLEAVE_SELF_MIN);
      npc.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(self, core.HitMask.BLUE)]);
    }
    for (const [x, y] of Shared.cleavePoolTiles(tile.x, tile.y, dx, dy)) {
      Specials.spawnPool(npc, x, y);
    }
  });
}

function combatClass() {
  const { CombatMethod, CombatType } = core;

  return class AraxxorCombat extends CombatMethod {
    start(character, target) {
      this.attack = null;
      const npc = character?.getAsNpc?.();
      this.npc = npc ?? null;
      if (!npc || npc.getId() !== Shared.BOSS_ID || !target) return;
      if (npc.getAttribute?.(Shared.ATTR_DYING) === true) {
        character.getCombat().setAttackDelay(1);
        return;
      }
      if (core.World.getProcessCycle() < (npc.getAttribute?.(Shared.ATTR_ARMED_AT) ?? 0)) {
        character.getCombat().setAttackDelay(1);
        return;
      }
      const attacks = (npc.getAttribute?.(Shared.ATTR_ATTACKS) ?? 0) + 1;
      npc.setAttribute(Shared.ATTR_ATTACKS, attacks);
      if (attacks % Shared.SPECIAL_EVERY_ATTACKS === 0) {
        Specials.startSpecial(npc, target);
        return;
      }
      // Wiki: eggs hatch on standards only, so specials never advance the hatch count.
      Specials.checkStandardHatch(npc);
      if (npc.getAttribute?.(Shared.ATTR_ENRAGED) === true && isAdjacent(npc, target)) {
        this.attack = Shared.Attack.CLEAVE;
        startCleave(npc, target);
        return;
      }
      this.attack = isAdjacent(npc, target)
        ? Shared.Attack.MELEE
        : chooseDistantAttack(target.getAsPlayer());
      // Captured: she turns to the player with every attack.
      npc.setPositionToFace?.(target.getLocation());
      const player = target.isPlayer?.() ? target.getAsPlayer() : null;
      if (this.attack === Shared.Attack.MELEE) {
        npc.performAnimation(new core.Animation(BOSS_ANIMATIONS.melee));
        Shared.playCaptured(player, Shared.SOUND.melee);
      } else {
        const ranged = this.attack === Shared.Attack.RANGED;
        npc.performAnimation(new core.Animation(ranged ? BOSS_ANIMATIONS.ranged : BOSS_ANIMATIONS.magic));
        this.shotDelay = sendShot(npc, target, ranged ? Shared.PROJECTILE.ranged : Shared.PROJECTILE.magic);
        Shared.playCaptured(player, ranged ? Shared.SOUND.ranged : Shared.SOUND.magic);
      }
    }

    hits(character, target) {
      if (!character || !target) return [];
      if (!this.attack || this.attack === Shared.Attack.CLEAVE) return [];
      const protect = protections(target);
      if (this.attack === Shared.Attack.MELEE) {
        const hit = new core.PendingHit(character, target, this, 0);
        const rolled = Math.min(Shared.MELEE_MAX, hit.getTotalDamage());
        hit.setTotalDamage(protect.melee ? Math.min(rolled, Shared.PROTECT_MELEE_CAP) : rolled);
        return [hit];
      }
      const ranged = this.attack === Shared.Attack.RANGED;
      const delay = this.shotDelay ?? 1;
      const hit = new core.PendingHit(character, target, this, { delay });
      const rolled = Math.min(ranged ? Shared.RANGED_MAX : Shared.MAGIC_MAX, hit.getTotalDamage());
      const factor = ranged ? protect.ranged : protect.magic;
      const prayerReduced = ranged ? Shared.PROTECT_RANGED_FACTOR : Shared.PROTECT_MAGIC_FACTOR;
      hit.setTotalDamage(factor ? Math.floor(rolled * prayerReduced) : rolled);
      hit.araxxorKind = this.attack;
      return [hit];
    }

    handleAfterHitEffects(hit) {
      const target = hit?.getTarget?.();
      if (!target?.isPlayer?.()) return;
      const player = target.getAsPlayer();
      if (hit.araxxorKind === Shared.Attack.RANGED) drainSkill(player, core.Skill.DEFENCE, Shared.DRAIN_RANGED_DEFENCE);
      else if (hit.araxxorKind === Shared.Attack.MAGIC) drainSkill(player, core.Skill.PRAYER, Shared.DRAIN_MAGIC_PRAYER);
    }

    attackDistance() {
      return Shared.ATTACK_DISTANCE;
    }

    attackSpeed() {
      return this.npc?.getAttribute?.(Shared.ATTR_ENRAGED) === true
        ? Shared.ENRAGED_SPEED_TICKS
        : Shared.ATTACK_SPEED_TICKS;
    }

    /**
     * The engine asks type() before start() picks this cycle's attack, so it must read the
     * distance itself: melee reach next to the player, magic/ranged from further out. With
     * the stale last-attack type the boss would only ever walk in for melee.
     */
    type() {
      const npc = this.npc;
      const target = npc?.getCombat?.().getTarget?.() ?? null;
      if (npc && target) {
        if (isAdjacent(npc, target)) return CombatType.MELEE;
        return target.isPlayer?.() && chooseDistantAttack(target.getAsPlayer()) === Shared.Attack.RANGED
          ? CombatType.RANGED
          : CombatType.MAGIC;
      }
      if (this.attack === Shared.Attack.MELEE || this.attack === Shared.Attack.CLEAVE) return CombatType.MELEE;
      if (this.attack === Shared.Attack.RANGED) return CombatType.RANGED;
      return CombatType.MAGIC;
    }
  };
}

/**
 * Damage rules for everything hitting Araxxor: venom immunity, hits during the death
 * sequence are discarded, and the enrage flips when the threshold is crossed.
 */
function modifyHit(event) {
  const { npc, hit } = event;
  if (!npc || npc.getId?.() !== Shared.BOSS_ID) return;
  if (npc.isVenomed?.() || npc.isPoisoned?.()) {
    npc.setVenomed?.(false);
    npc.setPoisonDamage?.(0);
  }
  if (npc.getAttribute?.(Shared.ATTR_DYING) === true) {
    const hits = hit.getHits?.() ?? [];
    for (const part of hits) part.setDamage(0);
    hit.updateTotalDamage?.();
    return;
  }
  redirectToMirrorback(npc, hit);
  const incoming = (hit.getHits?.() ?? []).reduce((sum, part) => sum + (part.getDamage?.() ?? 0), 0);
  checkEnrage(npc, incoming);
}

/**
 * While a Mirrorback araxyte lives, a fifth of the damage dealt to Araxxor moves onto it
 * and half of that recoils to the attacker - a tenth of the boss hit (Wiki).
 */
function redirectToMirrorback(boss, hit) {
  const attacker = hit.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  const session = boss.getAttribute?.(Shared.ATTR_ENCOUNTER);
  const mirrorback = (session?.minions ?? []).find((minion) =>
    minion?.getId?.() === Shared.MINION_ID.mirrorback && alive(minion));
  if (!mirrorback) return;
  const hits = hit.getHits?.() ?? [];
  const total = hits.reduce((sum, part) => sum + (part.getDamage?.() ?? 0), 0);
  const redirect = Math.floor(total * Shared.MIRRORBACK_REDIRECT_FACTOR);
  if (redirect <= 0) return;
  for (const part of hits) {
    part.setDamage(Math.floor((part.getDamage?.() ?? 0) * (1 - Shared.MIRRORBACK_REDIRECT_FACTOR)));
  }
  hit.updateTotalDamage?.();
  mirrorback.getCombat().getHitQueue().addPendingDamage([
    new core.HitDamage(redirect, core.HitMask.RED),
  ]);
  const recoil = Math.floor(redirect * Shared.MIRRORBACK_RECOIL_FACTOR);
  if (recoil > 0) {
    attacker.getAsPlayer().getCombat().getHitQueue().addPendingDamage([
      new core.HitDamage(recoil, core.HitMask.RED),
    ]);
    CombatAchievements.avoidableDamage(attacker.getAsPlayer(), recoil);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  PrayerHandler = pluginApi.getPrayerHandler();
  pluginApi.onNpcHitModify(modifyHit);
  pluginApi.registerNpcCombatMethodProvider(
    [core.NpcIdentifiers.ARAXXOR],
    combatClass(),
    { singleton: false },
  );
}

module.exports = {
  attach,
  modifyHit,
  combatClass,
  isAdjacent,
  protections,
  chooseDistantAttack,
  checkEnrage,
  startCleave,
  drainSkill,
  _test: { isAdjacent, protections, chooseDistantAttack },
};
