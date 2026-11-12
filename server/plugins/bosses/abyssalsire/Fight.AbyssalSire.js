/**
 * The fight with the Abyssal Sire, as captured (docs/abyssal-sire.md) with the Wiki's rules
 * after Poll 84 (https://oldschool.runescape.wiki/w/Abyssal_Sire/Strategies):
 * - Phase 1, in its alcove: the first hit wakes it (sire_waking) and its tentacles 2 ticks later.
 *   Awake, it throws spawns or a miasma pool every 7 ticks. 75 ranged or magic damage, or a
 *   shadow spell by its tier, stuns it for 46 ticks and calms its tentacles; damage to it only
 *   counts towards that, and it is whole again when the phase ends. Its respiratory systems
 *   (Lungs.AbyssalSire) can only be hurt while it is stunned.
 * - The last lung gone, it walks out (its puppet form, sire_mobilising) and fights in melee within
 *   2 tiles of its body, or throws spawns and pools at a player further off; attacked from there,
 *   it pulls the player in and hits them with its double hook. It starts phase 2 with at least 40%
 *   of its hitpoints (Wiki, June 2025); hits on it while it walks are halved (Wiki, Poll 84).
 * - Below half, it walks to the middle (at least 20% when it gets there), panics with four spawns
 *   and its tentacles awake, and pools the player instead of fighting. Below 35% it pulls the
 *   player beside it and explodes 6 ticks after starting: up to 96 within 4 tiles of its body.
 *   Then spawns pour out until 15 minions are up, and it pools at least 3 more times. It can't die
 *   before the explosion.
 */
const Common = require("./Common.AbyssalSire");
const Miasma = require("./Miasma.AbyssalSire");
const Minions = require("./Minions.AbyssalSire");
const Tentacles = require("./Tentacles.AbyssalSire");

const PHASE = Object.freeze({
  AWAKE: "awake",
  TO_PHASE_2: "toPhase2",
  PHASE_2: "phase2",
  TO_PHASE_3: "toPhase3",
  PANIC: "panic",
  EXPLODING: "exploding",
  APOCALYPSE: "apocalypse",
  DEAD: "dead",
});
const PHASE_1 = new Set([PHASE.AWAKE]);
const WALKING = new Set([PHASE.TO_PHASE_2, PHASE.TO_PHASE_3]);
/** Ticks between the "disoriented" reminders a player hitting a stunned Sire gets. */
const REMINDER_TICKS = 10;
/** Captured: back from a stun, its next pool or spawn comes about 4 ticks later. */
const UNSTUN_ATTACK_TICKS = 4;
const EXPLOSION_HIT = "abyssal-sire:explosion";

let SireMethod = null;

/** Caps a hit at `damage` in all, its splats in order. */
function setDamage(hit, damage) {
  let left = Math.max(0, damage);
  for (const part of hit.getHits()) {
    const value = Math.min(part.getDamage(), left);
    part.setDamage(value);
    left -= value;
  }
  hit.updateTotalDamage();
}

/** The hit's shadow spell, as its CombatSpells constant's name, or null. */
function shadowSpellOf(hit) {
  const spell = hit.getSpell?.();
  if (!spell) return null;
  const { CombatSpells } = Common.core;
  return Object.keys(Common.data.phase1.shadowSpells).find((name) => CombatSpells[name] === spell) ?? null;
}

/** The Sire's own hits: melee, or typeless for the explosion, rolled by the fight. */
function sireMethod() {
  if (!SireMethod) {
    const { CombatMethod, CombatType } = Common.core;
    SireMethod = new (class extends CombatMethod {
      type() {
        return CombatType.MELEE;
      }
      hits() {
        return [];
      }
    })();
  }
  return SireMethod;
}

