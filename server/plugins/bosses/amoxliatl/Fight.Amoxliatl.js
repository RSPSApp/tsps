/**
 * The fight with Amoxliatl, as captured (docs/amoxliatl.md) with the Wiki's rules
 * (https://oldschool.runescape.wiki/w/Amoxliatl/Strategies):
 * - She rises (11527) facing east with "Euat! You are not welcome here!", the HP HUD comes up in
 *   her colours, and 4 ticks later she attacks; then every 8 ticks. She follows the player to
 *   melee distance (the Wiki's "drag").
 * - Her standard attack (11530) is a magic hit of up to 22 on the same tick, which Protect from
 *   Magic blocks, with ice spikes across the floor around the player. 3 ticks later the spikes
 *   come up, 6-10 to a player still on one, and an icy pool forms on the tile the player stood on;
 *   it deals 6-10 a tick to anyone on it (Wiki) and stays until she dies.
 * - After every 2-4 standard attacks (Wiki) a special, the first at random and then in turn:
 *   Icicle Crash (Fight here) and Unstable Ice (UnstableIce.Amoxliatl). With the player on the
 *   path to her platform she has no room for Unstable Ice and only uses Icicle Crash.
 * - Icicle Crash (11531): turn active prayers off and announce the attack, then an icicle that lands 5 ticks
 *   later for up to 34; Protect from Magic turned back on in time negates it (Wiki).
 */
const Common = require("./Common.Amoxliatl");
const UnstableIce = require("./UnstableIce.Amoxliatl");

const ICICLE = "icicle";
const UNSTABLE_ICE = "unstableIce";
const IMPACT_SLOT = 2;

let MagicStyle = null;

function magicStyle() {
  if (!MagicStyle) {
    const { CombatMethod, CombatType } = Common.core;
    MagicStyle = new (class extends CombatMethod {
      type() {
        return CombatType.MAGIC;
      }
      hits() {
        return [];
      }
    })();
  }
  return MagicStyle;
}

const key = (x, y) => `${x},${y}`;

/** Every arena floor tile, as [x, y] on the cache map. */
let arenaTiles = null;
function floorTiles() {
  if (!arenaTiles) {
    arenaTiles = [];
    for (const [y, minX, maxX] of Common.data.arena.rows) for (let x = minX; x <= maxX; x++) arenaTiles.push([x, y]);
  }
  return arenaTiles;
}

function onFloor(x, y) {
  const row = Common.data.arena.rows.find(([rowY]) => rowY === y);
  return Boolean(row) && x >= row[1] && x <= row[2];
}

class Fight {
  constructor(session, boss) {
    this.session = session;
    this.player = session.player;
    this.boss = boss;
    this.tick = 0;
    this.events = [];
    this.startTick = 0;
    this.attacks = 0;
    this.attacksBeforeSpecial = this.rollAttacksBeforeSpecial();
    this.nextSpecial = Math.random() < 0.5 ? ICICLE : UNSTABLE_ICE;
    /** key(x, y) on the cache map -> the pool's GameObject. */
    this.pools = new Map();
    this.blocks = new Set();
    this.hudShown = false;
    this.shownHp = -1;
    this.stats = { damageTaken: 0, prayerLost: false, shattered: false, usedTemotli: false, otherWeapon: false };
    this.lastPrayer = this.prayerPoints();
    this.over = false;
    this.stopped = false;
  }

  get core() {
    return Common.core;
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  rollAttacksBeforeSpecial() {
    const [min, max] = Common.data.specials.afterAttacks;
    return Common.randomInt(min, max);
  }

  prayerPoints() {
    return this.player.getSkillManager().getCurrentLevel(this.core.Skill.PRAYER);
  }

  start() {
    const { spawn, hud } = Common.data;
    const { Animation } = this.core;
    this.boss.performAnimation(new Animation(spawn.anim));
    this.boss.forceChat(spawn.say);
    // As captured, the line goes to the chatbox too, as her npc_say message.
    this.player.getPacketSender().sendTypedMessage(this.core.ChatType.NPC_SAY, spawn.say, this.boss.getDefinition().getName());
    this.hudShown = true;
    this.shownHp = this.boss.getHitpoints();
    Common.api.emitCustomEvent("boss-hud:show", {
      player: this.player, npcId: this.boss.getId(), current: this.shownHp, maximum: this.boss.getMaxHitpoints(), colours: hud.colours,
    });
    this.boss.getCombat().attack(this.player);
    this.boss.getCombat().setAttackDelay(spawn.firstAttackTicks);
  }

  /** Every tick: due events, the pools under the player, the prayer the task watches, the HUD. */
  process() {
    if (this.stopped) return;
    this.tick++;
    // Her specials aren't combat-engine attacks: refresh the combat stopwatch so she counts as
    // fighting.
    if (!this.over) this.boss.getCombat().getLastAttack().reset();
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped) return;
    if (!this.over) this.poolDamage();
    const prayer = this.prayerPoints();
    if (prayer < this.lastPrayer) this.stats.prayerLost = true;
    this.lastPrayer = prayer;
    this.updateHud();
  }

