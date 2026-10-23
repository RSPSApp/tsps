/**
 * Nex's specials and what they leave on players (docs/nex.md). Captured: every line, message,
 * animation, sound, loc and tick below; the Wiki gives who is chosen, the max hits and the rules:
 * - Smoke: the virus ("Let the virus flow through you!": three coughs that drain prayer and the
 *   best style's levels, spreading to anyone beside the coughing player; a gas mask, facemask or
 *   slayer helmet halves it) and Smoke Dash ("There is..." / "NO ESCAPE!": down one of the four
 *   aisles, up to 50 to anyone in it). Her smoke spells can drag someone 2-6 tiles away to her.
 * - Shadow: Shadow Smash ("Fear the shadow!": a shadow under everyone, up to 50 four ticks later)
 *   and Embrace Darkness ("Embrace darkness!": the room darkens, more so near her, and lingering
 *   beside her hurts every tick).
 * - Blood: Blood Siphon ("A siphon will solve this!": blood reavers, and every hit heals her while
 *   she kneels) and Blood Sacrifice ("I demand a blood sacrifice!": the marked player must get 7
 *   tiles away within six ticks, or takes up to 50 and splashes up to 12 on those beside them).
 * - Ice: Containment ("Contain this!": icicles in the 5x5 around her, up to 60 to anyone inside,
 *   halved by Protect from Missiles) and Ice Prison ("Die now, in a prison of ice!": stalagmites
 *   around a player that shatter for up to 75 eight ticks later unless one is broken).
 * - Her ice spells freeze for 15 ticks unless the player prays against magic; a freeze only lands
 *   if the last one ended over 5 ticks before (Mod Ash).
 */
const Common = require("./Common.Nex");
const Attacks = require("./Attacks.Nex");

const FREEZE_TICKS = 15;
const FREEZE_GAP = 5;
/** Protection prayers stay off this long (the engine's prayer-block timer counts seconds; Sever's 8 ticks). */
const PRAYER_BLOCK_SECONDS = 5;
/** Thrown out of her way (the dash, the ice prison's ring): seq 1157, the cache's human_troll_flyback. Unverified: no capture has a player thrown. */
const THROWN_ANIM = 1157;
/** Containment's icicles hold anyone inside for 10 ticks. Unverified: no OSRS source (docs/nex.md). */
const CONTAINMENT_HOLD_TICKS = 10;
const REAVER_SELF_HEAL = 0.25;
const REAVER_HITPOINTS = 150;
const GAS_PROTECTION = ["gas mask", "facemask"];

function data() {
  return Common.data.specials;
}

/** What Nex leaves on players: the virus, the darkness, freezes, the ice prison and marked players. */
class Effects {
  constructor(fight) {
    this.fight = fight;
    this.virus = new Map();
    this.frozenUntil = new Map();
    this.darkness = null;
    this.prison = null;
    this.locs = new Set();
  }

  process(players) {
    this.processVirus(players);
    this.processDarkness(players);
  }

  // ---------------------------------------------------------------- the virus

  infect(player, spread) {
    const virus = data().virus;
    if (this.virus.has(player)) return;
    this.virus.set(player, { since: this.fight.tick });
    this.fight.record.coughing.add(player);
    player.sendMessage(spread ? virus.spread : virus.start);
  }

  /** Coughs on the captured ticks, spreading to anyone beside; gone 11 ticks after it began. */
  processVirus(players) {
    const virus = data().virus;
    for (const [player, state] of [...this.virus]) {
      const elapsed = this.fight.tick - state.since;
      if (!players.includes(player) || player.getHitpoints() <= 0) {
        this.cure(player, false);
        continue;
      }
      if (elapsed >= virus.endTick) {
        this.cure(player, true);
        continue;
      }
      if (!virus.coughTicks.includes(elapsed)) continue;
      player.forceChat(virus.cough);
      player.performGraphic(Common.graphic(virus.graphic[0], { height: virus.graphic[1] }));
      player.getPacketSender().sendSoundEffect(virus.coughSound, 1, 0);
      const amount = wearsGasProtection(player) ? Math.ceil(virus.drain / 2) : virus.drain;
      Attacks.drainPrayer(player, amount);
      const { Skill } = Common.core;
      for (const skill of bestStyleSkills(player)) player.getSkillManager().decreaseCurrentLevel(Skill[skill], amount, 1);
      for (const other of players) {
        if (other === player || this.virus.has(other)) continue;
        if (other.getLocation().getDistance(player.getLocation()) <= 1) this.infect(other, true);
      }
    }
  }