class Fight {
  constructor(lair, player) {
    this.lair = lair;
    this.player = player;
    this.sire = lair.sire;
    this.phase = PHASE.AWAKE;
    this.tick = 0;
    this.events = [];
    this.stunnedUntil = 0;
    this.stunDamage = 0;
    this.attackAt = 0;
    this.pullNext = false;
    this.pulling = false;
    this.lastHitAt = 0;
    this.remindedAt = -REMINDER_TICKS;
    this.poolsAfterExplosion = 0;
    this.nextPoolAt = 0;
    this.nextWaveAt = 0;
    this.lungRegenAt = 0;
    this.stopped = false;
    this.miasma = new Miasma(this);
    this.minions = new Minions(this);
    this.tentacles = new Tentacles(this);
    this.stats = {
      stuns: 0, scionMatured: false, miasmaDamage: 0, tentacleDamage: 0, explosionDamage: 0,
      unprayedSireDamage: 0, rebounded: false,
    };
  }

  get core() {
    return Common.core;
  }

  get maxHitpoints() {
    return this.sire.getMaxHitpoints();
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  /** The players in the chamber, who see and hear the fight. */
  watchers() {
    return this.lair.players();
  }

  stunned() {
    return this.tick < this.stunnedUntil;
  }

  /** The player is still here and alive to be fought. */
  playerHere() {
    return this.player.isRegistered() && this.player.getHitpoints() > 0 && this.lair.contains(this.player.getLocation());
  }

  // ------------------------------------------------------------------ the loop

  process() {
    if (this.stopped) return;
    this.tick++;
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped || this.phase === PHASE.DEAD) return;
    if (!this.sire?.isRegistered()) {
      this.lair.reset();
      return;
    }
    this.miasma.tick();
    this.minions.tick();
    this.tentacles.tick();
    if (PHASE_1.has(this.phase)) this.regenerateLungs();
    this.attack();
    if (this.tick - this.lastHitAt > Common.data.phase2.idleResetTicks) this.lair.reset();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events = [];
    this.miasma.clear();
    this.minions.removeAll();
  }

  // ------------------------------------------------------------------ waking and stuns

  wake(spell) {
    const { npcs, anims, phase1 } = Common.data;
    const { Animation } = this.core;
    this.sire.setNpcTransformationId(npcs.awake);
    this.sire.performAnimation(new Animation(anims.waking));
    this.sire.setMobileInteraction(this.player);
    this.lastHitAt = this.tick;
    this.at(phase1.tentaclesWakeTicks, () => {
      if (this.phase === PHASE.AWAKE && !this.stunned()) this.lair.setTentacles("active");
    });
    this.attackAt = this.tick + phase1.sleepingStunDelayTicks;
    // A shadow spell that wakes it stuns once it is up (Wiki: 10 ticks), not with the waking hit.
    this.wakingHit = true;
    if (spell && this.shadowStuns(spell)) this.at(phase1.sleepingStunDelayTicks, () => this.stun());
  }

  /** `spell` is a CombatSpells constant's name (SHADOW_RUSH ...), or null. */
  shadowStuns(spell) {
    const chance = Common.data.phase1.shadowSpells[spell];
    return chance != null && Math.random() < chance;
  }

  stun() {
    if (this.phase !== PHASE.AWAKE) return;
    const { npcs, phase1, sounds } = Common.data;
    const { Animation } = this.core;
    const restun = this.stunned();
    this.stunnedUntil = this.tick + phase1.stunTicks;
    this.stunDamage = 0;
    this.stats.stuns++;
    this.player.sendMessage(Common.message("stunned"));
    Common.areaSound(this.watchers(), { id: sounds.stun, radius: 10 }, this.sire.getLocation());
    this.player.getPacketSender().sendSoundEffect(sounds.stun, 1, 0);
    Common.api.emitCustomEvent("abyssal-sire:stunned", { player: this.player });
    if (restun) return;
    this.sire.setNpcTransformationId(npcs.stunned);
    this.sire.performAnimation(new Animation(-1));
    this.sire.setMobileInteraction(null);
    this.at(phase1.tentaclesCalmTicks, () => {
      if (this.stunned() && this.phase === PHASE.AWAKE) this.lair.setTentacles("stunned");
    });
    this.scheduleUnstun();
  }