  /** The fight ends: the chamber closing (the HUD dropped at once), or after a kill. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events = [];
    this.clearPools(false);
    UnstableIce.clear(this);
    this.hideHud(false);
  }

  /** The player's tile on the cache map. */
  playerTile() {
    return this.session.worldTile(this.player.getLocation());
  }

  onPath([x]) {
    return x >= Common.data.arena.pathFromX;
  }

  /** Typeless damage on the player now (pools, her heal-free hazards). */
  hurtPlayer(amount) {
    const { HitDamage, HitMask } = this.core;
    const damage = Math.max(0, Math.floor(amount));
    if (damage > 0) this.stats.damageTaken += damage;
    this.player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, damage > 0 ? HitMask.RED : HitMask.BLUE)]);
  }

  // ------------------------------------------------------------------ the attack slot

  /** The combat engine's turn to attack: a standard attack or a special. */
  attack(target) {
    if (this.stopped || this.over || target !== this.player) return [];
    if (this.attacks >= this.attacksBeforeSpecial) return this.special();
    this.attacks++;
    return [this.standard()];
  }

  standard() {
    const { Animation, PendingHit } = this.core;
    const { attack } = Common.data;
    this.boss.performAnimation(new Animation(attack.anim));
    const [x, y] = this.playerTile();
    const spiked = this.spikes(x, y);
    this.at(Common.data.spikes.damageTicks, () => this.spikesErupt(spiked));
    this.at(Common.data.pools.afterTicks, () => this.placePool(x, y));
    // Lands on the same tick (captured); the engine rolls it against Protect from Magic.
    return new PendingHit(this.boss, this.player, magicStyle(), 0);
  }

  /** Spikes on the floor around the player, thinning out with distance (as captured): their tiles. */
  spikes(px, py) {
    const { spotanim, reach, chance } = Common.data.spikes;
    const spiked = new Set();
    for (const [x, y] of floorTiles()) {
      const distance = Math.max(Math.abs(x - px), Math.abs(y - py));
      if (distance > reach) continue;
      if (Math.random() < chance[Math.min(distance, chance.length - 1)]) {
        Common.tileGraphic(this.player, this.session.tile([x, y, 0]), spotanim);
        spiked.add(key(x, y));
      }
    }
    return spiked;
  }

  /**
   * The spikes come up 3 ticks after her attack (as captured): a player still on one of their
   * tiles takes 6-10. This runs before the player's own step that tick, so stepping off within
   * 2 ticks is safe - the Wiki's "step back two tiles".
   */
  spikesErupt(spiked) {
    if (this.over || this.player.getHitpoints() <= 0) return;
    const [x, y] = this.playerTile();
    if (!spiked.has(key(x, y))) return;
    const [min, max] = Common.data.spikes.damage;
    this.hurtPlayer(Common.randomInt(min, max));
  }

  special() {
    this.attacks = 0;
    this.attacksBeforeSpecial = this.rollAttacksBeforeSpecial();
    // From the path she has no room for Unstable Ice (Wiki); the turn order goes on regardless.
    const kind = this.onPath(this.playerTile()) ? ICICLE : this.nextSpecial;
    this.nextSpecial = this.nextSpecial === ICICLE ? UNSTABLE_ICE : ICICLE;
    if (kind === ICICLE) this.icicleCrash();
    else UnstableIce.launch(this);
    return [];
  }

  // ------------------------------------------------------------------ Icicle Crash

  icicleCrash() {
    const { Animation, PrayerHandler, Projectile } = this.core;
    const { icicle } = Common.data;
    const disablePrayers = !Common.isPostQuestFight(this.session) || this.player.getPrayerActive().some(Boolean);
    if (disablePrayers) PrayerHandler.deactivatePrayers(this.player);
    this.player.sendMessage(disablePrayers ? icicle.message : icicle.plainMessage);
    this.boss.performAnimation(new Animation(icicle.anim));
    const spec = icicle.projectile;
    new Projectile(Projectile.centreOf(this.boss), this.player.getLocation(), this.player, spec.id, spec.start, spec.end,
      spec.startHeight, spec.endHeight, this.session.area)
      .withAngle(spec.angle)
      .withProgress(spec.progress)
      .sendProjectile();
    this.at(icicle.impactTicks, () => this.icicleLands());
  }

  icicleLands() {
    const { CombatFactory, Graphic, PendingHit, PrayerHandler, World } = this.core;
    const { icicle } = Common.data;
    if (this.over) return;
    this.player.performGraphicInSlot(IMPACT_SLOT, new Graphic(icicle.impactSpotanim));
    this.player.getPacketSender().sendSoundEffect(icicle.impactSound, 1, 0);
    const hit = new PendingHit(this.boss, this.player, magicStyle(), { delay: 0 });
    CombatFactory.applyStyleDamage(hit, icicle.maxHit, { bypassProtectionPrayer: true });
    if (PrayerHandler.isActivated(this.player, PrayerHandler.PROTECT_FROM_MAGIC)) {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
    }
    this.player.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
  }

  // ------------------------------------------------------------------ the icy pools

  /** A pool on a floor tile (cache map), unless one is there already. */
  placePool(x, y, playSound = true) {
    if (this.stopped || this.over || !onFloor(x, y) || this.pools.has(key(x, y))) return false;
    const { GameObject, ObjectManager } = this.core;
    const { pools, arena } = Common.data;
    const tile = this.session.tile([x, y, 0]);
    if (this.core.RegionManager.blocked(tile, this.session.area)) return false;
    const pool = new GameObject(pools.id, tile, pools.shape, Common.randomInt(0, 3), this.session.area);
    ObjectManager.register(pool, true);
    this.pools.set(key(x, y), pool);
    // As captured, the sound comes from the middle of the platform, not the pool.
    if (playSound) Common.areaSound(this.player, pools.sound, this.session.tile(arena.centre));
    return true;
  }

  poolDamage() {
    const [x, y] = this.playerTile();
    if (!this.pools.has(key(x, y)) || this.player.getHitpoints() <= 0) return;
    const [min, max] = Common.data.pools.damage;
    this.hurtPlayer(Common.randomInt(min, max));
  }

  /** Her death takes every pool with it, each with a puff (captured). */
  clearPools(puff = true) {
    const { ObjectManager } = this.core;
    for (const pool of this.pools.values()) {
      if (puff && this.player.isRegistered()) Common.tileGraphic(this.player, pool.getLocation(), Common.data.pools.clearSpotanim);
      ObjectManager.deregister(pool, true);
    }
    this.pools.clear();
  }

  // ------------------------------------------------------------------ the kill

  /** The killing blow: her ice goes, and the fight with it. */
  died() {
    if (this.over) return;
    this.over = true;
    this.events = [];
    this.clearPools();
    UnstableIce.clear(this);
  }

  /** Ticks from her rising to the kill count (Fight duration). */
  duration() {
    return this.tick - this.startTick;
  }

  // ------------------------------------------------------------------ the HP HUD (the BossHud plugin)

  updateHud() {
    if (!this.hudShown) return;
    const hp = Math.max(0, this.boss.getHitpoints());
    if (hp === this.shownHp) return;
    this.shownHp = hp;
    Common.api.emitCustomEvent("boss-hud:update", { player: this.player, current: hp });
  }

  hideHud(fade = true) {
    if (!this.hudShown) return;
    this.hudShown = false;
    if (!this.player.isRegistered()) return;
    Common.api.emitCustomEvent("boss-hud:hide", fade ? { player: this.player } : { player: this.player, fade: false, afterTicks: 0 });
  }
}

