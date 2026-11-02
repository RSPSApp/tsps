/**
 * A fight with the Nightmare (docs/nightmare.md), in a dream (Dream.Nightmare), as captured:
 * - She lies asleep while the countdown runs ("will awaken in 30 seconds!", 10 for Phosani's),
 *   wakes with the fight's barriers closing, shows the HUD six ticks later, takes her first form
 *   two ticks after that and attacks.
 * - Each phase: her shield first (Totems.Nightmare shows it in the HUD and on her bar); when it
 *   fails she weakens and the four totems wake. Charged, they blast her for a third of her
 *   hitpoints; she leaves, comes back charging a blast, sleepwalkers walk to her
 *   (Sleepwalkers.Nightmare) and she restores her shield in her next form.
 * - Her attacks (Attacks.Nightmare) and specials (Specials.Nightmare) run on her own timer.
 * - The last blast: The Nightmare dies (her body stays, Disturb starts the next fight in 10s);
 *   Phosani's survives it, lashes out for 150 more hitpoints, then dies and reawakens by herself.
 */
const Common = require("./Common.Nightmare");
const Scoreboard = require("./Scoreboard.Nightmare");
const Attacks = require("./Attacks.Nightmare");
const Specials = require("./Specials.Nightmare");
const Totems = require("./Totems.Nightmare");
const Sleepwalkers = require("./Sleepwalkers.Nightmare");
const Loot = require("./Loot.Nightmare");

/** Who she has in her sights: the highest of each player's five defence bonuses, then level (Wiki). */
function defenceScore(player) {
  const { Skill } = Common.core;
  const bonuses = player.getBonusManager?.().getDefenceBonus?.() ?? [];
  const best = bonuses.slice(0, 5).reduce((max, value) => Math.max(max, Number(value) || 0), 0);
  return best * 1000 + player.getSkillManager().getCurrentLevel(Skill.DEFENCE);
}

/** Her shield (Wiki): 2,000, and 200 more for each player past five, at most 19,600; Phosani's 400. */
function shieldFor(phosani, teamSize) {
  if (phosani) return Common.data.fight.phosani.shield;
  const { base, perPlayer, max, from } = Common.data.fight.shield;
  return Math.min(max, base + perPlayer * Math.max(0, teamSize - from));
}

class Fight {
  constructor(dream) {
    this.dream = dream;
    this.phosani = dream.phosani;
    this.state = "sleeping";
    this.tick = 0;
    this.events = [];
    this.boss = null;
    this.totems = [];
    this.phase = 0;
    this.phaseCount = this.phosani ? Common.data.fight.phosani.phases : 3;
    this.sets = [];
    this.hitpoints = this.maxHitpoints();
    this.shield = 0;
    this.shieldMax = 0;
    this.stage = "asleep";
    this.nextAttackTick = Infinity;
    this.startTick = 0;
    this.teamSize = 1;
    this.curse = new Map();
    this.drowsy = new Map();
    this.parasites = new Map();
    this.frozen = new Map();
    this.flowers = null;
    this.spores = null;
    this.walkers = [];
    this.minions = new Set();
    this.hudShown = new Set();
    this.stopped = false;
    this.barriers = [];
    this.placeBarriers(Common.data.awaken.barriers.open);
    this.spawnSleeping();
  }

  maxHitpoints() {
    return this.phosani ? 3200 : Common.data.fight.hitpoints;
  }

  players() {
    return this.dream.present();
  }

  npcIds() {
    return this.phosani ? Common.data.npcs.phosani : Common.data.npcs;
  }

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  messageAll(text) {
    for (const player of this.players()) player.sendMessage(text);
  }

  // ------------------------------------------------------------------ asleep

  spawnSleeping() {
    const { arena, npcs } = Common.data;
    const ids = this.npcIds();
    this.boss = this.dream.spawn(ids.initial, arena.centre);
    if (this.boss) {
      this.boss.__nightmareFight = this;
      this.boss.setHitpointsLocked?.(true);
      this.boss.setUntargetable?.(true);
      this.boss.getMovementQueue().setBlockMovement(true).reset();
    }
    this.totems = npcs.totems.map((spec, index) => {
      const npc = this.dream.spawn(spec.dormant, spec.tile);
      if (npc) {
        npc.__nightmareFight = this;
        npc.__nightmareTotem = index;
        npc.setHitpointsLocked?.(true);
        npc.getMovementQueue().setBlockMovement(true).reset();
      }
      return { spec, npc, charge: 0, charged: false };
    });
  }

