"use strict";
const Common = require('./Common.DukeSucellus');
const Model = require('./Model.DukeSucellus');
const Records = require('./Records.DukeSucellus');
const Hazards = require('./Hazards.DukeSucellus');
const Preparation = require('./Preparation.DukeSucellus');
const { sendBossKillCount } = require('../../interface/BossKillCount.plugin');
class Fight {
  constructor(session, boss) {
    this.session = session;
    this.player = session.player;
    this.boss = boss;
    this.active = false;
    this.over = false;
    this.stopped = false;
    this.perfect = true;
    this.events = [];
    this.pending = new Set();
    this.clock = new Model.AttackClock();
    this.nextAttack = Infinity;
    this.started = 0;
    this.respawnAt = Infinity;
    this.wonAlready = false;
    this.baselineKills = Common.kills(this.player);
    this.completedOnSlayerTask = false;
    this.sleepEyes();
    this.lastAttackCycle = -1;
    this.mirror = true;
    this.coldFeetEligible = false;
  }
  valid() {
    return !this.over && !this.stopped && !this.session.ended && this.session.fight === this && this.player.getHitpoints() > 0;
  }
  at(delay, action) {
    this.events.push({ due: this.session.tick + delay, action });
  }
  wake() {
    if (this.active || !this.valid())
      return;
    this.active = true;
    this.started = Common.core.World.getProcessCycle();
    this.events = [];
    Hazards.clear(this);
    for (const eye of Common.data.extremities)
      this.animateEye(eye, Common.data.animations.eyeWake);
    this.at(1, () => {
      for (const eye of Common.data.extremities)
        this.animateEye(eye, Common.data.animations.eyeAwake);
    });
    Preparation.refresh(this.session);
    this.boss.setNpcTransformationId(Common.data.npcs.awake);
    this.boss.setCombatOverride({ stats: Common.data.normal.stats });
    this.boss.setMaxHitpoints(Common.data.normal.hitpoints);
    this.boss.setHitpoints(Common.data.normal.hitpoints);
    this.boss.setDisplayedHealth(null);
    this.boss.removeHeadbar(Common.data.meters.poison.id);
    this.boss.performAnimation(new Common.core.Animation(Common.data.animations.wake));
    this.boss.setAttribute(Common.DEMONBANE, .7);
    this.observeSlayerTask();
    this.nextAttack = this.session.tick + Common.data.timing.wake;
    this.session.setExit(true);
    Common.api.emitCustomEvent('boss-hud:show', { player: this.player, npcId: Common.data.npcs.awake, current: Common.data.normal.hitpoints, maximum: Common.data.normal.hitpoints });
  }
  process() {
    if (this.over) {
      if (this.session.tick >= this.respawnAt && !this.session.ended)
        this.session.reset();
      return;
    }
    if (!this.valid())
      return;
    const due = this.events.filter(e => e.due <= this.session.tick);
    this.events = this.events.filter(e => e.due > this.session.tick);
    for (const e of due) {
      if (!this.valid())
        break;
      e.action();
    }
    if (!this.valid())
      return;
    if (!this.active) {
      this.preparationHazards();
      return;
    }
    this.observeSlayerTask();
    Common.api.emitCustomEvent('boss-hud:update', { player: this.player, current: this.boss.getHitpoints() });
    if (this.session.tick < this.nextAttack)
      return;
    const action = this.clock.next(this.boss.getHitpoints());
    const attackTicks = Model.attackTicks(this.boss.getHitpoints());
    if (action === 'gaze')
      this.gaze();
    else if (action === 'gas')
      this.gas();
    else
      this.auto();
    const delay = action === 'gaze' ? Common.data.timing.gaze : action === 'gas' ? (Model.gasCount(this.boss.getHitpoints()) - 1) * Common.data.timing.gasSpitInterval + attackTicks - 1 : attackTicks;
    this.nextAttack = this.session.tick + delay;
  }
  auto() {
    this.lastAttackCycle = Common.core.World.getProcessCycle();
    const { normal, timing, graphics, animations, magic } = Common.data;
    const target = Common.source(this.session, this.player.getLocation());
    this.boss.setPositionToFace(this.player.getLocation());
    if (Model.melee(target)) {
      this.boss.performAnimation(new Common.core.Animation(animations.melee));
      this.boss.performGraphic(new Common.core.Graphic(graphics.meleeNpc));
      // Normal-world recording 1703: the whole visual row is sent with the attack.
      // It does not establish a seven-tile damaging slam; the current Wiki describes
      // a 3x3 chip followed by an aimed 1x1 main hit.
      const [bossX, bossY] = Common.data.site.boss;
      graphics.meleeRow.forEach((id, offset) => {
        Common.graphic(this.session, id, [bossX + offset, bossY - 1]);
      });
      const chip = () => {
        if (!Model.near(Common.source(this.session, this.player.getLocation()), target))
          return;
        const maximum = Common.protectedFrom(this.player, "PROTECT_FROM_MELEE")
          ? normal.protectedChip : normal.chip;
        Common.strike(this, "melee", maximum, { accurate: false, avoidable: false });
      };
      if (timing.chip === 0)
        chip();
      else
        this.at(timing.chip, chip);
      this.at(timing.slam, () => {
        if (!Model.near(Common.source(this.session, this.player.getLocation()), target, 0) ||
          Model.hidden(target))
          return;
        const maximum = Common.protectedFrom(this.player, "PROTECT_FROM_MELEE")
          ? normal.protectedSlam : normal.slam;
        Common.strike(this, "melee", maximum);
      });
      return;
    }
    this.boss.performAnimation(new Common.core.Animation(animations.magic));
    const destination = this.player.getLocation().clone();
    this.player.getPacketSender().sendProjectile(this.session.tile(Common.data.site.mouth), destination, 0, magic.endCycle, graphics.magicProjectile, magic.startHeight, magic.endHeight, this.player, magic.startCycle, magic.slope, magic.distanceOffset, null);
    this.player.performGraphicInSlot(magic.impactSlot, new Common.core.Graphic(graphics.magicImpact, magic.endCycle));
    this.at(timing.magic, () => {
      const maximum = Common.protectedFrom(this.player, "PROTECT_FROM_MAGIC")
        ? normal.protectedMagic : normal.magic;
      Common.strike(this, "magic", maximum, { evenZero: true });
    });
  }
  gaze() {
    this.lastAttackCycle = Common.core.World.getProcessCycle();
    const overlay = Common.data.gazeOverlay;
    this.player.getPacketSender().sendSubInterface((overlay.targetGroup << 16) | overlay.targetComponent, overlay.group, 1);
    this.gazeVisible = true;
    this.boss.performAnimation(new Common.core.Animation(Common.data.animations.gaze));
    this.player.sendMessage("<col=6800bf>Duke Sucellus turns his gaze upon you...");
    this.at(Common.data.timing.gazeWarning, () => {
      this.hideGaze();
      if (Model.hidden(Common.source(this.session, this.player.getLocation()))) {
        this.player.sendMessage("<col=06600c>You manage to avoid Duke Sucellus' gaze.");
      }
      else {
        this.player.sendMessage("You failed to avoid Duke Sucellus' gaze.");
        this.at(1, () => Common.hurt(this, Common.data.normal.gaze));
      }
    });
  }
  hideGaze() {
    if (!this.gazeVisible)
      return;
    this.gazeVisible = false;
    const overlay = Common.data.gazeOverlay, sender = this.player.getPacketSender();
    if (sender.isSubInterfaceOpen(overlay.group) === true)
      sender.closeSubInterface((overlay.targetGroup << 16) | overlay.targetComponent);
  }
  ignite(tile) {
    Hazards.gas(this, tile, false);
  }
  gas() {
    const amount = Model.gasCount(this.boss.getHitpoints());
    const spit = () => {
      this.lastAttackCycle = Common.core.World.getProcessCycle();
      this.boss.performAnimation(new Common.core.Animation(Common.data.animations.gas));
      const here = Common.source(this.session, this.player.getLocation());
      const vents = [...Common.data.vents].sort((a, b) => Math.hypot(a[0] - here[0], a[1] - here[1]) - Math.hypot(b[0] - here[0], b[1] - here[1]));
      this.player.getPacketSender().sendProjectile(this.session.tile(Common.data.site.mouth), this.session.tile(vents[0]), 0, 90, Common.data.graphics.gasProjectile, 87.5, 0, null, 20, 5, 32, null);
      this.ignite(vents[0]);
    };
    spit();
    for (let i = 1; i < amount; i++)
      this.at(i * Common.data.timing.gasSpitInterval, spit);
  }
  animateEye(eye, animation) {
    const object = new Common.core.GameObject(eye.id, this.session.tile(eye.tile), 10, eye.face, this.session.area);
    this.player.getPacketSender().sendObjectAnimation(object, new Common.core.Animation(animation));
  }
  sleepEyes() {
    for (const eye of Common.data.extremities)
      this.animateEye(eye, Common.data.animations.eyeSleep);
  }
  freeze(ticks, ice = false) {
    const { graphics, preparation } = Common.data;
    this.player.getTimers().registers(Common.core.TimerKey.FREEZE, ticks);
    this.player.sendMessage("<col=e00a19>You've been frozen in place!");
    this.player.performGraphicInSlot(preparation.freezeSlot, new Common.core.Graphic(graphics.freeze, 0, preparation.freezeHeight));
    if (ice)
      this.player.performGraphicInSlot(preparation.iceFreezeSlot, new Common.core.Graphic(graphics.iceFreeze));
  }
  preparationHazards() {
    Hazards.preparation(this);
  }
  observeSlayerTask() {
    if (this.completedOnSlayerTask)
      return;
    const task = { player: this.player, npc: this.boss, onTask: false };
    Common.api.emitCustomEvent('slayer:on-task', task);
    if (task.onTask)
      this.completedOnSlayerTask = true;
  }
  fell() {
    if (this.over || this.stopped || !this.active)
      return;
    // Slayer's death handler may complete the assignment before won() runs.
    this.observeSlayerTask();
    this.over = true;
    this.events = [];
    Common.cancelPending(this);
    this.hideGaze();
    Hazards.clear(this);
    this.coldFeetEligible = this.perfect && !this.session.ranSinceKill;
    this.session.ranSinceKill = false;
    this.finishedTicks = Math.max(1, Common.core.World.getProcessCycle() - this.started);
    this.respawnAt = this.session.tick + Common.data.timing.respawn;
    this.session.setExit(false);
    Common.api.emitCustomEvent('boss-hud:update', { player: this.player, current: 0 });
  }
  won(killer) {
    if (!this.over || this.wonAlready || killer !== this.player || this.session.fight !== this)
      return;
    this.wonAlready = true;
    const count = Math.max(this.baselineKills + 1, Common.count(this.player, Common.KILLS) + 1, Common.kills(this.player)), ticks = this.finishedTicks;
    this.player.setAttribute(Common.KILLS, count);
    this.player.getPacketSender().sendConfig(Common.data.killCountVarp, count);
    sendBossKillCount(this.player, `Your Duke Sucellus kill count is: ${count}.`);
    const previous = Common.count(this.player, Common.BEST);
    if (!previous || ticks < previous)
      this.player.setAttribute(Common.BEST, ticks);
    Records.kill(ticks);
    this.player.sendMessage(`Fight duration: ${(ticks * .6).toFixed(1)} seconds.`);
    if (this.perfect)
      this.session.perfectKills++;
    if (this.coldFeetEligible)
      Common.api.emitCustomEvent('combat-achievements:complete', { player: this.player, task: 'Cold Feet' });
    if (this.mirror)
      Common.api.emitCustomEvent('combat-achievements:complete', { player: this.player, task: 'Mirror Image' });
    if (this.session.perfectKills >= 5)
      Common.api.emitCustomEvent('combat-achievements:complete', { player: this.player, task: 'Perfect Duke Sucellus' });
    if (!this.completedOnSlayerTask)
      for (const [rank, seconds] of [['Trialist', 60], ['Chaser', 50], ['Runner', 40]]) {
        if (ticks * .6 < seconds)
          Common.api.emitCustomEvent('combat-achievements:complete', { player: this.player, task: `Duke Sucellus Speed-${rank}` });
      }
    this.boss.setNpcTransformationId(Common.data.npcs.dead);
    Common.api.emitCustomEvent('boss-hud:hide', { player: this.player, fade: false, afterTicks: 0 });
  }
  stop() {
    for (const npc of [...this.session.passive])
      if (npc.getId() !== Common.data.npcs.vatTimer)
        this.session.removePassive(npc);
    this.stopped = true;
    this.events = [];
    Common.cancelPending(this);
    this.hideGaze();
  }
}
const fightOf = npc => npc?.__dukeSucellusFight;
function beforeDeath({ npc }) {
  fightOf(npc)?.fell();
}
function death(event) {
  const f = fightOf(event.npc);
  f?.won(event.killer);
  if (f?.wonAlready && f.player === event.killer && !f.stopped && !f.session.ended)
    event.remains = { ticks: Math.max(1, f.respawnAt - f.session.tick), respawnTicks: 0 };
}
function playerAttack({ attacker, target }) {
  const f = fightOf(target);
  if (f && f.boss === target && attacker === f.player && f.active && !f.over && !f.stopped && !f.session.ended && f.session.fight === f && f.lastAttackCycle !== Common.core.World.getProcessCycle())
    f.mirror = false;
}
function context({ player, npc, context }) {
  const f = fightOf(npc);
  if (f?.over && f.boss === npc && !f.stopped && f.player === player && f.session.fight === f && !f.session.ended && npc.getHitpoints() <= 0)
    context.perfectKill = f.perfect;
}
function lootLocation(event) {
  const f = fightOf(event.npc);
  if (f && f.boss === event.npc && !f.stopped && !f.session.ended && f.session.fight === f && event.player === f.player)
    event.location = f.session.tile(Common.data.site.loot);
}
function noDefaultCombat() {
  const { CombatMethod, CombatType } = Common.core;
  return class extends CombatMethod {
    hits() {
      return [];
    }
    type() {
      return CombatType.MELEE;
    }
    attackSpeed() {
      return 1;
    }
    attackDistance() {
      return 1;
    }
  };
}
function attach(api) {
  api.registerNpcCombatMethodProvider(Common.data.npcs.awake, noDefaultCombat());
  api.onNpcBeforeDeath(beforeDeath);
  api.onNpcDeath(death);
  api.onCombatHitRoll(playerAttack);
  api.onCustomEvent('npc-drops:context', context);
  api.onCustomEvent('npc-drops:location', lootLocation);
}
module.exports = { Fight, attach, context, beforeDeath, death };