  scheduleUnstun() {
    const until = this.stunnedUntil;
    this.at(until - this.tick, () => {
      if (this.stunnedUntil !== until) {
        this.scheduleUnstun();
        return;
      }
      if (this.phase !== PHASE.AWAKE) return;
      this.sire.setNpcTransformationId(Common.data.npcs.awake);
      this.sire.setMobileInteraction(this.player);
      this.lair.setTentacles("active");
      this.attackAt = this.tick + UNSTUN_ATTACK_TICKS;
    });
  }

  // ------------------------------------------------------------------ hits on the Sire

  /** onNpcHitModify for the Sire: what its phase lets a hit do. */
  hitSire(hit) {
    const attacker = hit.getAttacker?.();
    if (attacker !== this.player) {
      this.setDamage(hit, 0);
      return;
    }
    this.lastHitAt = this.tick;
    const { CombatType } = this.core;
    const type = hit.getCombatType();
    const spell = shadowSpellOf(hit);
    if (PHASE_1.has(this.phase)) {
      const waking = this.wakingHit;
      this.wakingHit = false;
      if (spell && Common.data.phase1.shadowSpells[spell] != null) {
        if (!waking && this.shadowStuns(spell)) this.stun();
      } else if (type === CombatType.RANGED || type === CombatType.MAGIC) {
        this.stunDamage += hit.getTotalDamage();
        if (!this.stunned() && this.stunDamage >= Common.data.phase1.stunDamage) this.stun();
        else if (this.stunned() && this.tick - this.remindedAt >= REMINDER_TICKS) {
          this.remindedAt = this.tick;
          this.player.sendMessage(Common.message("alreadyStunned"));
        }
      }
      this.keepAlive(hit);
      return;
    }
    if (WALKING.has(this.phase)) {
      this.setDamage(hit, Math.floor(hit.getTotalDamage() / 2));
      this.keepAlive(hit);
      return;
    }
    if (this.phase === PHASE.PHASE_2) {
      const far = Common.distanceToFootprint(this.player.getLocation(), this.sire) > Common.data.phase2.reach;
      // Arrows already in the air when it pulls the player in don't pull them again.
      if (far && type !== CombatType.MELEE && !this.pulling) this.pullNext = true;
      this.keepAlive(hit);
      if (this.sire.getHitpoints() - hit.getTotalDamage() < this.maxHitpoints * Common.data.phase2.threshold) this.toPhase3();
      return;
    }
    if (this.phase === PHASE.PANIC) {
      this.keepAlive(hit);
      if (this.sire.getHitpoints() - hit.getTotalDamage() < this.maxHitpoints * Common.data.phase3.explosionThreshold) this.explode();
      return;
    }
    if (this.phase === PHASE.EXPLODING) this.keepAlive(hit);
  }

  setDamage(hit, damage) {
    setDamage(hit, damage);
  }

  /** The Sire can't die before the explosion (Wiki): a hit leaves it at 1 at least. */
  keepAlive(hit) {
    const most = Math.max(0, this.sire.getHitpoints() - 1);
    if (hit.getTotalDamage() > most) this.setDamage(hit, most);
  }

  // ------------------------------------------------------------------ the Sire's attacks

  attack() {
    if (this.tick < this.attackAt || !this.playerHere()) return;
    switch (this.phase) {
      case PHASE.AWAKE:
        if (this.stunned()) return;
        this.attackAt = this.tick + Common.data.phase1.attackTicks;
        if (Math.random() < 0.5) this.throwSpawn(Common.data.anims.spawnsAwake);
        else this.poolAttack(Common.data.anims.miasmaAwake);
        return;
      case PHASE.PHASE_2:
        this.attackAt = this.tick + Common.data.phase2.attackTicks;
        this.phase2Attack();
        return;
      case PHASE.PANIC:
        this.panicAttack();
        return;
      case PHASE.APOCALYPSE:
        this.apocalypseAttack();
        return;
      default:
    }
  }