  cure(player, message) {
    if (!this.virus.delete(player)) return;
    this.fight.record.coughing.delete(player);
    if (message) player.sendMessage(data().virus.end);
  }

  // ---------------------------------------------------------------- the darkness

  startDarkness() {
    this.darkness = { until: this.fight.tick + data().darkness.ticks, shades: new Map(), close: new Map() };
  }

  stopDarkness() {
    const darkness = this.darkness;
    if (!darkness) return;
    this.darkness = null;
    for (const player of darkness.shades.keys()) this.lift(player);
  }

  lift(player) {
    const spec = data().darkness;
    if (!player.isRegistered?.()) return;
    player.getPacketSender().sendClientScript(spec.script, spec.shades.clear);
    player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM ?? 0, spec.recedes);
  }

  /** Each tick the shade eases toward one by distance (captured: about 40 a tick); 7 ticks at the darkest hurts. */
  processDarkness(players) {
    const darkness = this.darkness;
    if (!darkness) return;
    const spec = data().darkness;
    if (this.fight.tick >= darkness.until) {
      this.stopDarkness();
      return;
    }
    for (const player of [...darkness.shades.keys()]) {
      if (players.includes(player)) continue;
      darkness.shades.delete(player);
      this.lift(player);
    }
    for (const player of players) {
      const distance = this.fight.distanceTo(player);
      const goal = distance <= 1 ? spec.shades.near : distance <= 2 ? spec.shades.close : distance <= 4 ? spec.shades.mid : spec.shades.far;
      const current = darkness.shades.get(player) ?? spec.shades.far;
      const shade = current > goal ? Math.max(goal, current - spec.step) : Math.min(goal, current + spec.step);
      darkness.shades.set(player, shade);
      player.getPacketSender().sendClientScript(spec.script, shade);
      const close = shade === spec.shades.near ? (darkness.close.get(player) ?? 0) + 1 : 0;
      darkness.close.set(player, close);
      if (close < spec.engulfAfter) continue;
      if (close === spec.engulfAfter) player.sendMessage(spec.engulf);
      const amount = Common.randomInt(spec.damage[0], spec.damage[1]);
      Common.damage(player, amount);
      player.getPacketSender().sendSoundEffect(spec.damageSound, 1, 0);
      this.fight.noteHit(player, "darkness", amount);
    }
  }

  // ---------------------------------------------------------------- freezes

  /** Mod Ash: a freeze only lands if the last one ended over 5 ticks ago. */
  freeze(player, ticks) {
    const ended = this.frozenUntil.get(player);
    if (ended != null && this.fight.tick < ended + FREEZE_GAP) return false;
    this.frozenUntil.set(player, this.fight.tick + ticks);
    Common.core.CombatFactory.freeze(player, ticks * 0.6);
    return true;
  }

  // ---------------------------------------------------------------- temporary locs

  /** A loc in the fight's arena for `ticks` ticks (shadows, icicles, stalagmites). */
  placeLoc(id, location, ticks, face = 0) {
    const { GameObject, ObjectManager } = Common.core;
    const object = new GameObject(id, location, 10, face, this.fight.arena.area);
    ObjectManager.register(object, true);
    this.locs.add(object);
    if (ticks > 0) Common.later(ticks, () => this.removeLoc(object));
    return object;
  }

  removeLoc(object) {
    if (!this.locs.delete(object)) return;
    Common.core.ObjectManager.deregister(object, true);
  }

  playerLeft(player) {
    this.cure(player, false);
    if (this.darkness?.shades.delete(player)) this.lift(player);
    this.frozenUntil.delete(player);
  }

  clear() {
    this.stopDarkness();
    for (const player of [...this.virus.keys()]) this.cure(player, false);
    for (const object of [...this.locs]) this.removeLoc(object);
    this.prison = null;
  }
}