  /** The first player in starts the countdown; Phosani's dream starts at once. */
  playerArrived(player) {
    if (this.state === "sleeping") this.beginCountdown(this.phosani ? Common.data.countdown.phosani : Common.data.countdown.normal);
    if (this.state !== "sleeping" && this.state !== "waiting") this.showHud(player);
  }

  beginCountdown(steps, reawaken = false) {
    const { countdown } = Common.data;
    this.state = "waiting";
    const total = steps[0][0];
    for (const [left, seconds] of steps) {
      this.at(total - left, () => this.messageAll((reawaken ? countdown.reawaken : countdown.message).replace("[n]", seconds)));
    }
    this.at(total, () => this.awaken(reawaken));
  }

  awaken(reawaken) {
    if (this.stopped || !this.boss?.isRegistered()) return;
    const { awaken, countdown, music } = Common.data;
    this.state = "fighting";
    this.startTick = this.tick;
    this.teamSize = Math.max(1, this.players().length);
    this.phase = 0;
    this.hitpoints = this.maxHitpoints();
    if (this.phosani) this.sets = Specials.phosaniSets();
    this.boss.setNpcTransformationId(this.npcIds().initial);
    this.boss.performAnimation(Common.animation(awaken.anim));
    this.placeBarriers(awaken.barriers.fight);
    for (const player of this.players()) {
      player.sendMessage(reawaken ? countdown.reawoken : countdown.awoken);
      Common.sounds(player, awaken.sounds);
      Common.api.emitCustomEvent("music:unlock-track", { player, trackId: music.fight });
      player.getPacketSender().sendSong(music.fight);
    }
    this.at(awaken.hudTicks, () => {
      this.shieldMax = this.shieldFor(1);
      this.shield = this.shieldMax;
      for (const player of this.players()) this.showHud(player);
    });
    this.at(awaken.phaseTicks, () => this.startPhase(1));
  }

  shieldFor() {
    return shieldFor(this.phosani, this.teamSize);
  }

  /** A phase begins in its form, with its shield up and her attacks on her own timer. */
  startPhase(phase) {
    if (this.stopped || !this.boss?.isRegistered()) return;
    this.phase = phase;
    this.stage = "shield";
    this.shieldMax = this.shieldFor(phase);
    this.shield = this.shieldMax;
    this.boss.setNpcTransformationId(this.formId(phase));
    this.boss.setUntargetable?.(false);
    this.boss.getMovementQueue().setBlockMovement(false);
    Specials.startPhase(this);
    this.updateHud({ force: true });
    this.nextAttackTick = this.tick + Common.data.awaken.firstAttackTicks;
    const target = this.target();
    if (target) this.boss.getCombat().attack(target);
  }

  formId(phase) {
    if (!this.phosani) return Common.data.npcs.phases[phase - 1];
    return Common.data.npcs.phosani.sets[String(this.sets[phase - 1])];
  }

  weakFormId(phase) {
    if (!this.phosani) return Common.data.npcs.weak[phase - 1];
    return Common.data.npcs.phosani.weakSets[String(this.sets[phase - 1])];
  }

  // ------------------------------------------------------------------ each tick

