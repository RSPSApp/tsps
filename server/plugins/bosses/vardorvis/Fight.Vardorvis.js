/**
 * A fight with Vardorvis (docs/vardorvis.md), as captured (rsprox 3285, 3344):
 * - He rises on his spot facing north-west and the boss HUD comes up a tick later. He isn't
 *   aggressive; the first hit to land on him (a miss too) raises the barrier (Barrier.Vardorvis),
 *   starts the fight's clock and has him run at the player.
 * - He attacks every 5 ticks from the tick after that first hit: a slash (32-43 as his hitpoints
 *   fall, Wiki; a quarter through Protect from Melee) landing a tick later, healing him half of it.
 * - Axes come 14 ticks into the fight, then every 13 (8 once he's below a third, and always when
 *   awakened) (Axes.Vardorvis).
 * - Below 570 hitpoints (1,140 awakened) the specials join in: the strangle takes an attack's
 *   place or an axe set's (and the axes follow 8 ticks after it) (Strangle.Vardorvis); his head's
 *   gaze rides with a slash after an axe set (Head.Vardorvis); the dash takes an attack's place
 *   (Dash.Vardorvis). Which of them comes when is inferred from 16 kills (docs/vardorvis.md).
 * - His Strength rises and his Defence falls in step with his hitpoints (Wiki).
 * - The kill: his death animation; four ticks on the kill count, the fight's time, the loot and
 *   the rocks open; a tick later the tendrils sink; the HUD goes at twelve; he rises again at
 *   nineteen.
 */
const Common = require("./Common.Vardorvis");
const Scoreboard = require("./Scoreboard.Vardorvis");
const Barrier = require("./Barrier.Vardorvis");
const Axes = require("./Axes.Vardorvis");
const Head = require("./Head.Vardorvis");
const Dash = require("./Dash.Vardorvis");
const Strangle = require("./Strangle.Vardorvis");
const CombatAchievements = require("./CombatAchievements.Vardorvis");

const MELEE_PRAYER = "PROTECT_FROM_MELEE";
const BOSS_NAME = "Vardorvis";

class Fight {
  constructor(session, boss) {
    this.session = session;
    this.player = session.player;
    this.boss = boss;
    this.awakened = session.awakened;
    this.stats = Common.data.boss[this.awakened ? "awakened" : "normal"];
    this.tick = 0;
    this.events = [];
    this.engaged = false;
    this.startCycle = 0;
    this.nextAttack = Infinity;
    this.axesDue = Infinity;
    this.enraged = this.awakened;
    this.lastSpecial = null;
    this.strangles = 0;
    this.strangling = false;
    this.strangleQueued = false;
    this.headReadyAt = Infinity;
    this.afterStrangle = false;
    this.nextDash = Infinity;
    this.dashing = false;
    this.axes = [];
    this.shownHp = -1;
    this.hudShown = false;
    this.over = false;
    this.stopped = false;
    this.perfectKill = true;
  }

  /** Only damage actually taken during this fight can spoil its loot bonus. */
  recordDamage(amount) {
    if (amount <= 0 || this.over || this.stopped || this.session.ended || this.session.fight !== this) return;
    this.perfectKill = false;
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  alive() {
    return !this.stopped && !this.over && this.boss?.isRegistered?.() && this.boss.getHitpoints() > 0;
  }

  /** The share of his hitpoints he has lost, 0 to 1. */
  missing() {
    const max = this.boss.getMaxHitpoints();
    return max > 0 ? 1 - Math.max(0, this.boss.getHitpoints()) / max : 0;
  }

  specialsOpen() {
    const { clock } = Common.data;
    return this.boss.getHitpoints() < (this.awakened ? clock.awakenedSpecialsBelow : clock.specialsBelow);
  }

  /** The first hit on him: the barrier, the clock, and after the player. */
  engage() {
    if (this.engaged || !this.alive()) return;
    const { clock } = Common.data;
    this.engaged = true;
    this.startCycle = Common.core.World.getProcessCycle();
    Barrier.raise(this.session);
    this.nextAttack = this.tick + clock.firstAttackTicks;
    this.nextDash = this.tick + Common.data.dash.firstTicks;
    this.axesDue = this.tick + (this.awakened ? clock.firstAttackTicks + clock.enragedAxeTicks : clock.firstAxesTicks);
    this.boss.getCombat().attack(this.player);
  }

  process() {
    if (this.stopped) return;
    this.tick++;
    // His attacks aren't the combat engine's, which would count him out of combat and regenerate him.
    if (this.boss?.isRegistered()) this.boss.getCombat().getLastAttack().reset();
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped) return;
    Axes.process(this);
    if (this.engaged && this.alive()) this.fightTick();
    this.updateHud();
  }

