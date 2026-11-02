/**
 * One fight with Nex, in the public chamber or a private one (an arena: Chamber.Nex or
 * Instance.Nex), as captured (docs/nex.md):
 * - "AT LAST!": she appears in her spawning form and calls her four mages one by one, then "Fill my
 *   soul with smoke!" begins the smoke phase; she can't be hurt until her first attack.
 * - Five phases (smoke, shadow, blood, ice, Zaros). At 80/60/40/20% she calls the phase's mage
 *   ("Fumus, don't fail me!"), who becomes vulnerable; she still takes damage down to 75/55/35/15%,
 *   then nothing until the mage dies, and the next phase begins a tick after its death.
 * - An attack every 4 ticks (Attacks.Nex); every 6th is a special (Specials.Nex), the phase's
 *   first coming 4 ticks after its line. The Zaros phase heals her 500 and cycles her curses.
 * - At 0 hitpoints, Wrath: "Taste my wrath!", the blast four ticks later and its damage with the
 *   loot three ticks after that.
 */
const Common = require("./Common.Nex");
const Attacks = require("./Attacks.Nex");
const Specials = require("./Specials.Nex");

const SIZE = 3;
const BOSS_NAME = "Nex";

class Fight {
  /**
   * `arena`: { area, tile([x,y,z]), real(location) -> [x, y], inChamber(location), players(),
   * spawn(id, tile), spawnAt(id, location), ended(fight, killed) } - Chamber.Nex or Instance.Nex.
   */
  constructor(arena) {
    const { fight } = Common.data;
    this.arena = arena;
    this.tick = 0;
    this.events = [];
    this.stage = "spawning";
    this.phaseIndex = 0;
    this.boss = null;
    this.mages = new Map();
    this.vulnerable = new Set();
    this.reavers = [];
    this.contribution = new Map();
    this.hudShown = new Set();
    this.musicPlayers = new Set();
    this.nextAttackTick = Infinity;
    this.lastAttackTick = 0;
    this.autosSinceSpecial = 0;
    this.specialDue = false;
    this.lane = 0;
    this.target = null;
    this.attacksOnTarget = 0;
    this.meleeChain = 0;
    this.noMeleeNext = false;
    this.curse = { form: null, attacks: 0, index: -1 };
    this.immuneUntil = 0;
    this.busyUntil = 0;
    this.siphonUntil = 0;
    this.hitpoints = fight.hitpoints;
    this.deaths = 0;
    this.startPlayers = 0;
    /** What the Combat Achievements judge: per player, the hits they took from each special. */
    this.record = { siphonHealed: false, hitBy: new Map(), coughing: new Set() };
    this.stopped = false;
    this.effects = new Specials.Effects(this);
    this.spawn();
  }

  // ------------------------------------------------------------------ helpers

  /** Runs `action` `ticks` ticks into the fight. */
  at(ticks, action) {
    this.events.push({ tick: this.tick + Math.max(1, ticks), action });
  }

  players() {
    return this.arena.players();
  }

  phase() {
    return Common.data.fight.phases[this.phaseIndex];
  }

  /** The phase's key, for Peek: null before her smoke phase. */
  phaseName() {
    return this.stage === "spawning" ? null : this.phase().key;
  }

  tile(tile) {
    return this.arena.tile(tile);
  }

  centre() {
    return this.boss.getLocation().transform(1, 1);
  }

  distanceTo(player) {
    return Common.distanceToBody(player.getLocation(), this.boss.getLocation(), SIZE);
  }

  say(text) {
    Common.say(this.boss, this.players(), text);
  }

  areaSound(entry, location = this.centre()) {
    const [id, delay, range] = Array.isArray(entry) ? entry : [entry, 0, 7];
    Common.areaSound(this.players(), location, [id, delay ?? 0, range ?? 7]);
  }

  messageAll(text) {
    for (const player of this.players()) player.sendMessage(text);
  }

  form() {
    const id = this.boss?.getNpcTransformationId?.() ?? -1;
    return id > 0 ? id : Common.data.npcs.spawning;
  }

  transform(id) {
    this.boss.setNpcTransformationId(id);
    this.updateHud({ force: true });
  }