  phase2Attack() {
    const { anims, phase2 } = Common.data;
    if (this.pullNext) {
      this.pullNext = false;
      this.pull();
      return;
    }
    if (Common.distanceToFootprint(this.player.getLocation(), this.sire) <= phase2.reach) {
      const attack = Common.weighted(phase2.attacks);
      this.melee(anims[attack.anim], attack.max, attack.prayedMax);
      return;
    }
    const { spawnsWeight, miasmaWeight } = phase2.rangedAttacks;
    if (Math.random() * (spawnsWeight + miasmaWeight) < spawnsWeight) this.throwSpawn(anims.spawnsWandering);
    else this.poolAttack(anims.miasmaWandering);
  }

  /** A melee hit a tick after the swing (captured), rolled against Protect from Melee's own maximum. */
  melee(anim, max, prayedMax) {
    const { Animation, PrayerHandler } = this.core;
    this.sire.performAnimation(new Animation(anim));
    this.sire.setMobileInteraction(this.player);
    this.at(1, () => {
      if (!this.playerHere() || this.phase === PHASE.DEAD) return;
      const prayed = PrayerHandler.isActivated(this.player, PrayerHandler.PROTECT_FROM_MELEE);
      const hit = this.queueHit(prayed ? prayedMax : max, { rollAccuracy: true });
      if (!prayed && hit) this.stats.unprayedSireDamage += hit.getTotalDamage();
    });
  }

  /** A hit from the Sire on the player, through the hit queue (vengeance, recoil, splats). */
  queueHit(max, { rollAccuracy }) {
    const { CombatFactory, PendingHit, World } = this.core;
    const hit = new PendingHit(this.sire, this.player, sireMethod(), { delay: 0, rollAccuracy });
    CombatFactory.applyStyleDamage(hit, max, { bypassProtectionPrayer: true });
    this.player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
    return hit;
  }

  /**
   * Attacked from range in phase 2: the player is pulled in (busy, teleport impact) and lands
   * beside it 3 ticks later; its double hook follows 3 ticks after that (captured).
   */
  pull() {
    const { anims, spotanims, sounds, phase2 } = Common.data;
    const { Animation, Graphic } = this.core;
    this.sire.setNpcTransformationId(Common.data.npcs.puppet);
    this.sire.performAnimation(new Animation(anims.teleportPlayer));
    this.player.performAnimation(new Animation(anims.playerTeleported));
    this.player.performGraphic(new Graphic(spotanims.playerTeleported, 0, spotanims.playerTeleportedHeight));
    this.player.getPacketSender().sendSoundEffect(sounds.playerTeleported, 1, 0);
    this.player.getMovementQueue().reset();
    Common.busyFor(this.player, phase2.teleport.busyTicks);
    this.pulling = true;
    this.at(phase2.teleport.busyTicks, () => {
      if (!this.playerHere() || this.phase !== PHASE.PHASE_2) {
        this.pulling = false;
        return;
      }
      this.player.moveTo(this.besideSire());
      this.sire.setNpcTransformationId(Common.data.npcs.wandering);
      this.sire.setMobileInteraction(this.player);
      this.attackAt = this.tick + phase2.teleport.busyTicks;
      this.at(phase2.teleport.busyTicks, () => {
        this.pulling = false;
        if (this.phase === PHASE.PHASE_2) this.melee(anims.doubleHook, phase2.teleport.max, phase2.teleport.prayedMax);
      });
    });
  }

  /** The tile south of the middle of its body, where captures land a pulled player. */
  besideSire() {
    return this.sire.getLocation().transform(2, -1);
  }

  /** A spawn thrown from its mouth, landing near the player 6 ticks later (captured). */
  throwSpawn(anim) {
    const { Animation } = this.core;
    if (anim != null) this.sire.performAnimation(new Animation(anim));
    this.minions.throwSpawn(this.player.getLocation());
  }

  /** A pool under the player a tick after the gesture (captured). */
  poolAttack(anim) {
    const { Animation } = this.core;
    if (anim != null) this.sire.performAnimation(new Animation(anim));
    const tile = this.player.getLocation().clone();
    this.at(1, () => this.miasma.place(tile));
  }

  panicAttack() {
    if (this.tick < this.nextPoolAt) return;
    this.nextPoolAt = this.tick + Common.randomInt(...Common.data.phase3.poolTicks);
    this.miasma.place(this.player.getLocation().clone());
  }

