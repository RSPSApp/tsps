"use strict";

/**
 * Path of Apmeken, Ba-Ba (Ape-ex Predator). Ba-Ba slams the ground under her target and
 * throws a great rock at everyone, which only rubble, sarcophagi or baboons standing beside
 * you soften. Below 75% baboons join in and wear down the sarcophagi (which then spit
 * debris); at 66% and 33% she knocks everyone to the pit's edge and rolls ten waves of
 * boulders at them, one cracked boulder in each wave.
 * Wiki: https://oldschool.runescape.wiki/w/Ba-Ba
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const SPAWN = { x: 3815, y: 5406, z: 0 };
const BOULDER_STARTS = [{ x: 3813, y: 5401 }, { x: 3813, y: 5404 }, { x: 3813, y: 5407 }, { x: 3813, y: 5410 }, { x: 3813, y: 5413 }];
const SARCOPHAGI = [
  { x: 3803, y: 5416 }, { x: 3808, y: 5416 }, { x: 3813, y: 5416 }, { x: 3818, y: 5416 },
  { x: 3803, y: 5400 }, { x: 3808, y: 5400 }, { x: 3813, y: 5400 }, { x: 3818, y: 5400 },
];
const RUBBLE_TILES = [
  [{ x: 3798, y: 5413 }, { x: 3798, y: 5407 }, { x: 3798, y: 5401 }, { x: 3803, y: 5401 }, { x: 3803, y: 5413 }, { x: 3805, y: 5407 }],
  [{ x: 3816, y: 5413 }, { x: 3812, y: 5413 }, { x: 3812, y: 5406 }, { x: 3812, y: 5401 }, { x: 3817, y: 5401 }, { x: 3810, y: 5405 }],
];
const BABOON_SPAWN = { x: 3811, y: 5408 };
const PIT_WALL_X = 3798;
const PIT_MIN_Y = 5406;

const RUBBLE = 42838;
const SARCOPHAGUS = 45752; // open: + 1
const BANANA_PEEL = 45755;

const ANIMATION = {
  SPAWN: 9752, ATTACK: 9743, THROW_ROCK: 9744, FLY: 9748, THROW_BOULDERS: 9749, PLAYER_FLYBACK: 9799,
  PIT_FALL: 4366, SLIP: 4030, COLLISION: 7210, SLIDE: 1114, BABOON_SPAWN: 9753, BABOON_RANGED: 9745, BABOON_MELEE: 9742,
};
const GRAPHIC = {
  SHADOW_END: 1103, SHADOW_SLOW: 1447, SHADOW_FAST: 2111, SHADOW_RING: 1446, RUBBLE_FALL: 2250, ROCK_IMPACT: 1463,
  SARCO_OPEN: 128, SARCO_IMPACT: 2265, SLIP: 1575, STUN: 245,
};
const PROJECTILE = { ROCK: 2244, BOULDER: 2245, SARCO: 2246, BABOON: 2243 };
const SOUND = { THROW_ROCK: 6023, FLYBACK: 3201, BOULDERS: 5981, RUBBLE: 5949, ROCK_IMPACT: 5987, SLIP: 2727, COLLISION: 6033, DARKNESS: 3737, SHADOW_END: 5972 };

const MAX_HIT = { MELEE: 24, ROCK: 39, SLAM: 17, RUBBLE: 19, COLLISION: 14, SARCO: 8, BANANA: 8, BABOON: 12 };
const COVER = { rubble: 0.05, sarcophagus: 0.55, baboon: 0.45 };
const COVER_COST = { rubble: 10, sarcophagus: 30, baboon: 12 };
const SARCOPHAGUS_HEALTH = 100;
const BABOON_RESPAWN = 325;

class BaBaRoom extends Raid.Room {
  build() {
    this.baba = null;
    this.state = null;
    this.rubble = [null, null];
    this.nextRubble = [null, null];
    this.rockTiles = [];
    this.rubbleTicks = 0;
    this.sarcophagi = SARCOPHAGI.map((tile, index) => ({ tile, index, health: SARCOPHAGUS_HEALTH, open: false, pending: 0 }));
    this.baboons = [null, null];
    this.boulders = new Set();
    this.peels = new Map();
    this.settingsCache = {
      shaking: this.settings.isActive("SHAKING_THINGS_UP"),
      gap: this.settings.isActive("MIND_THE_GAP"),
      dash: this.settings.isActive("BOULDERDASH"),
      japes: this.settings.isActive("JUNGLE_JAPES"),
      faith: this.settings.isActive("GOTTA_HAVE_FAITH"),
    };
    this.resetSarcophagi();
  }

  onStart() {
    const { NpcIdentifiers, Animation } = Shared.core();
    this.baba = this.spawn(NpcIdentifiers.BA_BA, SPAWN, { points: 2, face: 3 }); // Wiki: 2 points per damage
    if (!this.baba) return;
    this.baba.__toaBaba = true;
    this.baba.performAnimation(new Animation(ANIMATION.SPAWN));
    this.state = {
      shadowCycle: 2, slam: null, underneath: 2, rockThrow: 0, rockImpact: 0, baboonTicks: -1,
      script: [], scriptDelay: 0, cracked: Shared.random(0, 4), lastHp: this.baba.getHitpoints(),
    };
    this.openBossHud(this.baba);
  }

  lootSource() {
    return this.baba;
  }

  onComplete() {
    this.clearAdds();
  }

  onReset() {
    this.clearAdds();
    if (this.baba) this.despawn(this.baba);
    this.build();
  }

  clearAdds() {
    for (const rubble of this.rubble) if (rubble) this.removeRubble(rubble);
    this.rubble = [null, null];
    for (const baboon of this.baboons) if (baboon) this.despawn(baboon);
    this.baboons = [null, null];
    for (const boulder of this.boulders) this.despawn(boulder);
    this.boulders.clear();
    for (const tile of this.peels.values()) this.setObject(-1, tile, 10);
    this.peels.clear();
    this.rockTiles = [];
  }

  resetSarcophagi() {
    for (const sarcophagus of this.sarcophagi) {
      sarcophagus.health = SARCOPHAGUS_HEALTH;
      sarcophagus.open = false;
      this.setObject(SARCOPHAGUS, { ...sarcophagus.tile, z: 0 }, 10, sarcophagus.index < 4 ? 1 : 3);
    }
  }

  busy() {
    return !!this.state && (this.state.script.length > 0 || this.state.slam !== null);
  }

  // -------------------------------------------------------------- tick

  tick() {
    const baba = this.baba;
    if (!this.isStarted() || !baba || baba.getHitpoints() <= 0) return;
    const state = this.state;
    const players = this.challengePlayers();
    this.checkThresholds();
    this.tickRubble(players);
    this.tickBoulders(players);
    this.tickBaboons(players);
    if (state.script.length > 0) {
      if (state.scriptDelay > 0 && --state.scriptDelay > 0) return;
      while (state.script.length > 0 && state.scriptDelay <= 0) {
        const [delay, action] = state.script.shift();
        action();
        state.scriptDelay = delay;
      }
      return;
    }
    if (state.rockThrow > 0 && --state.rockThrow <= 0) this.throwRock(players);
    else if (state.rockImpact > 0 && --state.rockImpact <= 0) this.landRock(players);
    else if (state.baboonTicks > 0 && --state.baboonTicks <= 0) state.baboonTicks = this.spawnBaboons() ? BABOON_RESPAWN : 10;
    if (state.slam && --state.slam.ticks <= 0) this.slam(players);
    const target = baba.getCombat().getTarget?.();
    if (target && !state.slam && overlaps(baba, target)) {
      if (--state.underneath <= 0) {
        state.underneath = 2;
        this.startSlam(target, true);
      }
    } else {
      state.underneath = 2;
    }
  }

  /** 75%: baboons start coming. 66% and 33%: the boulder phase. */
  checkThresholds() {
    const baba = this.baba;
    const state = this.state;
    const now = baba.getHitpoints();
    const max = baba.getMaxHitpoints();
    const crossed = (share) => state.lastHp > Math.floor(max * share) && now <= Math.floor(max * share);
    if (crossed(0.75)) state.baboonTicks = 1;
    if (crossed(0.66) || crossed(0.33)) this.boulderPhase();
    state.lastHp = now;
  }

  // -------------------------------------------------------------- attacks

  /** One swing at her target; every few she slams the ground instead. */
  attack(target, method) {
    const state = this.state;
    if (!state || this.busy()) return [];
    const { Animation } = Shared.core();
    if (state.rockImpact <= 0 && (state.shadowCycle <= 0 || --state.shadowCycle <= 0)) {
      this.startSlam(target, false);
      state.shadowCycle = 5;
      return [];
    }
    if (state.shadowCycle === 3) {
      this.dropRubble();
      state.rockThrow = 13;
    }
    this.baba.performAnimation(new Animation(ANIMATION.ATTACK));
    // Wiki: since June 2025 her melee is fully blocked by Protect from Melee.
    return [this.styledHit(this.baba, target, method, "melee", MAX_HIT.MELEE, 0, { prayerMultiplier: 0 })];
  }

  startSlam(target, underneath) {
    const baba = this.baba;
    baba.getCombat().reset();
    const centre = underneath ? baba.getLocation().transform(2, 2) : target.getLocation().clone();
    const fast = overlaps(baba, target);
    this.state.slam = { centre, fast, ticks: fast ? 2 : 4 };
    this.graphic(fast ? GRAPHIC.SHADOW_FAST : GRAPHIC.SHADOW_SLOW, centre);
    for (let distance = 1; distance < (this.settingsCache.shaking ? 4 : 3); distance++) {
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const tile = centre.transform(dx * distance, dy * distance);
        if (Shared.floorFree(this.area, tile)) {
          this.graphic(distance === 1 && !fast ? GRAPHIC.SHADOW_RING : GRAPHIC.SHADOW_FAST, tile, { delay: distance * 30 });
        }
      }
    }
    for (const player of this.challengePlayers()) Shared.sound(player, SOUND.DARKNESS);
  }

  /** The slam lands: full damage in the middle, a tenth less per tile out. */
  slam(players) {
    const { Animation } = Shared.core();
    const { centre, fast } = this.state.slam;
    this.state.slam = null;
    this.baba.performAnimation(new Animation(ANIMATION.ATTACK));
    const length = this.settingsCache.shaking || fast ? 3 : 2;
    for (let dx = -length; dx <= length; dx++) {
      for (let dy = -length; dy <= length; dy++) {
        if ((Math.abs(dx) === length && dy !== 0) || (Math.abs(dy) === length && dx !== 0)) continue;
        const tile = centre.transform(dx, dy);
        if (!Shared.floorFree(this.area, tile)) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.graphic(GRAPHIC.SHADOW_END, tile, { delay: distance === 0 ? 0 : (1 + distance) * 6 });
        for (const player of players) {
          if (!player.getLocation().equals(tile)) continue;
          Shared.damage(player, Math.floor((1 - 0.1 * distance) * this.maxHit(MAX_HIT.SLAM)) + Shared.random(0, 5));
        }
      }
    }
  }

  dropRubble() {
    const speed = Math.min(2, Math.floor(this.pathLevel() / 2));
    this.rubbleTicks = 6 - speed * 2;
    this.rockTiles = [];
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (!this.rockTiles.some((tile) => tile.equals(location))) this.rockTiles.push(location.clone());
      Shared.sound(player, SOUND.RUBBLE);
    }
    for (let side = 0; side < 2; side++) {
      if (this.rubble[side]) continue;
      for (const tile of Shared.shuffle(RUBBLE_TILES[side])) {
        const location = Shared.loc(tile, 0);
        if (!Shared.floorFree(this.area, location) || overlapsTile(this.baba, location, 3)) continue;
        this.nextRubble[side] = location;
        this.rockTiles.push(location);
        break;
      }
    }
    for (const tile of this.rockTiles) this.graphic(GRAPHIC.RUBBLE_FALL + speed, tile, { delay: 20 });
  }

  /** Rubble lands on the marked tiles, crushing anyone there and shoving others aside. */
  tickRubble(players) {
    if (this.rubbleTicks <= 0 || --this.rubbleTicks > 0 || this.state.script.length > 0) return;
    for (const tile of this.rockTiles) {
      for (const player of players) {
        if (player.getLocation().equals(tile)) Shared.damage(player, this.maxHit(MAX_HIT.RUBBLE) + Shared.random(0, 5));
      }
    }
    this.rockTiles = [];
    const health = 10 + Math.floor((players.length - 1) / 2) * 10;
    for (let side = 0; side < 2; side++) {
      const location = this.nextRubble[side];
      if (!location) continue;
      this.nextRubble[side] = null;
      const { NpcIdentifiers } = Shared.core();
      const rubble = this.spawn(NpcIdentifiers.COL_00FFFF_RUBBLE_COL_6, { x: location.getX(), y: location.getY(), z: 0 }, { scale: false, points: 0 });
      if (!rubble) continue;
      rubble.__toaScripted = true;
      rubble.__toaCover = { kind: "rubble", pending: 0 };
      rubble.setMaxHitpoints(health);
      rubble.setHitpoints(health);
      rubble.getMovementQueue().setBlockMovement(true);
      this.setObject(RUBBLE, { x: location.getX(), y: location.getY(), z: 0 }, 10, 2);
      this.rubble[side] = rubble;
      for (const baboon of this.baboons) if (baboon && overlaps(rubble, baboon)) baboon.setHitpoints(0);
      for (const player of players) if (overlaps(rubble, player)) this.shoveOut(player, rubble);
    }
  }

  shoveOut(player, rubble) {
    const location = player.getLocation();
    for (let radius = 1; radius < 4; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          const tile = location.transform(dx, dy);
          if (!Shared.floorFree(this.area, tile) || overlapsTile(rubble, tile, 1)) continue;
          player.forceChat?.("Ouch!");
          player.performAnimation(new (Shared.core().Animation)(ANIMATION.SLIDE));
          Shared.knockback(player, dx, dy, { ticks: 1, speed: 29 });
          return;
        }
      }
    }
  }

  removeRubble(rubble) {
    const location = rubble.getLocation();
    this.setObject(-1, { x: location.getX(), y: location.getY(), z: 0 }, 10);
    this.despawn(rubble);
  }

  throwRock(players) {
    const { Animation } = Shared.core();
    this.baba.performAnimation(new Animation(ANIMATION.THROW_ROCK));
    this.state.rockImpact = 7;
    for (const player of players) {
      player.sendMessage("<col=ef0083>Ba-Ba throws a large boulder at you.</col>");
      Shared.sound(player, SOUND.THROW_ROCK);
      Shared.tileProjectile(this.area, this.baba, player, PROJECTILE.ROCK, { delay: 90, duration: 120, startHeight: 100, endHeight: 31 });
    }
  }

  /** The rock lands on everyone; standing beside cover soaks most of it, at the cover's expense. */
  landRock(players) {
    const base = this.maxHit(MAX_HIT.ROCK);
    for (const player of players) {
      player.performGraphic(Shared.gfx(GRAPHIC.ROCK_IMPACT, { height: 50 }));
      Shared.sound(player, SOUND.ROCK_IMPACT);
      const cover = this.coverFor(player);
      Shared.damage(player, cover ? Math.floor(base * COVER[cover.kind]) : base);
    }
    for (const rubble of this.rubble) {
      if (rubble && rubble.__toaCover.pending > 0) {
        rubble.setHitpoints(Math.max(0, rubble.getHitpoints() - rubble.__toaCover.pending));
        rubble.__toaCover.pending = 0;
        if (rubble.getHitpoints() <= 0) {
          this.rubble[this.rubble.indexOf(rubble)] = null;
          this.removeRubble(rubble);
        }
      }
    }
    for (const sarcophagus of this.sarcophagi) {
      if (sarcophagus.pending > 0) this.damageSarcophagus(sarcophagus, sarcophagus.pending);
      sarcophagus.pending = 0;
    }
    for (const baboon of this.baboons) {
      if (baboon && baboon.__toaCover.pending > 0) {
        baboon.setHitpoints(Math.max(0, baboon.getHitpoints() - baboon.__toaCover.pending));
        baboon.__toaCover.pending = 0;
      }
    }
  }

  coverFor(player) {
    const besides = (x, y, size) => adjacentNoDiagonal(player.getLocation(), x, y, size);
    for (const rubble of this.rubble) {
      if (rubble && besides(rubble.getLocation().getX(), rubble.getLocation().getY(), rubble.getSize()) && claim(rubble.__toaCover, rubble.getHitpoints(), COVER_COST.rubble)) {
        return { kind: "rubble" };
      }
    }
    for (const sarcophagus of this.sarcophagi) {
      if (!sarcophagus.open && besides(sarcophagus.tile.x, sarcophagus.tile.y, 2) && claim(sarcophagus, sarcophagus.health, COVER_COST.sarcophagus)) {
        return { kind: "sarcophagus" };
      }
    }
    for (const baboon of this.baboons) {
      if (baboon && besides(baboon.getLocation().getX(), baboon.getLocation().getY(), 1) && claim(baboon.__toaCover, baboon.getHitpoints(), COVER_COST.baboon)) {
        return { kind: "baboon" };
      }
    }
    return null;
  }

  damageSarcophagus(sarcophagus, amount) {
    if (sarcophagus.open) return;
    sarcophagus.health -= amount;
    if (sarcophagus.health <= 0) this.openSarcophagus(sarcophagus);
  }

  /** An opened sarcophagus spits three bursts of debris every four ticks. */
  openSarcophagus(sarcophagus) {
    sarcophagus.open = true;
    const origin = Shared.loc(sarcophagus.tile, 0);
    const south = sarcophagus.index > 3;
    this.setObject(SARCOPHAGUS + 1, { ...sarcophagus.tile, z: 0 }, 10, sarcophagus.index < 4 ? 1 : 3);
    this.repeat(4, () => {
      if (!this.baba || this.baba.getHitpoints() <= 0) return false;
      this.graphic(GRAPHIC.SARCO_OPEN, origin, { height: 150 });
      const tiles = [];
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = -8; dy <= -1; dy++) {
          const tile = origin.transform(dx, south ? -dy : dy);
          if (Shared.floorFree(this.area, tile)) tiles.push(tile);
        }
      }
      for (const tile of Shared.shuffle(tiles).slice(0, 3)) {
        Shared.tileProjectile(this.area, origin, tile, PROJECTILE.SARCO, { duration: 90, startHeight: 37, endHeight: 0 });
        this.later(2, () => {
          this.graphic(GRAPHIC.SARCO_IMPACT, tile, { delay: 5 });
          for (const player of this.challengePlayers()) {
            if (!player.getLocation().equals(tile)) continue;
            let damage = Math.floor(MAX_HIT.SARCO * this.raid.damageFactor(0));
            if (this.settingsCache.faith) {
              const { Skill } = Shared.core();
              const skills = player.getSkillManager();
              damage += Math.floor(Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - skills.getMaxLevel(Skill.PRAYER)) * 0.15);
            }
            Shared.damage(player, damage + Shared.random(0, 1));
          }
        });
      }
      return true;
    });
  }

  // -------------------------------------------------------------- baboons

  spawnBaboons() {
    const { NpcIdentifiers, Animation } = Shared.core();
    const free = this.baboons.map((baboon, index) => (!baboon || baboon.getHitpoints() <= 0 ? index : -1)).filter((index) => index !== -1);
    if (free.length === 0) return false;
    const tiles = [];
    for (let dx = -5; dx <= 3; dx++) {
      for (let dy = -4; dy <= 4; dy++) {
        const tile = Shared.loc({ x: BABOON_SPAWN.x + dx, y: BABOON_SPAWN.y + dy }, 0);
        if (Shared.floorFree(this.area, tile) && !overlapsTile(this.baba, tile, 1)) tiles.push(tile);
      }
    }
    const shuffled = Shared.shuffle(tiles);
    free.forEach((slot, index) => {
      const tile = shuffled[index];
      if (!tile) return;
      const baboon = this.spawn(NpcIdentifiers.BABOON, { x: tile.getX(), y: tile.getY(), z: 0 }, { points: 1 });
      if (!baboon) return;
      baboon.__toaCover = { kind: "baboon", pending: 0, shots: 3 };
      baboon.performAnimation(new Animation(ANIMATION.BABOON_SPAWN));
      this.baboons[slot] = baboon;
      const target = Shared.randomOf(this.challengePlayers());
      if (target) baboon.getCombat().attack(target);
    });
    return true;
  }

  /** Baboons shoot three times, then go and batter the nearest sarcophagus. */
  tickBaboons(players) {
    const { PathFinder, Animation } = Shared.core();
    this.baboons.forEach((baboon, slot) => {
      if (!baboon) return;
      if (baboon.getHitpoints() <= 0 || baboon.isRegistered?.() === false) {
        this.baboons[slot] = null;
        if (this.settingsCache.japes) this.dropPeel(baboon.getLocation());
        return;
      }
      const cover = baboon.__toaCover;
      if (cover.shots > 0) {
        if (!baboon.getCombat().getTarget?.()) {
          const target = Shared.randomOf(players);
          if (target) baboon.getCombat().attack(target);
        }
        return;
      }
      baboon.getCombat().reset();
      const sarcophagus = this.sarcophagi.filter((entry) => !entry.open)
        .sort((a, b) => baboon.getLocation().getDistance(Shared.loc(a.tile, 0)) - baboon.getLocation().getDistance(Shared.loc(b.tile, 0)))[0];
      if (!sarcophagus) {
        cover.shots = 3;
        return;
      }
      const tile = Shared.loc(sarcophagus.tile, 0);
      if (baboon.getLocation().getDistance(tile) > 2) {
        if (baboon.getMovementQueue().size() === 0) PathFinder.calculateWalkRoute(baboon, tile.getX(), tile.getY() + (sarcophagus.index < 4 ? -2 : 2));
      } else if (Shared.cycle() % 4 === 0) {
        baboon.performAnimation(new Animation(ANIMATION.BABOON_MELEE));
        this.damageSarcophagus(sarcophagus, 20);
        if (sarcophagus.open) cover.shots = 3;
      }
    });
  }

  baboonShot(npc, target, method) {
    const { Animation } = Shared.core();
    npc.performAnimation(new Animation(ANIMATION.BABOON_RANGED));
    const ticks = Shared.tileProjectile(this.area, npc, target, PROJECTILE.BABOON, { delay: 67, duration: 34, perTile: 4, startHeight: 36, endHeight: 36 });
    if (npc.__toaCover.shots > 0) npc.__toaCover.shots--;
    return [this.styledHit(npc, target, method, "ranged", MAX_HIT.BABOON, ticks, { scale: false })];
  }

  dropPeel(location) {
    const tileKey = `${location.getX()},${location.getY()}`;
    if (this.peels.has(tileKey) || !Shared.floorFree(this.area, location)) return;
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    this.peels.set(tileKey, tile);
    this.setObject(BANANA_PEEL, tile, 10, Shared.random(0, 3));
  }

  /** Jungle Japes: banana skins left by fallen baboons trip you up. */
  onStep(player, _from, to) {
    const tileKey = `${to.getX()},${to.getY()}`;
    const tile = this.peels.get(tileKey);
    if (!tile) return;
    const { Animation } = Shared.core();
    this.peels.delete(tileKey);
    this.setObject(-1, tile, 10);
    Shared.damage(player, Math.floor(MAX_HIT.BANANA * this.raid.damageFactor(0)));
    player.sendMessage("You slip and fall on a banana skin!");
    player.performAnimation(new Animation(ANIMATION.SLIP));
    player.performGraphic(Shared.gfx(GRAPHIC.SLIP, { height: 124 }));
    Shared.sound(player, SOUND.SLIP);
    player.getMovementQueue().reset();
    player.getMovementQueue().setBlockMovement(true);
    Shared.later(player, 5, () => player.getMovementQueue().setBlockMovement(false));
  }

  // -------------------------------------------------------------- boulders

  /** She leaps back, throws everyone against the pit wall, then rolls waves of boulders. */
  boulderPhase() {
    const { Animation } = Shared.core();
    const baba = this.baba;
    const state = this.state;
    baba.getCombat().reset();
    baba.getMovementQueue().reset();
    baba.getMovementQueue().setBlockMovement(true);
    baba.setUntargetable(true);
    state.rockThrow = 0;
    state.slam = null;
    state.underneath = 2;
    const script = [];
    script.push([3, () => {}]);
    script.push([1, () => {
      baba.performAnimation(new Animation(ANIMATION.FLY));
      this.clearRockfall();
    }]);
    script.push([1, () => baba.moveTo(Shared.loc(SPAWN))]);
    script.push([1, () => this.knockToWall()]);
    script.push([0, () => {
      this.clearRockfall();
      baba.setUntargetable(false);
    }]);
    const waves = this.settingsCache.dash ? 15 : 10;
    for (let wave = 0; wave < waves; wave++) {
      script.push([2, () => {
        for (const player of this.challengePlayers()) Shared.sound(player, SOUND.BOULDERS);
        for (const start of BOULDER_STARTS) {
          Shared.tileProjectile(this.area, baba, Shared.loc({ x: start.x + 2, y: start.y }, 0), PROJECTILE.BOULDER, { delay: 30, duration: 60, startHeight: 50, endHeight: 5 });
        }
        baba.performAnimation(new Animation(ANIMATION.THROW_BOULDERS));
        state.cracked = Math.max(0, Math.min(4, state.cracked + Shared.random(0, 4) - 2));
      }]);
      script.push([this.settingsCache.dash ? 5 : 6, () => {
        BOULDER_STARTS.forEach((start, index) => this.rollBoulder(start, index === state.cracked));
      }]);
    }
    script.push([0, () => baba.getMovementQueue().setBlockMovement(false)]);
    state.script = script;
    state.scriptDelay = 0;
  }

  clearRockfall() {
    this.rockTiles = [];
    this.rubbleTicks = 0;
    for (let side = 0; side < 2; side++) {
      if (this.rubble[side]) this.removeRubble(this.rubble[side]);
      this.rubble[side] = null;
      this.nextRubble[side] = null;
    }
  }

  intoGap(y) {
    return y >= PIT_MIN_Y && y <= PIT_MIN_Y + 4;
  }

  knockToWall() {
    const { Animation } = Shared.core();
    for (const player of this.challengePlayers()) {
      player.sendMessage("<col=ef0083>Ba-Ba screams and knocks you back!</col>");
      player.performAnimation(new Animation(ANIMATION.PLAYER_FLYBACK));
      player.performGraphic(Shared.gfx(GRAPHIC.STUN, { height: 124 }));
      Shared.sound(player, SOUND.FLYBACK);
      const location = player.getLocation();
      const gap = this.settingsCache.gap && this.intoGap(location.getY());
      const targetX = PIT_WALL_X + (gap ? -2 : 0);
      if (targetX !== location.getX()) Shared.knockback(player, targetX - location.getX(), 0, { ticks: 1, speed: 5 + 10 * Math.abs(targetX - location.getX()) });
      if (gap) this.later(2, () => this.fallIntoPit(player));
    }
  }

  fallIntoPit(player) {
    const { Animation } = Shared.core();
    player.performAnimation(new Animation(ANIMATION.PIT_FALL));
    player.sendMessage("<col=ff3045>You're pushed straight into a deep pit! Ouch!</col>");
    Shared.damage(player, player.getHitpoints());
  }

  rollBoulder(start, cracked) {
    const { NpcIdentifiers } = Shared.core();
    const id = cracked ? NpcIdentifiers.COL_00FFFF_BOULDER_COL_6 : NpcIdentifiers.COL_00FFFF_BOULDER_COL_5;
    const boulder = this.spawn(id, { ...start, z: 0 }, { scale: false, points: 0 });
    if (!boulder) return;
    boulder.__toaScripted = true;
    boulder.__toaBoulder = { cracked };
    boulder.canWalkThroughNPCs = () => true;
    let health = cracked ? 1 : boulder.getDefinition().getHitpoints();
    if (!cracked) {
      const level = this.pathLevel();
      // Wiki: +2 at path level 2 (27), and 4 more at level 4 (31).
      health += level >= 4 ? 6 : level >= 2 ? 2 : 0;
      health = Math.floor(health * (1 + 0.45 * (this.teamSize - 1)));
    }
    boulder.setMaxHitpoints(health);
    boulder.setHitpoints(health);
    this.boulders.add(boulder);
  }

  /** Boulders roll a tile west each tick, flattening whoever they meet. */
  tickBoulders(players) {
    const { Animation } = Shared.core();
    for (const boulder of [...this.boulders]) {
      if (boulder.getHitpoints() <= 0 || boulder.isRegistered?.() === false) {
        this.boulders.delete(boulder);
        continue;
      }
      const location = boulder.getLocation();
      for (const player of players) {
        const at = player.getLocation();
        if (at.getX() < location.getX() || at.getX() > location.getX() + 1 || at.getY() < location.getY() || at.getY() > location.getY() + 2) continue;
        Shared.sound(player, SOUND.COLLISION);
        const pushTo = at.getX() - (this.settingsCache.dash ? 5 : 6);
        if (this.settingsCache.gap && pushTo < PIT_WALL_X && this.intoGap(at.getY())) {
          Shared.knockback(player, PIT_WALL_X - 1 - at.getX(), 0, { ticks: 1, speed: 30 });
          this.later(1, () => this.fallIntoPit(player));
        } else {
          player.performAnimation(new Animation(ANIMATION.COLLISION));
          Shared.knockback(player, Math.max(PIT_WALL_X, pushTo) - at.getX(), 0, { ticks: 1, speed: 30 });
          Shared.damage(player, Math.floor(this.raid.damageFactor(0) * MAX_HIT.COLLISION));
        }
      }
      for (const baboon of this.baboons) {
        if (baboon && baboon.getLocation().getX() === location.getX() && baboon.getLocation().getY() >= location.getY() && baboon.getLocation().getY() <= location.getY() + 2) {
          baboon.setHitpoints(0);
        }
      }
      const next = location.transform(-1, 0);
      if (!Shared.floorFree(this.area, next)) {
        this.boulders.delete(boulder);
        this.despawn(boulder);
        continue;
      }
      // No animate here: the boulder's own idle and walk animation is the roll (9518), and
      // restarting it every tick held the boulder still on the client (the sequence blocks
      // movement while it plays), however far it moved on the server.
      Shared.walkStraight(boulder, next);
    }
  }

  died() {
    this.complete();
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (!viewer) return;
    const location = tile.getX ? tile : Shared.loc({ x: tile.x, y: tile.y, z: 0 });
    Shared.graphicAt(viewer, id, location, options);
  }
}

