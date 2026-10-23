"use strict";

/**
 * The Archive Guardian, the first room. The Inert Guardian waits in the middle of the Nexus
 * until someone touches it; then it flies, shielded, and only grounds when its shield breaks.
 *
 * Captured (duo attempts as a fighter, four kills watched as a spectator, docs/fractured-archive.md):
 * - Touch: "Begin the challenge?" Yes./No. "Challenge started: Archive Guardian.", music 887,
 *   npc_archive_guardian_spawn01 with its graphic, the exit's ops gone; five ticks later it is
 *   tfa_guardian (16659) and the four batteries are active. Its shield, the batteries and its
 *   health (twice the shield) scale with the party: 550/180/1,100 for two up to 1,260/400/2,520
 *   for five.
 * - Flying, it acts every 5 ticks: a ranged attack (range_attack01, projectile 4201 per target,
 *   landing four ticks later with 4200), and every fifth a special that grows two mushrooms per
 *   player, one beside them and one three tiles off. A mushroom ripens three ticks later
 *   (nightmare_infection_spotanim_idle); a player beside a ripe one bursts it: poison 10 and
 *   "You have been poisoned!". A target 7+ tiles away makes it swoop (swoosh_attack01, a 40-56
 *   cycle exact move) to land a few tiles from them; a player under it is hit in melee (33 seen
 *   through Protect from Missiles). Melee can't reach it: "It's flying too high to hit using melee."
 * - The shield at 0: three ticks later idle_to_ground01, the landing blast, tfa_guardian_unshielded
 *   (16660) and the boss bar on its health, which carries over between landings. On the ground
 *   it doesn't attack; vines rise beside each player every three ticks from five ticks in
 *   (spawn, attacks at +3/+6/+9, gone at +13). The first landing lasts 35 ticks (41 for five);
 *   later ones end 3-4 ticks after its health drops below a third. Then ground_to_flying01 and a
 *   full shield.
 * - Enraged (below a third): in the air with no ranged attacks; every 20 ticks a special, five
 *   ticks later enraged_phase01 with "The Archive Guardian focuses intently on you!", ten ticks
 *   later 43 damage on that player, through prayer. A battery about four tiles from where it
 *   lands takes the blast instead (a hit of its full hitpoints, guthixian_battery_despawn, a
 *   camera shake, the destroyed battery), the player takes 20, and four ticks later the
 *   Guardian loses 40% of its shield. The second battery grounds it at once, taking the rest of
 *   the shield and as much again from its health. On the ground for good, its special, a dive
 *   three ticks later and the beam five after, every 20 ticks; no vines.
 * - The kill: death01, seven ticks later the dead Guardian and the batteries gone, section 1's
 *   doors opening (Hub.*); the bar fades at 11 and goes at 15.
 * - Players can hit the batteries too (captured hitsplats; the Wiki calls it charging them, for
 *   "~40% damage to shield"): a battery charged to its full hitpoints breaks as the beam breaks it.
 * Estimates (not in the captures): the damage figures other than the beam's (Wiki: max hit
 * 25), the swoop's trigger and landing, the vines', mushrooms' and batteries' reach, the camera
 * shake's length.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");
const Hub = require("./Hub.FracturedArchive");

const { SOUND, MUSIC } = Shared;

/** The room's layout, as captured. */
const LAYOUT = {
  guardian: { x: 4125, y: 5597, z: 0 },
  batteries: [{ x: 4139, y: 5592 }, { x: 4139, y: 5605 }, { x: 4114, y: 5605 }, { x: 4114, y: 5592 }],
  exit: { x: 4124, y: 5569, z: 0, face: 0 },
  ocellusDoor: { x: 4124, y: 5621, face: 0 },
};

