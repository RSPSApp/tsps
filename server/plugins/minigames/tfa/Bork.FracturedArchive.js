"use strict";

/**
 * Bork and the Smorks (section 1, east). Bork chases a player beating his gong; the Smorks'
 * cannon tower shells the rest of the party. Its heavy cannonball dazes Bork if it lands on him,
 * and he then stomps the room flat but for the tower's shadow.
 *
 * From the spectator captures of four fights (two to four players; docs/fractured-archive.md) and
 * the Wiki's strategy, Bork and Smorks pages:
 * - Spawns and bar:
 *   - Bork (16640, 4x4) at 4194,5603 and the Smorks' tower (16641, 3x3) at 4190,5598, both facing
 *     the entrance; nine projectile-blocking locs on the tower's tiles.
 *   - The bar is npc 16642 (bork_smork_hp_ui_handler) with Bork's hitpoints, and the second bar
 *     shows the Smorks' (colours 9312/22784/31104). Hitpoints by party size: Bork 1,500/2,180/2,810,
 *     the Smorks about 40% of that.
 *   - Bork's flat armour is 10 (0 while dazed; 2 against magic), the Smorks' 2 (Wiki).
 * - The start: sound 12769. Bork goes for the first player in (Wiki), facing and following them.
 * - Bork's gong (gong_melee01, synth 10051), eight ticks in and then every 7, 6, 5 or 4 ticks as
 *   the tempo rises: two strikes two ticks apart. The second shakes the ring of tiles touching
 *   him; the first reaches out to his target when they stand two or three tiles off (a "stronger
 *   beat with a larger area": captured 2- and 3-tile rings then, the dust a cycle later a tile).
 * - The Smorks (cannon_attack01, from the tower's centre), facing whom they shoot:
 *   - Volleys of all bones (ranged, projanim 4056) or all potions (magic, 4057) at every player
 *     but Bork's target (Wiki; captured: one fewer than the party), flying 150, 120, then 90 cycles.
 *   - Their cycle (captured): the first volley 13 ticks in, then napalm; later cycles two or three
 *     volleys, napalm, one or two volleys, the heavy cannonball; volleys a tempo's spacing apart
 *     (7, 6, 5, 4), the next one 2 x spacing - 1 after the napalm, 39 ticks after a daze.
 *   - Napalm (an incendiary cannonball): "Burny gloop!" / "Fireeeeeeeeee!" / "Hot stuff!" with a
 *     goblin voice; a tick later the cast (sound 12240) and the shadow on its tile; four ticks
 *     after, the fire (12239) splashing from it towards the tower, two or three tiles (captured
 *     shapes; 3 cycles a tile); a tick later oil splatters there for 199 ticks. Heavy damage on
 *     the splash; oil 6-7 a tick and a burn from 2 (Wiki); on Bork, moderate damage to him.
 *   - The heavy cannonball: "Big bomb! Bork watch out!"; two ticks later the cast (12248) and the
 *     shadow on a player's tile other than Bork's target's; it lands five ticks after that.
 * - Landing on Bork (every captured one: the party lures him onto it): "Oof.", dazed
 *   (14_cycle_stun01, sounds 3201, 12273, 12758, 12249), a Smork line: "Bork! We sorry! No go!" /
 *   "No! Fearless leader!" / "That you fault!". Dazed, his armour is gone and melee always hits
 *   (Wiki). Fourteen ticks later "Bork very angry!!" and the stomp: four shockwaves three ticks
 *   apart over the arena (his own tiles too) rolling out from his feet, the tower's shadow safe.
 *   Then "Bork smash <player> now." and the gong again. Missing him, the stomp comes anyway:
 *   "Bork think it stomp time now!" (Wiki).
 * - The tempo rises at the Smorks' 75/50/25%:
 *   - "Bork get into it!" / "Smorks go faster!"
 *   - "Bork make fast drum!" / "Smorks feeling drum beat now!"
 *   - "Bork maximum crush!" / "Smorks go fastest!"
 * - Deaths:
 *   - Bork: death01, "Smorks... avenge... Bork.", gone seven ticks later with "Human die for
 *     that!"; four ticks on the Smorks' frenzy: a volley at everyone every two ticks, napalm every
 *     fourteen (five volleys between).
 *   - The Smorks: "Uh oh." (12761), the tower's death graphics two ticks later (12251), fading out,
 *     gone at nine; the oil crumbles. With them gone first, Bork's stomps cover the whole arena.
 *   - The room is won when both have fallen.
 * Estimates (a spectator sees no damage on players): every damage figure, the burn's ticking, the
 * missed cannonball's timing, Bork's stomps after the Smorks fall, and the target after a death.
 */