  process() {
    if (this.stopped) return;
    this.tick++;
    if (this.boss?.isRegistered()) this.boss.getCombat().getLastAttack().reset();
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped) return;
    Specials.process(this);
    Sleepwalkers.process(this);
    if ((this.stage === "shield" || this.stage === "totems" || this.stage === "desperate") && this.tick >= this.nextAttackTick) {
      this.nextAttackTick = this.tick + Common.data.fight.attackSpeed;
      this.act();
    }
  }

  /** Her turn: a special when one is due, otherwise one of her standard attacks. */
  act() {
    const target = this.target();
    if (!target || !this.boss?.isRegistered()) return;
    if (this.boss.getInteractingMobile?.() !== target) this.boss.getCombat().attack(target);
    const hold = Specials.maybeSpecial(this, target);
    if (hold != null) {
      this.nextAttackTick = this.tick + hold;
      return;
    }
    if (this.stage === "desperate") return;
    Attacks.attack(this, target);
  }

  /** Per player in the dream, each tick (the area's process). */
  processPlayer(player) {
    Specials.processPlayer(this, player);
  }

  target() {
    const players = this.players().filter((player) => player.getHitpoints() > 0);
    if (players.length === 0) return null;
    return players.reduce((best, player) => (defenceScore(player) > defenceScore(best) ? player : best));
  }

  // ------------------------------------------------------------------ shield and totems

  /** Her shield breaks: she weakens and the totems wake. */
  shieldBroken() {
    if (this.stage !== "shield") return;
    this.stage = "totems";
    this.boss.setNpcTransformationId(this.weakFormId(this.phase));
    Totems.wake(this);
    this.updateHud({ force: true });
    this.messageAll(Common.data.fight.messages.shieldFails);
    for (const player of this.players()) Common.sounds(player, [Common.data.fight.shieldSound]);
  }

  /** All four charged: their blast, then the next phase or her end. */
  totemsCharged() {
    if (this.stage !== "totems") return;
    this.stage = "blast";
    const { totems, fight } = Common.data;
    Specials.interrupt(this);
    Totems.fire(this);
    this.at(totems.hitTicks, () => {
      const last = this.phase >= this.phaseCount;
      const blast = this.phosani ? Math.floor(this.maxHitpoints() / 3) : fight.blastDamage;
      const amount = last && this.phosani ? this.hitpoints - 1 : Math.min(this.hitpoints, blast);
      this.hitpoints = Math.max(this.phosani ? 1 : 0, this.hitpoints - amount);
      this.boss.showHitsplat(amount, Common.data.hud.blastSplat, this.healthBar());
      Totems.sleep(this);
      this.updateHud();
      if (last && !this.phosani) {
        this.dying();
        return;
      }
      if (last) this.messageAll(fight.messages.survives);
      this.at(totems.leaveTicks - totems.hitTicks, () => this.boss.performAnimation(Common.animation(Common.data.flowers.leaveAnim)));
      this.at(totems.blastFormTicks - totems.hitTicks, () => this.blastForm(last));
    });
  }

  /** Back as her blast form at the centre, charging while the sleepwalkers come. */
  blastForm(last) {
    if (this.stopped) return;
    const { totems, npcs } = Common.data;
    this.stage = "sleepwalkers";
    this.boss.moveTo(this.dream.tile(Common.data.arena.centre));
    this.boss.setNpcTransformationId(this.phosani ? npcs.phosani.blast : npcs.blast);
    this.boss.performAnimation(Common.animation(totems.blastFormAnim));
    this.boss.getMovementQueue().setBlockMovement(true).reset();
    this.boss.getCombat().reset?.();
    Totems.closeOverlay(this);
    this.updateHud({ force: true });
    for (const player of this.players()) Common.sounds(player, [totems.blastFormSound]);
    Sleepwalkers.summon(this, () => (last ? this.desperation() : this.startPhase(this.phase + 1)));
  }

  /** Phosani's last stand: 150 hitpoints, her claws over and over, a sleepwalker at a time. */
  desperation() {
    if (this.stopped) return;
    const { fight, npcs } = Common.data;
    this.stage = "desperate";
    this.hitpoints = fight.phosani.desperationHitpoints;
    this.boss.setNpcTransformationId(npcs.phosani.desperation);
    this.boss.setUntargetable?.(false);
    this.messageAll(fight.messages.lashes);
    this.updateHud({ force: true });
    Specials.desperation(this);
    Sleepwalkers.desperation(this);
    this.nextAttackTick = this.tick + 1;
  }

  /** A hit on her, by stage: her shield, nothing at all, or (desperate) her hitpoints. */
  hitBoss(hit) {
    const total = hit.getTotalDamage();
    const attacker = hit.getAttacker?.();
    const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
    if (this.stage === "shield") {
      if (player && Specials.heldFlowers(this, player, hit)) return;
      let left = this.shield;
      for (const part of hit.getHits()) {
        const amount = Math.min(left, part.getDamage());
        part.setDamage(amount);
        left -= amount;
        if (amount > 0) part.setSplatTypes(Common.data.hud.shieldSplat.mine, Common.data.hud.shieldSplat.others);
      }
      hit.updateTotalDamage();
      Loot.credit(this, player, "shield", this.shield - left);
      this.shield = left;
      this.boss.setDisplayedHealth({ current: this.shield, max: this.shieldMax, bar: Common.data.hud.shieldBar });
      this.updateHud();
      if (this.shield <= 0) this.shieldBroken();
      return;
    }
    if (this.stage === "desperate") {
      let left = this.hitpoints;
      for (const part of hit.getHits()) {
        const amount = Math.min(left, part.getDamage());
        part.setDamage(amount);
        left -= amount;
      }
      hit.updateTotalDamage();
      this.hitpoints = left;
      this.boss.setDisplayedHealth(this.healthBar());
      this.updateHud();
      if (this.hitpoints <= 0) this.dying();
      return;
    }
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    if (player && total >= 0) player.sendMessage(Common.data.fight.messages.noEffect);
  }

  healthBar() {
    const max = this.stage === "desperate" ? Common.data.fight.phosani.desperationHitpoints : this.maxHitpoints();
    return { current: this.hitpoints, max, bar: Common.data.hud.healthBar };
  }

  /** Healing (flowers on the wrong side, parasites): her shield, or a totem's charge back. */
  healShield(amount) {
    if (this.stage !== "shield" || amount <= 0) return;
    this.shield = Math.min(this.shieldMax, this.shield + amount);
    this.updateHud();
  }

  // ------------------------------------------------------------------ the HUD

  hudValues() {
    const { hud } = Common.data;
    const npcId = this.boss?.getNpcTransformationId?.() > 0 ? this.boss.getNpcTransformationId() : this.npcIds().initial;
    if (this.stage === "shield" || this.stage === "asleep") {
      return { npcId, current: this.shield, maximum: this.shieldMax, colours: hud.shieldColours };
    }
    const max = this.stage === "desperate" ? Common.data.fight.phosani.desperationHitpoints : this.maxHitpoints();
    return { npcId, current: this.hitpoints, maximum: max, colours: hud.healthColours };
  }

  showHud(player) {
    if (this.state !== "fighting") return;
    this.hudShown.add(player);
    Common.api.emitCustomEvent("boss-hud:show", { player, ...this.hudValues() });
    if (this.stage === "totems") Totems.openOverlay(this, player);
  }

  updateHud({ force = false } = {}) {
    const values = this.hudValues();
    for (const player of this.players()) {
      if (!this.hudShown.has(player)) {
        this.showHud(player);
        continue;
      }
      Common.api.emitCustomEvent("boss-hud:update", { player, ...values, force });
    }
  }

  hideHud(player, fade = true) {
    if (!this.hudShown.delete(player)) return;
    Common.api.emitCustomEvent("boss-hud:hide", fade ? { player } : { player, fade: false, afterTicks: 0 });
  }

  // ------------------------------------------------------------------ her end

  dying() {
    if (this.stage === "dead") return;
    const { kill, npcs } = Common.data;
    this.stage = "dead";
    Specials.interrupt(this);
    Sleepwalkers.clear(this);
    this.boss.getCombat().reset?.();
    this.boss.setUntargetable?.(true);
    this.boss.getMovementQueue().setBlockMovement(true).reset();
    const deathAt = this.phosani ? 1 : kill.deathTicks - Common.data.totems.hitTicks;
    this.at(deathAt, () => {
      this.boss.performAnimation(Common.animation(kill.deathAnim));
      this.boss.setNpcTransformationId(this.phosani ? npcs.phosani.dying : npcs.dying);
      Totems.closeOverlay(this);
      for (const player of this.players()) Common.sounds(player, kill.sounds);
    });
    this.at(deathAt + kill.lootTicks - kill.deathTicks, () => this.won());
  }

  won() {
    const { kill, npcs, varbits, music } = Common.data;
    this.state = "over";
    const ticks = this.tick - this.startTick;
    const players = this.players();
    this.boss.setNpcTransformationId(this.phosani ? npcs.phosani.dead : npcs.dead);
    this.placeBarriers(Common.data.awaken.barriers.open);
    Loot.reward(this, players);
    Scoreboard.won(this.phosani, ticks, players.length);
    for (const player of players) {
      this.count(player, ticks, players.length);
      const sender = player.getPacketSender();
      sender.sendVarbit(varbits.present, 1);
      this.hideHud(player, false);
    }
    if (this.phosani) {
      this.at(7, () => {
        this.messageAll(Common.data.countdown.begins);
        this.boss.setNpcTransformationId(npcs.phosani.initial);
        this.resetForNext();
        this.beginCountdown(Common.data.countdown.phosani, true);
      });
    } else {
      this.state = "slain";
      for (const player of players) player.getPacketSender().sendSong(music.lobby);
    }
  }

  count(player, ticks, team) {
    const { kill, varps } = Common.data;
    const key = this.phosani ? Common.PHOSANI_KILLS_ATTRIBUTE : Common.KILLS_ATTRIBUTE;
    const bestKey = this.phosani ? Common.PHOSANI_BEST_ATTRIBUTE : Common.BEST_ATTRIBUTE;
    const kills = Common.count(player, key) + 1;
    player.setAttribute(key, kills);
    player.getPacketSender().sendConfig(this.phosani ? varps.phosaniKills : varps.kills, kills);
    player.sendMessage((this.phosani ? kill.phosaniCount : kill.count).replace("[n]", kills));
    const best = Common.count(player, bestKey);
    const duration = kill.duration.replace("[team]", team === 1 ? "Solo" : String(team)).replace("[time]", Common.formatTicks(ticks));
    if (!best || ticks < best) {
      player.setAttribute(bestKey, ticks);
      Common.api.emitCustomEvent("boss:personal-best", { player, boss: this.phosani ? "Phosani's Nightmare" : "The Nightmare", ticks });
      player.sendMessage(duration + kill.best);
    } else {
      player.sendMessage(duration + kill.personalBest.replace("[time]", Common.formatTicks(best)));
    }
    const monster = this.phosani ? "Phosani's Nightmare" : "The Nightmare";
    Common.api.emitCustomEvent("combat-achievements:kill", { player, monster, count: kills });
    Common.api.emitCustomEvent("collection-log:count", { player, category: "The Nightmare" });
  }

  /** Disturb on her body after a kill: the next fight, in 10 seconds (Wiki). */
  disturbAgain() {
    if (this.state !== "slain") return;
    this.boss.setNpcTransformationId(Common.data.npcs.initial);
    this.resetForNext();
    this.beginCountdown(Common.data.countdown.phosani, true);
  }

  resetForNext() {
    this.phase = 0;
    this.stage = "asleep";
    this.hitpoints = this.maxHitpoints();
    this.shield = 0;
    this.boss.moveTo(this.dream.tile(Common.data.arena.centre));
    for (const totem of this.totems) totem.charge = 0;
  }

  // ------------------------------------------------------------------ the dream's doors

  placeBarriers(id) {
    const { GameObject, ObjectManager } = Common.core;
    for (const object of this.barriers) ObjectManager.deregister(object, false);
    this.barriers = Common.data.awaken.barriers.tiles.map(([x, y, z, rotation]) => {
      const object = new GameObject(id, this.dream.tile([x, y, z]), 10, rotation, this.dream.area);
      ObjectManager.register(object, true);
      return object;
    });
  }

  playerLeft(player) {
    this.hideHud(player, false);
    Specials.playerLeft(this, player);
    if (this.state === "fighting" && this.players().length === 0) this.stop();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.events = [];
    Specials.interrupt(this);
    Sleepwalkers.clear(this);
  }
}