  isMage(npc) {
    return npc?.__nexFight === this && npc.__nexMage != null;
  }

  isImmuneMage(npc) {
    return this.isMage(npc) && !this.vulnerable.has(npc.__nexMage);
  }

  /** Damage to Nex, her mages and the reavers is each player's share (Wiki). */
  credit(player, amount) {
    if (!player || amount <= 0) return;
    this.contribution.set(player, (this.contribution.get(player) ?? 0) + amount);
  }

  /** A player was hit by a special (the Combat Achievements' "no damage from" tasks). */
  noteHit(player, special, amount) {
    if (amount <= 0) return;
    const hits = this.record.hitBy.get(player) ?? new Set();
    hits.add(special);
    this.record.hitBy.set(player, hits);
  }

  // ------------------------------------------------------------------ the spawn

  /** "AT LAST!": her spawning form in the middle, the music and the HUD; then the mages. */
  spawn() {
    const { npcs, chamber, spawn, music } = Common.data;
    this.boss = this.arena.spawn(npcs.spawning, chamber.nexTile);
    if (!this.boss) {
      this.stop();
      return;
    }
    this.boss.faceTile(this.tile(chamber.entry));
    this.boss.__nexFight = this;
    this.boss.setFlag("combat:no-retaliate");
    // Her attacks are the fight's, so the engine would think her idle and regenerate her.
    this.boss.setFlag("combat:no-regen");
    // She faces her target at any range (her spells reach 10 tiles; the engine lets go sooner).
    this.boss.setFlag("interaction:keep");
    this.boss.setHitpoints(this.hitpoints);
    this.boss.getMovementQueue().setBlockMovement(false).reset();
    this.baseDefence = this.boss.getDefenceLevel?.() ?? null;
    this.boss.performAnimation(Common.animation(spawn.anim));
    this.areaSound(spawn.sound);
    this.say(spawn.say);
    for (const player of this.players()) {
      Common.api.emitCustomEvent("music:unlock-track", { player, trackId: music.fight });
      Common.api.emitCustomEvent("music:unlock-track", { player, trackId: music.blood });
      this.playSong(player, music.fight);
      this.showHud(player);
    }
    this.startPlayers = this.players().length;
    for (const call of spawn.calls) this.at(call.tick, () => this.callMage(call));
    this.at(spawn.fillTick, () => this.fill());
  }

  /** "Fumus!": she turns to the corner and the mage appears there, sending her its power. */
  callMage(call) {
    const { chamber, spawn } = Common.data;
    const corner = chamber.mages[call.mage];
    this.say(`${call.mage[0].toUpperCase()}${call.mage.slice(1)}!`);
    this.boss.performAnimation(Common.animation(call.anim));
    this.areaSound(call.sound);
    const at = this.tile(corner.tile);
    this.boss.faceTile(at);
    const mage = this.arena.spawn(Common.data.npcs.mages[call.mage], corner.tile);
    if (!mage) return;
    mage.faceTile(this.centre());
    mage.__nexFight = this;
    mage.__nexMage = call.mage;
    mage.setFlag("combat:no-regen");
    mage.getMovementQueue().setBlockMovement(true).reset();
    mage.performGraphic(Common.graphic(spawn.mageArrival.graphic));
    mage.performAnimation(Common.animation(spawn.mageArrival.anim));
    this.areaSound(spawn.mageArrival.sound, mage.getLocation());
    this.mages.set(call.mage, mage);
    this.sendPower(mage);
  }

  /** A mage's power, sent to her on its arrival and on its phase's line. */
  sendPower(mage) {
    const { power } = Common.data.spawn;
    if (!mage?.isRegistered?.()) return;
    mage.performAnimation(Common.animation(Common.data.spawn.mageArrival.anim));
    Common.projectile(mage, this.boss, power);
    this.areaSound(power.sound, mage.getLocation());
  }

  /** "Fill my soul with smoke!": her fighting form; the smoke phase opens with her first attack. */
  fill() {
    const { npcs, spawn } = Common.data;
    this.transform(npcs.nex);
    this.stage = "fighting";
    this.immuneUntil = this.tick + (spawn.firstAttackTick - spawn.fillTick);
    this.startPhase(0, spawn.firstAttackTick - spawn.fillTick);
  }

