/**
 * One fight with the Phantom Muspah (docs/phantom-muspah.md), as captured:
 * - It appears in ranged or melee form (Wiki: either) with seq 9938 and two spikes near the edge,
 *   the darkness overlay and its music; the HUD comes up a tick later and it can be attacked three
 *   ticks in. Its first attack is seven ticks in.
 * - Ranged and melee forms swap after 100 / 80 damage and four damaging hits (Wiki): seq 9936, and
 *   a tick later the other form (seq 9937, spot 2334) with a wave of spikes.
 * - Specials at 637 and 425 hitpoints: Lightning clouds first if it appeared in ranged form, else
 *   Homing spikes (Wiki). Below 127, the shockwave and the shield (Shield.PhantomMuspah); after the
 *   shield, spikes spread every fourth attack.
 * - The kill: seq 9941 (npc-combat-defs), then five ticks later the kill count, the fight's length
 *   and the loot on its centre tile (Loot.PhantomMuspah). The next one appears 30 seconds after it
 *   fell (Wiki).
 * The Muspah's attacks aren't the combat engine's: its CombatMethod only walks it into reach.
 */
const Common = require("./Common.PhantomMuspah");
const Attacks = require("./Attacks.PhantomMuspah");
const Hits = require("./Hits.PhantomMuspah");
const Clouds = require("./Clouds.PhantomMuspah");
const Shield = require("./Shield.PhantomMuspah");
const { SpikeField } = require("./Spikes.PhantomMuspah");

const OTHER_FORM = { ranged: "melee", melee: "ranged" };
/** Wiki: Defence reductions cannot take this encounter below 125. */
const DEFENCE_FLOOR = 125;
/** A special or a switch waits this long after an attack, so they don't cut it short. */
const ACTION_GAP_TICKS = 2;
/** Form switches are at least this far apart (captured: never closer, even under Leagues damage). */
const SWITCH_GAP_TICKS = 5;
/** A second special waits this long after the first (captured: 6 ticks between them). */
const SPECIAL_GAP_TICKS = 6;
/** The overlay lifts this long after the Homing spikes' darkness (captured: 5 ticks). */
const HOMING_DARK_TICKS = 5;

class Fight {
  constructor(session) {
    this.session = session;
    this.player = session.player;
    this.muspah = null;
    this.startForm = Math.random() < 0.5 ? "ranged" : "melee";
    this.form = this.startForm;
    this.tick = 0;
    this.events = [];
    this.held = false;
    this.nextAttackTick = Infinity;
    this.lastActionTick = -Infinity;
    this.specialsDone = 0;
    this.specialReadyTick = 0;
    this.switchDamage = 0;
    this.switchHits = 0;
    this.switchReadyTick = 0;
    this.shockwaveStarted = false;
    this.shieldDone = false;
    this.shield = 0;
    this.pendingSkip = null;
    this.attacksSinceGrowth = 0;
    this.stillTicks = 0;
    this.lastTile = null;
    this.clouds = [];
    this.spikes = new SpikeField(this);
    this.hud = null;
    this.over = false;
    this.stopped = false;
    this.startCycle = Common.core.World.getProcessCycle();
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  /** While held (a special, the shockwave) the Muspah doesn't attack or walk. */
  hold(held) {
    this.held = held;
    const movement = this.muspah?.getMovementQueue();
    if (!movement) return;
    movement.setBlockMovement(held);
    if (held) movement.reset();
    else this.nextAttackTick = Math.max(this.nextAttackTick === Infinity ? 0 : this.nextAttackTick, this.tick + this.speed());
  }

  speed() {
    const form = Common.data.forms[this.form];
    return form?.speed ?? Common.data.forms.ranged.speed;
  }

  start() {
    const { boss, npcs, lair, overlay } = Common.data;
    const at = this.session.tile(boss.tile);
    const muspah = Common.api.spawnNpc({ id: npcs[this.form], x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0 });
    if (!muspah) return;
    this.muspah = muspah;
    muspah.setStatMinimumLevel(Common.core.Skill.DEFENCE, DEFENCE_FLOOR);
    muspah.__skipDefaultRespawn = true;
    muspah.__muspahFight = this;
    muspah.setFlag("combat:freezable", true);
    muspah.setMaxHitpoints(boss.hitpoints);
    muspah.setHitpoints(boss.hitpoints);
    muspah.setHealthBar(boss.healthBar);
    muspah.setUntargetable(true);
    this.session.area.add(muspah);
    muspah.setPositionToFace(this.session.tile([...boss.face, 0]));
    Common.animate(muspah, boss.spawnAnim);
    Common.sound(this.player, boss.spawnSound);
    Common.overlay(this.player, overlay.spawn);
    Common.playMusic(this.player, lair.music.fight);
    this.spikes.spawnWave();
    this.at(1, () => this.showHitpoints());
    this.at(boss.attackableTicks, () => {
      muspah.setUntargetable(false);
      muspah.getCombat().attack(this.player);
    });
    this.nextAttackTick = boss.firstAttackTicks;
    this.lastTile = muspah.getLocation().clone();
  }

  /** Every tick: due events, spikes and clouds, then the Muspah's turn. */
  process() {
    if (this.stopped) return;
    this.tick++;
    // Its attacks aren't the combat engine's, which would count it out of combat and regenerate it.
    if (this.muspah?.isRegistered()) this.muspah.getCombat().getLastAttack().reset();
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped) return;
    this.spikes.process();
    Clouds.process(this);
    const muspah = this.muspah;
    if (this.over || !muspah?.isRegistered() || muspah.getHitpoints() <= 0) return;
    this.trackStillness();
    if (muspah.getInteractingMobile?.() !== this.player) muspah.setMobileInteraction(this.player);
    if (this.held || !Common.alive(this.player)) return;
    // The engine drops a target it can't reach (a spike in the way, the switch's pause); it never gives up.
    if (muspah.getCombat().getTarget() !== this.player) muspah.getCombat().attack(this.player);
    this.turn();
  }

