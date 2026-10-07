"use strict";

/**
 * Path of Scabaras, Kephri (A Mother's Curse). Kephri never moves; she bombards players'
 * tiles, throws eggs and flings players back through a trail of dung. Twice she falls
 * asleep behind a shield while scarab swarms crawl in to heal her and her overlords
 * (spitting, soldier, arcane) join the fight; the third time she is down for good.
 * Wiki: https://oldschool.runescape.wiki/w/Kephri
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const SPAWN = { x: 3549, y: 5406, z: 0 };
const CENTRE = { x: 3551, y: 5408, z: 0 };
const THROW_START = { x: 3550, y: 5409, z: 0 };
const THROW_SECOND = { x: 3551, y: 5408, z: 0 };
const SWARM_SPAWNS = [
  { x: 3543, y: 5404 }, { x: 3543, y: 5410 }, { x: 3547, y: 5416 }, { x: 3553, y: 5416 },
  { x: 3559, y: 5410 }, { x: 3559, y: 5404 }, { x: 3553, y: 5400 }, { x: 3547, y: 5400 },
];
const EGG_TILES = [
  { x: 3551, y: 5404 }, { x: 3549, y: 5402 }, { x: 3545, y: 5406 }, { x: 3551, y: 5412 }, { x: 3549, y: 5414 },
  { x: 3545, y: 5410 }, { x: 3547, y: 5408 }, { x: 3553, y: 5402 }, { x: 3557, y: 5406 }, { x: 3553, y: 5414 },
  { x: 3555, y: 5408 }, { x: 3557, y: 5410 },
];
const FLY_BOMB_SOURCES = [{ x: 3542, y: 5417 }, { x: 3560, y: 5417 }, { x: 3560, y: 5398 }, { x: 3542, y: 5398 }];
const SOLDIER_SPAWN = { x: 3556, y: 5407 };
const SPITTER_SPAWN = { x: 3556, y: 5413 };
const ARCANE_TILES = [{ x: 3556, y: 5401 }, { x: 3544, y: 5413 }, { x: 3550, y: 5401 }, { x: 3556, y: 5413 }];
const ARCANE_CHARGE_OFFSETS = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]];

const DUNG = 45504;
const INVISIBLE_BLOCK = 32740;
const FINAL_PHASE_HITPOINTS = 80;
const ATTACK_SPEED = 6;
const FIREBALL_MAX_HIT = 24;
const SHIELD_TICKS = 52;
const EGG_FUSE = 16;
const HEAL_CAP = 1.15;

const ANIMATION = {
  THROW: 9577, THROW_EGGS: 9578, SUMMON: 9579, AWAKE: 9581, DEATH: 9582, EGG_SPAWN: 8630,
  PLAYER_THROWN: 9799, PLAYER_SLIDE: 1114, SCARAB_SPAWN: 9589, SCARAB_ATTACK: 9587, SPIT: 9588,
  AGILE_ATTACK: 9594, ARCANE_UP: 9597, ARCANE_DOWN: 9596, SWARM_SPAWN: 9605, SWARM_FADE: 9607,
};
const GRAPHIC = {
  AWAKE_AURA: 2141, ASLEEP_AURA: 2142, TO_SLEEP: 2143, WAKE: 2144, TELEGRAPH: 1447, EGG_EXPLODE: 2156,
  FLY_EXPLODE: 2148, BOMB_EXPLODE: 2157, PLAYER_FLIES: 2146, PLAYER_STUN: 245, EGG_BREAK: 2166, DUNG: 2145,
  ARCANE_CHARGE: 2149,
};
const PROJECTILE = {
  THROW_FIRST: 1481, THROW_SECOND: 2266, BROWN_EGG: 2164, EGG: 2165, FLY_BOMB: 2147, HEAL: 2150, SPIT: 2152, ARCANE: 2149,
};

class KephriRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    this.phase = 0;
    this.shieldTicks = 0;
    this.attackTicks = ATTACK_SPEED;
    this.specialCycle = 3;
    this.dungNext = true;
    this.playerIndex = 0;
    this.eggFuse = 0;
    this.medicTicks = 12;
    this.flyBombTicks = 8;
    this.swarmIndex = Shared.random(0, SWARM_SPAWNS.length - 1);
    this.swarmTicks = 5;
    this.tripleSwarmCycle = 0;
    this.dung = new Set();
    this.eggs = new Set();
    this.agile = new Set();
    this.swarms = new Set();
    this.overlords = new Set();
    this.kephri = this.spawn(NpcIdentifiers.KEPHRI, SPAWN, { points: 1 });
    if (this.kephri) {
      this.kephri.__toaScripted = true;
      this.kephri.__toaKephri = true;
      this.kephri.getMovementQueue().setBlockMovement(true);
    }
    this.setObject(INVISIBLE_BLOCK, SPAWN, 10, 0);
    const settings = this.settings;
    this.aerialAssault = settings.isActive("AERIAL_ASSAULT");
    this.blowingMud = settings.isActive("BLOWING_MUD");
    this.livelyLarvae = settings.isActive("LIVELY_LARVAE");
    this.moreOverlords = settings.isActive("MORE_OVERLORDS");
    this.medic = settings.isActive("MEDIC");
  }

  onStart() {
    this.raid.scale(this.kephri, this.pathLevel());
    this.openBossHud(this.kephri);
  }

  lootSource() {
    return this.kephri;
  }

  onComplete() {
    this.clearAdds();
    this.clearDung();
  }

  onReset() {
    this.clearAdds();
    this.clearDung();
    this.despawn(this.kephri);
    this.build();
  }

  clearAdds() {
    for (const set of [this.eggs, this.agile, this.swarms, this.overlords]) {
      for (const npc of set) this.despawn(npc);
      set.clear();
    }
  }

  clearDung() {
    for (const key of this.dung) {
      const [x, y] = key.split(",").map(Number);
      this.setObject(-1, { x, y, z: 0 }, 10);
    }
    this.dung.clear();
  }

  alive(npc) {
    return npc && npc.getHitpoints() > 0 && npc.isRegistered?.() !== false;
  }

  tick() {
    const kephri = this.kephri;
    if (!this.isStarted() || !this.alive(kephri)) return;
    this.prune();
    const players = this.challengePlayers();
    if (players.length === 0) return;
    this.dungDamage(players);
    if (this.eggFuse > 0 && --this.eggFuse === 0) {
      for (const egg of [...this.eggs]) this.hatch(egg);
    }
    this.tickOverlords(players);
    this.tickSwarms();
    if (this.shieldTicks > 0) {
      this.tickShield();
      return;
    }
    if (this.medic && --this.medicTicks <= 0) {
      this.medicTicks = 12;
      this.spawnSwarm(true);
    }
    if (--this.attackTicks > 0) return;
    this.attackTicks = this.attackSpeed();
    if (this.specialCycle-- === 0) {
      this.specialCycle = this.phase === 3 ? 2 : Shared.random(4, 5);
      if (this.dungNext || this.agile.size > 4 + this.teamSize) {
        this.dungNext = false;
        this.prepareDung(players);
      } else {
        this.dungNext = true;
        this.throwEggs(players);
      }
    } else {
      this.regularAttack();
    }
  }

  /** Wiki: 6 ticks, and "every two levels" of the path her auto-attacks are faster. */
  attackSpeed() {
    return ATTACK_SPEED - Math.min(2, Math.floor(this.pathLevel() / 2));
  }

  prune() {
    for (const set of [this.eggs, this.agile, this.swarms, this.overlords]) {
      for (const npc of set) {
        if (!this.alive(npc)) set.delete(npc);
      }
    }
  }

  tickShield() {
    const { NpcIdentifiers, Animation, Graphic } = Shared.core();
    const kephri = this.kephri;
    if (this.shieldTicks === 50) kephri.setNpcTransformationId(NpcIdentifiers.KEPHRI_2);
    if (this.shieldTicks > 3 && this.shieldTicks < 49 && this.flyBombTicks > 0 && --this.flyBombTicks <= 0) {
      this.flyBombTicks = 12;
      this.bombs(false);
    }
    if (--this.shieldTicks === 3) {
      this.swarmTicks = 5;
      kephri.performGraphic(new Graphic(GRAPHIC.WAKE));
      kephri.performAnimation(new Animation(ANIMATION.AWAKE));
      this.flyBombTicks += 1;
      for (const swarm of this.swarms) this.fadeSwarm(swarm);
    } else if (this.shieldTicks <= 1) {
      kephri.setNpcTransformationId(-1);
    } else if (--this.swarmTicks <= 0) {
      this.swarmTicks = Shared.random(2, 3);
      this.spawnSwarm(false);
    }
  }

  /** Her health reaching zero: the first two times she sleeps behind a shield. */
  onDowned() {
    const { Animation, Graphic } = Shared.core();
    const kephri = this.kephri;
    this.phase++;
    if (this.phase === 4) return false;
    if (this.phase === 3) {
      const scaled = Math.round(FINAL_PHASE_HITPOINTS * this.raid.hitpointFactor(this.pathLevel()));
      kephri.setMaxHitpoints(scaled);
      kephri.setHitpoints(scaled);
      this.specialCycle = 2;
      for (const player of this.challengePlayers()) this.dungAttack(player);
      return true;
    }
    this.shieldTicks = SHIELD_TICKS;
    this.attackTicks = ATTACK_SPEED;
    this.medicTicks = 12;
    this.flyBombTicks = 8;
    kephri.performAnimation(new Animation(ANIMATION.SUMMON));
    kephri.performGraphic(new Graphic(GRAPHIC.TO_SLEEP));
    kephri.setHitpoints(1);
    const overlords = [];
    if (this.phase === 2) overlords.push("arcane");
    if (this.phase === 1 || this.moreOverlords) overlords.push("spitting");
    if (this.phase === 2 || this.moreOverlords) overlords.push("soldier");
    overlords.forEach((kind, index) => this.later(index, () => this.spawnOverlord(kind)));
    return true;
  }

  finalDeath() {
    const { Animation, NpcIdentifiers } = Shared.core();
    this.kephri.setHitpoints(1);
    this.kephri.setUntargetable(true);
    this.kephri.getCombat().reset();
    this.kephri.performAnimation(new Animation(ANIMATION.DEATH));
    this.complete();
    Shared.later(this.taskKey, 2, () => {
      if (!this.destroyed && this.kephri) this.kephri.setNpcTransformationId(NpcIdentifiers.KEPHRI_4);
    });
  }

  /** Heals her by a share of her health, up to 115%; reaching the cap wakes her early. */
  heal(source, factor, min, max) {
    const kephri = this.kephri;
    const cap = Math.floor(kephri.getMaxHitpoints() * HEAL_CAP);
    if (kephri.getHitpoints() >= cap) return;
    let amount = Shared.random(Math.floor(kephri.getMaxHitpoints() * factor * min), Math.floor(kephri.getMaxHitpoints() * factor * max));
    if (kephri.getHitpoints() + amount >= cap) {
      amount = cap - kephri.getHitpoints();
      this.shieldTicks = Math.min(this.shieldTicks, 4);
    }
    kephri.setHitpoints(kephri.getHitpoints() + amount);
  }

  // -------------------------------------------------------------- attacks

  regularAttack() {
    const { Animation } = Shared.core();
    this.kephri.performAnimation(new Animation(ANIMATION.THROW));
    // The fireball rises and is gone as the falling one leaves, two ticks (60 client cycles)
    // later. Near-Reality's 39 + 51 cycles kept it in the air a tick into the second, so two
    // fireballs showed for one hit.
    Shared.tileProjectile(this.area, Shared.loc(THROW_START), Shared.loc(THROW_SECOND), PROJECTILE.THROW_FIRST,
      { delay: 39, duration: 21, perTile: 0, startHeight: 175, endHeight: 250 });
    this.later(2, () => this.shieldTicks <= 0 && this.bombs(true));
  }

  /** Bombs on every player's tile (3x3 with Aerial Assault) that land three ticks later. */
  bombs(regular) {
    const players = this.challengePlayers();
    const centres = [];
    const tiles = new Map();
    const mark = (x, y) => tiles.set(`${x},${y}`, { x, y });
    for (const player of players) {
      const location = player.getLocation();
      const key = `${location.getX()},${location.getY()}`;
      if (tiles.has(key)) continue;
      mark(location.getX(), location.getY());
      centres.push(key);
      const from = regular ? Shared.loc(THROW_SECOND) : Shared.loc(nearest(FLY_BOMB_SOURCES, location));
      Shared.tileProjectile(this.area, from, location.clone(), regular ? PROJECTILE.THROW_SECOND : PROJECTILE.FLY_BOMB,
        { duration: regular ? 120 : 120, startHeight: regular ? 250 : 112, endHeight: 9 });
    }
    if (this.aerialAssault) {
      for (const key of centres) {
        const [x, y] = key.split(",").map(Number);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) mark(x + dx, y + dy);
      }
    }
    for (const tile of tiles.values()) this.graphic(GRAPHIC.TELEGRAPH, tile);
    this.later(3, () => {
      if (!this.alive(this.kephri)) return;
      for (const tile of tiles.values()) {
        this.graphic(GRAPHIC.BOMB_EXPLODE, tile);
        if (!regular) this.graphic(GRAPHIC.FLY_EXPLODE, tile);
        for (const player of this.challengePlayers()) {
          const location = player.getLocation();
          if (location.getX() !== tile.x || location.getY() !== tile.y) continue;
          // Wiki: her auto-attack's max hit is 24 (the fly bombs keep their own 5-10).
          let base = this.maxHit(regular ? FIREBALL_MAX_HIT / 2 : 5);
          if (Shared.isProtected(player, "magic")) base = Math.floor(base / 3);
          Shared.damage(player, Shared.random(base, base * 2));
        }
      }
    });
  }

  throwEggs(players) {
    const { Animation } = Shared.core();
    this.kephri.performAnimation(new Animation(ANIMATION.THROW_EGGS));
    const brown = this.livelyLarvae ? Shared.random(players.length * 3, players.length * 5) : players.length * 2;
    const tiles = Shared.shuffle(EGG_TILES);
    tiles.forEach((tile, index) => {
      if (this.dung.has(`${tile.x},${tile.y}`)) return;
      Shared.tileProjectile(this.area, Shared.loc(THROW_SECOND), Shared.loc(tile, 0), index < brown ? PROJECTILE.BROWN_EGG : PROJECTILE.EGG,
        { delay: 70, duration: 50, perTile: 14, startHeight: 86, endHeight: 0 });
    });
    this.later(3, () => {
      if (!this.alive(this.kephri) || this.challengePlayers().length === 0) return;
      tiles.forEach((tile, index) => this.placeEgg(tile, index < brown));
      this.eggFuse = EGG_FUSE;
    });
  }

  placeEgg(tile, brown) {
    if (this.dung.has(`${tile.x},${tile.y}`)) return;
    const { NpcIdentifiers, Animation } = Shared.core();
    const egg = this.spawn(brown ? NpcIdentifiers.COL_00FFFF_EGG_COL_2 : NpcIdentifiers.COL_00FFFF_EGG_COL, { ...tile, z: 0 }, { scale: false, points: 0, inert: true });
    if (!egg) return;
    egg.__toaScripted = true;
    egg.__toaEgg = brown ? "brown" : "plain";
    egg.getMovementQueue().setBlockMovement(true);
    egg.performAnimation(new Animation(ANIMATION.EGG_SPAWN));
    this.eggs.add(egg);
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (location.getX() === tile.x && location.getY() === tile.y) Shared.damage(player, this.maxHit(2));
    }
  }

  /** An egg left too long: plain eggs explode, brown ones hatch an agile scarab. */
  hatch(egg) {
    if (!this.alive(egg)) return;
    const location = egg.getLocation().clone();
    this.eggs.delete(egg);
    this.despawn(egg);
    if (egg.__toaEgg === "plain") {
      this.graphic(GRAPHIC.EGG_EXPLODE, location);
      for (const player of this.challengePlayers()) {
        if (player.getLocation().getDistance(location) <= 1) {
          player.sendMessage("You are damaged by a nearby egg explosion!");
          Shared.damage(player, this.maxHit(8));
        }
      }
      return;
    }
    this.graphic(GRAPHIC.EGG_BREAK, location);
    const { NpcIdentifiers } = Shared.core();
    const scarab = this.spawn(NpcIdentifiers.AGILE_SCARAB, { x: location.getX(), y: location.getY(), z: 0 }, { points: 0.5 });
    if (!scarab) return;
    scarab.__toaAgile = true;
    this.agile.add(scarab);
    const target = Shared.randomOf(this.challengePlayers());
    if (target) scarab.getCombat().attack(target);
  }

  eggBroken(egg) {
    this.eggs.delete(egg);
    this.graphic(GRAPHIC.EGG_BREAK, egg.getLocation());
  }

  prepareDung(players) {
    const { Graphic } = Shared.core();
    this.attackTicks += 7;
    const first = players[this.playerIndex % players.length];
    const second = players[(this.playerIndex + 1) % players.length];
    first.performGraphic(new Graphic(GRAPHIC.PLAYER_FLIES));
    if (this.blowingMud) second.performGraphic(new Graphic(GRAPHIC.PLAYER_FLIES));
    this.later(4, () => {
      if (!this.alive(this.kephri)) return;
      this.dungAttack(first);
      if (this.blowingMud && second !== first) this.dungAttack(second);
    });
    this.playerIndex += this.blowingMud ? 2 : 1;
  }

  /** Throws a player away from her and leaves a trail of dung where they flew. */
  dungAttack(player) {
    if (this.shieldTicks > 0) return;
    const { Animation, Graphic } = Shared.core();
    this.kephri.performAnimation(new Animation(ANIMATION.THROW_EGGS));
    if (player.getHitpoints() <= 0 || !this.inChallenge(player)) return;
    const location = player.getLocation();
    const dx = location.getX() - CENTRE.x;
    const dy = location.getY() - CENTRE.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    let stepX = Math.sign(dx);
    let stepY = Math.sign(dy);
    if (Math.abs(ady - adx) > 1) {
      if (adx > ady) stepY = 0;
      else stepX = 0;
    }
    if (stepX === 0 && stepY === 0) stepX = 1;
    let end = location.clone();
    for (let i = 0; i < 8 - Math.max(adx, ady); i++) {
      const next = end.transform(stepX, stepY);
      if (!Shared.floorFree(this.area, next) || this.dung.has(`${next.getX()},${next.getY()}`)) break;
      end = next;
    }
    player.sendMessage("<col=ef0083>Kephri throws you back!</col>");
    player.performAnimation(new Animation(ANIMATION.PLAYER_THROWN));
    player.performGraphic(Shared.gfx(GRAPHIC.PLAYER_STUN, { height: 124 }));
    player.getCombat().reset();
    Shared.knockback(player, end.getX() - location.getX(), end.getY() - location.getY(), { ticks: 2, speed: 30 + Math.max(1, Math.floor(end.getDistance(location) / 3)) * 30 });
    const start = { x: CENTRE.x + Math.max(-2, Math.min(2, dx)), y: CENTRE.y + Math.max(-2, Math.min(2, dy)) };
    const path = line(start, { x: end.getX(), y: end.getY() });
    if (path.length === 0) return;
    this.later(2, () => path.forEach((tile, index) => this.graphic(GRAPHIC.DUNG, tile, index * 10)));
    this.later(4, () => path.slice(0, 3).forEach((tile) => this.addDung(tile)));
    this.later(5, () => path.slice(3).forEach((tile) => this.addDung(tile)));
  }

  addDung(tile) {
    const key = `${tile.x},${tile.y}`;
    if (this.dung.has(key)) return;
    this.dung.add(key);
    this.setObject(DUNG, { ...tile, z: 0 }, 10, Shared.random(0, 3));
  }

  /** Standing in dung hurts and slides you off it; agile scarabs drown in it. */
  dungDamage(players) {
    if (this.dung.size === 0) return;
    for (const player of players) {
      const location = player.getLocation();
      if (!this.dung.has(`${location.getX()},${location.getY()}`)) continue;
      Shared.damage(player, this.maxHit(3));
      const free = this.freeTileNear(location);
      if (!free) continue;
      const { Animation } = Shared.core();
      player.forceChat?.("Ouch!");
      player.performAnimation(new Animation(ANIMATION.PLAYER_SLIDE));
      Shared.knockback(player, free.getX() - location.getX(), free.getY() - location.getY(), { ticks: 1, speed: 29 });
    }
    for (const scarab of this.agile) {
      const location = scarab.getLocation();
      if (this.dung.has(`${location.getX()},${location.getY()}`)) scarab.setHitpoints(0);
    }
  }

  freeTileNear(location) {
    for (let radius = 1; radius <= 10; radius++) {
      for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
          if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
          const tile = location.transform(x, y);
          if (Shared.floorFree(this.area, tile) && !this.dung.has(`${tile.getX()},${tile.getY()}`)) return tile;
        }
      }
    }
    return null;
  }

  // -------------------------------------------------------------- swarms & overlords

  spawnSwarm(medic) {
    const base = SWARM_SPAWNS[this.swarmIndex];
    const alongX = [2, 3, 6, 7].includes(this.swarmIndex);
    const level = this.pathLevel();
    const offset = (delta) => ({ x: base.x + (alongX ? delta : 0), y: base.y + (alongX ? 0 : delta), z: 0 });
    if (!medic && level > 1 && ++this.tripleSwarmCycle >= (level > 3 ? SWARM_SPAWNS.length / 2 : SWARM_SPAWNS.length)) {
      this.tripleSwarmCycle = 0;
      for (let i = 0; i < 3; i++) this.addSwarm(offset(i), medic);
    } else {
      this.addSwarm(offset(Shared.random(0, 3)), medic);
    }
    this.swarmIndex = (this.swarmIndex + Shared.random(1, 2)) % SWARM_SPAWNS.length;
  }

  addSwarm(tile, medic) {
    const { NpcIdentifiers, Animation } = Shared.core();
    const swarm = this.spawn(NpcIdentifiers.SCARAB_SWARM_6, tile, { scale: false, points: 0.5 });
    if (!swarm) return;
    swarm.__toaScripted = true;
    swarm.__toaSwarm = { medic, delay: 4, fading: false };
    swarm.canWalkThroughNPCs = () => true;
    swarm.performAnimation(new Animation(ANIMATION.SWARM_SPAWN));
    this.swarms.add(swarm);
  }

  /** Swarms crawl to her; reaching her while she sleeps heals her. */
  tickSwarms() {
    const { PathFinder } = Shared.core();
    const target = this.kephri.getLocation();
    for (const swarm of this.swarms) {
      const state = swarm.__toaSwarm;
      if (state.fading) continue;
      if (state.delay > 0) {
        state.delay--;
        continue;
      }
      if (swarm.getLocation().getDistance(Shared.loc(CENTRE)) <= 3) {
        if (this.shieldTicks > 0) this.heal(swarm, 1, state.medic ? 0.18 : 0.08, state.medic ? 0.2 : 0.1);
        this.fadeSwarm(swarm);
        continue;
      }
      if (swarm.getMovementQueue().size() === 0) PathFinder.calculateWalkRoute(swarm, target.getX() + 2, target.getY() + 2);
    }
  }

  fadeSwarm(swarm) {
    if (!this.alive(swarm) || swarm.__toaSwarm.fading) return;
    const { Animation } = Shared.core();
    swarm.__toaSwarm.fading = true;
    swarm.getMovementQueue().reset();
    swarm.performAnimation(new Animation(ANIMATION.SWARM_FADE));
    this.later(2, () => {
      this.swarms.delete(swarm);
      this.despawn(swarm);
    });
  }

  spawnOverlord(kind) {
    if (!this.isStarted() || !this.alive(this.kephri)) return;
    const { NpcIdentifiers, Animation } = Shared.core();
    const id = { soldier: NpcIdentifiers.SOLDIER_SCARAB, spitting: NpcIdentifiers.SPITTING_SCARAB, arcane: NpcIdentifiers.ARCANE_SCARAB }[kind];
    const tile = { soldier: SOLDIER_SPAWN, spitting: SPITTER_SPAWN, arcane: ARCANE_TILES[0] }[kind];
    const npc = this.spawn(id, { ...tile, z: 0 }, { points: 0.5 });
    if (!npc) return;
    npc.__toaOverlord = { kind, healTicks: 13, attackTicks: 4, chargeDelay: 5, charges: 0, tileIndex: 1, flying: 0, moderateHits: 0 };
    npc.performAnimation(new Animation(kind === "arcane" ? ANIMATION.ARCANE_DOWN : ANIMATION.SCARAB_SPAWN));
    if (kind !== "soldier") {
      npc.__toaScripted = true;
      npc.getMovementQueue().setBlockMovement(true);
    } else {
      const target = Shared.randomOf(this.challengePlayers());
      if (target) npc.getCombat().attack(target);
    }
    this.overlords.add(npc);
  }

  tickOverlords(players) {
    for (const npc of this.overlords) {
      const state = npc.__toaOverlord;
      if (state.kind === "soldier") this.tickSoldier(npc, state, players);
      else if (state.kind === "spitting") this.tickSpitter(npc, state, players);
      else this.tickArcane(npc, state, players);
    }
  }

  /** The soldier fights in melee and keeps topping her up. */
  tickSoldier(npc, state, players) {
    const target = npc.getCombat().getTarget?.();
    if (!target || target.getHitpoints() <= 0 || !this.inChallenge(target)) {
      const next = Shared.randomOf(players);
      if (next) npc.getCombat().attack(next);
    }
    if (state.healTicks <= 0) return;
    if (--state.healTicks === 1) {
      Shared.tileProjectile(this.area, npc, this.kephri, PROJECTILE.HEAL, { duration: 30, startHeight: 25, endHeight: 62 });
    } else if (state.healTicks <= 0) {
      state.healTicks = 6;
      this.heal(npc, npc.getHitpoints() / npc.getMaxHitpoints(), 0.05, 0.07);
    }
  }

  /** The spitter spits at everyone every three ticks, poisoning them. */
  tickSpitter(npc, state, players) {
    if (--state.attackTicks > 0) return;
    state.attackTicks = 3;
    const { Animation, CombatFactory } = Shared.core();
    npc.performAnimation(new Animation(ANIMATION.SPIT));
    for (const player of players) {
      const ticks = Shared.tileProjectile(this.area, npc, player, PROJECTILE.SPIT, { delay: 36, duration: 14, perTile: 5, startHeight: 24, endHeight: 31 });
      this.later(ticks, () => {
        if (!this.inChallenge(player) || player.getHitpoints() <= 0) return;
        let damage = Shared.random(0, this.maxHit(10));
        if (Shared.isProtected(player, "ranged")) damage = Math.floor(damage * 0.2);
        Shared.damage(player, damage);
        CombatFactory.poisonEntity(player, 5);
      });
    }
  }

  /** The arcane scarab charges a blast at everyone; heavy hits make it fly off and land elsewhere. */
  tickArcane(npc, state, players) {
    const { Animation } = Shared.core();
    if (state.flying > 0) {
      if (--state.flying === 0) {
        npc.performAnimation(new Animation(ANIMATION.ARCANE_DOWN));
        npc.moveTo(Shared.loc(ARCANE_TILES[state.tileIndex++ % ARCANE_TILES.length], 0));
        npc.setVisible(true);
        state.chargeDelay = 5;
      }
      return;
    }
    if (state.chargeDelay <= 0 || --state.chargeDelay > 0) return;
    state.chargeDelay = 3;
    state.charges++;
    if (state.charges >= 9) {
      const origin = npc.getLocation().transform(1, 1);
      for (const player of players) {
        const ticks = Shared.tileProjectile(this.area, origin, player, PROJECTILE.ARCANE, { duration: 90, startHeight: 0, endHeight: 0 });
        this.later(ticks, () => {
          if (!this.inChallenge(player) || player.getHitpoints() <= 0) return;
          const base = this.maxHit(65);
          let damage = Shared.random(Math.floor(base / 2), base);
          if (Shared.isProtected(player, "magic")) damage = Math.floor(damage * 0.33);
          Shared.damage(player, damage);
        });
      }
      this.arcaneFlyAway(npc, state);
      return;
    }
    for (let i = 0; i < state.charges && i < ARCANE_CHARGE_OFFSETS.length; i++) {
      const [dx, dy] = ARCANE_CHARGE_OFFSETS[i];
      this.graphic(GRAPHIC.ARCANE_CHARGE, { x: npc.getLocation().getX() + dx, y: npc.getLocation().getY() + dy });
    }
  }

  arcaneFlyAway(npc, state) {
    const { Animation } = Shared.core();
    npc.performAnimation(new Animation(ANIMATION.ARCANE_UP));
    state.charges = 0;
    state.flying = 2;
    state.moderateHits = 0;
  }

  graphic(id, tile, delay = 0) {
    const location = tile.getX ? tile : Shared.loc({ x: tile.x, y: tile.y, z: 0 });
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, location, { delay });
  }
}