  fightTick() {
    this.scaleStats();
    if (!this.enraged && this.boss.getHitpoints() <= this.boss.getMaxHitpoints() * Common.data.clock.enrageShare) this.enraged = true;
    if (this.boss.getInteractingMobile?.() !== this.player && !this.strangling && !this.dashing) this.boss.setMobileInteraction(this.player);
    if (this.tick >= this.axesDue) this.axeTime();
    // An attack falling while he holds the player in the strangle is skipped; his clock keeps time.
    if (this.tick >= this.nextAttack && this.strangling) this.nextAttack += Common.data.clock.attackTicks;
    if (this.tick >= this.nextAttack && !this.dashing) this.attackSlot();
  }

  /** The axe set falls due: axes, or (below 570) a strangle at his next attack instead. */
  axeTime() {
    const { clock, strangle } = Common.data;
    if (this.strangleQueued || this.strangling) return;
    if (this.mayStrangle() && Math.random() < strangle.chance) {
      this.strangleQueued = true;
      this.axesDue = Infinity;
      return;
    }
    Axes.throwSet(this);
    this.axesDue = this.tick + (this.enraged ? clock.enragedAxeTicks : clock.axeTicks);
    // Captured: the head comes with the first slash 5 ticks after the axes, 2 after a strangle's.
    if (this.specialsOpen()) this.headReadyAt = this.tick + (this.afterStrangle ? 2 : 5);
    this.afterStrangle = false;
  }

  mayStrangle() {
    return this.specialsOpen() && this.lastSpecial !== "strangle";
  }

  inReach() {
    const { size } = Common.data.boss;
    const at = this.boss.getLocation();
    const p = this.player.getLocation();
    if (p.getZ() !== at.getZ()) return false;
    const dx = p.getX() < at.getX() ? at.getX() - p.getX() : Math.max(0, p.getX() - (at.getX() + size - 1));
    const dy = p.getY() < at.getY() ? at.getY() - p.getY() : Math.max(0, p.getY() - (at.getY() + size - 1));
    return dx + dy === 1;
  }

  /** His attack: a queued strangle, a strangle ahead of an axe set, the dash, or a slash. */
  attackSlot() {
    const { clock, strangle } = Common.data;
    if (this.strangleQueued || (this.mayStrangle() && this.axesDue - this.tick <= 3 && Math.random() < strangle.chance)) {
      this.strangleQueued = false;
      this.lastSpecial = "strangle";
      this.strangles++;
      this.afterStrangle = true;
      this.axesDue = this.tick + clock.axesAfterStrangleTicks;
      this.nextAttack = this.tick + clock.attackTicks;
      Strangle.start(this);
      return;
    }
    if (!this.inReach()) return;
    if (this.specialsOpen() && this.tick >= this.nextDash && this.tick < this.headReadyAt && Math.random() < Common.data.dash.chance) {
      this.lastSpecial = "dash";
      this.nextDash = this.tick + Common.data.dash.cooldownTicks;
      Dash.start(this);
      return;
    }
    this.melee();
    if (this.specialsOpen() && this.tick >= this.headReadyAt) {
      this.headReadyAt = Infinity;
      this.lastSpecial = "head";
      Head.gaze(this);
    }
    this.nextAttack = this.tick + clock.attackTicks;
  }