  // ------------------------------------------------------------------ phases

  /** A phase's line, its mage's power, and a special `delay` ticks later. */
  startPhase(index, delay = Common.data.fight.specialAfterPhaseTicks) {
    this.phaseIndex = index;
    const phase = this.phase();
    this.say(phase.line);
    if (phase.mage) this.sendPower(this.mages.get(phase.mage));
    this.autosSinceSpecial = 0;
    this.meleeChain = 0;
    this.noMeleeNext = false;
    this.specialDue = phase.specials.length > 0;
    // The phase opens in the lane of the last special (captured: the virus leads to the darkness,
    // the dash to the smash).
    this.lane = this.lastLane ?? 0;
    this.nextAttackTick = this.tick + delay;
    if (phase.key === "blood") for (const player of this.players()) this.playSong(player, Common.data.music.blood);
    if (phase.key === "zaros") this.zaros();
  }

  /** "NOW, THE POWER OF ZAROS!": 500 hitpoints back; her curses start with her first attack. */
  zaros() {
    const { zaros, fight } = Common.data;
    this.boss.performAnimation(Common.animation(zaros.anim));
    this.boss.performGraphic(Common.graphic(zaros.graphic));
    Common.healNpc(this.boss, zaros.heal, fight.hitpoints);
    this.curse = { form: null, attacks: 0, index: -1 };
  }

  /** At the phase's line her mage becomes vulnerable. */
  checkCall() {
    const phase = this.phase();
    if (!phase.mage || this.vulnerable.has(phase.mage) || !this.mages.has(phase.mage)) return;
    if (this.boss.getHitpoints() > Math.floor(Common.data.fight.hitpoints * phase.call)) return;
    const mage = this.mages.get(phase.mage);
    this.vulnerable.add(phase.mage);
    this.say(Common.data.fight.callLine.replace("[name]", mage.getCurrentDefinition().getName()));
    const target = Common.pick(this.players().filter((player) => player.getHitpoints() > 0));
    if (target) mage.getCombat().attack(target);
  }

  /** The phase's mage died: the next phase's line a tick later (captured). */
  mageDied(key) {
    const mage = this.mages.get(key);
    this.mages.delete(key);
    this.vulnerable.delete(key);
    if (mage) Common.later(Common.data.fight.mageRemoveTicks, () => mage.isRegistered?.() && Common.api.removeNpc(mage));
    if (this.stage !== "fighting" || this.phase().mage !== key) return;
    const next = this.phaseIndex + 1;
    this.stage = "switching";
    Specials.phaseEnded(this, this.phase().key);
    this.nextAttackTick = Infinity;
    this.at(Common.data.fight.nextPhaseTicks, () => {
      if (this.stage !== "switching") return;
      this.stage = "fighting";
      this.startPhase(next);
    });
  }

  /** Wiki: her Defence can be lowered by 10 levels at most. */
  capDefenceDrain() {
    if (this.baseDefence == null || !this.boss.getDefenceLevel) return;
    const floor = this.baseDefence - Common.data.fight.maxDefenceDrain;
    if (this.boss.getDefenceLevel() < floor) this.boss.setDefenceLevel(floor);
  }

  // ------------------------------------------------------------------ each tick

  process() {
    if (this.stopped) return;
    this.tick++;
    const due = this.events.filter((event) => event.tick <= this.tick);
    this.events = this.events.filter((event) => event.tick > this.tick);
    for (const event of due) if (!this.stopped) event.action();
    if (this.stopped) return;
    const players = this.players();
    if (players.length === 0 && this.stage !== "dying") {
      this.end(false);
      return;
    }
    if (this.stage !== "dying") {
      for (const player of players) if (!this.hudShown.has(player)) this.showHud(player);
      this.updateHud();
    }
    this.effects.process(players);
    if (this.stage !== "fighting") return;
    this.checkCall();
    this.capDefenceDrain();
    if (this.tick >= this.busyUntil) this.pickTarget(players);
    this.move();
    if (this.tick >= this.nextAttackTick) this.act();
  }