const Shared = require("./Shared.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");

const { named, anim, spot } = Shared;

const LAYOUT = {
  bork: { x: 4194, y: 5603, z: 0 },
  smork: { x: 4190, y: 5598, z: 0 },
  arena: { minX: 4184, maxX: 4198, minY: 5591, maxY: 5607, z: 0 },
};
const BORK_HP = { 2: 1500, 3: 2180, 4: 2810 };
const SMORK_HP = { 2: 600, 3: 870, 4: 1120 };
const EXTRA_COLOURS = [9312, 22784, 31104];

const TIME = {
  FIRST_GONG: 8,
  GONG: [7, 6, 5, 4],
  GONG_SECOND: 2,
  FIRST_VOLLEY: 13,
  SPACING: [7, 6, 5, 4],
  AFTER_DAZE: 39,
  NAPALM_CAST: 1,
  NAPALM_LANDS: 4,
  OIL_LASTS: 199,
  BOMB_CAST: 2,
  BOMB_LANDS: 5,
  STOMP_IN: 14,
  STOMP: 2,
  SHOCKWAVES: [3, 6, 9, 12],
  RECOVER: 8,
  RETARGET: 15,
  GONG_RESUMES: 19,
  MISSED_STOMP: 2,
  STOMP_ALONE: 45,
  BORK_GONE: 7,
  FRENZY_AFTER: 4,
  FRENZY: 2,
  FRENZY_VOLLEYS: 5,
  SMORK_GRAPHICS: 2,
  SMORK_FADES: 7,
  SMORK_GONE: 9,
  BURN_EVERY: 4,
  BURN_HITS: 5,
};
const FLIGHT = [150, 120, 90, 90];
const ARMOUR = { BORK: 10, BORK_MAGIC: 2, SMORK: 2 };

const DAMAGE = { GONG: 30, VOLLEY: 25, NAPALM: 35, NAPALM_ON_BORK: 50, OIL: [6, 7], BURN: 2, BOMB: 40, SHOCKWAVE: 35 };

const LINES = {
  napalm: ["Burny gloop!", "Fireeeeeeeeee!", "Hot stuff!"],
  sorry: ["Bork! We sorry! No go!", "No! Fearless leader!", "That you fault!"],
  tempo: [
    ["Bork get into it!", "Smorks go faster!"],
    ["Bork make fast drum!", "Smorks feeling drum beat now!"],
    ["Bork maximum crush!", "Smorks go fastest!"],
  ],
};
/** The goblins' voices with a napalm line (captured: one at random). */
const NAPALM_VOICES = [12747, 12748, 12750, 12751, 12752, 12753, 12754, 12755, 12756];
const TEMPO_AT = [75, 50, 25];

/**
 * The napalm's splash from its tile towards the tower (captured, 18 of them): the tile itself and,
 * straight on, the 2x3 beyond it; diagonally, the 2x2. Given for east and north-east; the others
 * are these turned. One or two drips land beside the tile at random.
 */
const SPLASH = {
  straight: [[0, 0], [1, -1], [1, 0], [1, 1], [2, -1], [2, 0], [2, 1]],
  diagonal: [[0, 0], [1, 1], [1, 2], [2, 1], [2, 2]],
};
const DRIPS = 2;
/** His footprint's edge tiles but the corners, anticlockwise from the south edge's east one. */
const FEET = [[2, 0], [3, 1], [3, 2], [2, 3], [1, 3], [0, 2], [0, 1], [1, 0]];