/** The best attack style's levels, which the virus drains (Wiki). */
function bestStyleSkills(player) {
  const bonuses = player.getBonusManager?.()?.getAttackBonus?.() ?? [];
  const melee = Math.max(bonuses[0] ?? 0, bonuses[1] ?? 0, bonuses[2] ?? 0);
  const magic = bonuses[3] ?? 0;
  const ranged = bonuses[4] ?? 0;
  if (melee >= magic && melee >= ranged) return ["ATTACK", "STRENGTH"];
  return ranged >= magic ? ["RANGED"] : ["MAGIC"];
}

function wearsGasProtection(player) {
  const { ItemDefinition } = Common.core;
  const head = player.getEquipment().getItems()[0];
  const name = String(ItemDefinition.forId(head?.getId?.() ?? -1)?.getName?.() ?? "").toLowerCase();
  return GAS_PROTECTION.includes(name) || name.includes("slayer helmet");
}

function magicDefence(player) {
  return player.getBonusManager?.()?.getDefenceBonus?.()?.[3] ?? 0;
}

const alive = (fight) => fight.players().filter((player) => player.getHitpoints() > 0);

// ------------------------------------------------------------------ smoke

/** Wiki: the player furthest away with the least magic defence. */
function virus(fight) {
  const players = alive(fight);
  if (players.length === 0) return null;
  const spec = data().virus;
  const target = [...players].sort((a, b) => magicDefence(a) - magicDefence(b) || fight.distanceTo(b) - fight.distanceTo(a))[0];
  fight.say(spec.say);
  fight.boss.performAnimation(Common.animation(spec.anim));
  fight.areaSound(spec.sound);
  fight.at(1, () => fight.effects.infect(target, false));
  return spec.nextAttackTicks;
}

/** Wiki: someone 2-6 tiles away, 1/4 (1/8 praying against magic); pulled when the smoke lands. */
function dragCandidate(fight) {
  const spec = data().drag;
  const close = alive(fight).filter((player) => fight.distanceTo(player) > 1 && fight.distanceTo(player) <= spec.range);
  if (close.length === 0) return null;
  const player = Common.pick(close);
  const chance = Common.protectedStyle(player) === "magic" ? spec.chancePraying : spec.chance;
  return Math.random() < chance ? player : null;
}

function drag(fight, player) {
  const spec = data().drag;
  if (fight.stage !== "fighting" || player.getHitpoints() <= 0) return;
  const spot = besideHer(fight, player);
  player.sendMessage(spec.message);
  player.getMovementQueue().reset();
  if (spot) player.moveTo(spot);
  player.performAnimation(Common.animation(spec.anim));
  player.getPacketSender().sendSoundEffect(spec.sound, 1, 0);
  Common.later(1, () => {
    if (!player.isRegistered()) return;
    player.performAnimation(Common.animation(-1));
    disableProtection(player);
  });
}