/** Timings in ticks (captured unless noted). */
const TIME = {
  IDLE_GRAPHIC: 3,
  TRANSFORM: 5,
  ATTACK: 5,
  SPECIAL_EVERY: 5,
  RANGED_LANDS: 4,
  MELEE_LANDS: 1,
  MUSHROOM_RIPENS: 3,
  /** A ripe mushroom bursts this long after a player is beside it (captured: 5 after spawning). */
  MUSHROOM_FUSE: 2,
  MUSHROOM_GONE: 2,
  LAND_AFTER_BREAK: 3,
  /** The first landing: 35 ticks (41 for five players), captured. */
  FIRST_WINDOW: 35,
  FIRST_WINDOW_FIVE: 41,
  /** Later landings end on the hitpoint thirds (captured); this caps one that never gets there. */
  WINDOW_GROWTH: 6,
  /** A landing ends this long after its health drops below a third (captured: 3-4 ticks). */
  TAKE_OFF_AFTER_THIRD: 3,
  VINES_FROM: 5,
  VINE_EVERY: 3,
  VINE_ATTACKS: [3, 6, 9],
  VINE_DESPAWN: 12,
  VINE_GONE: 13,
  ENRAGE_CYCLE: 20,
  FOCUS_AFTER_SPECIAL: 5,
  BEAM_AFTER_FOCUS: 10,
  BATTERY_DESTROYED: 2,
  BATTERY_DAMAGE: 4,
  /** The kill (captured): the dead Guardian 7 ticks after its death, the bar fading at 11, gone at 15. */
  DEATH: 7,
  HUD_FADE: 11,
  HUD_GONE: 15,
  /** The final landing (captured): a dive 3 ticks after each special, the beam 5 after. */
  DIVE_AFTER_SPECIAL: 3,
};

/** Damage. Captured: the beam's 43 and 20, the battery's 220; the rest are estimates. */
const DAMAGE = {
  RANGED: 25,
  RANGED_PRAYED: 0.4,
  /**
   * The fighter capture (under Protect from Missiles): hits of 1-10 about 22 times each, 0 62 times
   * of 290; the zeros beyond the damage roll's share are misses, ~13%. Unprayed misses aren't
   * captured; the same rate is assumed.
   */
  RANGED_MISS: 0.13,
  MELEE: 35,
  MELEE_PRAYED: 0.5,
  VINE: 20,
  VINE_PRAYED: 0.5,
  POISON: 10,
  BEAM: 43,
  BEAM_ABSORBED: 20,
};

/**
 * Hitpoints by party size (captured with 2-5 players): the shield, the batteries, and the
 * health pool on the ground, always twice the shield. A battery's break takes 40% of the shield.
 */
const SHIELD = { 2: 550, 3: 800, 4: 1030, 5: 1260 };
const BATTERY = { 2: 180, 3: 250, 4: 330, 5: 400 };
const BATTERY_SHARE = 0.4;
const SWOOP_FROM = 7;
const SWOOP_LAND = 3;
const SWOOP_CYCLES = 48;
/** Estimate: one ranged attack in four or five went to both players. */
const RANGED_SPREAD_CHANCE = 0.22;
const BATTERY_REACH = 4;
const VINE_REACH = 1;
const MUSHROOM_REACH = 1;
/** The boss bar's back, sliding and remaining colours: blue for the shield, as captured. */
const SHIELD_COLOURS = [132, 623, 853];
const HEALTH_COLOURS = [25600, 576, 800];
const FOCUS_MESSAGE = "@mes_hl_ora@The Archive Guardian focuses intently on you!";
const CAMERA_SHAKE = [[0, 5], [1, 2], [2, 2]];
/** A camera shake runs until reset; this long after it starts (estimate: a spectator never sees it). */
const CAMERA_SHAKE_TICKS = 3;
const RANGED_PROJECTILE = { delay: 48, end: 116, angle: 127, progress: 0, startHeight: 0, endHeight: 0 };

const PHASE = { INERT: "inert", WAKING: "waking", FLYING: "flying", LANDING: "landing", GROUNDED: "grounded", DEAD: "dead" };

class GuardianRoom extends Raid.Room {
  onBuild() {
    const { npc, loc } = Shared.ids();
    this.phase = PHASE.INERT;
    this.maxShield = this.scaled(SHIELD);
    this.maxHealth = this.maxShield * 2;
    this.health = this.maxHealth;
    this.landings = 0;
    this.enraged = false;
    this.final = false;
    this.batteriesBroken = 0;
    this.mushrooms = [];
    this.vines = new Set();
    this.guardian = this.spawn(npc.GUARDIAN_START, LAYOUT.guardian, { scripted: true, face: Shared.core().Direction.SOUTH.getId() });
    this.batteries = LAYOUT.batteries.map((tile) => this.spawn(npc.BATTERY_INACTIVE, { ...tile, z: 0 }, { scripted: true }));
    this.exit = this.placeObject(loc.EXIT, LAYOUT.exit, 10, LAYOUT.exit.face);
    Hub.placeGuardianDoors(this);
    this.placeObject(loc.OCELLUS_DOOR, { ...LAYOUT.ocellusDoor, z: 0 }, 10, LAYOUT.ocellusDoor.face);
    this.repeat(TIME.IDLE_GRAPHIC, () => {
      if (this.phase !== PHASE.INERT) return false;
      this.guardian.performGraphic(Shared.gfx(Shared.id("spotanim", "GUARDIAN_IDLE")));
      return true;
    });
  }