function nearest(tiles, location) {
  let best = tiles[0];
  let distance = Infinity;
  for (const tile of tiles) {
    const d = Math.max(Math.abs(tile.x - location.getX()), Math.abs(tile.y - location.getY()));
    if (d < distance) {
      best = tile;
      distance = d;
    }
  }
  return best;
}

/** Tiles from `from` (exclusive) to `to` (inclusive), as straight as the grid allows. */
function line(from, to) {
  const tiles = [];
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i <= steps; i++) {
    tiles.push({ x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps) });
  }
  return tiles;
}

function kephriRoomOf(npc) {
  const room = npc?.__toaRoom;
  return room instanceof KephriRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

/** No damage gets through her shield while she sleeps. */
function shieldKephri(event) {
  const room = kephriRoomOf(event.npc);
  if (!room) return;
  if (event.npc.__toaKephri && room.shieldTicks > 0) {
    for (const hit of event.hit.getHits()) hit.setDamage(0);
    event.hit.updateTotalDamage();
  }
  const overlord = event.npc.__toaOverlord;
  if (overlord?.kind === "arcane") {
    const damage = event.hit.getTotalDamage();
    if ((damage >= 15 && ++overlord.moderateHits >= 3) || damage >= 40) room.arcaneFlyAway(event.npc, overlord);
  }
}

function kephriDowned(event) {
  const room = kephriRoomOf(event.npc);
  if (!room) return;
  if (event.npc.__toaKephri) {
    // She stays where she fell, as a corpse, rather than despawning.
    event.preventDeath = true;
    if (!room.onDowned()) room.finalDeath();
    return;
  }
  if (event.npc.__toaEgg) room.eggBroken(event.npc);
}

module.exports = function registerKephri(api) {
  Shared.bind(api);
  Raid.registerRoom("SCABARAS_BOSS", KephriRoom);
  api.onNpcHitModify(shieldKephri);
  api.onNpcBeforeDeath(kephriDowned);
  registerScarabCombat(api);
};

function registerScarabCombat(api) {
  const { CombatMethod, CombatType, Animation, Projectile, NpcIdentifiers } = api.core;

  class AgileScarabCombatMethod extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return 6;
    }

    attackSpeed() {
      return 4;
    }

    start(npc, target) {
      npc.performAnimation(new Animation(ANIMATION.AGILE_ATTACK));
      Projectile.createProjectile(npc, target, PROJECTILE.SPIT, 10, Projectile.arrivalCycles(npc, target, 10), 10, 31).sendProjectile();
    }

    hits(npc, target) {
      const room = kephriRoomOf(npc);
      if (!room) return [];
      return [room.styledHit(npc, target, this, "ranged", 5, 1)];
    }
  }

  class SoldierScarabCombatMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackSpeed() {
      return 6;
    }

    start(npc) {
      npc.performAnimation(new Animation(ANIMATION.SCARAB_ATTACK));
    }

    hits(npc, target) {
      const room = kephriRoomOf(npc);
      if (!room) return [];
      return [room.styledHit(npc, target, this, "melee", 17, 0)];
    }
  }

  api.registerNpcCombatMethodProvider(NpcIdentifiers.AGILE_SCARAB, AgileScarabCombatMethod);
  api.registerNpcCombatMethodProvider(NpcIdentifiers.SOLDIER_SCARAB, SoldierScarabCombatMethod);
}