  apocalypseAttack() {
    const { phase3 } = Common.data;
    if (this.tick >= this.nextWaveAt && this.minions.count() < phase3.minionCap) {
      this.nextWaveAt = this.tick + Common.randomInt(...phase3.spawnWaveTicks);
      this.minions.spawnAround(Common.randomInt(2, 4));
    }
    const poolsLeft = this.poolsAfterExplosion < phase3.poolsAfterExplosion || this.minions.count() < phase3.minionCap;
    if (poolsLeft && this.tick >= this.nextPoolAt) {
      this.nextPoolAt = this.tick + Common.randomInt(...phase3.poolTicks);
      this.poolsAfterExplosion++;
      this.miasma.place(this.player.getLocation().clone());
    }
  }

  // ------------------------------------------------------------------ the lungs and phase 1's end

  regenerateLungs() {
    const { phase1 } = Common.data;
    if (this.tick < this.lungRegenAt) return;
    this.lungRegenAt = this.tick + phase1.lungRegenTicks;
    for (const lung of this.lair.lungs) {
      const npc = lung.npc;
      if (lung.dead || !npc?.isRegistered()) continue;
      if (npc.getHitpoints() > 0 && npc.getHitpoints() < npc.getMaxHitpoints()) npc.setHitpoints(npc.getHitpoints() + 1);
    }
  }

  /** A lung is gone; the last one ends phase 1. */
  lungDied() {
    this.lastHitAt = this.tick;
    if (this.phase !== PHASE.AWAKE || this.lair.lungs.some((lung) => !lung.dead)) return;
    const { npcs, anims, phase1, offsets } = Common.data;
    const { Animation } = this.core;
    this.phase = PHASE.TO_PHASE_2;
    this.stunnedUntil = 0;
    this.sire.setHitpoints(this.maxHitpoints);
    this.sire.setNpcTransformationId(npcs.puppet);
    this.sire.performAnimation(new Animation(anims.mobilising));
    this.lair.setTentacles("stunned");
    const { startTicks, tilesPerTick, arriveTicks } = phase1.toPhase2;
    this.at(startTicks, () => this.walk(this.lair.offset(offsets.phase2), tilesPerTick, () => this.at(arriveTicks, () => this.startPhase2())));
  }

  /**
   * Walks the Sire straight to `target`, `tilesPerTick` a tick. The steps are its own, as the
   * movement queue would make them (walk, then run, direction), but without its routing: a 6x6
   * NPC has no route out of its alcove. The client walks it with its form's walk sequence.
   */
  walk(target, tilesPerTick, arrived) {
    const { Direction } = this.core;
    const step = () => {
      if (this.stopped || this.phase === PHASE.DEAD) return;
      let here = this.sire.getLocation();
      if (here.getX() === target.getX() && here.getY() === target.getY()) {
        arrived();
        return;
      }
      for (let i = 0; i < tilesPerTick; i++) {
        const dx = Math.sign(target.getX() - here.getX());
        const dy = Math.sign(target.getY() - here.getY());
        if (dx === 0 && dy === 0) break;
        const next = here.transform(dx, dy);
        this.sire.setLocation(next);
        if (i === 0) this.sire.setWalkingDirection(Direction.fromDeltas(dx, dy));
        else this.sire.setRunningDirection(Direction.fromDeltas(dx, dy));
        here = next;
      }
      this.at(1, step);
    };
    step();
  }

  startPhase2() {
    const { npcs, phase2 } = Common.data;
    if (this.phase !== PHASE.TO_PHASE_2) return;
    this.phase = PHASE.PHASE_2;
    this.sire.setHitpoints(Math.max(this.sire.getHitpoints(), Math.floor(this.maxHitpoints * phase2.phase1Floor)));
    this.sire.setNpcTransformationId(npcs.wandering);
    this.sire.setMobileInteraction(this.player);
    this.attackAt = this.tick;
  }

