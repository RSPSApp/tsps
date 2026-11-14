"use strict";

const Common = require("./Common.MaggotKing");
const FLOOR = { minX: 2904, maxX: 2918, minY: 8033, maxY: 8036 };
const BILE_POISON = 33423;
const BILE_STICKY = 33424;
const CARRION = 33425;
const HEAD = 33426;
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const blows = new WeakMap();
let styles;

function combatStyles() {
  if (styles) return styles;
  const { CombatMethod, CombatType } = Common.core();
  styles = {};
  for (const [key, type] of Object.entries({ ranged: CombatType.RANGED, magic: CombatType.MAGIC, melee: CombatType.MELEE })) {
    styles[key] = new (class extends CombatMethod {
      type() { return type; }
      hits() { return []; }
    })();
  }
  return styles;
}

function poisonousBileProtected(player) {
  const helm = { player, active: false };
  Common.api().emitCustomEvent("serpentine-helm:protection", helm);
  if (!helm.active) return false;
  const dose = { player, antiVenomPlus: false };
  Common.api().emitCustomEvent("potions:poison-protection", dose);
  return dose.antiVenomPlus === true;
}

/** One owner, one clock, and one collection of removable encounter actors/objects. */
class Fight {
  constructor(session, npc) {
    this.session = session;
    this.npc = npc;
    this.player = session.player;
    this.phase = "ranged";
    this.previousStyle = "ranged";
    this.attacksLeft = rand(4, 8);
    this.screeched = false;
    this.nextAttack = 1;
    this.tick = 0;
    this.events = [];
    this.floor = new Map();
    this.larvae = new Set();
    this.west = true;
    this.head = null;
    this.slamCycle = -1;
    this.clickCycle = -1;
    this.punishSpent = -1;
    this.launch = null;
    this.stopped = false;
    this.winding = false;
  }

  start() {
    const { Task, TaskManager } = Common.core();
    this.npc.setScriptedMovement(true);
    this.npc.setFlag("combat:no-retaliate"); // controller owns its queue; ordinary retaliation would reset it
    this.npc.setMultiCombat(true);
    this.npc.moveTo(this.posture(2911, 8040));
    this.npc.setBaseAnimations({ idle: 13926, walk: 13927 });
    const fight = this;
    this.task = new (class extends Task {
      constructor() { super(1, fight, false); }
      execute() { fight.process(); }
    })();
    TaskManager.submit(this.task);
  }

  at(delay, action) { this.events.push({ tick: this.tick + delay, action }); }
  cycle() { return Common.core().World.getProcessCycle(); }
  source(location) { return this.session.worldTile(location); }
  valid() {
    return !this.stopped && !this.session.ended && !this.session.area.isDestroyed() && this.session.boss === this.npc
      && this.npc.getHitpoints() > 0 && this.player.getHitpoints() > 0
      && this.player.getPrivateArea() === this.session.area;
  }
  posture(playerX, y) {
    const { RegionManager } = Common.core();
    const roots = [];
    for (let x = 2904; x <= 2914; x++) {
      let clear = true;
      for (let dx = 0; dx < 5; dx++) for (let dy = 0; dy < 5; dy++) {
        if (this.session.area.getClip(this.session.tile([x + dx, y + dy, 0])) & RegionManager.BLOCKED_MASK) clear = false;
      }
      if (clear) roots.push(x);
    }
    if (!roots.length) throw new Error(`Maggot King has no clear northern posture at ${y}`);
    roots.sort((a, b) => Math.abs(a + 2 - playerX) - Math.abs(b + 2 - playerX));
    return this.session.tile([roots[0], y, 0]);
  }
  inFloor(location) {
    const [x, y] = this.source(location);
    return location.getZ() === 0 && x >= FLOOR.minX && x <= FLOOR.maxX && y >= FLOOR.minY && y <= FLOOR.maxY;
  }
  key(location) { return `${location.getX()},${location.getY()}`; }
  protecting(prayer) { return Common.core().PrayerHandler.isActivated(this.player, prayer); }
  protectionActive() {
    const p = Common.core().PrayerHandler;
    return [p.PROTECT_FROM_MELEE, p.PROTECT_FROM_MAGIC, p.PROTECT_FROM_MISSILES].some(prayer => this.protecting(prayer));
  }
  animate(id) { this.npc.performAnimation(new (Common.core().Animation)(id)); }
  graphic(id, location) { this.player.getPacketSender().sendGraphic(new (Common.core().Graphic)(id), location); }