class BorkRoom extends Raid.Room {
  onBuild() {
    const face = Shared.core().Direction.WEST.getId();
    this.bork = this.spawn(named("npc", "tfa_bork"), LAYOUT.bork, { scripted: true, face });
    this.smork = this.spawn(named("npc", "tfa_smork"), LAYOUT.smork, { scripted: true, face });
    // The tower stops projectiles (captured: invisible block-range locs on its 3x3).
    const block = named("loc", "invisible_type8_blockrange");
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) this.placeObject(block, { x: LAYOUT.smork.x + dx, y: LAYOUT.smork.y + dy, z: 0 });
    this.oil = new Map();
    this.burns = new Map();
    this.tempo = 0;
    this.stunned = false;
    this.stomping = false;
    this.borkDead = false;
    this.smorkDead = false;
  }

  onStart() {
    this.setHitpoints(this.bork, this.scaled(BORK_HP));
    this.setHitpoints(this.smork, this.scaled(SMORK_HP));
    this.showBar(named("npc", "tfa_bork_smork_hp_ui_handler"), this.bork.getMaxHitpoints());
    this.extraBar(this.smork.getHitpoints(), this.smork.getMaxHitpoints(), EXTRA_COLOURS);
    Shared.areaSound(this.area, this.bork, 12769);
    const fighters = this.fighters();
    this.setTarget(fighters.includes(this.starter) ? this.starter : fighters.find((player) => inArena(Shared.tileOf(player))) ?? fighters[0]);
    this.nextGong = Shared.cycle() + TIME.FIRST_GONG;
    this.smorkCycle(TIME.FIRST_VOLLEY, true);
  }

  tick() {
    if (!this.isStarted()) return;
    const now = Shared.cycle();
    this.burnOil();
    if (!this.borkDead && !this.stunned && !this.stomping) {
      this.chase();
      if (now >= this.nextGong) this.gong(now);
    }
    this.barTo(this.borkDead ? 0 : this.bork.getHitpoints());
    this.extraBar(this.smorkDead ? 0 : this.smork.getHitpoints(), this.smork.getMaxHitpoints(), EXTRA_COLOURS);
    this.checkTempo();
  }

  // ---------------------------------------------------------------- Bork

  setTarget(player) {
    this.target = player ?? null;
    this.bork.setMobileInteraction(this.target);
  }

  /** He follows his target, a tile a tick, until he is beside them (captured). */
  chase() {
    if (!this.fighters().includes(this.target)) this.setTarget(Shared.randomOf(this.fighters()));
    if (!this.target) return;
    const at = this.target.getLocation();
    if (Shared.distanceTo(this.bork, at) <= 1) return;
    const movement = this.bork.getMovementQueue();
    if (movement.size() > 0) return;
    movement.reset();
    movement.addSteps(Shared.loc({ x: at.getX(), y: at.getY(), z: 0 }));
  }

  /**
   * Two strikes two ticks apart (captured). The first reaches his target when they stand two or
   * three tiles off, every ring out to them; otherwise, and on the second, the tiles touching him.
   */
  gong(now) {
    this.nextGong = now + TIME.GONG[this.tempo];
    const reach = this.target ? Shared.distanceTo(this.bork, this.target.getLocation()) : 1;
    const strike = (rings) => {
      if (this.borkDead || this.stunned || this.stomping) return;
      this.bork.performAnimation(anim("npc_bork_gong_melee01"));
      Shared.areaSound(this.area, this.bork, 10051);
      // The dust rolls out from the tile north-east of his middle, a cycle a tile (captured).
      const at = this.bork.getLocation();
      const origin = { x: at.getX() + 2, y: at.getY() + 2 };
      const dust = named("spotanim", "tfa_wave_dust_short");
      for (let d = 1; d <= rings; d++) {
        for (const tile of this.ring(this.bork, d)) Shared.graphicAt(this.area, dust, tile, { delay: Math.abs(tile.x - origin.x) + Math.abs(tile.y - origin.y) });
      }
      for (const player of this.fighters()) {
        const distance = Shared.distanceTo(this.bork, player.getLocation());
        if (distance >= 1 && distance <= rings) this.strike(this.bork, player, "melee", DAMAGE.GONG, 0, { prayerMultiplier: 0.5 });
      }
    };
    strike(reach >= 2 && reach <= 3 ? reach : 1);
    this.later(TIME.GONG_SECOND, () => strike(1));
  }

  /** The tiles at Chebyshev distance `d` from an NPC's footprint, on the arena, the tower's left out. */
  ring(npc, d) {
    const at = npc.getLocation();
    const size = npc.getSize?.() ?? 1;
    const tiles = [];
    for (let x = at.getX() - d; x < at.getX() + size + d; x++) {
      for (let y = at.getY() - d; y < at.getY() + size + d; y++) {
        if (Shared.distanceTo(npc, { x, y }) === d && inArena({ x, y }) && !onTower({ x, y })) tiles.push({ x, y, z: 0 });
      }
    }
    return tiles;
  }

  // ---------------------------------------------------------------- the Smorks

  /**
   * One of their cycles (captured): volleys, napalm, volleys, the heavy cannonball, the volleys a
   * tempo's spacing apart. The first cycle opens with one volley and has no cannonball's daze to
   * wait out; the next starts 39 ticks after the daze.
   */
  smorkCycle(delay, first = false) {
    const before = first ? 1 : Shared.random(2, 3);
    const after = first ? Shared.random(1, 2) : 4 - before;
    let at = delay;
    for (let i = 0; i < before; i++) {
      this.smorkLater(at, () => this.volley());
      at += this.spacing();
    }
    this.smorkLater(at, () => this.napalm());
    at += TIME.NAPALM_CAST + 2 * this.spacing() - 1;
    for (let i = 0; i < after; i++) {
      this.smorkLater(at, () => this.volley());
      at += this.spacing();
    }
    this.smorkLater(at, () => this.heavyCannonball());
  }

  spacing() {
    return TIME.SPACING[this.tempo];
  }

  /** A Smork action unless they or Bork have fallen meanwhile (the frenzy takes over then). */
  smorkLater(ticks, action) {
    this.later(ticks, () => {
      if (!this.smorkDead && !this.borkDead) action();
    });
  }

  /** A volley at every player but Bork's target (Wiki), all bones (ranged) or all potions (magic). */
  volley(everyone = false) {
    const targets = this.fighters().filter((player) => everyone || player !== this.target);
    if (targets.length === 0) return;
    const magic = Math.random() < 0.5;
    const projectile = named("spotanim", magic ? "vfx_smork_mage_attack_projanim01" : "vfx_smork_range_attack_projanim01");
    const flight = everyone ? FLIGHT[FLIGHT.length - 1] : FLIGHT[this.tempo];
    this.smork.performAnimation(anim("npc_smork_cannon_attack01"));
    this.smork.setPositionToFace(Shared.randomOf(targets).getLocation());
    for (const player of targets) {
      const ticks = Shared.projectile(this.area, this.smork, player, projectile, { delay: 0, end: flight, startHeight: 270, endHeight: 100, angle: 20, progress: 100 });
      this.strike(this.smork, player, magic ? "magic" : "ranged", DAMAGE.VOLLEY, ticks, { prayerMultiplier: 0 });
    }
  }

  /** Napalm at a player: the line, the cast a tick later, the splash four after it, then oil. */
  napalm() {
    const player = Shared.randomOf(this.fighters());
    if (!player) return;
    this.smork.forceChat(Shared.randomOf(LINES.napalm));
    Shared.areaSound(this.area, this.smork, Shared.randomOf(NAPALM_VOICES));
    this.smork.setPositionToFace(player.getLocation());
    const at = Shared.tileOf(player);
    this.later(TIME.NAPALM_CAST, () => {
      if (this.smorkDead) return;
      this.smork.performAnimation(anim("npc_smork_cannon_attack01"));
      Shared.areaSound(this.area, this.smork, 12240);
      Shared.graphicAt(this.area, named("spotanim", "gargboss_debris_shadow_120"), at);
      Shared.projectile(this.area, this.smork, at, named("spotanim", "vfx_smork_napalm_fire_projanim01"), { end: 120, angle: 30, progress: 100, startHeight: 270, endHeight: 0 });
      this.later(TIME.NAPALM_LANDS, () => this.napalmLands(at));
    });
  }

  napalmLands(at) {
    const tiles = splash(at);
    const splats = ["vfx_smork_napalm_splat_spotanim01", "vfx_smork_napalm_splat_spotanim01_90", "vfx_smork_napalm_splat_spotanim01_180", "vfx_smork_napalm_splat_spotanim01_270"];
    for (const tile of tiles) {
      const delay = 3 * Math.max(Math.abs(tile.x - at.x), Math.abs(tile.y - at.y));
      Shared.graphicAt(this.area, named("spotanim", "vfx_smork_napalm_fire_spotanim01"), tile, { delay });
      Shared.graphicAt(this.area, named("spotanim", Shared.randomOf(splats)), tile, { delay });
    }
    Shared.areaSound(this.area, at, 12239);
    for (const player of this.fighters()) {
      const p = Shared.standingOn(player);
      if (tiles.some((tile) => tile.x === p.x && tile.y === p.y)) Shared.damageNow(player, Shared.random(Math.floor(DAMAGE.NAPALM / 2), DAMAGE.NAPALM));
    }
    if (!this.borkDead && tiles.some((tile) => Shared.distanceTo(this.bork, tile) === 0)) Shared.damage(this.bork, Shared.random(Math.floor(DAMAGE.NAPALM_ON_BORK / 2), DAMAGE.NAPALM_ON_BORK));
    this.later(1, () => this.spill(tiles));
  }

  /** Oil on the splash's tiles, turned at random, for 199 ticks (captured). */
  spill(tiles) {
    const id = named("loc", "tfa_bork_ragged_tile");
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`;
      const old = this.oil.get(key);
      if (old) this.removeObject(old);
      const object = this.placeObject(id, tile, 10, Shared.random(0, 3));
      this.oil.set(key, object);
      this.later(TIME.OIL_LASTS, () => {
        if (this.oil.get(key) !== object) return;
        this.oil.delete(key);
        this.removeObject(object);
      });
    }
  }

  /** Oil: 6-7 a tick and a burn from 2 (Wiki; the burn's ticking is an estimate). */
  burnOil() {
    for (const player of this.fighters()) {
      const at = Shared.standingOn(player);
      if (this.oil.has(`${at.x},${at.y}`)) {
        Shared.damageNow(player, Shared.random(...DAMAGE.OIL));
        this.ignite(player);
      }
    }
  }

  ignite(player) {
    const burning = this.burns.get(player);
    if (burning) {
      burning.left = TIME.BURN_HITS;
      return;
    }
    const state = { left: TIME.BURN_HITS };
    this.burns.set(player, state);
    this.repeat(TIME.BURN_EVERY, () => {
      if (state.left-- <= 0 || !this.fighters().includes(player)) {
        this.burns.delete(player);
        return false;
      }
      Shared.damageNow(player, DAMAGE.BURN);
      return true;
    });
  }

  /** The heavy cannonball at a player who isn't Bork's target (captured), for him to be lured onto. */
  heavyCannonball() {
    const others = this.fighters().filter((player) => player !== this.target);
    const player = Shared.randomOf(others.length > 0 ? others : this.fighters());
    if (!player) return;
    this.smork.forceChat("Big bomb! Bork watch out!");
    this.smork.setPositionToFace(player.getLocation());
    this.later(TIME.BOMB_CAST, () => {
      if (this.smorkDead) return;
      const at = Shared.tileOf(player);
      this.smork.performAnimation(anim("npc_smork_big_cannon_attack01"));
      Shared.areaSound(this.area, this.smork, 12248, 15);
      Shared.graphicAt(this.area, named("spotanim", "gargboss_debris_shadow_150"), at);
      Shared.projectile(this.area, this.smork, at, named("spotanim", "cannonball_travel_big"), { delay: 15, end: 150, angle: 30, progress: 100, startHeight: 270, endHeight: 0 });
      this.later(TIME.BOMB_LANDS, () => this.cannonballLands(at));
    });
  }

  cannonballLands(at) {
    for (const player of this.fighters()) {
      if (Shared.distanceTo(player, at) <= 1) Shared.damageNow(player, Shared.random(Math.floor(DAMAGE.BOMB / 2), DAMAGE.BOMB));
    }
    if (this.borkDead) return;
    if (Shared.distanceTo(this.bork, at) === 0) this.daze();
    else {
      this.later(TIME.MISSED_STOMP, () => this.stomp("Bork think it stomp time now!", 0));
      this.smorkCycle(TIME.AFTER_DAZE);
    }
  }

  // ---------------------------------------------------------------- the daze and the stomp

  /** Dazed for the 14-tick stun: no armour, melee always hits (Wiki); then he stomps (captured). */
  daze() {
    this.stunned = true;
    this.bork.getMovementQueue().reset();
    this.bork.performAnimation(anim("npc_bork_14_cycle_stun01"));
    this.bork.performGraphic(spot("vfx_bork_14_cycle_stun_spotanim01"));
    this.bork.forceChat("Oof.");
    if (!this.smorkDead) this.smork.forceChat(Shared.randomOf(LINES.sorry));
    for (const sound of [3201, 12273, 12758, 12249]) Shared.areaSound(this.area, this.bork, sound);
    this.later(TIME.STOMP_IN, () => this.stomp("Bork very angry!!", 0));
    // The Smorks' next cycle starts 39 ticks after the daze (captured).
    this.smorkCycle(TIME.AFTER_DAZE);
  }

  /**
   * The stomp (captured from the daze's end): the line and stomp_in; two ticks later the stomp;
   * four shockwaves 3, 6, 9 and 12 ticks in; the recovery at 8; "Bork smash <player> now." at 15;
   * the gong again at 19.
   */
  stomp(line, delay) {
    this.later(delay, () => {
      if (this.borkDead) return;
      this.stomping = true;
      this.stunned = false;
      this.bork.getMovementQueue().reset();
      this.bork.forceChat(line);
      this.bork.performAnimation(anim("npc_bork_enraged_stomp_attack_in01"));
      this.later(TIME.STOMP, () => {
        if (this.borkDead) return;
        this.bork.performAnimation(anim("npc_bork_enraged_stomp_attack01"));
        this.bork.performGraphic(spot("vfx_bork_enraged_stomp_spotanim01"));
      });
      TIME.SHOCKWAVES.forEach((at, i) => this.later(at, () => this.shockwave(i)));
      this.later(TIME.RECOVER, () => {
        if (!this.borkDead) this.bork.performAnimation(anim("npc_bork_enraged_stomp_attack_cycle_and_out01"));
      });
      this.later(TIME.RETARGET, () => {
        if (this.borkDead) return;
        this.setTarget(Shared.randomOf(this.fighters()));
        if (this.target) this.bork.forceChat(`Bork smash ${Shared.displayName(this.target)} now.`);
      });
      this.later(TIME.GONG_RESUMES, () => {
        this.stomping = false;
        this.nextGong = Shared.cycle();
      });
    });
  }

  /**
   * A shockwave over the arena from one of his feet (captured: a cycle a tile of Manhattan distance,
   * his own tiles too), but the tower's shadow; with the Smorks gone, all of it.
   */
  shockwave(index) {
    if (this.borkDead) return;
    const foot = this.foot(index);
    const dust = named("spotanim", "tfa_wave_dust_short");
    Shared.areaSound(this.area, this.bork, 10051);
    const { arena } = LAYOUT;
    for (let x = arena.minX; x <= arena.maxX; x++) {
      for (let y = arena.minY; y <= arena.maxY; y++) {
        const tile = { x, y, z: 0 };
        if (!inArena(tile) || onTower(tile) || this.shadowed(tile)) continue;
        Shared.graphicAt(this.area, dust, tile, { delay: Math.abs(x - foot.x) + Math.abs(y - foot.y) });
      }
    }
    for (const player of this.fighters()) {
      const at = Shared.standingOn(player);
      if (inArena(at) && !this.shadowed(at)) this.strike(this.bork, player, "melee", DAMAGE.SHOCKWAVE, 0, { prayable: false });
    }
  }

  /**
   * The foot a shockwave rolls out from (captured, all 40 exactly): of the eight edge tiles of his
   * footprint that aren't corners, the two on the side facing his target as the stomp starts, in
   * turn, the one clockwise first.
   */
  foot(index) {
    const at = this.bork.getLocation();
    if (index === 0) {
      const p = this.target ? Shared.tileOf(this.target) : { x: at.getX() + 1.5, y: at.getY() - 1 };
      const angle = Math.atan2(p.y - (at.getY() + 1.5), p.x - (at.getX() + 1.5));
      // 0 = south-east, anticlockwise in eighths.
      this.stompSide = (((Math.round(angle / (Math.PI / 4)) + 1) % 8) + 8) % 8;
    }
    const [dx, dy] = FEET[(this.stompSide + (index % 2)) % 8];
    return { x: at.getX() + dx, y: at.getY() + dy };
  }

  /**
   * In the tower's shadow: every line from the middle 2x2 of his footprint to the tile (to points
   * 0.3 in from its corners) passes over the tower (fitted to the captured stomps, a tile or two
   * off at the edge).
   */
  shadowed(tile) {
    if (this.smorkDead) return false;
    const at = this.bork.getLocation();
    const origins = [[1.5, 1.5], [2.5, 1.5], [1.5, 2.5], [2.5, 2.5]].map(([dx, dy]) => [at.getX() + dx, at.getY() + dy]);
    const targets = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].map(([dx, dy]) => [tile.x + dx, tile.y + dy]);
    return origins.every(([ox, oy]) => targets.every(([tx, ty]) => overTower(ox, oy, tx, ty)));
  }

  checkTempo() {
    if (this.smorkDead || this.tempo >= TEMPO_AT.length) return;
    const percent = Math.floor((100 * this.smork.getHitpoints()) / Math.max(1, this.smork.getMaxHitpoints()));
    if (percent > TEMPO_AT[this.tempo]) return;
    const [borkLine, smorkLine] = LINES.tempo[this.tempo];
    this.tempo++;
    if (!this.borkDead) this.bork.forceChat(borkLine);
    this.smork.forceChat(smorkLine);
  }

  // ---------------------------------------------------------------- damage and deaths

  /** Flat armour: Bork 10 (none while dazed; 2 against magic), the Smorks 2 (Wiki). */
  modifyHit(npc, hit) {
    let armour = 0;
    const { CombatType } = Shared.core();
    if (npc === this.bork) armour = this.stunned ? 0 : hit.getCombatType?.() === CombatType.MAGIC ? ARMOUR.BORK_MAGIC : ARMOUR.BORK;
    else if (npc === this.smork) armour = ARMOUR.SMORK;
    if (armour <= 0) return;
    for (const part of hit.getHits?.() ?? []) part.setDamage(Math.max(0, part.getDamage() - armour));
    hit.updateTotalDamage?.();
  }

  /** Dazed, melee on Bork always lands (Wiki). */
  hitRoll(event) {
    if (event.target === this.bork && this.stunned && event.combatType === Shared.core().CombatType.MELEE) event.forceAccurate = true;
  }

  holdsOn(npc) {
    if (npc === this.bork) {
      this.borkFalls();
      return true;
    }
    if (npc === this.smork) {
      this.smorkFalls();
      return true;
    }
    return false;
  }

  borkFalls() {
    if (this.borkDead) return;
    this.borkDead = true;
    this.bork.setHitpoints(1);
    this.bork.getMovementQueue().reset();
    this.bork.setMobileInteraction(null);
    this.bork.performAnimation(anim("npc_bork_death01"));
    this.bork.performGraphic(spot("vfx_bork_death_spotanim01"));
    this.bork.forceChat("Smorks... avenge... Bork.");
    this.bork.__tfaUntargetable = true;
    this.later(TIME.BORK_GONE, () => {
      this.despawn(this.bork);
      if (!this.smorkDead) this.smork.forceChat("Human die for that!");
      this.later(TIME.FRENZY_AFTER, () => this.frenzy());
      this.checkWon();
    });
  }

  /**
   * Bork gone: a volley at everyone every two ticks, two or three, then napalm, its next volley
   * three ticks after the cast, and from then on five volleys between napalms (captured).
   */
  frenzy(volleys = Shared.random(2, 3)) {
    if (this.smorkDead) return;
    if (volleys === 0) {
      this.napalm();
      this.later(TIME.NAPALM_CAST + 3, () => this.frenzy(TIME.FRENZY_VOLLEYS));
      return;
    }
    this.volley(true);
    this.later(TIME.FRENZY, () => this.frenzy(volleys - 1));
  }

  smorkFalls() {
    if (this.smorkDead) return;
    this.smorkDead = true;
    this.smork.setHitpoints(1);
    this.smork.__tfaUntargetable = true;
    this.smork.forceChat("Uh oh.");
    Shared.areaSound(this.area, this.smork, 12761);
    this.later(TIME.SMORK_GRAPHICS, () => {
      this.smork.performGraphic(spot("vfx_smork_death_explosion_spotanim01"));
      this.smork.performGraphicInSlot(1, spot("vfx_smork_goblins_death_spotanim01"));
      this.smork.performGraphicInSlot(2, spot("vfx_smork_tower_death_spotanim01"));
      Shared.areaSound(this.area, this.smork, 12251);
    });
    this.later(TIME.SMORK_FADES, () => this.smork.fade(255, { from: 0, endCycles: 30 }));
    this.later(TIME.SMORK_GONE, () => {
      this.despawn(this.smork);
      this.checkWon();
    });
    // Without the Smorks no cannonball dazes him: he stomps on his own, the whole arena (estimate).
    if (!this.borkDead) this.repeat(TIME.STOMP_ALONE, () => {
      if (this.borkDead || this.isCompleted()) return false;
      if (!this.stunned && !this.stomping) this.stomp("Bork think it stomp time now!", 0);
      return true;
    });
  }

  checkWon() {
    if (this.borkDead && this.smorkDead && this.isStarted() && !this.npcs.has(this.smork) && !this.npcs.has(this.bork)) this.complete();
  }

  canAttack(attacker, target) {
    if (target?.__tfaUntargetable && attacker?.isPlayer?.()) return false;
    return null;
  }

  /** The oil crumbles (captured: napalm_despawn, turned at random). */
  onComplete() {
    this.hideBars();
    const despawn = ["vfx_smork_napalm_despawn_spotanim01", "vfx_smork_napalm_despawn_spotanim01_90", "vfx_smork_napalm_despawn_spotanim01_180", "vfx_smork_napalm_despawn_spotanim01_270"];
    for (const object of this.oil.values()) {
      const location = object.getLocation();
      Shared.graphicAt(this.area, named("spotanim", Shared.randomOf(despawn)), { x: location.getX(), y: location.getY(), z: 0 });
      this.removeObject(object);
    }
    this.oil.clear();
  }
}

/**
 * The napalm's splash from a tile towards the tower, or away from it on the tower's doorstep
 * (captured in the frenzy), on the arena.
 */
function splash(at, drips = Shared.random(0, DRIPS)) {
  let dx = LAYOUT.smork.x + 1 - at.x;
  let dy = LAYOUT.smork.y + 1 - at.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) <= 3) [dx, dy] = [-dx, -dy];
  const sx = Math.sign(dx) || 1;
  const sy = Math.sign(dy) || 1;
  let offsets;
  if (Math.abs(dx) > 2 * Math.abs(dy)) offsets = SPLASH.straight.map(([a, b]) => [a * sx, b]);
  else if (Math.abs(dy) > 2 * Math.abs(dx)) offsets = SPLASH.straight.map(([a, b]) => [b, a * sy]);
  else offsets = SPLASH.diagonal.map(([a, b]) => [a * sx, b * sy]);
  const taken = new Set(offsets.map(([a, b]) => `${a},${b}`));
  const beside = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].filter(([a, b]) => !taken.has(`${a},${b}`));
  offsets.push(...Shared.shuffle(beside).slice(0, drips));
  return offsets.map(([ox, oy]) => ({ x: at.x + ox, y: at.y + oy, z: 0 })).filter((tile) => inArena(tile) && !onTower(tile));
}

function onTower({ x, y }) {
  return x >= LAYOUT.smork.x && x <= LAYOUT.smork.x + 2 && y >= LAYOUT.smork.y && y <= LAYOUT.smork.y + 2;
}

/** Whether the segment between two points passes over the tower's 3x3. */
function overTower(ox, oy, tx, ty) {
  const steps = 64;
  for (let i = 1; i < steps; i++) {
    const px = ox + ((tx - ox) * i) / steps;
    const py = oy + ((ty - oy) * i) / steps;
    if (px >= LAYOUT.smork.x && px <= LAYOUT.smork.x + 3 && py >= LAYOUT.smork.y && py <= LAYOUT.smork.y + 3) return true;
  }
  return false;
}

/** The arena: its square, the four corners cut (captured: the shockwave's tiles). */
function inArena({ x, y }) {
  const { arena } = LAYOUT;
  if (x < arena.minX || x > arena.maxX || y < arena.minY || y > arena.maxY) return false;
  return !((x === arena.minX || x === arena.maxX) && (y === arena.minY || y === arena.maxY));
}

function roomOf(player) {
  const room = Raid.raidOf(player)?.room;
  return room instanceof BorkRoom ? room : null;
}

function hitRoll(event) {
  if (!event.attacker?.isPlayer?.()) return;
  roomOf(event.attacker)?.hitRoll(event);
}

module.exports = function registerBork(api) {
  Shared.bind(api);
  Raid.registerRoom("BORK", BorkRoom);
  api.onCombatHitRoll(hitRoll);
};

Object.assign(module.exports, { BorkRoom, LAYOUT, BORK_HP, SMORK_HP, TIME, DAMAGE, splash, inArena });