/** She rises: a fight for the session, run on its own tick task. */
function begin(session, boss) {
  const fight = new Fight(session, boss);
  session.fight = fight;
  boss.__amoxliatlFight = fight;
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (fight.stopped || session.ended) {
        this.stop();
        return;
      }
      fight.process();
    }
  })());
  fight.start();
  return fight;
}

// ------------------------------------------------------------------ hooks

/** Outside her chamber (The Heart of Darkness's fight at the door): the plain magic attack. */
function plainAttack(npc, target) {
  const { Animation, PendingHit } = Common.core;
  npc.performAnimation(new Animation(Common.data.attack.anim));
  return [new PendingHit(npc, target, magicStyle(), 0)];
}

/** Her combat: every attack slot is the fight's to fill, from melee distance. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class AmoxliatlCombat extends CombatMethod {
    start() {}

    hits(npc, target) {
      const fight = npc.__amoxliatlFight;
      return fight ? fight.attack(target) : plainAttack(npc, target);
    }

    attackSpeed() {
      return Common.data.attack.speed;
    }

    attackDistance() {
      return 1;
    }

    type() {
      return CombatType.MAGIC;
    }
  };
}

/** Her hurt sound with every hitsplat she takes (captured). */
function bossHurt({ target, hit }) {
  const fight = target?.__amoxliatlFight;
  if (!fight || fight.stopped || !fight.player.isRegistered()) return;
  const sound = Common.data.attack.hurtSound;
  for (let i = 0; i < hit.getHits().length; i++) fight.player.getPacketSender().sendSoundEffect(sound, 1, 0);
}

/** Damage the player takes from her or her ice, for Nagua Negation. */
function playerHurt({ target, hit }) {
  if (!target?.isPlayer?.()) return;
  const session = require("./Chamber.Amoxliatl").sessionOf(target.getAsPlayer());
  const fight = session?.fight;
  if (fight && !fight.stopped && hit.getTotalDamage() > 0) fight.stats.damageTaken += hit.getTotalDamage();
}

function attachFight(api) {
  api.registerNpcCombatMethodProvider(Common.data.npcs.boss, combatClass());
  api.registerNpcCombatMethodProvider(Common.data.npcs.quest, combatClass());
  api.onCombatHitResolved(bossHurt);
  api.onCombatHitResolved(playerHurt);
}

module.exports = { attachFight, begin, Fight, onFloor, floorTiles, key };