  /** "Touch": the challenge, once everyone agrees. */
  touch(player) {
    if (this.phase !== PHASE.INERT || this.raid.member(player).roomKey !== this.key) return;
    Shared.options(player, "Begin the challenge?", "Yes.", () => {
      if (this.phase === PHASE.INERT) this.start();
    }, "No.", () => {});
  }

  onStart() {
    const { Animation } = Shared.core();
    this.phase = PHASE.WAKING;
    // Scaled for the party that touched it (Room.start fixed the size).
    this.maxShield = this.scaled(SHIELD);
    this.maxHealth = this.maxShield * 2;
    this.health = this.maxHealth;
    this.setExitOps(false);
    this.guardian.performGraphic(Shared.gfx(Shared.id("spotanim", "GUARDIAN_SPAWN")));
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_SPAWN")));
    this.later(TIME.TRANSFORM, () => this.wake());
  }

  wake() {
    const { npc } = Shared.ids();
    this.guardian.setNpcTransformationId(npc.GUARDIAN);
    this.guardian.performAnimation(new (Shared.core().Animation)(Shared.id("seq", "GUARDIAN_IDLE")));
    for (const battery of this.batteries) {
      battery.setNpcTransformationId(npc.BATTERY_ACTIVE);
      this.setHitpoints(battery, this.scaled(BATTERY));
    }
    this.fly(true);
    for (const player of this.fighters()) {
      Shared.api().emitCustomEvent("boss-hud:show", { player, npcId: npc.GUARDIAN, current: this.shield, maximum: this.maxShield, colours: SHIELD_COLOURS });
    }
  }

  // ---------------------------------------------------------------- flying

  /** Up in the air with a full shield; the attack cycle starts over. */
  fly(first = false) {
    this.phase = PHASE.FLYING;
    this.shield = this.maxShield;
    this.setHitpoints(this.guardian, this.maxShield);
    this.attacks = 0;
    this.nextAttack = Shared.cycle() + (first ? 4 : TIME.ATTACK);
    this.nextSwoop = Shared.cycle() + 1;
    this.nextEnrageSpecial = Shared.cycle() + (first ? 4 : TIME.ATTACK);
    this.focus = null;
    this.updateHud(Shared.id("npc", "GUARDIAN"), this.shield, this.maxShield, SHIELD_COLOURS);
  }

  tick() {
    if (!this.isStarted()) return;
    this.tickMushrooms();
    if (this.phase === PHASE.FLYING) this.tickFlying();
    else if (this.phase === PHASE.GROUNDED && this.final) this.tickEnraged(Shared.cycle());
    this.syncHud();
  }

  tickFlying() {
    const now = Shared.cycle();
    if (this.enraged) {
      this.tickEnraged(now);
      return;
    }
    if (now >= this.nextSwoop && now < this.nextAttack - 1) this.maybeSwoop(now);
    if (now < this.nextAttack) return;
    this.nextAttack = now + TIME.ATTACK;
    this.attacks++;
    const under = this.fighters().filter((player) => Shared.distanceTo(this.guardian, player.getLocation()) === 0);
    if (under.length > 0) {
      this.melee(under);
      return;
    }
    if (this.attacks % TIME.SPECIAL_EVERY === 0) this.special();
    else this.ranged();
  }

  target() {
    const fighters = this.fighters();
    if (fighters.length === 0) return null;
    const current = this.guardian.getCombat().getTarget?.();
    return fighters.includes(current) ? current : Shared.randomOf(fighters);
  }

  centre() {
    const at = this.guardian.getLocation();
    return { x: at.getX() + 2, y: at.getY() + 2, z: at.getZ() };
  }

  /** It keeps facing its target (captured: a face-entity on its target). */
  facePlayer(player) {
    this.guardian.setMobileInteraction(player);
  }