/** The free tile beside her body nearest the player. */
function besideHer(fight, player) {
  const { RegionManager } = Common.core;
  const base = fight.boss.getLocation();
  const at = player.getLocation();
  let best = null;
  let bestDistance = Infinity;
  for (let x = -1; x <= 3; x++) {
    for (let y = -1; y <= 3; y++) {
      if (x >= 0 && x <= 2 && y >= 0 && y <= 2) continue;
      const tile = base.transform(x, y);
      if (RegionManager.blocked(tile, fight.arena.area)) continue;
      const distance = tile.getDistance(at);
      if (distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Protection prayers off and blocked for a while (the engine's prayer-block timer); "You've been
 * injured and can't use protection prayers!" when one was on (unverified: every captured case had one on).
 */
function disableProtection(player) {
  const { PrayerHandler } = Common.core;
  const praying = PrayerHandler.PROTECTION_PRAYERS.some((prayer) => PrayerHandler.isActivated(player, prayer));
  player.getCombat().getPrayerBlockTimer().start(PRAYER_BLOCK_SECONDS);
  PrayerHandler.resetPrayers(player, PrayerHandler.PROTECTION_PRAYERS);
  if (praying) player.sendMessage(Common.data.fight.messages.injured);
}

/** Holds a player where they stand: no moving or acting, no stun graphic or message. */
function hold(player, ticks) {
  player.getMovementQueue().reset();
  Common.core.CombatFactory.stunTicks(player, ticks, true, { graphic: null, message: false });
}

/**
 * Throws a player toward `dest` as a forced move (seq 1157), stopping on the last walkable tile of
 * the line, so nobody lands in a wall.
 */
function thrown(fight, player, dest, startCycles, endCycles) {
  const { ForceMovement, ForceMovementTask, Location, RegionManager, TaskManager } = Common.core;
  const at = player.getLocation();
  const steps = Math.max(Math.abs(dest.getX() - at.getX()), Math.abs(dest.getY() - at.getY()));
  let land = null;
  for (let i = steps; i >= 1 && !land; i--) {
    const x = at.getX() + Math.round(((dest.getX() - at.getX()) * i) / steps);
    const y = at.getY() + Math.round(((dest.getY() - at.getY()) * i) / steps);
    if (!RegionManager.blocked(new Location(x, y, at.getZ()), fight.arena.area)) land = [x, y];
  }
  if (!land) return;
  const dx = land[0] - at.getX();
  const dy = land[1] - at.getY();
  const direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 0 : 2);
  TaskManager.submit(new ForceMovementTask(player, Math.max(1, Math.ceil(endCycles / 30)),
    new ForceMovement(at.clone(), new Location(dx, dy, 0), startCycles, endCycles, direction, THROWN_ANIM)));
}

/** Smoke Dash, as captured: the line, a turn to the aisle, "NO ESCAPE!", then the charge home. */
function dash(fight) {
  const spec = data().dash;
  const aisle = Common.pick(Common.data.chamber.aisles);
  const end = fight.tile(aisle.end);
  const home = fight.tile(Common.data.chamber.nexTile);
  fight.say(spec.say);
  fight.boss.performAnimation(Common.animation(spec.anim[0], spec.anim[1]));
  fight.target = null;
  fight.boss.setMobileInteraction(null);
  fight.busyUntil = fight.tick + spec.nextAttackTicks;
  fight.boss.getMovementQueue().reset();
  fight.at(spec.turnTick, () => fight.boss.faceTile(end.transform(1, 1)));
  fight.at(spec.escapeTick, () => {
    fight.say(spec.escape);
    fight.boss.faceTile(end.transform(1, 1));
  });
  fight.at(spec.moveTick, () => {
    if (fight.stage !== "fighting") return;
    fight.immuneUntil = fight.tick + (spec.stopTick - spec.moveTick);
    fight.boss.moveTo(end);
    fight.boss.exactMove(home, { startCycles: spec.moveCycles[0], endCycles: spec.moveCycles[1], angle: aisle.angle });
    charge(fight, aisle, end, home);
  });
  fight.at(spec.stopTick, () => fight.boss.performAnimation(Common.animation(-1)));
  return spec.nextAttackTicks;
}

/**
 * Wiki: up to 50 to anyone in the aisle she charges down. Unverified (nobody was hit in the captures): a tick into the charge they
 * are thrown (seq 1157, cycles 30-80) to 3 tiles past her middle tile along the dash, hit the next.
 */
function charge(fight, aisle, end, home) {
  const spec = data().dash;
  const zone = aisle.zone;
  const dir = [Math.sign(home.getX() - end.getX()), Math.sign(home.getY() - end.getY())];
  const dest = home.transform(dir[0] * spec.throwTiles, dir[1] * spec.throwTiles);
  const victims = alive(fight).filter((player) => {
    const [x, y] = fight.arena.real(player.getLocation());
    return x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY;
  });
  Common.later(1, () => {
    if (fight.stage !== "fighting") return;
    for (const player of victims) {
      if (!player.isRegistered() || player.getHitpoints() <= 0) continue;
      thrown(fight, player, dest, spec.throwCycles[0], spec.throwCycles[1]);
      const amount = Common.randomInt(0, spec.maxHit);
      Common.later(1, () => {
        if (fight.stage !== "fighting" || !player.isRegistered()) return;
        player.sendMessage(spec.hit);
        Common.damage(player, amount);
        fight.noteHit(player, "dash", amount);
      });
    }
  });
}

// ------------------------------------------------------------------ shadow

function smash(fight) {
  const spec = data().smash;
  fight.say(spec.say);
  fight.boss.performAnimation(Common.animation(spec.anim));
  for (const player of alive(fight)) {
    const at = player.getLocation().clone();
    const shadow = fight.effects.placeLoc(Common.data.objects.shadow, at, 0);
    fight.at(spec.eruptTicks, () => {
      fight.effects.removeLoc(shadow);
      const erupted = fight.effects.placeLoc(Common.data.objects.shadowErupted, at, spec.clearTicks - spec.eruptTicks);
      Common.tileGraphic(fight.players(), at, spec.graphic);
      Common.areaSound(fight.players(), at, spec.sound);
      for (const victim of alive(fight)) {
        if (!victim.getLocation().equals(at)) continue;
        const amount = Common.randomInt(0, spec.maxHit);
        victim.sendMessage(spec.hit);
        Common.damage(victim, amount);
        fight.noteHit(victim, "smash", amount);
      }
      return erupted;
    });
  }
  return spec.nextAttackTicks;
}

function darkness(fight) {
  const spec = data().darkness;
  fight.say(spec.say);
  fight.boss.performAnimation(Common.animation(spec.anim));
  fight.areaSound(spec.sound);
  for (const player of fight.players()) player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM ?? 0, spec.begins);
  fight.effects.startDarkness();
  return spec.nextAttackTicks;
}

// ------------------------------------------------------------------ blood

/** She kneels, healing from every hit; a reaver per three players, at least one (captured: one, solo or duo). */
function siphon(fight) {
  const spec = data().siphon;
  fight.say(spec.say);
  fight.boss.performAnimation(Common.animation(spec.anim));
  fight.boss.performGraphic(Common.graphic(spec.graphic));
  fight.boss.getMovementQueue().reset();
  fight.target = null;
  fight.boss.setMobileInteraction(null);
  fight.killReavers(true);
  const count = Math.max(1, Math.min(spec.maxReavers, Math.ceil(fight.players().length / spec.playersPerReaver)));
  for (let i = 0; i < count; i++) spawnReaver(fight);
  fight.siphonUntil = fight.tick + spec.kneelTicks;
  fight.busyUntil = fight.tick + spec.kneelTicks;
  fight.at(spec.kneelTicks, () => fight.boss.performAnimation(Common.animation(-1)));
  return spec.nextAttackTicks;
}

function spawnReaver(fight) {
  const spec = data().siphon;
  const { RegionManager } = Common.core;
  const base = fight.boss.getLocation();
  for (let attempt = 0; attempt < 50; attempt++) {
    const tile = base.transform(Common.randomInt(-6, 6), Common.randomInt(-6, 6));
    if (!fight.arena.inChamber(tile) || Common.distanceToBody(tile, base, 3) < 2) continue;
    let free = true;
    for (let x = 0; x < 2 && free; x++) {
      for (let y = 0; y < 2 && free; y++) free = !RegionManager.blocked(tile.transform(x, y), fight.arena.area);
    }
    if (!free) continue;
    const reaver = fight.arena.spawnAt(Common.data.npcs.reaver, tile);
    if (!reaver) return;
    reaver.__nexFight = fight;
    reaver.performGraphic(Common.graphic(spec.reaverGraphic));
    fight.areaSound(spec.reaverSound, tile);
    fight.reavers.push(reaver);
    const target = Common.pick(alive(fight));
    if (target) reaver.getCombat().attack(target);
    return;
  }
}

function reaverDied(fight, npc) {
  fight.reavers = fight.reavers.filter((reaver) => reaver !== npc);
}

/** The marked player has six ticks to get 7 tiles away (captured timing, Wiki distance). */
function sacrifice(fight) {
  const spec = data().sacrifice;
  const players = alive(fight);
  if (players.length === 0) return null;
  const marked = Common.pick(players);
  fight.say(spec.say);
  fight.areaSound(spec.sound);
  marked.getPacketSender().sendSoundEffect(spec.synth, 1, 0);
  marked.sendMessage(spec.marked);
  marked.tint(spec.tint);
  fight.at(spec.resolveTicks, () => {
    if (fight.stage !== "fighting" || marked.getHitpoints() <= 0 || !fight.players().includes(marked)) return;
    if (fight.distanceTo(marked) >= spec.escapeDistance) {
      marked.sendMessage(spec.escaped);
      return;
    }
    marked.sendMessage(spec.failed);
    fight.boss.performAnimation(Common.animation(spec.failAnim));
    fight.areaSound(spec.failSound);
    const { Skill } = Common.core;
    const prayer = (player) => player.getSkillManager().getCurrentLevel(Skill.PRAYER);
    let healed = 0;
    for (const player of alive(fight)) {
      const splash = player !== marked;
      if (splash && player.getLocation().getDistance(marked.getLocation()) > 1) {
        player.sendMessage(spec.unleashed);
        continue;
      }
      const cycles = Common.projectile(fight.boss, player, { ...spec.projectile, start: Common.data.fight.attacks.projectileStart });
      const amount = Common.randomInt(0, splash ? spec.splashMaxHit : spec.maxHit);
      if (splash) player.sendMessage(spec.unleashed);
      healed += amount;
      Common.later(Common.landsIn(cycles), () => {
        if (!player.isRegistered()) return;
        player.performGraphic(Common.graphic(spec.impact));
        player.getPacketSender().sendSoundEffect(spec.impactSound, 1, 0);
        Common.damage(player, amount);
        Attacks.drainPrayer(player, Math.floor(prayer(player) / 3));
        fight.noteHit(player, "sacrifice", amount);
      });
    }
    Common.later(2, () => fight.stage === "fighting" && Common.healNpc(fight.boss, healed, Common.data.fight.hitpoints));
  });
  return spec.nextAttackTicks;
}

// ------------------------------------------------------------------ ice

function ring(minX, minY, maxX, maxY) {
  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (x === minX || x === maxX || y === minY || y === maxY) tiles.push([x, y]);
    }
  }
  return tiles;
}

/** Icicles in the 5x5 around her, five ticks after the line (captured); anyone inside is hit. */
function containment(fight) {
  const spec = data().containment;
  fight.say(spec.say);
  fight.boss.performAnimation(Common.animation(spec.anim));
  fight.at(spec.placeTicks, () => {
    if (fight.stage !== "fighting") return;
    const base = fight.boss.getLocation();
    const [minX, minY, maxX, maxY] = [base.getX() - 1, base.getY() - 1, base.getX() + 3, base.getY() + 3];
    const z = base.getZ();
    const { Location } = Common.core;
    for (const [x, y] of ring(minX, minY, maxX, maxY)) fight.effects.placeLoc(Common.data.objects.containment, new Location(x, y, z), spec.clearTicks);
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) fight.effects.placeLoc(Common.data.objects.blocker, base.transform(x, y), spec.clearTicks);
    }
    fight.areaSound(spec.sound);
    for (const player of alive(fight)) {
      const at = player.getLocation();
      if (at.getX() < minX || at.getX() > maxX || at.getY() < minY || at.getY() > maxY) continue;
      player.sendMessage(spec.spiked);
      disableProtection(player);
      hold(player, CONTAINMENT_HOLD_TICKS);
      player.performAnimation(Common.animation(spec.playerAnim));
      player.getPacketSender().sendSoundEffect(spec.playerSound, 1, 0);
      const max = Common.protectedStyle(player) === "ranged" ? Math.floor(spec.maxHit / 2) : spec.maxHit;
      const amount = Common.randomInt(0, max);
      Common.later(1, () => {
        if (!player.isRegistered()) return;
        Common.damage(player, amount);
        fight.noteHit(player, "containment", amount);
      });
    }
  });
  return spec.nextAttackTicks;
}

