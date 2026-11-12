const Common = require("./Common.Leviathan");
const Model = require("./Model.Leviathan");
const { Hazards } = require("./Hazards.Leviathan");
const Achievements = require('./Achievements.Leviathan');

class Fight {
  constructor(session) {
    this.session = session; this.player = session.player; this.awakened = session.awakened;
    this.stats = Common.data[this.awakened ? "awakened" : "normal"];
    this.normalKillsAtStart = Common.normalKills(this.player);
    this.tick = 0; this.events = []; this.pendingDamage = new Set(); this.tier = 0; this.shots = 0; this.stuns = 0; this.volleyEpoch = 0;
    this.bites = 0; this.volleyRoars = 0;
    this.stunnedUntil = 0; this.special = null; this.nextSpecial = Common.pick(["lightning", "smoke"]);
    this.enraged = false; this.perfect = true; this.over = false; this.stopped = false;
    this.rewarded = false; this.nextAttack = Common.data.inferred.firstAttackTicks;
    this.startCycle = Common.core.World.getProcessCycle();
    this.hazards = new Hazards(this);
    Achievements.begin(this);
  }
  at(ticks, action) { this.events.push({ at: this.tick + Math.max(1, ticks), action }); }
  alive() { return !this.over && !this.stopped && !this.session.ended && this.session.fight === this && this.boss?.isRegistered() && this.boss.getHitpoints() > 0 && this.player.getHitpoints() > 0; }
  start() {
    const boss = this.session.spawn(Common.ids.npcs.boss, Common.data.arena.boss);
    if (!boss) { this.stopped = true; return; }
    this.boss = boss; boss.__leviathanFight = this; boss.__skipDefaultRespawn = true;
    boss.setFlag('combat:no-regen');
    boss.setMaxHitpoints(this.stats.hitpoints); boss.setHitpoints(this.stats.hitpoints);
    const stats = [...boss.getDefinition().getStats()];
    [stats[0], stats[1], stats[2], stats[3], stats[4]] = [this.stats.attack, this.stats.strength, this.stats.defence, this.stats.ranged, this.stats.magic];
    boss.setCombatOverride({ stats, maxHit: Common.data.damage.melee });
    boss.setStatDrainImmune(this.awakened);
    boss.setScriptedMovement(true); boss.getMovementQueue().setBlockMovement(true);
    boss.setPositionToFace(this.player.getLocation());
    Common.animate(boss, "spawn");
    Achievements.observe(this);
    Common.api.emitCustomEvent("boss-hud:show", { player: this.player, npcId: Common.ids.npcs.boss, current: this.stats.hitpoints, maximum: this.stats.hitpoints });
  }
  process() {
    if (this.stopped) return;
    this.tick++;
    const due = this.events.filter(e => e.at <= this.tick);
    this.events = this.events.filter(e => e.at > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (!this.alive()) return;
    Achievements.observe(this);
    if (!this.enraged && this.boss.getHitpoints() <= this.stats.hitpoints * 0.2) this.enterEnrage();
    this.hazards.process();
    if (this.enraged && this.tick >= this.nextEnrageDebris) {
      this.hazards.roar();
      this.nextEnrageDebris = this.tick + 8;
    }
    Common.api.emitCustomEvent("boss-hud:update", { player: this.player, current: this.boss.getHitpoints() });
    if (this.stunnedUntil) {
      if (this.tick < this.stunnedUntil) return;
      this.stunnedUntil = 0;
      if (!this.awakened) this.boss.performAnimation(Common.core.Animation.DEFAULT_RESET_ANIMATION);
      this.nextAttack = this.tick + Model.volley(this.tier, this.awakened).interval;
    }
    if (this.special || this.tick < this.nextAttack) return;
    this.boss.setPositionToFace(this.player.getLocation());
    // Ordinary GM footage explicitly limits the initial bite to one attempt,
    // lifting that limit after the third normal roar. The counter survives
    // stuns/tier resets; enrage and disabled awakened retain their prior path.
    const canBite = this.awakened || this.enraged || this.bites < Common.data.normalBite.earlyLimit ||
      this.volleyRoars >= Common.data.normalBite.unlockAfterRoars;
    if (canBite && this.hazards.nearPool()) {
      if (!this.awakened) this.bites++;
      Common.animate(this.boss, "bite");
      this.session.biteTails?.();
      if (!Common.protectedFrom(this.player, "melee")) {
        const amount = Common.random(0, Common.data.damage.melee);
        if (this.awakened) Common.damage(this, amount);
        else Common.biteDamage(this, amount);
      }
      this.nextAttack = this.tick + (this.enraged ? this.stats.enrageInterval : Model.volley(this.tier, this.awakened).interval);
      return;
    }
    const pattern = this.enraged ? { interval: this.stats.enrageInterval, styles: ["magic", "ranged"], flight: 5 } : Model.volley(this.tier, this.awakened);
    this.orb(Common.pick(pattern.styles), pattern.flight);
    this.nextAttack = this.tick + pattern.interval;
    if (!this.enraged && ++this.shots >= pattern.shots) {
      this.shots = 0;
      const epoch = this.volleyEpoch;
      this.at(pattern.interval, () => {
        if (!this.alive() || this.volleyEpoch !== epoch || this.enraged || this.stunnedUntil || this.special) return;
        this.roar(); this.tier = Math.min(6, this.tier + 1);
      });
      this.nextAttack += pattern.recoveryTicks;
    }
  }
  orb(style, flight) {
    if (!this.alive()) return;
    const interval = this.enraged ? this.stats.enrageInterval : Model.volley(this.tier, this.awakened).interval;
    const startup = interval > 1 || !this.shots;
    Common.animate(this.boss, startup ? "orbStart" : "orbLoop");
    Common.projectile(this, style, flight, startup);
    const epoch = this.volleyEpoch;
    if (interval > 1) this.at(1, () => {
      if (this.alive() && this.volleyEpoch === epoch && !this.stunnedUntil && !this.special) Common.animate(this.boss, "orb");
    });
    this.at(flight, () => {
      if (!this.alive()) return;
      this.player.performGraphic(Common.graphic(`${style}Impact`));
      const pierces = this.enraged && this.hazards.pathReady() && !this.hazards.inAura();
      if (pierces || !Common.protectedFrom(this.player, style)) Common.damage(this, Common.random(0, Common.data.damage[style]));
    });
  }
  roar() {
    if (!this.alive()) return;
    if (!this.awakened && !this.enraged) this.volleyRoars++;
    this.volleyEpoch++;
    Common.animate(this.boss, "roar");
    this.at(1, () => { if (this.alive()) Common.damage(this, Common.random(0, Common.data.damage.roar), false); });
    this.hazards.roar();
  }
  stun() {
    if (!this.alive() || this.enraged || this.special || this.stunnedUntil > this.tick) return false;
    this.stuns++;
    this.volleyEpoch++;
    this.stunFace = Model.facing(Common.data.arena.centre, this.hazards.playerTile());
    this.stunHealth = this.boss.getHitpoints();
    this.stunnedUntil = this.tick + this.stats.stunTicks;
    Common.animate(this.boss, "stun");
    if (!this.awakened) {
      const epoch = this.volleyEpoch;
      // Cache reaction 10282 lasts ninety client cycles. The filmed back stays
      // exposed afterward; use its native idle until expiry or punishment.
      this.at(3, () => {
        if (this.alive() && this.volleyEpoch === epoch && this.stunnedUntil > this.tick && !this.special)
          Common.animate(this.boss, 'stunIdle');
      });
    }
    this.player.getCombat().setAttackDelay(0);
    return true;
  }
  beginSpecial() {
    if (!this.alive() || this.enraged) return;
    this.special = this.nextSpecial;
    this.nextSpecial = this.special === "lightning" ? "smoke" : "lightning";
    this.hazards[this.special]();
  }
  endSpecial() {
    this.special = null;
    this.nextAttack = this.tick + (this.enraged ? this.stats.enrageInterval : Model.volley(this.tier, this.awakened).interval);
  }
  enterEnrage() {
    this.enraged = true; this.stunnedUntil = 0; this.shots = 0;
    this.volleyEpoch++;
    // Smoke already in progress must resolve. Other outstanding impacts remain in flight.
    if (this.special !== "smoke") this.special = null;
    this.at(3, () => { if (this.alive()) this.hazards.spawnPathfinder(); });
    this.roar();
    this.nextEnrageDebris = this.tick + 8;
    this.nextAttack = this.tick + 5;
    // rsprox 227/00100.txt:77699 (and 227/00555, 00550, 01750): the enrage's game message.
    this.player.sendMessage("<col=ff289d>The Leviathan focuses on you intensely...</col>");
  }
  afterDamage(taken, rear) {
    if (!this.alive() || !taken || !this.stunnedUntil) return;
    if (rear || this.stunHealth - this.boss.getHitpoints() >= this.stats.hitpoints * 0.25) {
      this.stunnedUntil = 0; this.tier = Model.resetTier(this.stuns); this.shots = 0;
      this.beginSpecial();
    }
  }
  fell() {
    if (this.over || this.stopped) return;
    // Snapshot before Slayer's death hook can consume the last assignment.
    Achievements.observe(this);
    this.over = true; this.finishedTicks = Math.max(1, Common.core.World.getProcessCycle() - this.startCycle);
    Achievements.end(this);
    this.events = []; this.cancelDamage(); this.hazards.clear();
    Common.api.emitCustomEvent("boss-hud:hide", { player: this.player, fade: false, afterTicks: 0 });
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.events = []; this.cancelDamage(); this.hazards.clear();
    Achievements.end(this);
    if (this.boss?.isRegistered()) {
      if (this.boss.getPrivateArea() === this.session.area) this.session.area.remove(this.boss);
      Common.api.removeNpc(this.boss);
    }
    Common.api.emitCustomEvent("boss-hud:hide", { player: this.player, fade: false, afterTicks: 0 });
  }
  cancelDamage() {
    for (const hit of this.pendingDamage) hit.setDamage(0);
    this.pendingDamage.clear();
  }
}
const own = npc => npc?.__leviathanFight ?? null;
function shadowSpell(spell) {
  return Common.shadowSpell(spell);
}
function magicHit({ attacker, target, spell }) {
  const fight = own(target);
  if (fight && attacker === fight.player && shadowSpell(spell)) fight.stun();
}
function hitRoll(event) {
  const fight = own(event.target);
  if (!fight?.alive() || event.attacker !== fight.player) return;
  const { CombatType } = Common.core;
  const spell = event.attacker.getCombat().getCastSpell() ?? event.attacker.getCombat().getSelectedSpell();
  if (!fight.enraged && !fight.special && event.combatType === CombatType.MAGIC && shadowSpell(spell)) event.forceAccurate = true;
  const rear = fight.stunnedUntil > fight.tick && Model.behind(Common.data.arena.centre, fight.stunFace, fight.hazards.playerTile());
  if (event.combatType === CombatType.RANGED && (rear || fight.enraged && fight.hazards.inAura())) event.forceAccurate = true;
}
function modifyHit({ npc, hit }) {
  const fight = own(npc);
  if (!fight?.alive() || hit.getAttacker() !== fight.player) return;
  const type = hit.getCombatType(), { CombatType, DamageFormulas } = Common.core;
  const stunned = fight.stunnedUntil > fight.tick;
  const rear = stunned && Model.behind(Common.data.arena.centre, fight.stunFace, fight.hazards.playerTile());
  const aura = fight.enraged && fight.hazards.inAura();
  const maximum = DamageFormulas.sourceMaxHit(fight.player, type);
  for (const part of hit.getHits()) {
    let damage = part.getDamage();
    if (type === CombatType.RANGED && (rear || aura)) damage = Math.max(damage, Math.floor(maximum * (rear ? 0.65 : 0.2)));
    if (type === CombatType.MAGIC && (rear || aura)) damage *= 2;
    if (stunned && !rear) damage = Math.min(10, damage);
    if (fight.special) damage = Math.floor(damage * 2 / 3);
    part.setDamage(damage);
    part.onApplied(taken => fight.afterDamage(taken, rear));
  }
  hit.updateTotalDamage();
}
function beforeDeath({ npc }) { own(npc)?.fell(); }
function canAttack(event) {
  const fight = own(event.target);
  if (!fight) return;
  if (event.attacker !== fight.player || !fight.alive()) { event.allow = false; return; }
  if (event.method?.type?.() === Common.core.CombatType.MELEE) {
    event.allow = false;
    fight.player.sendMessage("Your melee attacks can't reach the lure!");
  }
}
function eligibility(request) { if (own(request.npc)?.awakened) request.eligible = false; }
function combatClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class LeviathanCombat extends CombatMethod {
    type() { return CombatType.MAGIC; }
    hits() { return []; }
    start() {}
  };
}
function attach(api) {
  Achievements.attach(api);
  api.registerNpcCombatMethodProvider(Common.ids.npcs.boss, combatClass());
  api.onCombatHitRoll(hitRoll);
  api.onNpcHitModify(modifyHit);
  api.onNpcBeforeDeath(beforeDeath);
  api.onCanAttack(canAttack);
  api.onCustomEvent("magic:hit-effects", magicHit);
  api.onCustomEvent("slayer:target-eligible", eligibility);
}
module.exports = { Fight, attach, own };