  melee() {
    const { boss } = Common.data;
    const [low, high] = this.stats.maxHit;
    this.boss.performAnimation(new Common.core.Animation(boss.meleeAnim));
    this.boss.setPositionToFace(this.player.getLocation());
    // Use the same protection snapshot as the damage roll; changing prayer during
    // its delay cannot turn unprotected damage into chip damage (or the reverse).
    const protectedMelee = Common.protectedFrom(this.player, MELEE_PRAYER);
    const hit = Common.strike(this.boss, this.player, "melee", low + Math.round((high - low) * this.missing()), 1, {
      prayer: MELEE_PRAYER, prayerShare: boss.prayerShare,
      onApplied: (amount) => { if (!protectedMelee) this.recordDamage(amount); },
    });
    hit.__vardorvisLifesteal = true;
  }

  /** Strength up, Defence down, in step with his hitpoints (Wiki). */
  scaleStats() {
    const hp = this.boss.getHitpoints();
    if (hp === this.scaledAt) return;
    this.scaledAt = hp;
    const missing = this.missing();
    const lerp = ([from, to]) => Math.round(from + (to - from) * missing);
    const base = [...this.boss.getDefinition().getStats()];
    base[0] = this.stats.attack;
    base[1] = lerp(this.stats.strength);
    base[2] = lerp(this.stats.defence);
    this.boss.setCombatOverride({ stats: base });
  }

  showHud() {
    this.hudShown = true;
    this.shownHp = this.boss.getHitpoints();
    Common.api.emitCustomEvent("boss-hud:show", {
      player: this.player, npcId: Common.data.npcs.boss, current: this.shownHp, maximum: this.boss.getMaxHitpoints(),
    });
  }

  updateHud() {
    if (!this.hudShown || !this.boss) return;
    const hp = Math.max(0, this.boss.getHitpoints());
    if (hp === this.shownHp) return;
    this.shownHp = hp;
    Common.api.emitCustomEvent("boss-hud:update", { player: this.player, current: hp });
  }

  /** His hitpoints reached 0: the specials stop with him. */
  fell() {
    if (this.over) return;
    this.over = true;
    this.updateHud();
    Axes.clear(this);
    Head.clear(this);
    Strangle.clear(this);
  }

  /** The kill, four ticks into his death: the count, the time, the rocks open, the respawn. */
  won() {
    const { kill, boss } = Common.data;
    const { player, session } = this;
    const ticks = Common.core.World.getProcessCycle() - this.startCycle;
    const awakened = this.awakened;
    if (awakened) {
      const kills = Common.count(player, Common.AWAKENED_KILLS_ATTRIBUTE) + 1;
      player.setAttribute(Common.AWAKENED_KILLS_ATTRIBUTE, kills);
      player.getPacketSender().sendConfig(kill.awakenedKillCountVarp, kills);
      player.sendMessage(kill.awakenedMessage.replace("%d", kills));
    } else {
      const own = Common.count(player, Common.KILLS_ATTRIBUTE) + 1;
      const total = CombatAchievements.killed(player, own, (kills) => player.sendMessage(kill.message.replace("%d", kills)));
      player.setAttribute(Common.KILLS_ATTRIBUTE, Math.max(own, total ?? 0));
      if (total == null) player.getPacketSender().sendConfig(kill.killCountVarp, own);
    }
    const bestKey = awakened ? Common.AWAKENED_BEST_TICKS_ATTRIBUTE : Common.BEST_TICKS_ATTRIBUTE;
    const best = Common.count(player, bestKey);
    if (!best || ticks < best) {
      player.setAttribute(bestKey, ticks);
      Common.api.emitCustomEvent("boss:personal-best", { player, boss: `${awakened ? "Awakened " : ""}${BOSS_NAME}`, ticks });
      player.sendMessage(`Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col> (new personal best)`);
    } else {
      player.sendMessage(`Fight duration: <col=ff0000>${Common.formatTicks(ticks)}</col>. Personal best: ${Common.formatTicks(best)}`);
    }
    Scoreboard.won(ticks, awakened);
    CombatAchievements.judge(this, ticks);
    session.awakened = false;
    session.setExit(false);
    Common.later(Common.data.barrier.fallTicks, () => Barrier.fall(session));
    Common.later(boss.hudHideTicks - boss.killTicks, () => {
      if (session.fight === this && !session.ended) this.hideHud();
    });
    Common.later(boss.respawnTicks - boss.killTicks, () => {
      if (session.ended || session.fight !== this) return;
      this.stop();
      spawnBoss(session);
    });
  }