  /** Her turn: a special when one is due, otherwise her attack (Attacks.Nex). */
  act() {
    const { fight } = Common.data;
    this.nextAttackTick = this.tick + fight.attackSpeed;
    const phase = this.phase();
    if (phase.specials.length > 0 && (this.specialDue || this.autosSinceSpecial >= fight.specialEvery - 1)) {
      const name = phase.specials[this.lane % phase.specials.length];
      const hold = Specials.run(this, name);
      if (hold != null) {
        this.specialDue = false;
        this.autosSinceSpecial = 0;
        this.lastLane = this.lane;
        this.lane = (this.lane + 1) % phase.specials.length;
        this.nextAttackTick = this.tick + hold;
        this.lastAttackTick = this.tick;
        return;
      }
    }
    if (Attacks.attack(this, this.target)) {
      this.lastAttackTick = this.tick;
      this.autosSinceSpecial++;
      this.attacksOnTarget++;
      if (phase.key === "zaros") this.rotateCurse();
    }
  }

  /** Zaros: Soul Split on her first attack, Deflect Melee 4 attacks later, then none, and round (Wiki). */
  rotateCurse() {
    const { npcs, zaros } = Common.data;
    const forms = [npcs.soulSplit, npcs.deflect, npcs.nex];
    if (this.curse.index >= 0 && ++this.curse.attacks < zaros.curseEvery) return;
    this.curse.attacks = 0;
    this.curse.index = (this.curse.index + 1) % forms.length;
    this.curse.form = forms[this.curse.index];
    this.transform(this.curse.form);
    if (this.curse.form === npcs.soulSplit) this.areaSound(zaros.curseSound);
  }

  // ------------------------------------------------------------------ targeting and movement

  /** The nearest player in range, not the last target if anyone else will do (Wiki). */
  pickTarget(players) {
    const { fight } = Common.data;
    const alive = players.filter((player) => player.getHitpoints() > 0);
    const keep = this.target && alive.includes(this.target) && this.attacksOnTarget < fight.retargetEvery;
    if (keep) return;
    const inRange = alive.filter((player) => this.distanceTo(player) <= fight.magicRange);
    const pool = inRange.length > 0 ? inRange : alive;
    const candidates = pool.length > 1 ? pool.filter((player) => player !== this.target) : pool;
    let best = [];
    let bestDistance = Infinity;
    for (const player of candidates) {
      const distance = this.distanceTo(player);
      if (distance < bestDistance) {
        best = [player];
        bestDistance = distance;
      } else if (distance === bestDistance) {
        best.push(player);
      }
    }
    this.target = best.length > 0 ? Common.pick(best) : null;
    this.attacksOnTarget = 0;
    if (this.target) this.boss.setMobileInteraction(this.target);
  }

  /** She closes in while her target is out of reach, and flies to it when she can't attack (captured). */
  move() {
    const { fight } = Common.data;
    const target = this.target;
    if (!target || this.tick < this.busyUntil || this.tick < this.immuneUntil) return;
    if (this.tick - this.lastAttackTick >= fight.flyAfterTicks) {
      this.fly(target);
      return;
    }
    if (this.distanceTo(target) <= fight.magicRange && this.distanceTo(target) > 0) return;
    const { RegionManager } = Common.core;
    const from = this.boss.getLocation();
    const dx = Math.sign(target.getLocation().getX() - (from.getX() + 1));
    const dy = Math.sign(target.getLocation().getY() - (from.getY() + 1));
    for (const [x, y] of [[dx, dy], [dx, 0], [0, dy]]) {
      if (x === 0 && y === 0) continue;
      if (!RegionManager.canMove(from.getX(), from.getY(), from.getX() + x, from.getY() + y, from.getZ(), SIZE, SIZE, this.arena.area)) continue;
      const movement = this.boss.getMovementQueue();
      movement.reset();
      movement.addSteps(from.transform(x, y));
      return;
    }
  }