  ranged() {
    const target = this.target();
    if (!target) return;
    const { Animation } = Shared.core();
    this.facePlayer(target);
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_RANGED")));
    this.guardian.performGraphic(Shared.gfx(Shared.id("spotanim", "RANGED_CAST")));
    const targets = Math.random() < RANGED_SPREAD_CHANCE ? this.fighters() : [target];
    for (const player of targets) {
      Shared.projectile(this.area, this.guardian, player, Shared.id("spotanim", "RANGED_PROJECTILE"), RANGED_PROJECTILE);
      // The prayer counts as the attack is thrown (captured: switching after it is too late).
      // Rarely a miss (captured ~13%), not a full accuracy roll against the player's defence.
      const hit = this.styledHit(this.guardian, player, "ranged", DAMAGE.RANGED, TIME.RANGED_LANDS, { prayerMultiplier: DAMAGE.RANGED_PRAYED, accurate: Math.random() >= DAMAGE.RANGED_MISS });
      this.later(TIME.RANGED_LANDS, () => {
        if (!this.fighters().includes(player)) return;
        // In graphic slot 2, as live plays it (fighter capture).
        player.performGraphicInSlot(2, Shared.gfx(Shared.id("spotanim", "RANGED_HIT"), { height: 0 }));
        Shared.core().CombatFactory.executeHit(hit);
      });
    }
  }

  melee(players) {
    const { Animation } = Shared.core();
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_MELEE")));
    for (const player of players) this.strike(this.guardian, player, "melee", DAMAGE.MELEE, TIME.MELEE_LANDS, { prayerMultiplier: DAMAGE.MELEE_PRAYED });
  }

  /** Two mushrooms per player: one beside them, one three tiles off. */
  special() {
    const { Animation } = Shared.core();
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_SPECIAL")));
    this.guardian.performGraphic(Shared.gfx(Shared.id("spotanim", "SPECIAL")));
    for (const player of this.fighters()) {
      for (const distance of [1, 3]) {
        const tile = this.freeTileAround(player.getLocation(), distance);
        if (tile) this.growMushroom(tile);
      }
    }
  }