  process() {
    if (!this.valid()) { this.stop(); return; }
    this.tick++;
    // Scripted movement suppresses generic attacks. Keep native regeneration from healing an active fight.
    this.npc.getCombat().getLastAttack().reset();
    const due = this.events.filter(event => event.tick <= this.tick);
    this.events = this.events.filter(event => event.tick > this.tick);
    for (const event of due) if (this.valid()) event.action();
    if (!this.valid()) return;
    if (this.tick >= this.nextAttack && this.phase !== "screech" && !this.winding) {
      if (this.attacksLeft <= 0) this.screech();
      else if (this.phase === "melee") this.windup();
      else this.spit();
    }
    this.processLarvae();
  }

  /** Rolls at impact, after this tick's prayer input. PendingHit retains native equipment reactions. */
  blow(kind, style = "melee", location = null, max = null, larva = null) {
    const { PendingHit, CombatFactory } = Common.core();
    const hit = new PendingHit(this.npc, this.player, combatStyles()[style], {
      delay: 0, rollAccuracy: false, experience: false, damage: 0, bypassProtectionPrayer: true,
    });
    hit.deferIncomingDamageUntilImpact();
    blows.set(hit, { fight: this, kind, style, location, max, larva });
    CombatFactory.addPendingHit(hit);
  }

  landBlow(hit, spec) {
    if (!this.valid()) { hit.setTotalDamage(0); return; }
    const prayer = Common.core().PrayerHandler;
    let damage = 0;
    if (spec.kind === "spit") {
      const protectedFrom = spec.style === "ranged" ? prayer.PROTECT_FROM_MISSILES : prayer.PROTECT_FROM_MAGIC;
      damage = this.protecting(protectedFrom) ? 0 : rand(0, 46);
      // The floor target is the player's tile at impact, rather than the launch tile.
      const at = this.player.getLocation().clone();
      this.bile(at, spec.style === "ranged" ? BILE_POISON : BILE_STICKY);
      if (spec.style === "ranged") Common.core().CombatFactory.poisonEntity(this.player, 40);
    } else if (spec.kind === "screech") {
      damage = this.protectionActive() ? rand(15, 25) : 0;
    } else if (spec.kind === "slam") {
      const [x, y] = this.source(this.player.getLocation());
      if (x >= spec.location[0] && x < spec.location[0] + 3 && y >= FLOOR.minY && y <= FLOOR.maxY) {
        damage = rand(0, this.protecting(prayer.PROTECT_FROM_MELEE) ? 35 : 55);
      }
    } else if (spec.kind === "larva") {
      if (spec.larva && this.larvae.has(spec.larva) && spec.larva.npc.getHitpoints() > 0
        && this.player.getLocation().equals(spec.larva.npc.getLocation())) damage = spec.max;
    } else if (!spec.location || this.player.getLocation().equals(spec.location)) damage = rand(0, spec.max);
    hit.setTotalDamage(damage);
    if (spec.larva) {
      for (const part of hit.getHits()) part.onApplied(actual => {
        if (this.valid() && this.larvae.has(spec.larva)) this.heal(actual);
      });
    }
  }