  turn() {
    const { shockwave, specials } = Common.data;
    const hp = this.muspah.getHitpoints();
    const free = this.tick - this.lastActionTick >= ACTION_GAP_TICKS;
    const preShield = this.form === "ranged" || this.form === "melee";
    if (preShield && free && !this.shockwaveStarted && (hp < shockwave.hitpoints || this.pendingSkip)) {
      this.lastActionTick = this.tick;
      Shield.shockwave(this);
      return;
    }
    if (preShield && free && this.tick >= this.specialReadyTick && this.specialsDone < specials.thresholds.length && hp <= specials.thresholds[this.specialsDone]) {
      this.lastActionTick = this.tick;
      this.special();
      return;
    }
    if (preShield && free && this.switchDue()) {
      this.lastActionTick = this.tick;
      this.switchForm();
      return;
    }
    if (this.tick < this.nextAttackTick) return;
    if (!Attacks.attack(this)) return;
    this.lastActionTick = this.tick;
    this.nextAttackTick = this.tick + this.speed();
    if (this.form === "final" && ++this.attacksSinceGrowth >= Common.data.spikes.growth.everyAttacks) {
      this.attacksSinceGrowth = 0;
      this.spikes.growthWave();
    }
  }

  /** The specials, in the order its first form sets (Wiki). */
  special() {
    const first = this.startForm === "ranged" ? "clouds" : "homing";
    const which = this.specialsDone === 0 ? first : (first === "clouds" ? "homing" : "clouds");
    this.specialsDone++;
    this.specialReadyTick = this.tick + SPECIAL_GAP_TICKS;
    this.resetSwitch();
    if (which === "clouds") {
      Clouds.teleport(this);
      return;
    }
    const { homing, specials, overlay } = Common.data;
    Common.animate(this.muspah, homing.anim);
    this.muspah.performGraphic(Common.graphic(homing.spot));
    this.player.sendMessage(specials.message);
    Common.overlayFade(this.player, overlay.dark);
    this.at(HOMING_DARK_TICKS, () => Common.overlayFade(this.player, overlay.clear));
    this.spikes.startHoming();
    this.nextAttackTick = Math.max(this.nextAttackTick, this.tick + this.speed());
  }

  switchDue() {
    const { switch: rules } = Common.data;
    if (this.tick < this.switchReadyTick) return false;
    const needed = this.form === "ranged" ? rules.rangedDamage : rules.meleeDamage;
    return this.switchHits >= rules.minHits && this.switchDamage >= needed;
  }

  resetSwitch() {
    this.switchDamage = 0;
    this.switchHits = 0;
  }