  /** A free floor tile at exactly `distance` (Chebyshev) from a location. */
  freeTileAround(location, distance) {
    const ring = [];
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dy = -distance; dy <= distance; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) continue;
        ring.push({ x: location.getX() + dx, y: location.getY() + dy, z: location.getZ() });
      }
    }
    return Shared.shuffle(ring).find((tile) => Shared.inArchive(Shared.loc(tile)) && Shared.floorFree(this.area, tile)
      && Shared.distanceTo(this.guardian, tile) > 0
      && ![...this.vines].some((vine) => vine.getLocation().getX() === tile.x && vine.getLocation().getY() === tile.y)
      && !this.mushrooms.some((mushroom) => mushroom.tile.x === tile.x && mushroom.tile.y === tile.y)) ?? null;
  }

  /** Lands its centre a few tiles from a far-off target (an estimate of how live picks it). */
  maybeSwoop(now) {
    const target = this.target();
    if (!target) return;
    const centre = this.centre();
    const at = target.getLocation();
    const distance = Math.max(Math.abs(at.getX() - centre.x), Math.abs(at.getY() - centre.y));
    if (distance < SWOOP_FROM) return;
    const dx = Math.sign(centre.x - at.getX());
    const dy = Math.sign(centre.y - at.getY());
    const landing = Shared.loc({ x: at.getX() + dx * SWOOP_LAND - 2, y: at.getY() + dy * SWOOP_LAND - 2, z: at.getZ() });
    if (!Shared.inArchive(landing)) return;
    const { Animation } = Shared.core();
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_SWOOSH")));
    this.guardian.exactMove(landing, { endCycles: SWOOP_CYCLES });
    this.nextSwoop = now + TIME.ATTACK * 2;
  }

  // ---------------------------------------------------------------- mushrooms

  growMushroom(tile) {
    const object = this.placeObject(Shared.id("loc", "MUSHROOM_SPAWN"), tile);
    const mushroom = { tile, object, ripe: false, armedAt: 0, burstAt: 0 };
    this.mushrooms.push(mushroom);
    this.later(TIME.MUSHROOM_RIPENS, () => {
      if (!this.mushrooms.includes(mushroom)) return;
      mushroom.object = this.replaceObject(mushroom.object, Shared.id("loc", "MUSHROOM_ACTIVE"));
      mushroom.ripe = true;
      const { Animation } = Shared.core();
      const animation = new Animation(Shared.id("seq", "MUSHROOM_IDLE"));
      for (const viewer of this.area.getPlayers()) viewer.getPacketSender().sendObjectAnimation(mushroom.object, animation);
    });
  }

  tickMushrooms() {
    const now = Shared.cycle();
    const fighters = this.fighters();
    for (const mushroom of [...this.mushrooms]) {
      if (!mushroom.ripe) continue;
      const near = fighters.filter((player) => Shared.distanceTo(player, mushroom.tile) <= MUSHROOM_REACH && player.getLocation().getZ() === mushroom.tile.z);
      if (mushroom.burstAt === 0 && near.length > 0) mushroom.burstAt = now + TIME.MUSHROOM_FUSE;
      if (mushroom.burstAt > 0 && now >= mushroom.burstAt) this.burst(mushroom, near);
    }
  }

  burst(mushroom, players) {
    this.mushrooms = this.mushrooms.filter((other) => other !== mushroom);
    mushroom.object = this.replaceObject(mushroom.object, Shared.id("loc", "MUSHROOM_DESPAWN"));
    Shared.areaSound(this.area, mushroom.tile, SOUND.MUSHROOM_POP);
    const { CombatFactory } = Shared.core();
    for (const player of players) {
      CombatFactory.poisonEntity(player, DAMAGE.POISON);
      Shared.damage(player, DAMAGE.POISON, "GREEN");
    }
    const object = mushroom.object;
    this.later(TIME.MUSHROOM_GONE, () => this.removeObject(object));
  }

  // ---------------------------------------------------------------- the shield and the ground

  /** Damage on the Guardian: melee can't reach it in the air, and its shield takes the rest. */
  modifyHit(npc, hit) {
    if (npc === this.guardian && this.phase !== PHASE.FLYING && this.phase !== PHASE.GROUNDED) {
      zero(hit);
      return;
    }
  }

  /** The Guardian's hitpoints running out is a landing (shield) or its end (health). */
  holdsOn(npc) {
    if (npc === this.guardian) {
      if (this.phase === PHASE.FLYING) this.breakShield();
      else if (this.phase === PHASE.GROUNDED) this.die();
      return true;
    }
    if (this.batteries.includes(npc)) {
      // Players charge a battery by hitting it (Wiki: "~40% damage to shield"); at full charge it breaks.
      if (!npc.__tfaDestroyed && npc.getId() === Shared.id("npc", "BATTERY_ACTIVE")) this.destroyBattery(npc);
      npc.setHitpoints(1);
      return true;
    }
    return this.vines.has(npc);
  }

  canAttack(attacker, target, method) {
    if (target !== this.guardian || !attacker?.isPlayer?.()) return null;
    if (this.phase === PHASE.INERT || this.phase === PHASE.WAKING || this.phase === PHASE.DEAD) return false;
    if (this.phase === PHASE.FLYING && method?.type?.() === Shared.core().CombatType.MELEE) {
      attacker.sendMessage("It's flying too high to hit using melee.");
      return false;
    }
    return null;
  }

  breakShield() {
    this.phase = PHASE.LANDING;
    this.shield = 0;
    // Its facing resets as the shield breaks and stays off on the ground (captured).
    this.guardian.setMobileInteraction(null);
    this.guardian.setHitpoints(1);
    this.syncHud();
    this.later(TIME.LAND_AFTER_BREAK, () => this.land());
  }

  /**
   * On the ground. The first landing lasts its captured time; later ones end three ticks after
   * the health drops below the next third (2/3, then 1/3, which enrages it). After the enraged
   * flight it lands for good: no vines, its special and dives on a 20-tick cycle, until it dies.
   */
  land() {
    const { Animation } = Shared.core();
    const { npc } = Shared.ids();
    this.phase = PHASE.GROUNDED;
    this.landings++;
    this.final = this.enraged;
    this.guardian.setNpcTransformationId(npc.GUARDIAN_UNSHIELDED);
    // Its cache stand pose is the flying idle; live sends the ground idle as it lands (captured bas).
    this.guardian.setBaseAnimations({ idle: Shared.named("seq", "npc_archive_guardian_ground_idle01") });
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_LAND")));
    this.guardian.performGraphic(Shared.gfx(Shared.id("spotanim", "LAND")));
    Shared.graphicAt(this.area, Shared.id("spotanim", "LANDING_BLAST"), this.centre(), { delay: 20 });
    this.setHitpoints(this.guardian, this.maxHealth);
    this.guardian.setHitpoints(Math.max(1, this.health));
    this.updateHud(npc.GUARDIAN_UNSHIELDED, this.health, this.maxHealth, HEALTH_COLOURS);
    this.thirdCrossed = this.thirdsAbove(this.health);
    this.takingOff = false;
    if (this.final) {
      this.nextEnrageSpecial = Shared.cycle() + TIME.ENRAGE_CYCLE;
      return;
    }
    const first = this.landings === 1;
    const window = first
      ? (this.size >= 5 ? TIME.FIRST_WINDOW_FIVE : TIME.FIRST_WINDOW)
      : TIME.FIRST_WINDOW + TIME.WINDOW_GROWTH * (this.landings - 1);
    const landing = this.landings;
    for (let at = TIME.VINES_FROM; at < window - TIME.VINE_ATTACKS[0]; at += TIME.VINE_EVERY) {
      this.later(at, () => {
        if (this.phase === PHASE.GROUNDED && this.landings === landing && !this.final) this.raiseVines();
      });
    }
    this.later(window, () => {
      if (this.phase === PHASE.GROUNDED && this.landings === landing) this.takeOff();
    });
  }

  /** How many of the health pool's thirds (2/3, 1/3) a value is still above. */
  thirdsAbove(health) {
    return [2 / 3, 1 / 3].filter((share) => health > this.maxHealth * share).length;
  }

  takeOff() {
    if (this.phase !== PHASE.GROUNDED || this.final) return;
    const { Animation } = Shared.core();
    this.health = Math.max(1, this.guardian.getHitpoints());
    this.guardian.setNpcTransformationId(Shared.id("npc", "GUARDIAN"));
    this.guardian.setBaseAnimations(null);
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_TAKE_OFF")));
    this.guardian.performGraphic(Shared.gfx(Shared.id("spotanim", "TAKE_OFF")));
    this.fly();
  }

  /** A vine beside each player, facing them; it lashes three times and sinks (captured timing). */
  raiseVines() {
    const { Animation } = Shared.core();
    for (const player of this.fighters()) {
      const tile = this.freeTileAround(player.getLocation(), 1);
      if (!tile) continue;
      const vine = this.spawn(Shared.id("npc", "TENTACLE"), tile, { scripted: true });
      if (!vine) continue;
      this.vines.add(vine);
      vine.setPositionToFace(player.getLocation());
      vine.performAnimation(new Animation(Shared.id("seq", "TENTACLE_SPAWN")));
      vine.performGraphic(Shared.gfx(Shared.id("spotanim", "TENTACLE_INTRO")));
      Shared.areaSound(this.area, vine, SOUND.TENTACLE);
      for (const at of TIME.VINE_ATTACKS) {
        this.later(at, () => {
          if (!vine.isRegistered?.()) return;
          vine.performAnimation(new Animation(Shared.id("seq", "TENTACLE_ATTACK")));
          for (const target of this.fighters()) {
            if (Shared.distanceTo(vine, target.getLocation()) > VINE_REACH) continue;
            // Damage with no attacker, so it doesn't pull the player's auto retaliate onto the vine.
            const prayed = Shared.isProtected(target, "melee");
            Shared.damage(target, Math.floor(Shared.random(0, DAMAGE.VINE) * (prayed ? DAMAGE.VINE_PRAYED : 1)));
          }
        });
      }
      this.later(TIME.VINE_DESPAWN, () => vine.performAnimation(new Animation(Shared.id("seq", "TENTACLE_DESPAWN"))));
      this.later(TIME.VINE_GONE, () => {
        this.vines.delete(vine);
        this.despawn(vine);
      });
    }
  }

  // ---------------------------------------------------------------- enraged

  /** On the ground, each third crossed ends the landing three ticks later; the last enrages it. */
  checkThirds() {
    if (this.final || this.takingOff) return;
    const above = this.thirdsAbove(this.health);
    if (above >= this.thirdCrossed) return;
    this.thirdCrossed = above;
    this.takingOff = true;
    const landing = this.landings;
    this.later(TIME.TAKE_OFF_AFTER_THIRD, () => {
      if (this.phase !== PHASE.GROUNDED || this.landings !== landing) return;
      if (above === 0) {
        this.enraged = true;
        this.nextEnrageSpecial = Shared.cycle() + TIME.ATTACK;
      }
      this.takeOff();
    });
  }

  /** Enraged (in the air, then on the ground for good): special, the beam 5 ticks later. */
  tickEnraged(now) {
    if (now < this.nextEnrageSpecial) return;
    this.nextEnrageSpecial = now + TIME.ENRAGE_CYCLE;
    this.special();
    if (this.final) this.later(TIME.DIVE_AFTER_SPECIAL, () => this.dive());
    this.later(TIME.FOCUS_AFTER_SPECIAL, () => this.focusOn());
  }

  /** The final landing's dive at its target (captured: a swoosh 3 ticks after each special). */
  dive() {
    const target = this.target();
    if (!target || this.phase !== PHASE.GROUNDED) return;
    const { Animation } = Shared.core();
    const at = target.getLocation();
    const landing = Shared.loc({ x: at.getX() - 2, y: at.getY() - 2, z: at.getZ() });
    if (!Shared.inArchive(landing)) return;
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_SWOOSH")));
    this.guardian.exactMove(landing, { endCycles: SWOOP_CYCLES });
  }

  focusOn() {
    if (!this.enraged || (this.phase !== PHASE.FLYING && !(this.phase === PHASE.GROUNDED && this.final))) return;
    const target = this.target();
    if (!target) return;
    const { Animation } = Shared.core();
    this.facePlayer(target);
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_ENRAGED")));
    this.guardian.performGraphicInSlot(2, Shared.gfx(Shared.id("spotanim", "ENRAGED")));
    target.sendMessage(FOCUS_MESSAGE);
    this.later(TIME.BEAM_AFTER_FOCUS, () => this.beam(target));
  }

  /** The beam lands where the player stands; a live battery close by takes it instead. */
  beam(target) {
    if (!this.fighters().includes(target) || (this.phase !== PHASE.FLYING && !this.final)) return;
    const at = target.getLocation();
    this.guardian.setPositionToFace(at);
    // On the ground for good it faces its target only for the beam.
    if (this.phase === PHASE.GROUNDED) this.later(1, () => this.phase === PHASE.GROUNDED && this.guardian.setMobileInteraction(null));
    const activeId = Shared.id("npc", "BATTERY_ACTIVE");
    const battery = this.batteries.find((npc) => npc.getId() === activeId && !npc.__tfaDestroyed && Shared.distanceTo(npc, at) <= BATTERY_REACH);
    if (!battery) {
      Shared.damage(target, DAMAGE.BEAM);
      return;
    }
    Shared.damage(target, DAMAGE.BEAM_ABSORBED);
    // The beam fills it at once (captured: a hit of its full hitpoints); its death breaks it.
    Shared.damage(battery, battery.getHitpoints(), "YELLOW");
  }

  destroyBattery(battery) {
    const { Animation } = Shared.core();
    battery.performAnimation(new Animation(Shared.id("seq", "BATTERY_DESPAWN")));
    battery.__tfaDestroyed = true;
    this.later(TIME.BATTERY_DESTROYED, () => {
      battery.setNpcTransformationId(Shared.id("npc", "BATTERY_DESTROYED"));
      const shaken = this.roomPlayers();
      for (const player of shaken) {
        Shared.sound(player, SOUND.BATTERY_EXPLODE);
        for (const [axis, amplitude] of CAMERA_SHAKE) player.getPacketSender().sendCameraShake(axis, amplitude);
      }
      this.later(CAMERA_SHAKE_TICKS, () => {
        for (const player of shaken) player.getPacketSender().sendCameraReset();
      });
    });
    this.batteriesBroken++;
    const second = this.batteriesBroken >= 2;
    this.later(TIME.BATTERY_DAMAGE, () => {
      if (this.phase !== PHASE.FLYING) return;
      // The second break grounds it at once: the rest of the shield goes, and as much again
      // from its health (captured: 612 to 524, 342 to 274, 801 to 581).
      if (second) {
        const rest = this.guardian.getHitpoints();
        this.health = Math.max(1, this.health - rest);
        Shared.damage(this.guardian, rest, "YELLOW");
        return;
      }
      const dealt = Math.min(this.guardian.getHitpoints(), Math.floor(this.maxShield * BATTERY_SHARE));
      Shared.damage(this.guardian, dealt, "YELLOW");
    });
  }

  // ---------------------------------------------------------------- the end

  /**
   * The kill (captured in four fights): death01 with its graphic, then seven ticks later the
   * dead Guardian, the batteries gone, section 1's doors opening and the room complete; the
   * bar fades at 11 and goes at 15. The Alliance's Guardians of Armadyl then run in.
   */
  die() {
    if (this.phase === PHASE.DEAD) return;
    const { Animation } = Shared.core();
    this.phase = PHASE.DEAD;
    this.health = 0;
    this.guardian.setHitpoints(1);
    this.guardian.performAnimation(new Animation(Shared.id("seq", "GUARDIAN_DEATH")));
    this.guardian.performGraphicInSlot(2, Shared.gfx(Shared.id("spotanim", "DEATH"), { height: 200 }));
    for (const vine of [...this.vines]) this.despawn(vine);
    this.vines.clear();
    this.later(TIME.DEATH, () => {
      this.guardian.setNpcTransformationId(Shared.id("npc", "GUARDIAN_DEAD"));
      for (const battery of this.batteries) this.despawn(battery);
      this.complete();
    });
    this.later(TIME.HUD_FADE, () => {
      for (const player of this.roomPlayers()) Shared.api().emitCustomEvent("boss-hud:fade", { player, fadeIn: false });
    });
    this.later(TIME.HUD_GONE, () => {
      for (const player of this.roomPlayers()) Shared.api().emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
    });
  }

  onComplete() {
    this.clearMushrooms();
    this.setExitOps(true);
    Hub.openFirstSection(this);
    this.alliance();
  }

  /** Armacus and the Guardians of Armadyl come in from the south and run north (captured). */
  alliance() {
    const { npcs, tiles, runTo } = HUB_DATA.postGuardian;
    npcs.forEach((name, index) => {
      const npcId = Shared.core().CacheDefinitions.getNpcId(name);
      if (npcId === null || npcId === undefined) return;
      const [x, y] = tiles[index];
      const npc = this.spawn(npcId, { x, y, z: 0 }, { face: Shared.core().Direction.NORTH.getId() });
      if (!npc) return;
      this.later(1, () => {
        npc.getMovementQueue().reset();
        npc.getMovementQueue().addSteps(Shared.loc({ x: runTo[0] + (index % 3) - 1, y: runTo[1], z: 0 }));
      });
    });
  }

  onFail() {
    this.clearMushrooms();
  }

  clearMushrooms() {
    for (const mushroom of this.mushrooms) this.removeObject(mushroom.object);
    this.mushrooms = [];
  }

  // ---------------------------------------------------------------- the boss bar

  updateHud(npcId, current, maximum, colours) {
    this.hud = { npcId, current, maximum, colours };
    for (const player of this.fighters()) Shared.api().emitCustomEvent("boss-hud:update", { player, ...this.hud });
  }

  /** The bar follows the shield or the health each tick, and the enrage is checked on health. */
  syncHud() {
    if (!this.hud) return;
    const points = this.phase === PHASE.FLYING ? this.guardian.getHitpoints()
      : this.phase === PHASE.LANDING ? 0
        : this.phase === PHASE.GROUNDED ? this.guardian.getHitpoints() : this.hud.current;
    if (this.phase === PHASE.GROUNDED) {
      this.health = points;
      this.checkThirds();
    }
    if (points === this.hud.current) return;
    this.hud.current = points;
    for (const player of this.fighters()) Shared.api().emitCustomEvent("boss-hud:update", { player, current: points });
  }

  // ---------------------------------------------------------------- the exit

  /** The exit's ops are off while the challenge runs (captured: opflags 0). */
  setExitOps(enabled) {
    const { loc } = Shared.ids();
    this.removeObject(this.exit);
    this.exit = this.placeObject(loc.EXIT, LAYOUT.exit, 10, LAYOUT.exit.face);
    if (!enabled) this.exit.getOpFlags = () => 0;
    for (const player of this.area.getPlayers()) {
      player.getPacketSender().sendObjectRemoval(this.exit);
      player.getPacketSender().sendObject(this.exit);
    }
  }
}

function zero(hit) {
  for (const part of hit.getHits?.() ?? []) part.setDamage(0);
  hit.updateTotalDamage?.();
}

function touchGuardian(event) {
  const raid = Raid.raidOf(event.player);
  const room = raid?.room;
  if (!(room instanceof GuardianRoom) || event.npc !== room.guardian) return false;
  room.touch(event.player);
  return true;
}

const HUB_DATA = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "data", "fractured-archive.json"), "utf8")).hub;

module.exports = function registerGuardian(api) {
  Shared.bind(api);
  Raid.registerRoom("GUARDIAN", GuardianRoom);
  api.onNpcInteraction("<col=00ffff>Inert Guardian</col>", { Touch: touchGuardian });
};

Object.assign(module.exports, { GuardianRoom, LAYOUT, TIME, DAMAGE, PHASE, SHIELD, BATTERY });