  spit() {
    const style = this.phase;
    this.animate(Common.data.combat.animations[style]);
    const { Projectile } = Common.core();
    const target = this.player.getLocation().clone();
    const projectile = Common.data.combat.projectiles[style];
    new Projectile(this.npc.getLocation(), target, this.player, projectile, 0, 60, 70, 10, this.session.area).sendProjectile();
    this.at(2, () => this.blow("spit", style));
    this.attacksLeft--;
    this.nextAttack = this.tick + (this.screeched ? 5 : 6);
  }

  adjacent(location) {
    return [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => location.transform(dx, dy, 0)).filter(at => this.inFloor(at));
  }
  shuffled(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = rand(0, i); [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  bile(location, id) {
    if (!this.inFloor(location)) return;
    for (const at of [location, ...this.shuffled(this.adjacent(location)).slice(0, 2)]) this.placeFloor(at, id);
  }
  placeFloor(location, id) {
    if (!this.inFloor(location)) return;
    this.removeFloor(location);
    const { GameObject, ObjectManager } = Common.core();
    const object = new GameObject(id, location.clone(), 10, 0, this.session.area);
    ObjectManager.register(object, true);
    this.floor.set(this.key(location), object);
  }
  removeFloor(location) {
    const key = this.key(location);
    const object = this.floor.get(key);
    if (object) Common.core().ObjectManager.deregister(object, true);
    this.floor.delete(key);
    return object;
  }
  /** Floor contact follows the owner's ordinary movement; no global player processing hook. */
  processFloor() {
    if (!this.valid()) return;
    const at = this.player.getLocation();
    const object = this.floor.get(this.key(at));
    if (!object || object.getId() === CARRION) return;
    this.removeFloor(at);
    if (object.getId() === BILE_POISON && poisonousBileProtected(this.player)) return;
    const { HitDamage, HitMask, Skill } = Common.core();
    // Sticky's 2..4 is documented; poisonous bile's unspecified minor damage uses the same bounded tuning.
    const amount = rand(2, 4);
    this.player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED)]);
    if (object.getId() === BILE_STICKY) {
      const skill = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE][rand(0, 2)];
      const skills = this.player.getSkillManager();
      skills.setCurrentLevels(skill, Math.max(0, skills.getCurrentLevel(skill) - amount), true);
      this.player.getCombat().delayAttack(1);
    } else {
      this.player.getCombat().getPoisonClock().reduceProtection(45);
    }
  }

  screech() {
    this.clearHead();
    this.previousStyle = this.phase === "melee" ? this.previousStyle : this.phase;
    this.phase = "screech";
    this.screeched = true;
    this.npc.setDefenceLevel(100);
    this.animate(Common.data.combat.animations.screech);
    this.npc.performGraphic(new (Common.core().Graphic)(3793));
    for (let delay = 1; delay <= 3; delay++) this.at(delay, () => {
      // In the final melee-only phase, the screech has nothing to punish.
      if (this.npc.getHitpoints() > 305) this.blow("screech");
    });
    for (let i = 0; i < Common.data.combat.carrionPiles; i++) {
      const target = this.session.tile([rand(FLOOR.minX, FLOOR.maxX), rand(FLOOR.minY, FLOOR.maxY), 0]);
      this.carrion(target);
    }
    if (this.npc.getHitpoints() <= 1250) this.spawnLarvae();
    this.at(5, () => {
      this.npc.setDefenceLevel(200);
      const melee = this.npc.getHitpoints() <= 305 || (this.npc.getHitpoints() <= 980 && this.previousPhase !== "melee");
      this.phase = melee ? "melee" : (this.previousStyle === "ranged" ? "magic" : "ranged");
      this.previousPhase = this.phase;
      this.attacksLeft = rand(4, 8);
      const [x] = this.source(this.npc.getLocation());
      const posture = this.posture(x + 2, this.phase === "melee" ? 8038 : 8040);
      Common.core().PathFinder.calculateWalkRoute(this.npc, posture.getX(), posture.getY());
      this.nextAttack = this.tick + 2;
    });
  }

  carrion(location) {
    const { Projectile } = Common.core();
    new Projectile(this.npc.getLocation(), location, null, 3796, 0, 90, 100, 0, this.session.area).sendProjectile();
    this.graphic(Common.data.combat.shadowGraphic, location);
    this.at(3, () => {
      this.placeFloor(location, CARRION);
      this.graphic(3798, location);
      this.blow("carrion", "melee", location, 25);
      for (const at of this.shuffled(this.adjacent(location)).slice(0, 2)) {
        this.graphic(Common.data.combat.shadowGraphic, at);
        this.at(1, () => {
          this.placeFloor(at, CARRION);
          this.graphic(3798, at);
          this.blow("fragment", "melee", at, 10);
        });
      }
    });
  }

  windup() {
    this.clearHead();
    const [px] = this.source(this.player.getLocation());
    // Body remains on the northern five-tile floor; the 3x4 projected head can cover either arena edge.
    const posture = this.posture(px, 8038);
    Common.core().PathFinder.calculateWalkRoute(this.npc, posture.getX(), posture.getY());
    const headX = clamp(px - 1, FLOOR.minX, FLOOR.maxX - 2);
    this.winding = true;
    const ready = () => {
      if (!this.npc.getLocation().equals(posture)) {
        this.slamCycle = this.cycle() + 2;
        this.at(2, ready);
        return;
      }
      this.winding = false;
      this.slam(headX);
      this.attacksLeft--;
      this.nextAttack = this.tick + 3;
    };
    this.slamCycle = this.cycle() + 2;
    this.at(2, ready);
  }
  slam(headX) {
    const { GameObject, ObjectManager } = Common.core();
    this.animate(Common.data.combat.animations.melee);
    this.head = new GameObject(HEAD, this.session.tile([headX, FLOOR.minY, 0]), 10, 0, this.session.area);
    ObjectManager.register(this.head, true);
    this.blow("slam", "melee", [headX, FLOOR.minY]);
    const at = this.session.tile([rand(headX, headX + 2), rand(8035, 8036), 0]);
    this.bile(at, rand(0, 1) ? BILE_POISON : BILE_STICKY);
    this.at(1, () => this.clearHead());
  }
  clearHead() {
    if (this.head) Common.core().ObjectManager.deregister(this.head, true);
    this.head = null;
  }

  spawnLarvae() {
    const count = this.npc.getHitpoints() <= 299 ? Math.max(0, 4 - this.larvae.size) : 1;
    for (let i = 0; i < count; i++) {
      const row = rand(FLOOR.minY, FLOOR.maxY);
      const x = this.west ? FLOOR.minX : FLOOR.maxX;
      const at = this.session.tile([x, row, 0]);
      const npc = Common.api().spawnNpc({ id: Common.core().NpcIdentifiers.UR_MAGGOT_LARVAE,
        x: at.getX(), y: at.getY(), z: 0, owner: this.player, ownerOnly: true, wanderRadius: 0 });
      if (!npc) continue;
      npc.__skipDefaultRespawn = true;
      npc.setScriptedMovement(true);
      npc.setFlag("combat:no-retaliate");
      npc.performAnimation(new (Common.core().Animation)(Common.data.combat.animations.larvaFlight));
      npc.setMultiCombat(true);
      this.session.area.add(npc);
      const larva = { npc, fight: this, airborneUntil: this.tick + 3, direction: this.west ? 1 : -1, contact: 0 };
      npc.__maggotLarva = larva;
      this.larvae.add(larva);
      this.west = !this.west;
    }
  }
  heal(amount) { this.npc.setHitpoints(Math.min(1500, this.npc.getHitpoints() + amount)); }
  removeLarva(larva) {
    this.larvae.delete(larva);
    larva.npc.__maggotLarva = null;
    this.session.area.detach(larva.npc);
    Common.api().removeNpc(larva.npc);
  }
  processLarvae() {
    for (const larva of [...this.larvae]) {
      if (!larva.npc.isRegistered() || larva.npc.getHitpoints() <= 0) { this.removeLarva(larva); continue; }
      if (this.tick < larva.airborneUntil) continue;
      if (this.tick === larva.airborneUntil) larva.npc.performAnimation(new (Common.core().Animation)(-1));
      const location = larva.npc.getLocation();
      if (location.equals(this.player.getLocation())) {
        this.blow("larva", "melee", null, 3 + larva.contact++, larva);
        continue;
      }
      larva.contact = 0;
      const [x, y] = this.source(location);
      if (x + larva.direction < FLOOR.minX || x + larva.direction > FLOOR.maxX) larva.direction *= -1;
      larva.npc.moveTo(this.session.tile([x + larva.direction, y, 0]));
      const food = this.floor.get(this.key(larva.npc.getLocation()));
      if (food?.getId() === CARRION) { this.removeFloor(larva.npc.getLocation()); this.heal(1); }
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    Common.api().emitCustomEvent("combat:clear-burn", { target: this.npc });
    this.task?.stop();
    this.events = [];
    this.launch = null;
    this.winding = false;
    this.clearHead();
    for (const object of [...this.floor.values()]) this.removeFloor(object.getLocation());
    for (const larva of [...this.larvae]) this.removeLarva(larva);
  }
}