  /** Ranged <-> melee: seq 9936, and a tick later the other form with a wave of spikes. */
  switchForm() {
    const { switch: rules } = Common.data;
    this.resetSwitch();
    Common.animate(this.muspah, rules.anim);
    this.hold(true);
    this.switchReadyTick = this.tick + SWITCH_GAP_TICKS;
    this.at(1, () => {
      this.setForm(OTHER_FORM[this.form]);
      this.resetSwitch();
      Common.animate(this.muspah, rules.appearAnim);
      this.muspah.performGraphic(Common.graphic(rules.appearSpot));
      this.spikes.switchWave();
      this.hold(false);
    });
  }

  /** The Muspah takes a form (an NPC transformation), keeping its hitpoints. */
  setForm(form) {
    const hp = this.muspah.getHitpoints();
    this.form = form;
    this.muspah.setNpcTransformationId(Common.data.npcs[form]);
    this.muspah.setMaxHitpoints(Common.data.boss.hitpoints);
    this.muspah.setHitpoints(hp);
    this.stillTicks = 0;
    if (form !== "shielded") this.showHitpoints();
  }

  /** A jump to a lair tile (its south-west corner), facing the arena's centre. */
  moveMuspah(tile) {
    const muspah = this.muspah;
    muspah.getMovementQueue().reset();
    muspah.moveTo(this.session.tile([tile[0], tile[1], 0]));
    muspah.setPositionToFace(this.session.tile([...Common.data.boss.centre, 0]));
    this.lastTile = muspah.getLocation().clone();
  }

  /** The melee form hits harder the longer it stands still. */
  trackStillness() {
    const here = this.muspah.getLocation();
    if (this.lastTile && here.equals(this.lastTile)) this.stillTicks++;
    else this.stillTicks = 0;
    this.lastTile = here.clone();
  }

  /** Whether a lair tile is under the Muspah. */
  underBoss([x, y]) {
    if (!this.muspah?.isRegistered()) return false;
    const [mx, my] = this.session.lairTile(this.muspah.getLocation());
    const size = this.muspah.getSize();
    return x >= mx && x < mx + size && y >= my && y < my + size;
  }

  // ------------------------------------------------------------------ hits on the Muspah

  /** A hit on the Muspah: the shield, the shield skip, and the form switch's count. */
  hitMuspah(hit) {
    if (this.over) return;
    if (this.form === "shielded") {
      Shield.hitShield(this, hit);
      return;
    }
    const total = hit.getTotalDamage();
    if (total <= 0) return;
    const hp = this.muspah.getHitpoints();
    if (!this.shieldDone && this.pendingSkip) {
      // More damage while it lies at 0 fails the skip: the damage is undone (captured 9 -> 0 -> 9).
      this.zero(hit);
      this.muspah.setHitpoints(this.pendingSkip.restore);
      this.pendingSkip = null;
      this.showHitpoints();
      return;
    }
    if (!this.shieldDone && total >= hp) {
      // Hitpoints reaching 0 before the shield: left on 1, the shield skipped if nothing else lands.
      this.cap(hit, hp - 1);
      this.pendingSkip = { restore: Math.min(hp, Common.data.shockwave.hitpoints - 1) };
      this.at(1, () => this.showHitpoints());
      return;
    }
    // What lands during a switch's own pause counts for neither form.
    if ((this.form === "ranged" || this.form === "melee") && !this.held) {
      this.switchDamage += total;
      this.switchHits++;
    }
    this.at(1, () => this.showHitpoints());
  }

  zero(hit) {
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
  }

  cap(hit, max) {
    let left = Math.max(0, max);
    for (const part of hit.getHits()) {
      const amount = Math.min(left, part.getDamage());
      part.setDamage(amount);
      left -= amount;
    }
    hit.updateTotalDamage();
  }

  /** A spike knocked the player: the Muspah heals (not while it lies at 0 for a skip). */
  spikeHealed(amount) {
    if (amount <= 0 || this.over || this.pendingSkip || !this.muspah?.isRegistered()) return;
    Hits.heal(this.muspah, amount);
    this.showHitpoints();
  }

  // ------------------------------------------------------------------ the HUD

  hudShow(npcId, current, maximum, colours) {
    const event = this.hud ? "boss-hud:update" : "boss-hud:show";
    Common.api.emitCustomEvent(event, { player: this.player, npcId, current, maximum, colours, force: true });
    this.hud = { npcId, current, maximum };
  }