  /** seq 9187 and a 30-cycle glide to beside her target (captured); hits do nothing meanwhile (Wiki). */
  fly(target) {
    const { fight } = Common.data;
    this.lastAttackTick = this.tick;
    this.immuneUntil = this.tick + 2;
    this.nextAttackTick = Math.max(this.nextAttackTick, this.tick + 3);
    const destination = this.landingNear(target) ?? this.tile(Common.data.chamber.nexTile);
    this.boss.performAnimation(Common.animation(fight.flyAnim));
    this.boss.getMovementQueue().reset();
    this.boss.exactMove(destination, { startCycles: 0, endCycles: fight.flyCycles });
  }

  /** A free spot for her 3x3 body next to the player, inside the chamber. */
  landingNear(player) {
    const { RegionManager } = Common.core;
    const at = player.getLocation();
    const options = [[1, -1], [-3, -1], [-1, 1], [-1, -3], [1, 1], [-3, -3], [1, -3], [-3, 1]];
    for (const [dx, dy] of options) {
      const base = at.transform(dx, dy);
      if (!this.arena.inChamber(base) || !this.arena.inChamber(base.transform(2, 2))) continue;
      let free = true;
      for (let x = 0; x < SIZE && free; x++) {
        for (let y = 0; y < SIZE && free; y++) {
          free = !RegionManager.blocked(base.transform(x, y), this.arena.area);
        }
      }
      if (free) return base;
    }
    return null;
  }

  // ------------------------------------------------------------------ hits on her

  /** A hit on her, by the fight's rules. */
  hitBoss(hit) {
    const { fight, npcs, zaros } = Common.data;
    const attacker = hit.getAttacker?.();
    const player = attacker?.isPlayer?.() ? attacker.getAsPlayer() : null;
    const total = hit.getTotalDamage();
    const zero = () => {
      for (const part of hit.getHits()) part.setDamage(0);
      hit.updateTotalDamage();
    };
    if (this.stage === "spawning" || this.stage === "dying" || this.stage === "ended" || this.tick < this.immuneUntil) {
      zero();
      if (player && this.stage !== "dying") player.sendMessage(fight.immune);
      return;
    }
    this.areaSound(fight.hitSound);
    if (this.tick < this.siphonUntil && total > 0) {
      zero();
      Common.healNpc(this.boss, total, fight.hitpoints);
      this.record.siphonHealed = true;
      return;
    }
    const phase = this.phase();
    if (phase.key === "zaros") {
      const { CombatType } = Common.core;
      if (this.form() === npcs.deflect && hit.getCombatType?.() === CombatType.MELEE && total > 0) {
        zero();
        if (player) {
          Common.damage(player, Math.floor(total * zaros.deflectShare));
          player.sendMessage(fight.messages.deflect);
        }
        return;
      }
    } else {
      // Down to the phase's floor, then nothing until its mage dies.
      const floor = Math.floor(fight.hitpoints * phase.floor);
      const room = Math.max(0, this.boss.getHitpoints() - floor);
      if (room === 0) {
        zero();
        if (player) player.sendMessage(fight.immune);
        return;
      }
      if (total > room) {
        let left = room;
        for (const part of hit.getHits()) {
          const amount = Math.min(left, part.getDamage());
          part.setDamage(amount);
          left -= amount;
        }
        hit.updateTotalDamage();
      }
    }
    this.credit(player, hit.getTotalDamage());
  }

  // ------------------------------------------------------------------ HUD and music

  hudValues() {
    return { npcId: this.form(), current: Math.max(0, this.boss?.getHitpoints?.() ?? 0), maximum: Common.data.fight.hitpoints };
  }

  showHud(player) {
    if (this.stage === "ended") return;
    this.hudShown.add(player);
    Common.api.emitCustomEvent("boss-hud:show", { player, ...this.hudValues() });
  }

  updateHud({ force = false } = {}) {
    if (!this.boss) return;
    const values = this.hudValues();
    for (const player of this.hudShown) Common.api.emitCustomEvent("boss-hud:update", { player, ...values, force });
  }

  hideHud(player) {
    if (!this.hudShown.delete(player)) return;
    Common.api.emitCustomEvent("boss-hud:hide", { player });
  }

  playSong(player, id) {
    this.musicPlayers.add(player);
    player.getPacketSender().sendSong(id);
  }

