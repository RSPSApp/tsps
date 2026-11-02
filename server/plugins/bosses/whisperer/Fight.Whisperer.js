const Common = require('./Common.Whisperer');
const Specials = require('./Specials.Whisperer');
const Rewards = require('./Rewards.Whisperer');
const BOSS_NAME = 'Whisperer';
class Fight {
  constructor(session, boss) {
    this.session = session;
    this.player = session.player;
    this.boss = boss;
    this.tick = 0;
    this.sanityClock = 0;
    this.sanity = 100;
    this.shadow = false;
    this.perfectKill = true;
    this.enraged = false;
    this.over = false;
    this.stopped = false;
    this.completed = 0;
    this.startedSpecials = 0;
    this.special = null;
    this.attacks = 0;
    this.nextAttack = 3;
    this.events = [];
    this.tentacles = [];
    this.rotation = Common.random(0, 1) ? ['screech', 'souls', 'seeds'] : ['seeds', 'screech', 'souls'];
    this.startCycle = Common.core.World.getProcessCycle();
    this.boundUntil = 0;
    this.bindingFormUntil = 0;
    this.pursuitCancelled = false;
    this.wakeMovementTask = null;
    this.deathRecorded = false;
    Rewards.begin(this);
  }
  wake() {
    this.waking = true;
    this.nextAttack = this.tick + 7;
    this.boss.setNpcTransformationId(Common.data.npcs.figure);
    this.boss.performAnimation(new Common.core.Animation(Common.data.animations.spawn));
    const from = this.player.getLocation(), origin = this.boss.getLocation(), size = this.boss.getSize();
    const geometry = Common.data.wakeKnockback;
    const dy = from.getY() === origin.getY() + size ? geometry.tiles : from.getY() === origin.getY() - 1 ? -geometry.tiles : 0;
    // The captured north approach and ordinary south approach corroborate
    // these faces only. Do not infer diagonal or east/west destinations.
    if (dy && from.getX() >= origin.getX() && from.getX() < origin.getX() + size) {
      const { ForceMovement, ForceMovementTask, Location, TaskManager } = Common.core;
      const fight = this;
      const movement = new ForceMovement(from.clone(), new Location(0, dy), 0, geometry.cycles, dy > 0 ? 2 : 0, Common.data.animations.wakeKnockback);
      this.wakeMovementTask = new (class extends ForceMovementTask {
        execute() {
          if (!fight.alive()) {
            this.stop();
            return;
          }
          super.execute();
        }
      })(this.player, geometry.ticks, movement);
      TaskManager.submit(this.wakeMovementTask);
    }
    this.at(4, () => {
      this.waking = false;
      this.boss.setNpcTransformationId(Common.data.npcs.boss);
      this.boss.performAnimation(Common.core.Animation.DEFAULT_RESET_ANIMATION);
    });
  }
  alive() {
    return !this.over && !this.stopped && !this.session.ended && this.session.fight === this;
  }
  pattern(base = 'ranged') {
    if (this.enraged)
      return [Math.floor(this.attacks / 2) % 2 ? 'magic' : 'ranged'];
    const other = base === 'magic' ? 'ranged' : 'magic';
    return this.completed >= 3 ? [base, other, base] : this.completed > 0 ? [base, base, other] : [base, base, base];
  }
  at(delay, action, launched = false, binding = false) {
    this.events.push({ due: this.tick + delay, action, launched, binding });
  }
  changeSanity(amount) {
    this.sanity = Math.max(0, Math.min(100, this.sanity + amount));
    Common.sync(this);
  }
  sanityTick() {
    if (this.sanity <= 0) {
      if (!this.insanity)
        this.player.sendMessage(Common.data.messages.insanity);
      // Provisional: captures establish the warning, not this damage ramp.
      this.insanity = (this.insanity ?? 0) + 1;
      Common.damage(this, Math.min(99, 5 * this.insanity));
      return;
    }
    if (++this.sanityClock % 4 !== 0)
      return;
    if (this.shadow) {
      this.changeSanity(-3);
      const { Skill } = Common.core;
      const skills = this.player.getSkillManager();
      skills.setCurrentLevel(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - 3), true);
    }
    else
      this.changeSanity(1);
  }
  setShadow(shadow) {
    if (this.shadow === shadow)
      return;
    const offset = Common.data.site.realmOffset * (shadow ? -1 : 1);
    const move = entity => {
      const p = entity.getLocation();
      entity.moveTo(new Common.core.Location(p.getX() + offset, p.getY(), p.getZ()));
    };
    move(this.player);
    move(this.boss);
    for (const tentacle of this.tentacles) {
      move(tentacle.npc);
      tentacle.x += offset;
      tentacle.targetX += offset;
    }
    this.shadow = shadow;
    if (shadow)
      this.player.getPacketSender().sendVarbit(Common.data.sanity.visitedVarbit, 1);
    Specials.render(this);
    Common.sync(this);
  }
  process() {
    if (!this.alive() || this.player.getHitpoints() <= 0)
      return;
    Rewards.process(this);
    this.tick++;
    this.sanityTick();
    const hp = this.boss.getHitpoints();
    if (this.shownHp !== hp) {
      this.shownHp = hp;
      Common.api.emitCustomEvent('boss-hud:update', { player: this.player, current: hp, maximum: this.boss.getMaxHitpoints() });
    }
    const due = this.events.filter(e => e.due <= this.tick);
    this.events = this.events.filter(e => e.due > this.tick);
    for (const event of due)
      if (this.alive())
        event.action();
    this.processTentacles();
    if (this.waking || this.transitionUntil > this.tick)
      return;
    if (this.special) {
      Specials.process(this);
      return;
    }
    if (!this.enraged && this.startedSpecials < 3 && this.tick >= this.nextAttack && this.boss.getHitpoints() <= Common.data.thresholds[this.startedSpecials]) {
      this.clearTentacles();
      Specials.start(this, this.rotation[this.startedSpecials++]);
      return;
    }
    if (this.boundUntil > this.tick) {
      this.pursueBound();
      if (!this.pursuitCancelled)
        return;
    }
    if (this.boss.getNpcTransformationId() === Common.data.npcs.melee && this.tick >= this.bindingFormUntil)
      this.boss.setNpcTransformationId(Common.data.npcs.boss);
    if (this.inMelee()) {
      if (this.tick >= this.nextAttack)
        this.melee();
      return;
    }
    if (this.boss.getLocation().getDistance(this.player.getLocation()) > 10) {
      const p = this.player.getLocation();
      this.boss.getMovementQueue().reset();
      this.boss.getMovementQueue().addStep(p.getX(), p.getY());
      return;
    }
    this.boss.getMovementQueue().reset();
    if (this.tick >= this.nextAttack)
      this.volley();
  }
  inMelee() {
    const a = this.boss.getLocation(), b = this.player.getLocation(), size = 3;
    const dx = Math.max(a.getX() - b.getX(), b.getX() - (a.getX() + size - 1), 0);
    const dy = Math.max(a.getY() - b.getY(), b.getY() - (a.getY() + size - 1), 0);
    return dx + dy <= 1;
  }
  volley() {
    if (this.boss.getNpcTransformationId() === Common.data.npcs.melee)
      this.boss.setNpcTransformationId(Common.data.npcs.boss);
    const base = Common.random(0, 1) ? 'magic' : 'ranged';
    const pattern = this.pattern(base);
    const hand = this.enraged ? this.attacks % 2 : 0;
    this.attacks++;
    pattern.forEach((style, index) => this.at(index + 1, () => {
      if (this.inMelee()) {
        this.melee();
        return;
      }
      const { Projectile, Animation } = Common.core, geometry = Common.data.volley;
      this.boss.performAnimation(new Animation(Common.data.animations[style + ((hand + index) % 2 ? 'Alt' : '')]));
      // This owner-only instance uses the captured fixed-lifetime tile projectile.
      this.player.getPacketSender().sendProjectile(Projectile.centreOf(this.boss), this.player.getLocation(), 0, geometry.arrivalCycles, Common.data.projectiles[style], geometry.startHeight, geometry.endHeight, this.player, geometry.launchDelay, geometry.angle, geometry.progress);
      this.at(geometry.impactTicks, () => this.impact(style), true);
      if (this.enraged)
        this.spawnTentacles();
    }));
    if (!this.enraged)
      this.at(5, () => this.spawnTentacles());
    this.nextAttack = this.tick + (this.enraged ? 2 : 10);
  }
  impact(style) {
    if (!this.alive())
      return;
    // Roll at impact: the Whisperer's overheads are checked when projectiles land.
    const { CombatMethod, CombatType, PendingHit, CombatFactory } = Common.core;
    const method = new (class extends CombatMethod {
      type() {
        return style === 'magic' ? CombatType.MAGIC : CombatType.RANGED;
      }
      hits() {
        return [];
      }
    })();
    // Start with zero damage so the explicit style roll applies armour
    // reactions once; the constructor still performs the accuracy roll.
    const hit = new PendingHit(this.boss, this.player, method, { delay: 0, damage: 0 });
    CombatFactory.applyStyleDamage(hit, Common.data.maxHit[style]);
    if (Common.protectedFrom(this.player, style)) {
      for (const part of hit.getHits())
        part.setDamage(0);
      hit.updateTotalDamage();
    }
    this.pendingDamage ??= new Set();
    for (const part of hit.getHits()) {
      this.pendingDamage.add(part);
      part.onApplied(taken => {
        this.pendingDamage.delete(part);
        if (taken > 0 && this.alive())
          this.perfectKill = false;
      });
    }
    // Already at the scheduled projectile impact. Resolve now rather than adding
    // another tick before impact; executeHit still queues real HP damage normally.
    CombatFactory.executeHit(hit);
  }
  melee() {
    // Movement/attack recovery must not discard a bind that is already in
    // flight. Its original deadline and a real counter still guard impact.
    this.events = this.events.filter(event => event.launched);
    this.nextAttack = this.tick + 5;
    this.boss.performAnimation(new Common.core.Animation(Common.data.animations.melee));
    // Provisional lower bound: the Wiki establishes max42, not this28 minimum.
    const damage = Common.random(28, 42);
    const protectedMelee = Common.protectedFrom(this.player, 'melee');
    // Tentacular describes roughly one-third mitigation. Exact rounding and
    // the ordinary roll distribution remain unmeasured.
    const amount = protectedMelee ? Math.floor(damage * 2 / 3) : damage;
    Common.meleeDamage(this, amount, !protectedMelee);
    this.at(1, () => Common.meleeDamage(this, amount, !protectedMelee));
  }
  bind() {
    this.pursuitCancelled = false;
    this.boundUntil = this.tick + 14;
    // A melee attack clears pursuit early; keep its visual form until a
    // real phase change or the existing provisional phase deadline.
    this.bindingFormUntil = this.boundUntil;
    const geometry = Common.data.binding;
    this.pursuitAt = this.tick + geometry.pursuitTicks;
    this.boss.getMovementQueue().reset();
    this.boss.setNpcTransformationId(Common.data.npcs.melee);
    this.boss.performAnimation(new Common.core.Animation(Common.data.animations.binding));
    this.boss.performGraphic(new Common.core.Graphic(Common.data.graphics.bindingCast, 0, 120));
    const start = Common.core.Projectile.centreOf(this.boss).clone(), target = this.player.getLocation().clone();
    const distance = Math.max(Math.abs(start.getX() - target.getX()), Math.abs(start.getY() - target.getY()));
    // All 22 independently normal casts match these distance choices and
    // their ceil(cycles/30) impacts. Distances below three remain unmeasured.
    const arrival = geometry.nearArrivalCycles[distance] ?? geometry.arrivalCycles;
    this.player.getPacketSender().sendProjectile(start, target, 0, arrival, Common.data.projectiles.bind, geometry.startHeight, geometry.endHeight, this.player, geometry.launchDelay, geometry.angle, geometry.progress);
    this.at(Math.ceil(arrival / 30), () => {
      if (this.boundUntil > this.tick) {
        this.player.sendMessage(Common.data.messages.bind);
        this.player.performGraphic(new Common.core.Graphic(Common.data.graphics.bindingImpact));
        // Ordinary footage rules out twelve ticks. Eight remains
        // provisional: attacks/clicks obscure the precise expiry tick.
        Common.core.CombatFactory.freezeTicks(this.player, 8);
      }
    }, true, true);
  }
  pursueBound() {
    const { TimerKey } = Common.core;
    if (this.boss.getTimers().has(TimerKey.FREEZE)) {
      this.player.getTimers().cancel(TimerKey.FREEZE);
      this.boundUntil = 0;
      this.boss.setNpcTransformationId(Common.data.npcs.boss);
      return;
    }
    if (this.pursuitCancelled)
      return;
    if (this.completed >= 3 && this.boss.getHitpoints() < 100) {
      this.boss.getMovementQueue().reset();
      this.pursuitCancelled = true;
      this.boss.setNpcTransformationId(Common.data.npcs.boss);
      // Independently normal captures restore form at cancellation and
      // launch the first auto two ticks later (volley schedules at +1).
      this.nextAttack = this.tick + 1;
      return;
    }
    // NPCs move before the owner's player-area pass. Prepare a distant
    // route one pass before the recorded first step, without advancing melee.
    if (this.tick + 1 < this.pursuitAt)
      return;
    if (this.inMelee()) {
      if (this.tick < this.pursuitAt)
        return;
      this.boundUntil = 0;
      this.melee();
      return;
    }
    const p = this.player.getLocation();
    this.boss.getMovementQueue().addStep(p.getX(), p.getY());
  }
  spawnTentacles() {
    if (!this.alive())
      return;
    const p = this.player.getLocation();
    const x = p.getX(), y = p.getY();
    const plus = this.completed >= 2 && Common.random(0, 1);
    const directions = [[-4, -4], [0, -4], [4, -4], [4, 0], [4, 4], [0, 4], [-4, 4], [-4, 0]];
    const offsets = this.enraged ? [directions[Common.random(0, 7)]] : plus ? [[0, -4], [4, 0], [0, 4], [-4, 0]] : [[-4, -4], [4, -4], [4, 4], [-4, 4]];
    const wave = { hit: false };
    for (const [dx, dy] of offsets) {
      const sx = x + dx, sy = y + dy;
      if (!this.validTentacleTile(sx, sy))
        continue;
      const npc = this.session.spawn(Common.data.npcs.tentacle, sx - 1, sy - 1);
      if (!npc)
        continue;
      npc.performAnimation(new Common.core.Animation(Common.data.animations.tentacleSpawn));
      npc.performGraphic(new Common.core.Graphic(2452));
      this.tentacles.push({ npc, x: sx, y: sy, targetX: x, targetY: y, spawned: this.tick, wave });
    }
  }
  validTentacleTile(x, y) {
    const shift = this.shadow ? Common.data.site.realmOffset : 0, b = this.boss.getLocation();
    const [minX, maxX, minY, maxY] = Common.data.site.tentacleBounds;
    return x >= minX - shift && x <= maxX - shift && y >= minY && y <= maxY &&
      !(x >= b.getX() && x < b.getX() + 3 && y >= b.getY() && y < b.getY() + 3) &&
      !Common.core.RegionManager.blocked(new Common.core.Location(x, y, 0), this.session.area);
  }
  processTentacles() {
    for (const t of [...this.tentacles]) {
      const age = this.tick - t.spawned;
      if (age === 1 && !t.attacked) {
        t.attacked = true;
        t.npc.performAnimation(new Common.core.Animation(Common.data.animations.tentacleAttack));
        t.npc.performGraphic(new Common.core.Graphic(2454));
      }
      const dx = Math.sign(t.targetX - t.x), dy = Math.sign(t.targetY - t.y);
      if (age === 2 && !t.rendered) {
        t.rendered = true;
        for (let step = 1; step <= 4; step++)
          this.player.getPacketSender().sendGraphic(new Common.core.Graphic(2446 + step, step * 5), new Common.core.Location(t.x + dx * step, t.y + dy * step, 0));
      }
      if (age === 3 && !t.wave.hit) {
        const p = this.player.getLocation();
        for (let step = 1; step <= 4; step++) {
          if (p.getX() === t.x + dx * step && p.getY() === t.y + dy * step) {
            t.wave.hit = true;
            Common.damage(this, 20, 20);
            break;
          }
        }
      }
      if (age >= 4) {
        Common.remove(t.npc);
        this.tentacles.splice(this.tentacles.indexOf(t), 1);
      }
    }
  }
  clearTentacles() {
    for (const t of this.tentacles)
      Common.remove(t.npc);
    this.tentacles = [];
  }
  finish() {
    Rewards.observe(this);
    this.elapsedTicks = Common.core.World.getProcessCycle() - this.startCycle;
    this.over = true;
    this.events = [];
    Common.cancelDamage(this);
    this.clearTentacles();
    Specials.clear(this);
    this.sanity = 100;
    if (this.shadow)
      this.setShadow(false);
    Common.sync(this);
  }
  stop() {
    this.stopped = true;
    this.wakeMovementTask?.stop();
    this.wakeMovementTask = null;
    this.events = [];
    Common.cancelDamage(this);
    this.clearTentacles();
    Specials.clear(this);
  }
}
function fightOf(npc) {
  return npc?.__whispererFight;
}
function beforeDeath(event) {
  const fight = fightOf(event.npc);
  if (!fight || !fight.alive())
    return;
  if (event.npc !== fight.boss) {
    Specials.soulDied(fight, event.npc);
    return;
  }
  if (!fight.enraged) {
    event.preventDeath = true;
    fight.enraged = true;
    fight.events = fight.events.filter(event => event.launched);
    fight.boundUntil = 0;
    if (fight.boss.getNpcTransformationId() === Common.data.npcs.melee)
      fight.boss.setNpcTransformationId(Common.data.npcs.boss);
    fight.boss.getMovementQueue().reset();
    fight.clearTentacles();
    Specials.clear(fight);
    fight.boss.setMaxHitpoints(140);
    fight.boss.setHitpoints(140);
    fight.boss.setCombatOverride(null);
    for (const skill of [Common.core.Skill.ATTACK, Common.core.Skill.STRENGTH, Common.core.Skill.DEFENCE, Common.core.Skill.MAGIC, Common.core.Skill.RANGED])
      fight.boss.setCurrentLevels(skill, fight.boss.getMaxLevel(skill));
    fight.attacks = 0;
    // Normal capture: HP restore, appearance +4, realm +5, first shot +7.
    fight.transitionUntil = fight.tick + 6;
    fight.nextAttack = fight.transitionUntil;
    if (!fight.shadow) {
      fight.at(4, () => fight.boss.performAnimation(new Common.core.Animation(Common.data.animations.appear)));
      fight.at(5, () => {
        fight.setShadow(true);
        fight.player.sendMessage(Common.data.messages.enrage);
      });
    }
  }
  else
    fight.finish();
}
function modifyHit({ npc, hit }) {
  const fight = fightOf(npc);
  if (!fight || !hit)
    return;
  if (npc !== fight.boss) {
    if (npc.__whispererSoul != null && !fight.shadow)
      for (const part of hit.getHits())
        part.setDamage(0);
  }
  else if (fight.special)
    for (const part of hit.getHits())
      part.setDamage(Math.floor(part.getDamage() * (fight.shadow ? .4 : .3)));
  hit.updateTotalDamage();
}
function dropContext({ player, npc, context }) {
  const fight = fightOf(npc);
  if (context && fight && fight.over && !fight.stopped && !fight.session.ended && fight.session.fight === fight && npc === fight.boss && player === fight.player)
    context.perfectKill = fight.perfectKill;
}
function bindingCounter(event) {
  const fight = fightOf(event.target);
  if (!fight || event.target !== fight.boss || !fight.alive() || fight.boundUntil <= fight.tick || event.attacker !== fight.player)
    return;
  const spell = event.attacker.getCombat().getCastSpell();
  const { CombatSpells } = Common.core;
  if (['BIND', 'SNARE', 'ENTANGLE', 'ICE_RUSH', 'ICE_BURST', 'ICE_BLITZ', 'ICE_BARRAGE'].some(name => CombatSpells[name] === spell))
    event.forceAccurate = true;
}
function onDeath({ npc }) {
  const fight = fightOf(npc);
  if (!fight)
    return;
  if (npc !== fight.boss) {
    Specials.soulDied(fight, npc);
    return;
  }
  if (!fight.over || fight.stopped || fight.session.ended || fight.wonAlready)
    return;
  fight.wonAlready = true;
  const player = fight.player;
  // The existing CA death listener counts this normal NPC already. Query its
  // canonical count rather than emitting an additional kill event.
  const known = { player, monster: Common.MONSTER, total: 0 };
  Common.api.emitCustomEvent('combat-achievements:count', known);
  const count = Math.max((Number(player.getAttribute(Common.KILLS_ATTRIBUTE)) || 0) + 1, Number(known.total) || 0);
  player.setAttribute(Common.KILLS_ATTRIBUTE, count);
  player.getPacketSender().sendConfig(Common.data.killCountVarp, count);
  player.sendMessage(`Your Whisperer kill count is: <col=ff0000>${count}</col>.`);
  const ticks = fight.elapsedTicks;
  const best = Number(player.getAttribute(Common.BEST_ATTRIBUTE)) || 0;
  if (!best || ticks < best)
    player.setAttribute(Common.BEST_ATTRIBUTE, ticks);
  if (!best || ticks < best)
    Common.api.emitCustomEvent('boss:personal-best', { player, boss: BOSS_NAME, ticks });
  require('./Records.Whisperer').won(fight);
  const duration = value => `${Math.floor(value * .6 / 60)}:${String(Math.floor(value * .6) % 60).padStart(2, '0')}`;
  player.sendMessage(`Fight duration: <col=ff0000>${duration(ticks)}</col>${!best || ticks < best ? ' (new personal best)' : `. Personal best: ${duration(best)}`}`);
  Rewards.complete(fight);
  Common.later(30, () => {
    if (!fight.session.ended && fight.session.fight === fight)
      fight.session.respawn();
  });
}
function combatClass() {
  return class extends Common.core.CombatMethod {
    hits() {
      return [];
    }
    attackSpeed() {
      return 1;
    }
    attackDistance() {
      return 10;
    }
    type() {
      return Common.core.CombatType.MAGIC;
    }
  };
}
function attach(api) {
  api.registerNpcCombatMethodProvider(Common.data.npcs.boss, combatClass());
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(onDeath);
  api.onNpcHitModify(modifyHit);
  api.onCombatHitRoll(Rewards.attack);
  api.onCombatHitRoll(bindingCounter);
  api.onCustomEvent('npc-drops:context', dropContext);
}
module.exports = { Fight, beforeDeath, modifyHit, dropContext, bindingCounter, attach };