  hideHud() {
    if (!this.hudShown) return;
    this.hudShown = false;
    Common.api.emitCustomEvent("boss-hud:hide", { player: this.player, fade: false, afterTicks: 0 });
  }

  /** The fight ends without a kill (the player left, died, logged out). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events = [];
    Axes.clear(this);
    Head.clear(this);
    Strangle.clear(this);
    if (this.boss?.isRegistered?.() && this.boss.getHitpoints() > 0) Common.api.removeNpc(this.boss);
  }
}

/** Vardorvis rises on his spot; the fight runs on its own tick task. */
function spawnBoss(session) {
  if (session.ended) return;
  const { npcs, boss } = Common.data;
  const npc = session.spawn(npcs.boss, boss.tile, boss.face);
  if (!npc) return;
  const stats = boss[session.awakened ? "awakened" : "normal"];
  npc.setMaxHitpoints(stats.hitpoints);
  npc.setHitpoints(stats.hitpoints);
  npc.setMovementSteps(2);
  // His own axes, tendrils and heads never hold him up.
  npc.setFlag(Common.core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
  const fight = new Fight(session, npc);
  npc.__vardorvisFight = fight;
  session.fight = fight;
  fight.scaleStats();
  fight.at(1, () => fight.showHud());
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
}

// ------------------------------------------------------------------ hooks

/** His combat: the fight times his attacks; the engine only runs him at the player. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class VardorvisCombat extends CombatMethod {
    start() {}

    hits() {
      return [];
    }

    attackSpeed() {
      return 1;
    }

    attackDistance() {
      return 1;
    }

    type() {
      return CombatType.MELEE;
    }
  };
}

const fightOf = (npc) => npc?.__vardorvisFight ?? null;

/** The first hit to land on him starts the fight; his slashes heal him half of what they take. */
function hitResolved({ attacker, target, hit }) {
  const fight = fightOf(target);
  if (fight && attacker === fight.player) fight.engage();
  const own = fightOf(attacker);
  if (own && hit?.__vardorvisLifesteal && target === own.player) Common.lifesteal(attacker, hit.getTotalDamage());
}

function beforeDeath(event) {
  fightOf(event.npc)?.fell();
}

function onDeath(event) {
  const fight = fightOf(event.npc);
  if (fight && !fight.stopped && fight.session.fight === fight) fight.won();
}

/** The grade is frozen at lethal damage, before the delayed death/loot event. */
function dropContext({ player, npc, context }) {
  const fight = fightOf(npc);
  if (!context || !fight || fight.boss !== npc || fight.player !== player || !fight.over || fight.stopped ||
      fight.session.ended || fight.session.fight !== fight || npc.getHitpoints() > 0) return;
  context.perfectKill = fight.perfectKill;
}

function attachFight(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.AWAKENED_KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_TICKS_ATTRIBUTE, 0);
  api.persistAttribute(Common.AWAKENED_BEST_TICKS_ATTRIBUTE, 0);
  api.registerNpcCombatMethodProvider(Common.data.npcs.boss, combatClass());
  api.onCombatHitResolved(hitResolved);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(onDeath);
  api.onCustomEvent("npc-drops:context", dropContext);
  api.onPlayerLogin(sendAwakenedKillCount);
}

function sendAwakenedKillCount({ player }) {
  const kills = Common.count(player, Common.AWAKENED_KILLS_ATTRIBUTE);
  if (kills > 0) player.getPacketSender().sendConfig(Common.data.kill.awakenedKillCountVarp, kills);
}

module.exports = { attachFight, spawnBoss, Fight };