/** Stalagmites around a player when her projectile lands; they shatter eight ticks later. */
function prison(fight) {
  const spec = data().prison;
  const players = alive(fight);
  if (players.length === 0) return null;
  const target = Common.pick(players);
  fight.say(spec.say);
  fight.boss.performAnimation(Common.animation(spec.anim));
  fight.areaSound(spec.sound);
  const cycles = Common.projectile(fight.boss, target, { ...spec.projectile, start: Common.data.fight.attacks.projectileStart });
  fight.at(Common.landsIn(cycles), () => {
    if (fight.stage !== "fighting" || target.getHitpoints() <= 0 || !fight.players().includes(target)) return;
    const centre = target.getLocation().clone();
    const inside = alive(fight).filter((player) => player.getLocation().equals(centre));
    const { Location, RegionManager } = Common.core;
    const stalagmites = [];
    for (const [x, y] of ring(centre.getX() - 1, centre.getY() - 1, centre.getX() + 1, centre.getY() + 1)) {
      // Only on walkable tiles, and anyone standing on one is pushed a tile outward (unverified: not captured).
      const tile = new Location(x, y, centre.getZ());
      if (RegionManager.blocked(tile, fight.arena.area)) continue;
      for (const player of alive(fight)) {
        if (!player.getLocation().equals(tile)) continue;
        thrown(fight, player, tile.transform(Math.sign(x - centre.getX()), Math.sign(y - centre.getY())), 80, 80);
      }
      stalagmites.push(fight.effects.placeLoc(Common.data.objects.icePrison, tile, 0));
    }
    const blocker = fight.effects.placeLoc(Common.data.objects.blocker, centre, 0);
    for (const player of inside) {
      player.sendMessage(spec.trapped);
      disableProtection(player);
      hold(player, spec.shatterTicks);
    }
    const state = { stalagmites, blocker, inside, broken: false };
    fight.effects.prison = state;
    fight.at(spec.shatterTicks, () => {
      if (fight.effects.prison !== state) return;
      release(fight, state);
      for (const player of inside) {
        if (!player.isRegistered() || player.getHitpoints() <= 0) continue;
        player.sendMessage(spec.shatters);
        player.getPacketSender().sendSoundEffect(spec.shatterSound, 1, 0);
        const amount = Common.randomInt(0, spec.maxHit);
        Common.later(1, () => {
          Common.damage(player, amount);
          fight.noteHit(player, "prison", amount);
        });
      }
    });
  });
  return spec.nextAttackTicks;
}