  toPhase3() {
    if (this.phase !== PHASE.PHASE_2) return;
    const { npcs, anims, phase2, offsets } = Common.data;
    const { Animation } = this.core;
    this.phase = PHASE.TO_PHASE_3;
    this.pullNext = false;
    this.sire.setNpcTransformationId(npcs.puppet);
    this.sire.setMobileInteraction(null);
    const { tilesPerTick, panicModeTicks, panicTicks } = phase2.toPhase3;
    this.walk(this.lair.offset(offsets.phase3), tilesPerTick, () => this.at(panicModeTicks, () => {
      this.sire.performAnimation(new Animation(anims.panicMode));
      this.at(panicTicks, () => this.startPhase3());
    }));
  }

  startPhase3() {
    const { npcs, phase2, phase3 } = Common.data;
    if (this.phase !== PHASE.TO_PHASE_3) return;
    this.phase = PHASE.PANIC;
    this.sire.setHitpoints(Math.max(this.sire.getHitpoints(), Math.floor(this.maxHitpoints * phase2.toPhase3.floor)));
    this.sire.setNpcTransformationId(npcs.panicking);
    this.sire.setMobileInteraction(this.player);
    this.lair.setTentacles("active");
    this.minions.spawnAround(phase3.spawnsOnPanic);
    this.nextPoolAt = this.tick + 1;
  }

  // ------------------------------------------------------------------ the explosion

  explode() {
    if (this.phase !== PHASE.PANIC) return;
    const { anims, spotanims, sounds, offsets, phase3 } = Common.data;
    const { Animation, Graphic } = this.core;
    this.phase = PHASE.EXPLODING;
    this.sire.performAnimation(new Animation(anims.apocalypse));
    this.player.performAnimation(new Animation(anims.playerTeleported));
    this.player.performGraphic(new Graphic(spotanims.playerTeleported, 0, spotanims.playerTeleportedHeight));
    this.player.getPacketSender().sendSoundEffect(sounds.playerTeleported, 1, 0);
    this.player.getMovementQueue().reset();
    Common.busyFor(this.player, phase3.teleportTicks);
    this.at(phase3.teleportTicks, () => {
      if (this.playerHere()) this.player.moveTo(this.lair.offset(offsets.explosionTile));
    });
    this.at(phase3.explodeTicks, () => this.blast());
  }

  blast() {
    const { npcs, sounds, phase3 } = Common.data;
    if (this.phase !== PHASE.EXPLODING) return;
    this.phase = PHASE.APOCALYPSE;
    this.sire.setNpcTransformationId(npcs.apocalypse);
    Common.areaSound(this.watchers(), sounds.explosion, this.sire.getLocation());
    if (this.playerHere() && Common.distanceToFootprint(this.player.getLocation(), this.sire) <= phase3.explosionReach) {
      const vengeance = this.player.hasVengeanceReturn?.() === true;
      const hit = this.queueHit(phase3.explosionMax, { rollAccuracy: false });
      hit.__sireHit = EXPLOSION_HIT;
      hit.__sireVengeance = vengeance;
    }
    this.minions.spawnAround(phase3.spawnsOnExplosion);
    this.nextWaveAt = this.tick + Common.randomInt(...phase3.spawnWaveTicks);
    this.nextPoolAt = this.tick + 1;
  }

  // ------------------------------------------------------------------ its death

  /** Only the apocalypse form dies (Wiki); its minions die with it and its pools stop. */
  dying() {
    if (this.phase !== PHASE.APOCALYPSE) return false;
    this.phase = PHASE.DEAD;
    this.events = [];
    this.miasma.clear();
    this.minions.killAll();
    this.lair.setTentacles("sleeping");
    return true;
  }
}

/** The fight on its own tick task, from the waking hit. */
function begin(lair, player, spell = null) {
  const fight = new Fight(lair, player);
  lair.sire.__sireFight = fight;
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (fight.stopped) {
        this.stop();
        return;
      }
      fight.process();
    }
  })());
  fight.wake(spell);
  return fight;
}

module.exports = { begin, Fight, PHASE, EXPLOSION_HIT, shadowSpellOf, setDamage };