// ------------------------------------------------------------------ hooks

/** Opens a dream's fight and drives it from a tick task of its own. */
function open(dream) {
  const fight = new Fight(dream);
  dream.fight = fight;
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (fight.stopped || dream.ended) {
        this.stop();
        return;
      }
      fight.process();
    }
  })());
  return fight;
}

const fightOf = (npc) => npc?.__nightmareFight ?? null;

/** Her combat: the fight times her attacks; the engine only walks her after her target. */
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class NightmareCombat extends CombatMethod {
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

/** Husks, parasites and sleepwalkers fight on the fight's timers, never the engine's. */
function minionClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class NightmareMinionCombat extends CombatMethod {
    start() {}

    hits() {
      return [];
    }

    attackSpeed() {
      return 100;
    }

    attackDistance() {
      return 64;
    }

    canAttack() {
      return false;
    }

    type() {
      return CombatType.MAGIC;
    }
  };
}

const CRUSH = 2;

/** Phosani's husks and weakened parasites always take a crush weapon's max hit (Wiki). */
function crushOnMinions(event) {
  const { attacker, target } = event;
  const fight = fightOf(target);
  if (!fight?.phosani || !attacker?.isPlayer?.()) return;
  const weakParasite = target.__nightmareParasite?.weak === true;
  if (!target.__nightmareHusk && !weakParasite) return;
  if (attacker.getAsPlayer().getFightType?.()?.getBonusType?.() !== CRUSH) return;
  event.forceAccurate = true;
  event.forceMaxHit = true;
}