function release(fight, state) {
  if (fight.effects.prison === state) fight.effects.prison = null;
  for (const object of state.stalagmites) fight.effects.removeLoc(object);
  fight.effects.removeLoc(state.blocker);
}

/** Attack on a stalagmite: a stab or crush weapon may break it, freeing those inside (Wiki). */
function attackStalagmite({ player, object }) {
  const fight = fightAt(player);
  const state = fight?.effects?.prison;
  if (!state || !state.stalagmites.some((loc) => loc.getLocation().equals(object.getLocation()))) return false;
  const spec = data().prison;
  if (state.inside.includes(player)) {
    player.sendMessage(spec.frozenInside);
    return true;
  }
  const style = player.getFightType?.()?.getBonusType?.();
  const twoHanded = player.getEquipment().getItems()[3]?.getId?.() > 0 && Common.core.ItemDefinition.forId(player.getEquipment().getItems()[3].getId())?.isDoubleHanded?.();
  if ((style !== 0 && style !== 2 && style != null) || twoHanded) {
    player.sendMessage(spec.unsuitable);
    return true;
  }
  player.performAnimation(Common.animation(player.getAttackAnim?.() ?? 422));
  const bonuses = player.getBonusManager?.()?.getAttackBonus?.() ?? [];
  const bonus = Math.max(bonuses[0] ?? 0, bonuses[2] ?? 0);
  const chance = 0.25 + Math.min(1, Math.max(0, bonus) / 130) * 0.75;
  if (Math.random() >= chance) {
    player.sendMessage(spec.fail);
    return true;
  }
  player.sendMessage(spec.success);
  Common.areaSound(fight.players(), object.getLocation(), [spec.breakSound, 0, 7]);
  fight.effects.removeLoc(object);
  for (const trapped of state.inside) trapped.sendMessage(spec.freed);
  Common.later(1, () => release(fight, state));
  return true;
}