  playerLeft(player) {
    if (player.getHitpoints() <= 0 && this.stage !== "ended") this.deaths++;
    this.hideHud(player);
    this.effects.playerLeft(player);
    if (this.musicPlayers.delete(player)) player.getPacketSender().sendSong(Common.data.music.prison);
  }

  // ------------------------------------------------------------------ her end

  /** Her hitpoints reached 0: Wrath, then she is gone and the loot is down. */
  dying() {
    if (this.stage === "dying" || this.stage === "ended") return;
    const { wrath, npcs } = Common.data;
    this.stage = "dying";
    this.endTick = this.tick;
    this.events = [];
    Specials.interrupt(this);
    this.killReavers(false);
    for (const mage of this.mages.values()) Common.api.removeNpc(mage);
    this.mages.clear();
    this.boss.getMovementQueue().setBlockMovement(true).reset();
    this.boss.setMobileInteraction(null);
    this.say(wrath.say);
    this.transform(npcs.dying);
    const centre = this.centre();
    this.at(wrath.deathAnimTick, () => this.boss.performAnimation(Common.animation(wrath.deathAnim)));
    this.at(wrath.blastTick, () => this.blast(centre));
    this.at(wrath.hudFadeTick, () => {
      for (const player of [...this.hudShown]) this.hideHud(player);
    });
    this.at(wrath.damageTick, () => {
      for (const player of this.players()) {
        const at = player.getLocation();
        if (Math.max(Math.abs(at.getX() - centre.getX()), Math.abs(at.getY() - centre.getY())) > wrath.radius) continue;
        Common.damage(player, Common.randomInt(0, wrath.maxHit));
      }
      this.won(centre);
    });
  }

  /** Wrath's blast, as captured: the centre's map animation and a ring of projectiles and bursts. */
  blast(centre) {
    const { wrath } = Common.data;
    const players = this.players();
    Common.tileGraphic(players, centre, wrath.centreGraphic);
    for (let dx = -wrath.radius; dx <= wrath.radius; dx++) {
      for (let dy = -wrath.radius; dy <= wrath.radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== wrath.radius) continue;
        const tile = centre.transform(dx, dy);
        const end = 16 + 4 * Common.randomInt(0, 3);
        Common.projectile(centre, tile, { ...wrath.projectile, start: 0, end, area: this.arena.area });
        Common.tileGraphic(players, tile, wrath.tileGraphic, { delay: end });
      }
    }
    for (const sound of wrath.sounds) this.areaSound([sound[0], sound[1], 7], centre);
  }

  won(centre) {
    const ticks = this.endTick - this.startedTick();
    const players = this.players();
    this.stage = "ended";
    if (this.boss?.isRegistered?.()) Common.api.removeNpc(this.boss);
    for (const player of players) {
      this.count(player, ticks, players.length);
      if (this.musicPlayers.has(player)) player.getPacketSender().sendSong(Common.data.music.silence);
    }
    require("./Loot.Nex").reward(this, players, centre);
    require("./CombatAchievements.Nex").judge(this, players, ticks);
    this.finish(true);
  }

  /** The tick "Fill my soul with smoke!" began the fight (the kill's timer). */
  startedTick() {
    return Common.data.spawn.fillTick;
  }

  count(player, ticks, team) {
    const { kill, varps } = Common.data;
    const own = Common.count(player, Common.KILLS_ATTRIBUTE) + 1;
    player.setAttribute(Common.KILLS_ATTRIBUTE, own);
    player.getPacketSender().sendConfig(varps.kills, own);
    require("./CombatAchievements.Nex").killed(player, own, (kills) => player.sendMessage(kill.count.replace("[n]", kills)));
    const best = Common.count(player, Common.BEST_ATTRIBUTE);
    const duration = kill.duration.replace("[time]", Common.formatTicks(ticks));
    if (!best || ticks < best) {
      player.setAttribute(Common.BEST_ATTRIBUTE, ticks);
      Common.api.emitCustomEvent("boss:personal-best", { player, boss: BOSS_NAME, ticks });
      player.sendMessage(duration + kill.best);
    } else {
      player.sendMessage(duration + kill.personalBest.replace("[time]", Common.formatTicks(best)));
    }
    Common.api.emitCustomEvent("collection-log:count", { player, category: "Nex" });
  }

  killReavers(healHer) {
    let healed = 0;
    for (const reaver of this.reavers) {
      if (!reaver?.isRegistered?.() || reaver.getHitpoints() <= 0) continue;
      healed += reaver.getHitpoints();
      if (healHer) Common.projectile(reaver, this.boss, { ...Common.data.specials.sacrifice.projectile, start: 0 });
      Common.api.removeNpc(reaver);
    }
    this.reavers = [];
    if (healHer && healed > 0) {
      Common.healNpc(this.boss, healed, Common.data.fight.hitpoints);
      this.record.siphonHealed = true;
    }
    return healed;
  }

  /** Everyone left or she died: clears the chamber and tells the arena. */
  end(killed) {
    if (this.stage === "ended" && !killed) return;
    this.stage = "ended";
    Specials.interrupt(this);
    this.killReavers(false);
    for (const mage of this.mages.values()) Common.api.removeNpc(mage);
    this.mages.clear();
    if (this.boss?.isRegistered?.()) Common.api.removeNpc(this.boss);
    for (const player of [...this.hudShown]) this.hideHud(player);
    this.finish(killed);
  }

  finish(killed) {
    if (this.stopped) return;
    this.stop();
    this.arena.ended(this, killed);
  }

  stop() {
    this.stopped = true;
    this.events = [];
  }
}