  /** The HUD on its hitpoints (0 while a shield skip is pending). */
  showHitpoints() {
    if (!this.muspah || this.form === "shielded" || this.stopped) return;
    const { boss, npcs } = Common.data;
    const current = this.pendingSkip ? 0 : Math.max(0, this.muspah.getHitpoints());
    this.muspah.setDisplayedHealth(this.pendingSkip ? { current: 0, max: boss.hitpoints, bar: boss.healthBar } : null);
    if (this.hud && this.hud.current === current && this.hud.npcId === npcs[this.form] && this.hud.maximum === boss.hitpoints) return;
    this.hudShow(npcs[this.form], current, boss.hitpoints, boss.hudColours);
  }

  /** The HUD and head bar on the shield. */
  showShield() {
    const { shield, npcs } = Common.data;
    this.muspah.setDisplayedHealth({ current: this.shield, max: shield.points, bar: shield.healthBar });
    this.hudShow(npcs.shielded, this.shield, shield.points, shield.hudColours);
  }

  hideHud(fade = true) {
    if (!this.hud) return;
    this.hud = null;
    Common.api.emitCustomEvent("boss-hud:hide", fade ? { player: this.player } : { player: this.player, fade: false, afterTicks: 0 });
  }

  // ------------------------------------------------------------------ the end

  /** It falls: no more turns; the kill itself comes with its death (Loot.PhantomMuspah). */
  fell() {
    if (this.over) return;
    this.over = true;
    this.events = [];
    this.spikes.homing = [];
    Clouds.clear(this);
  }

  /** The kill has been counted: spikes sink, the HUD goes, and the next one is on its way. */
  finished() {
    this.spikes.clear();
    this.hideHud();
    Common.overlayFade(this.player, Common.data.overlay.clear);
    this.stopped = true;
    if (this.session.fight === this) this.session.fight = null;
    const { respawnTicks } = Common.data.lair;
    const { kill } = Common.data;
    this.session.spawnMuspah(Math.max(1, respawnTicks - kill.lootTicks));
  }

  /** The fight ends without a kill (the player left). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events = [];
    Clouds.clear(this);
    if (this.player.isRegistered?.()) this.hideHud(false);
    if (this.muspah?.isRegistered?.()) Common.api.removeNpc(this.muspah);
    this.muspah = null;
  }
}

/** Starts the session's fight and runs it on its own tick task. */
function start(session) {
  if (session.fight || session.ended) return;
  const fight = new Fight(session);
  session.fight = fight;
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
}

// ------------------------------------------------------------------ hooks

/** The Muspah's combat: its fight times its attacks; the engine only walks it into reach. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class PhantomMuspahCombat extends CombatMethod {
    start() {}

    hits() {
      return [];
    }

    attackSpeed() {
      return 1;
    }

    attackDistance(npc) {
      return npc?.__muspahFight?.form === "melee" ? 1 : Common.data.boss.range;
    }

    type() {
      return CombatType.RANGED;
    }
  };
}

/** The Muspah's attackable forms hold a freeze for 66% of its base duration (Wiki). */
function freezeDuration(event) {
  const { npcs } = Common.data;
  if (![npcs.ranged, npcs.melee, npcs.shielded, npcs.final].includes(event.target?.getId?.())) return;
  event.ticks *= 0.66;
}

/** A hit on the Muspah: the shield, the shield skip, and the form switch's count. */
function onMuspahHit({ npc, hit }) {
  npc?.__muspahFight?.hitMuspah(hit);
}

/** It never dies before the shield is dealt with; otherwise its fall stops the fight. */
function beforeDeath(event) {
  const fight = event.npc?.__muspahFight;
  if (!fight || fight.stopped) return;
  if (!fight.shieldDone) {
    event.preventDeath = true;
    event.npc.setHitpoints(1);
    return;
  }
  fight.fell();
}

function attachFight(api) {
  const { npcs } = Common.data;
  const Combat = combatClass();
  for (const form of ["ranged", "melee", "teleport", "shielded", "final"]) {
    api.registerNpcCombatMethodProvider(npcs[form], Combat);
  }
  api.onNpcHitModify(onMuspahHit);
  api.onNpcBeforeDeath(beforeDeath);
  api.onCustomEvent("combat:freeze-duration", freezeDuration);
}

module.exports = { attachFight, start };