function fightOf(attacker, target) {
  const fight = target?.__maggotKingSession?.fight;
  return fight?.valid() && attacker === fight.player ? fight : null;
}
function standardAirborne(attacker, target) {
  const larva = target?.__maggotLarva;
  return larva?.fight.valid() && larva.fight.player === attacker && larva.fight.tick < larva.airborneUntil
    && attacker.getCombat().getRangedWeapon() != null
    && (Common.core().WeaponProfiles.ranged(attacker)?.rangedDefenceType ?? "standard") === "standard" ? larva : null;
}
function click({ player, npc }) {
  const fight = fightOf(player, npc);
  if (fight) fight.clickCycle = fight.cycle();
}
function punishEligible(fight, method) {
  return method?.type() === Common.core().CombatType.MELEE && fight.phase === "melee"
    && fight.clickCycle === fight.cycle() && fight.slamCycle === fight.cycle() && fight.punishSpent !== fight.cycle();
}
function timing(event) {
  const fight = fightOf(event.attacker, event.target);
  if (fight && punishEligible(fight, event.method)) { event.ignoreDelay = true; event.keepDelay = true; }
  if (event.method?.type() === Common.core().CombatType.RANGED && standardAirborne(event.attacker, event.target)) event.ignoreDelay = true;
}
function started({ attacker, target, method }) {
  const fight = fightOf(attacker, target);
  if (!fight) return;
  fight.launch = { punish: punishEligible(fight, method), defenceUsed: false, damageUsed: false };
  if (fight.launch.punish) fight.punishSpent = fight.cycle();
}
function finished({ attacker, target }) { const fight = fightOf(attacker, target); if (fight) fight.launch = null; }
function defence(event) {
  const fight = fightOf(event.attacker, event.target);
  // Compose stance and live burns without overwriting permanent bonus drains (Eye of Ayak).
  if (fight && event.combatType === Common.core().CombatType.MAGIC) {
    const bonus = fight.npc.getDefenceBonus(3);
    const burns = { target: fight.npc, stacks: 0 };
    Common.api().emitCustomEvent("combat:burn-remaining", burns);
    // Unmeasured mixed-source/minimum edge policy: all native stacks, effective bonus floor0.
    const effective = Math.max(0, bonus + (fight.phase === "melee" ? 250 : 0) - 20 * burns.stacks);
    if (effective !== bonus) event.defenceRoll = event.defenceRoll / (bonus + 64) * (effective + 64);
  }
  if (!fight?.launch?.punish || fight.launch.defenceUsed) return;
  fight.launch.defenceUsed = true;
  if (event.combatType === Common.core().CombatType.MELEE && event.attacker.getFightType().getBonusType() === 2) event.defenceRoll *= 0.15;
}
function fireBurn({ attacker, target, hit }) {
  if (!fightOf(attacker, target) || !hit.isAccurate()
      || hit.getCombatMethod().type() !== Common.core().CombatType.MAGIC) return;
  const { CombatSpells } = Common.core();
  const spell = hit.getSpell(); // The launched spell survives a cast/gear change before impact.
  if (![CombatSpells.FIRE_STRIKE, CombatSpells.FIRE_BOLT, CombatSpells.FIRE_BLAST,
    CombatSpells.FIRE_WAVE, CombatSpells.FIRE_SURGE].includes(spell)) return;
  Common.api().emitCustomEvent("combat:burn", { attacker, target, damage: 5 });
}
function damage(event) {
  const fight = fightOf(event.attacker, event.target);
  if (!fight?.launch?.punish || fight.launch.damageUsed) return;
  fight.launch.damageUsed = true;
  event.damage.setDamage(Math.floor(event.damage.getDamage() * 1.5));
}
function reach(event) {
  const fight = fightOf(event.attacker, event.target);
  if (fight?.phase === "melee" && fight.inFloor(event.attacker.getLocation()) && event.combatType === Common.core().CombatType.MELEE) {
    const [px] = fight.source(event.attacker.getLocation());
    const [bx] = fight.source(fight.npc.getLocation());
    if (px >= bx - 1 && px <= bx + 5) event.distance = Math.max(event.distance, 5);
  }
}
function strike({ player, object, objectId }) {
  if (objectId !== HEAD) return false;
  const session = require("./Instance.MaggotKing").sessionOf(player);
  const fight = session?.fight;
  if (!fight?.valid() || fight.head !== object || fight.phase !== "melee") return true;
  fight.clickCycle = fight.cycle();
  player.getCombat().attack(fight.npc);
  // Object operations resolve after the normal combat turn. Commit through the native checked path now.
  player.getCombat().performNewAttack(false);
  return true;
}
function ammoLanding(event) {
  const fight = fightOf(event.attacker, event.target);
  if (!fight) return;
  const [x, y] = fight.source(fight.player.getLocation());
  event.location = fight.session.tile([clamp(x, FLOOR.minX, FLOOR.maxX), clamp(y, FLOOR.minY, FLOOR.maxY), 0]);
}
function land({ hit }) {
  const spec = blows.get(hit);
  if (!spec) return;
  blows.delete(hit);
  spec.fight.landBlow(hit, spec);
}
function resolveMethod(attacker) {
  const target = attacker?.getCombat?.().getTarget?.();
  if (!standardAirborne(attacker, target)) return null;
  const { RangedCombatMethod, PendingHit } = Common.core();
  return new (class extends RangedCombatMethod {
    hits(player, npc) {
      return [new PendingHit(player, npc, this, { delay: 0, damage: npc.getHitpoints(), rollAccuracy: false })];
    }
  })();
}
function attach(api) {
  api.onNpcAttackOption(click);
  api.onAttackTiming(timing);
  api.onCombatAttackDistance(reach);
  api.onObjectInteraction("<col=ffff00>Maggot king head</col>", { Strike: strike });
  api.onPlayerHitModify(land);
  api.onCombatHitDamage(damage);
  api.onCombatHitResolved(fireBurn);
  api.onCustomEvent("combat:attack-started", started);
  api.onCustomEvent("combat:attack-finished", finished);
  api.onCustomEvent("combat:defence-roll", defence);
  api.onCustomEvent("ranged:ammo-drop-location", ammoLanding);
  api.registerCombatMethodResolver({ resolve: resolveMethod });
}

module.exports = { Fight, attach, FLOOR, BILE_POISON, BILE_STICKY, CARRION, HEAD, fightOf, standardAirborne };