/** The fight in the player's arena. */
function fightAt(player) {
  return require("./Chamber.Nex").fightFor(player);
}

/** Her ice spell's freeze: 15 ticks unless praying against magic (Mod Ash). */
function iceFreeze(fight, player) {
  if (Common.protectedStyle(player) === "magic") return;
  if (fight.effects.freeze(player, FREEZE_TICKS)) {
    player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM ?? 0, Common.data.fight.messages.frozen);
  }
}

const SPECIALS = { virus, dash, smash, darkness, siphon, sacrifice, containment, prison };

/** Runs a special; returns the ticks until her next attack, or null if it couldn't happen. */
function run(fight, name) {
  return SPECIALS[name]?.(fight) ?? null;
}

/** A phase's mage died: Umbra takes the darkness with him, Cruor his reavers (healing her, Wiki). */
function phaseEnded(fight, key) {
  if (key === "shadow") fight.effects.stopDarkness();
  if (key === "blood") fight.killReavers(true);
}

function interrupt(fight) {
  fight.effects.clear();
}

/** The reavers: Blood Blitz at a player, as captured (seq 9194, projectile 372, impact 373). */
function reaverClass() {
  const { CombatMethod, CombatType, PendingHit, CombatFactory } = Common.core;
  return class NexReaverCombat extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 8;
    }

    attackSpeed() {
      return 4;
    }

    start(npc, target) {
      npc.performAnimation(Common.animation(9194));
      Common.projectile(npc, target, { id: 372, start: 42, angle: 4, startHeight: 0, endHeight: 3 });
    }

    hits(npc, target) {
      const hit = new PendingHit(npc, target, this, 2);
      CombatFactory.applyStyleDamage(hit, 20, {});
      return [hit];
    }

    /** A reaver heals itself a quarter of the damage it deals (unverified: not captured). */
    handleAfterHitEffects(hit) {
      const target = hit.getTarget();
      if (!target?.isPlayer?.() || !hit.isAccurate()) return;
      target.performGraphic(Common.graphic(373));
      const reaver = hit.getAttacker();
      const damage = hit.getTotalDamage();
      if (damage > 0) reaver.setHitpoints(Math.min(REAVER_HITPOINTS, reaver.getHitpoints() + Math.floor(damage * REAVER_SELF_HEAL)));
    }
  };
}

function attachSpecials(api) {
  api.registerNpcCombatMethodProvider(Common.data.npcs.reaver, reaverClass(), { singleton: false });
  api.onObjectInteraction("Stalagmite", { Attack: attackStalagmite });
}

module.exports = {
  attachSpecials, Effects, run, phaseEnded, interrupt, reaverDied, dragCandidate, drag, iceFreeze, attackStalagmite,
  SPECIALS, bestStyleSkills, wearsGasProtection,
};