// ------------------------------------------------------------------ hooks

const fightOf = (npc) => {
  const fight = npc?.__nexFight;
  return fight && !fight.stopped ? fight : null;
};

/** Opens a fight in `arena`, driven from a tick task of its own. */
function open(arena) {
  const fight = new Fight(arena);
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
  return fight;
}

/** Nex and her mages fight on the fight's timers, never the engine's. */
function scriptedClass() {
  const { CombatMethod, CombatType } = Common.core;
  return class NexScriptedCombat extends CombatMethod {
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

function modifyHit({ npc, hit }) {
  const fight = fightOf(npc);
  if (!fight) return;
  if (npc === fight.boss) {
    fight.hitBoss(hit);
    return;
  }
  if (fight.isImmuneMage(npc)) {
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    return;
  }
  const attacker = hit.getAttacker?.();
  if (attacker?.isPlayer?.()) fight.credit(attacker.getAsPlayer(), hit.getTotalDamage());
}

/** Hitting a blood reaver heals you half the damage (Wiki). */
function dealtDamage({ player, target, hit }) {
  const fight = fightOf(target);
  if (!fight || !fight.reavers.includes(target)) return;
  const amount = hit.getTotalDamage();
  if (amount > 1) player.heal(Math.floor(amount / 2));
}

/** At 0 she casts Wrath before going. */
function beforeDeath(event) {
  const fight = fightOf(event.npc);
  if (!fight || event.npc !== fight.boss) return;
  event.preventDeath = true;
  fight.dying();
}

function npcDied({ npc, killer }) {
  const fight = fightOf(npc);
  if (!fight) return;
  if (npc.__nexMage != null) {
    // Captured: ancient essence (varbit 13080) up 2 for the mage's killer.
    if (killer?.isPlayer?.()) {
      const player = killer.getAsPlayer();
      Common.setEssence(player, Common.getEssence(player) + Common.data.fight.mageEssence);
    }
    fight.mageDied(npc.__nexMage);
    return;
  }
  if (fight.reavers.includes(npc)) Specials.reaverDied(fight, npc);
}

function attachFight(api) {
  const { npcs } = Common.data;
  api.persistAttribute(Common.KILLS_ATTRIBUTE, 0);
  api.persistAttribute(Common.BEST_ATTRIBUTE, 0);
  api.persistAttribute(Common.DEATHS_ATTRIBUTE, 0);
  const method = scriptedClass();
  for (const id of [npcs.nex, npcs.spawning, npcs.soulSplit, npcs.deflect, npcs.dying]) api.registerNpcCombatMethodProvider(id, method);
  api.onNpcHitModify(modifyHit);
  api.onPlayerDealtDamage(dealtDamage);
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(npcDied);
}

module.exports = { attachFight, open, fightOf, Fight, SIZE };