function modifyHit({ npc, hit }) {
  const fight = fightOf(npc);
  if (!fight) return;
  if (npc === fight.boss) fight.hitBoss(hit);
  else if (Number.isInteger(npc.__nightmareTotem)) Totems.hit(fight, npc, hit);
}

/** Totems are charged only while they're ready; the blast form can't be touched. */
function canAttack(event) {
  const { attacker, target } = event;
  const fight = fightOf(target);
  if (!fight || !attacker?.isPlayer?.()) return;
  if (Number.isInteger(target.__nightmareTotem)) {
    const totem = fight.totems[target.__nightmareTotem];
    if (fight.stage !== "totems" || totem.charged) {
      if (totem.charged) attacker.getAsPlayer().sendMessage(Common.data.fight.messages.totemCharged);
      event.allow = false;
    }
  }
}

function disturbBody({ player, npc }) {
  const fight = fightOf(npc);
  if (!fight) return false;
  if (require("./Dream.Nightmare").dreamOf(player) !== fight.dream) return true;
  fight.disturbAgain();
  return true;
}

function attachFight(api) {
  api.persistAttribute(Common.KILLS_ATTRIBUTE);
  api.persistAttribute(Common.PHOSANI_KILLS_ATTRIBUTE);
  api.persistAttribute(Common.BEST_ATTRIBUTE);
  api.persistAttribute(Common.PHOSANI_BEST_ATTRIBUTE);
  const { npcs } = Common.data;
  const forms = [
    npcs.initial, ...npcs.phases, ...npcs.weak, npcs.blast, npcs.dying, npcs.dead,
    npcs.phosani.initial, ...Object.values(npcs.phosani.sets), ...Object.values(npcs.phosani.weakSets),
    npcs.phosani.desperation, npcs.phosani.blast, npcs.phosani.dying, npcs.phosani.dead,
  ];
  const method = combatClass();
  for (const id of forms) api.registerNpcCombatMethodProvider(id, method);
  const minion = minionClass();
  const minions = [
    npcs.husks.magic, npcs.husks.ranged, npcs.parasite, npcs.parasiteWeak, ...npcs.sleepwalkers,
    npcs.phosani.husks.magic, npcs.phosani.husks.ranged, npcs.phosani.parasite, npcs.phosani.parasiteWeak, npcs.phosani.sleepwalker,
  ];
  for (const id of minions) api.registerNpcCombatMethodProvider(id, minion);
  api.registerNpcCombatOption("Charge");
  api.onNpcHitModify(modifyHit);
  api.onCombatHitRoll(crushOnMinions);
  api.onCanAttack(canAttack);
  api.onNpcInteraction("Phosani's Nightmare", { Disturb: disturbBody });
}

module.exports = { attachFight, open, fightOf, disturbBody, shieldFor, Fight };