/** A cover soaks up to its remaining health of rock, `cost` per player sheltering. */
function claim(holder, health, cost) {
  const pending = holder.pending ?? 0;
  if (pending >= health) return false;
  holder.pending = pending + cost;
  return true;
}

function overlaps(npc, other) {
  return overlapsTile(npc, other.getLocation(), other.getSize?.() ?? 1);
}

function overlapsTile(npc, location, size) {
  if (!npc) return false;
  const at = npc.getLocation();
  const npcSize = npc.getSize?.() ?? 1;
  return location.getX() < at.getX() + npcSize && location.getX() + size > at.getX()
    && location.getY() < at.getY() + npcSize && location.getY() + size > at.getY();
}

/** Beside a square of `size` tiles, not diagonally. */
function adjacentNoDiagonal(location, x, y, size) {
  const px = location.getX();
  const py = location.getY();
  const insideX = px >= x && px < x + size;
  const insideY = py >= y && py < y + size;
  if (insideX && (py === y - 1 || py === y + size)) return true;
  return insideY && (px === x - 1 || px === x + size);
}

function babaRoom(npc) {
  const room = npc?.__toaRoom;
  return room instanceof BaBaRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

function babaDowned(event) {
  const room = babaRoom(event.npc);
  if (room && event.npc.__toaBaba) room.died();
}

/** Cracked boulders break at a single hit. */
function crackedBoulder(event) {
  const npc = event.npc;
  if (!babaRoom(npc) || !npc.__toaBoulder?.cracked) return;
  for (const hit of event.hit.getHits()) hit.setDamage(Math.max(1, npc.getHitpoints()));
  event.hit.updateTotalDamage();
}

/** She shrugs off ranged attackers who stay safely across the pit during the boulders. */
function babaUnreachable(event) {
  const target = event.target;
  const room = babaRoom(target);
  if (!room || !target.__toaBaba || !room.busy() || !event.attacker?.isPlayer?.()) return;
  if (room.state.script.length > 0) event.allow = false;
}

module.exports = function registerBaBa(api) {
  Shared.bind(api);
  Raid.registerRoom("APMEKEN_BOSS", BaBaRoom);
  api.onNpcBeforeDeath(babaDowned);
  api.onNpcHitModify(crackedBoulder);
  Raid.onRaidArea("canAttack", babaUnreachable);
  registerBaBaCombat(api);
};

function registerBaBaCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers } = api.core;

  class BaBaCombatMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    canAttack(npc) {
      const room = babaRoom(npc);
      return !!room && room.isStarted() && !room.busy();
    }

    hits(npc, target) {
      const room = babaRoom(npc);
      return room ? room.attack(target, Raid.styleMethod("melee")) : [];
    }
  }

  class BaBaBaboonCombatMethod extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackDistance() {
      return 7;
    }

    hits(npc, target) {
      const room = babaRoom(npc);
      return room && npc.__toaCover ? room.baboonShot(npc, target, Raid.styleMethod("ranged")) : [];
    }
  }

  api.registerNpcCombatMethodProvider(NpcIdentifiers.BA_BA, BaBaCombatMethod, { singleton: false });
  api.registerNpcCombatMethodProvider(NpcIdentifiers.BABOON, BaBaBaboonCombatMethod);
}
