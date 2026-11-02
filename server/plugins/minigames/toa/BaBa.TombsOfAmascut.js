"use strict";

/**
 * Path of Apmeken, Ba-Ba (Ape-ex Predator). Wiki: https://oldschool.runescape.wiki/w/Ba-Ba
 *
 * Ba-Ba slams the ground under her target and throws a great rock at everyone, which rubble,
 * sarcophagi, baboons or a neighbour share with you. Baboons come and go, wearing down the
 * sarcophagi (which then spit debris). At 66% and 33% she knocks everyone to the pit's edge
 * and rolls waves of boulders at them, one cracked boulder in each wave.
 *
 * Where the numbers come from. Captures are rev/rec/tick; no recording after the 25 June 2025
 * rework has a rock throw or a baboon, so those timings are from before it (rev 223-227).
 *
 * Wiki:
 * - Melee max 24, fully blocked by Protect from Melee (June 2025). 2 points per damage.
 * - Next to cover the rock does nothing, "always split completely" (June 2025); it costs rubble
 *   10, a sarcophagus 30 and a baboon 12. Rubble has 10 health and 10 more per extra player.
 *   Standing by another player also shares it. Destroyed rubble brings the next rockfall.
 * - Thresholds 66% and 33%. Ten sets of boulders. Melee ends the set early.
 * - Boulder hitpoints: the Boulder page's table by team size and path level. The cracked one has
 *   the same, and ranged always lands its maximum on it.
 * - Baboons: 1-4 by group size, 10 hitpoints, always take a maximum hit, two banana peels with
 *   Jungle Japes (June 2025). They hit a sarcophagus for 20.
 * - Shaking Things Up: slam area 5x5 -> 7x7. Boulderdash faster. Peel stun 3 seconds.
 *
 * Captures:
 * - Ids and timing: spawn 9752, melee lands on its animation (234/03280 6171-6185).
 * - Rockfall: 2250 at path 0 lands 6 ticks later, 2251 at paths 3-6 lands in 4 (79 samples across
 *   41 fights; path 2 unseen, taken from the Wiki's level 2 step). Marks the player's tile and
 *   the middle of each rubble. Rubble tiles: the 36 captured in those fights.
 * - Rock: thrown 7 ticks before it lands, projectile 90-210, angle 40 (223/00014 3250-3257).
 * - Slam: rings of shadow 30 cycles apart, landing 4 ticks later or 5 with Shaking Things Up;
 *   1103 at 6 cycles per ring (00014 3240-3244, 00101 17930-2). The stomp under her: 2 ticks.
 * - Boulder phase: 9748 on her throne, scream +2 with 11780, first set +2, every 8 ticks (6 with
 *   Boulderdash: 00553, 00554, 01757), boulders 2 after each throw from (3813, 5401-5413) and gone
 *   16 ticks later, 9751 back to 11778 (11779 after the second) (234/03280 6191-6246).
 * - Sarcophagus: 45752 -> 45753; first shots after 5-6 ticks, every 3, 2-3 a time, projectile
 *   90 cycles at angle 41-44 (01757 30735-30747, 01844, 01845).
 * - Baboons: 9753; 3 ticks between shots, 2243 from height 17 at 4 cycles a tile (00014 3269-3274).
 *
 * Estimates (fits, from few samples):
 * - Slam by rings out, 24/15/10/6 x factor: 9 hits, raid level 0-555.
 * - Boulder collision 14-21 x factor: 3280 (14, 17, 17), 3431 (43), 844 (42, 45, 52).
 * - Banana peel 6 x factor +- 1: 8 hits of 14-16 at raid level 520.
 * - Rock with no cover in a party, 24 x factor: 57-60 at the cap, 8 hits. Half of that beside one
 *   other player (28-29, 4 hits).
 * - First baboons 42 ticks in and every 150 ticks: first 39-50 in 10 fights; 3 repeats.
 * - First rockfall 12 ticks in (9-14, 12 fights); first slam on her third swing, then every
 *   fifth; rock 11+ ticks after rockfall on her next swing (11-25, 14 samples), 34 if no rubble fell.
 * - Sarcophagus reach by path level (width x depth): 7 x 10 at paths 5-6 (7 openings, up to 145
 *   shots); 5 x 8 at path 2 and 3 x 6 at path 0 are guesses from the Wiki's "wider".
 *
 * Still only from Near-Reality: the solo rock's 39 (no uncovered solo rock in any recording), the
 * falling rock's 19-24, the sarcophagus shot's 8-9 and Gotta Have Faith's 15% of missing prayer,
 * the baboon's 12, the pit's rows (y 5406-5410) and the "deep pit" message (never captured).
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");

const SPAWN = { x: 3815, y: 5406, z: 0 };
const BOULDER_STARTS = [{ x: 3813, y: 5401 }, { x: 3813, y: 5404 }, { x: 3813, y: 5407 }, { x: 3813, y: 5410 }, { x: 3813, y: 5413 }];
const SARCOPHAGI = [
  { x: 3803, y: 5416 }, { x: 3808, y: 5416 }, { x: 3813, y: 5416 }, { x: 3818, y: 5416 },
  { x: 3803, y: 5400 }, { x: 3808, y: 5400 }, { x: 3813, y: 5400 }, { x: 3818, y: 5400 },
];
// Where rubble has fallen, its south-west tile: one pile from the north half, one from the south.
const RUBBLE_ROW_X = [3798, 3803, 3804, 3805, 3806, 3807, 3808, 3809, 3810, 3811, 3816];
const RUBBLE_TILES = [
  [...RUBBLE_ROW_X.map((x) => ({ x, y: 5413 })), ...[3803, 3805, 3809, 3811].map((x) => ({ x, y: 5407 })), ...[3803, 3805, 3806, 3810, 3811].map((x) => ({ x, y: 5408 }))],
  [...RUBBLE_ROW_X.map((x) => ({ x, y: 5401 })), ...[3803, 3804, 3805, 3808, 3811].map((x) => ({ x, y: 5406 }))],
];
const BABOON_SPAWN = { x: 3811, y: 5408 };
const PIT_WALL_X = 3798;
const PIT_MIN_Y = 5406;
const BOULDER_LIFE = 16;
const BOULDER_SIZE = 3;
const BOULDER_PUSH = 6;
const BOULDER_SETS = 10;
const THROW_TO_ROLL = 2;
const THROW_INTERVAL = 8;
const THROW_INTERVAL_DASH = 6;
const BOULDER_THROWN_FROM = { x: 3816, y: 5409 };
// Wiki, Boulder: hitpoints by team size (1-8) at path levels 0-1, 2-3 and 4+.
const BOULDER_HITPOINTS = [
  [25, 27, 31], [36, 39, 45], [47, 51, 58], [55, 60, 68], [62, 68, 77], [70, 77, 87], [77, 84, 96], [85, 93, 106],
];

const RUBBLE = 42838;
const SARCOPHAGUS = 45752; // open: + 1
const BANANA_PEEL = 45755;

const ANIMATION = {
  SPAWN: 9752, ATTACK: 9743, THROW_ROCK: 9744, FLY: 9748, THROW_BOULDERS: 9749, END_BOULDERS: 9751, PLAYER_FLYBACK: 9799,
  PIT_FALL: 4366, SLIP: 4030, COLLISION: 7210, SLIDE: 1114, BABOON_SPAWN: 9753, BABOON_RANGED: 9745, BABOON_MELEE: 9742,
};
const GRAPHIC = {
  SHADOW_END: 1103, SHADOW_SLOWEST: 1448, SHADOW_SLOW: 1447, SHADOW_FAST: 2111, SHADOW_RING: 1446, RUBBLE_FALL: 2250, ROCK_IMPACT: 1463,
  SARCO_OPEN: 128, SARCO_IMPACT: 2265, SLIP: 1575, STUN: 245,
};
const SHADOW_RINGS = [GRAPHIC.SHADOW_SLOW, GRAPHIC.SHADOW_RING, GRAPHIC.SHADOW_FAST];
const SHADOW_RINGS_SHAKING = [GRAPHIC.SHADOW_SLOWEST, GRAPHIC.SHADOW_SLOW, GRAPHIC.SHADOW_RING, GRAPHIC.SHADOW_FAST];
const SHADOW_RINGS_STOMP = [GRAPHIC.SHADOW_FAST, GRAPHIC.SHADOW_FAST, GRAPHIC.SHADOW_FAST];
const SHADOW_RING_DELAY = 30;
const PROJECTILE = { ROCK: 2244, BOULDER: 2245, SARCO: 2246, BABOON: 2243 };
const SOUND = { THROW_ROCK: 6023, FLYBACK: 3201, BOULDERS: 5981, RUBBLE: 5949, ROCK_IMPACT: 5987, SLIP: 2727, COLLISION: 6033, DARKNESS: 3737, SHADOW_END: 5972 };

const MAX_HIT = { MELEE: 24, ROCK_SOLO: 39, ROCK_PARTY: 24, RUBBLE: 19, SARCO: 8, BANANA: 6, BABOON: 12 };
const SLAM_BY_RING = [24, 15, 10, 6];
const COLLISION = { min: 14, max: 21 };
const COVER_COST = { rubble: 10, sarcophagus: 30, baboon: 12 };
const RUBBLE_HEALTH = 10;
const SARCOPHAGUS_HEALTH = 100;
const SARCOPHAGUS_HIT = 20;
const SARCOPHAGUS_FIRST_SHOT = 6;
const SARCOPHAGUS_INTERVAL = 3;
const SARCOPHAGUS_SHOTS = { min: 2, max: 3 };
const SARCOPHAGUS_LANDS = 3;
const SARCOPHAGUS_REACH = [{ width: 3, depth: 6 }, { width: 5, depth: 8 }, { width: 7, depth: 10 }];
const FAITH_FACTOR = 0.15;
const BABOON_HITPOINTS = 10;
const BABOON_FIRST = 42;
const BABOON_RESPAWN = 150;
const BABOON_ATTACK_SPEED = 3;
const ATTACK_SPEED = 6;
const FIRST_ROCKFALL = 12;
const ROCK_AFTER_FALL = 11;
const ROCK_AGAIN = 34;
const ROCK_LANDS = 7;
const FALL_AFTER_ROCK = 2;
const SLAM_EVERY = 5;
const PEEL_STUN = 5;
const TASK = { PERFECT: "Perfect Ba-Ba", SKIP: "No skipping allowed", RUSH: "I'm in a rush", EXPERT: "Ba-Bananza" };
const RUSH_BOULDERS = 4; // Wiki: "four or fewer"; the game's message says five.
const EXPERT_PATH_LEVEL = 4;

class BaBaRoom extends Raid.Room {
  build() {
    this.baba = null;
    this.state = null;
    this.rubble = [null, null];
    this.nextRubble = [null, null];
    this.rockTiles = [];
    this.rubbleTicks = 0;
    this.sarcophagi = SARCOPHAGI.map((tile, index) => ({ tile, index, health: SARCOPHAGUS_HEALTH, open: false, pending: 0 }));
    this.baboons = new Array(Math.min(4, Math.ceil(this.teamSize / 2))).fill(null);
    this.boulders = new Set();
    this.bouldersDestroyed = 0;
    this.dying = false;
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
    this.baba = this.spawn(NpcIdentifiers.BA_BA, SPAWN, { points: 2, face: 3 }); // Wiki, Chest: 2 points per damage
    if (!this.baba) return;
    this.baba.__toaBaba = true;
    this.baba.performAnimation(new Animation(ANIMATION.SPAWN));
    this.state = {
      shadowCycle: 3, slam: null, underneath: 2, rockDue: 0, fallTicks: FIRST_ROCKFALL, rockImpact: 0, baboonTicks: BABOON_FIRST,
      script: [], scriptDelay: 0, cracked: Shared.random(1, 3), lastHp: this.baba.getHitpoints(),
      boulders: false, phasesDone: 0, phasesWaiting: 0,
    };
    this.openBossHud(this.baba);
  }

  lootSource() {
    return this.baba;
  }

  onComplete() {
    this.clearAdds();
    this.reportTasks();
  }

  allInvocations() {
    const on = this.settingsCache;
    return on.shaking && on.gap && on.dash && on.japes && on.faith;
  }

  failPerfect(reason) {
    this.raid.failTask(TASK.PERFECT, reason);
  }

  reportTasks() {
    const survivors = this.deathlessPlayers();
    if (survivors.length > 0) this.raid.completeTask(TASK.RUSH, survivors);
    if (survivors.length > 0 && this.settingsCache.dash) this.raid.completeTask(TASK.SKIP, survivors);
    if (!this.allInvocations()) return;
    if (this.teamSize >= 2) this.raid.completeTask(TASK.PERFECT);
    if (survivors.length > 0 && this.pathLevel() >= EXPERT_PATH_LEVEL) this.raid.completeTask(TASK.EXPERT, survivors);
  }

  /** The Wiki's two boulder tasks: every boulder counts for the rush, a cracked one for its destroyer. */
  boulderDestroyed(boulder) {
    this.bouldersDestroyed++;
    if (boulder.__toaBoulder.cracked && boulder.__toaLastHit?.isPlayer?.()) {
      this.raid.failTask(TASK.SKIP, "You destroyed a weakened boulder.", boulder.__toaLastHit);
    }
    if (this.bouldersDestroyed > RUSH_BOULDERS) this.raid.failTask(TASK.RUSH, "More than five rolling boulders were destroyed.");
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
    this.baboons = this.baboons.map(() => null);
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
    if (state.phasesWaiting > 0 && !state.slam) {
      state.phasesWaiting--;
      this.boulderPhase();
      return;
    }
    if (state.fallTicks > 0 && --state.fallTicks <= 0) this.dropRubble();
    if (state.rockImpact > 0 && --state.rockImpact <= 0) this.landRock(players);
    if (state.baboonTicks > 0 && --state.baboonTicks <= 0) state.baboonTicks = this.spawnBaboons() ? BABOON_RESPAWN : 10;
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

  /** 66% and 33%: the boulder phase, as soon as the last one is over. */
  checkThresholds() {
    const baba = this.baba;
    const state = this.state;
    const now = baba.getHitpoints();
    const max = baba.getMaxHitpoints();
    const crossed = (share) => state.lastHp > Math.floor(max * share) && now <= Math.floor(max * share);
    if (now > 0 && crossed(0.66)) state.phasesWaiting++;
    if (now > 0 && crossed(0.33)) state.phasesWaiting++;
    state.lastHp = now;
  }

  // -------------------------------------------------------------- attacks

  /** One swing at her target; every few she slams the ground or throws her rock instead. */
  attack(target, method) {
    const state = this.state;
    if (!state || this.busy()) return [];
    const { Animation } = Shared.core();
    const players = this.challengePlayers();
    if (state.rockDue > 0 && Shared.cycle() >= state.rockDue && state.rockImpact <= 0) {
      state.rockDue = 0;
      state.shadowCycle--;
      this.throwRock(players);
      return [];
    }
    if (--state.shadowCycle <= 0) {
      state.shadowCycle = SLAM_EVERY;
      this.startSlam(target, false);
      return [];
    }
    this.baba.performAnimation(new Animation(ANIMATION.ATTACK));
    if (target.isPlayer?.() && !Shared.isProtected(target, "melee")) {
      this.failPerfect(`${Shared.displayName(target)} didn't pray against a melee attack.`);
    }
    // Wiki: since June 2025 her melee is fully blocked by Protect from Melee.
    return [this.styledHit(this.baba, target, method, "melee", MAX_HIT.MELEE, 0, { prayerMultiplier: 0 })];
  }

  startSlam(target, underneath) {
    const baba = this.baba;
    baba.getCombat().reset();
    const centre = underneath ? baba.getLocation().transform(2, 2) : target.getLocation().clone();
    const fast = overlaps(baba, target);
    const rings = fast ? SHADOW_RINGS_STOMP : this.settingsCache.shaking ? SHADOW_RINGS_SHAKING : SHADOW_RINGS;
    this.state.slam = { centre, fast, target, ticks: fast ? 2 : rings.length + 1 };
    rings.forEach((graphic, distance) => {
      const delay = distance * SHADOW_RING_DELAY;
      if (distance === 0) {
        this.graphic(graphic, centre, { delay });
        return;
      }
      for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const tile = centre.transform(dx * distance, dy * distance);
        if (Shared.floorFree(this.area, tile)) this.graphic(graphic, tile, { delay });
      }
    });
    for (const player of this.challengePlayers()) Shared.sound(player, SOUND.DARKNESS);
  }

  /** The slam lands: hardest in the middle, weaker each ring out. */
  slam(players) {
    const { Animation } = Shared.core();
    const { centre, fast, target } = this.state.slam;
    this.state.slam = null;
    this.baba.performAnimation(new Animation(ANIMATION.ATTACK));
    const length = this.settingsCache.shaking || fast ? 3 : 2;
    for (let dx = -length; dx <= length; dx++) {
      for (let dy = -length; dy <= length; dy++) {
        if ((Math.abs(dx) === length && dy !== 0) || (Math.abs(dy) === length && dx !== 0)) continue;
        const tile = centre.transform(dx, dy);
        if (!Shared.floorFree(this.area, tile)) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        this.graphic(GRAPHIC.SHADOW_END, tile, { delay: distance * 6 });
        for (const player of players) {
          if (!player.getLocation().equals(tile)) continue;
          Shared.damage(player, this.maxHit(SLAM_BY_RING[distance]));
          this.failPerfect(`${Shared.displayName(player)} was hit by Ba-Ba's slam.`);
        }
      }
    }
    if (target?.getHitpoints?.() > 0 && this.inChallenge(target)) this.baba.getCombat().attack(target);
  }

  /** Rock falls on each player's tile and on two piles of debris; the rock throw follows. */
  dropRubble() {
    const faster = this.pathLevel() >= 2;
    this.rubbleTicks = faster ? 4 : 6;
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
        // The shadow marks the pile's middle tile, and only that tile hurts.
        this.rockTiles.push(location.transform(1, 1));
        break;
      }
    }
    for (const tile of this.rockTiles) this.graphic(faster ? GRAPHIC.RUBBLE_FALL + 1 : GRAPHIC.RUBBLE_FALL, tile, { delay: 20 });
    this.state.rockDue = Shared.cycle() + ROCK_AFTER_FALL;
  }

  /** Rubble lands on the marked tiles, crushing anyone there and shoving others aside. */
  tickRubble(players) {
    if (this.rubbleTicks <= 0 || --this.rubbleTicks > 0 || this.state.script.length > 0) return;
    for (const tile of this.rockTiles) {
      for (const player of players) {
        if (!player.getLocation().equals(tile)) continue;
        Shared.damage(player, this.maxHit(MAX_HIT.RUBBLE) + Shared.random(0, 5));
        this.failPerfect(`${Shared.displayName(player)} was hit by falling rocks.`);
      }
    }
    this.rockTiles = [];
    const health = RUBBLE_HEALTH * Math.max(1, players.length);
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
      for (const baboon of this.baboons) if (baboon && overlaps(rubble, baboon)) Shared.kill(baboon);
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
          player.sendMessage("You are knocked back from the rubble.");
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
    this.state.rockImpact = ROCK_LANDS;
    for (const player of players) {
      player.sendMessage("<col=ff289d>Ba-Ba throws a large boulder at you.</col>");
      Shared.sound(player, SOUND.THROW_ROCK, 10);
      Shared.tileProjectile(this.area, this.baba, player, PROJECTILE.ROCK, { delay: 90, duration: 120, perTile: 0, startHeight: 100, endHeight: 31, angle: 40 });
    }
  }

  /**
   * The rock lands on everyone. Beside cover it does nothing at the cover's expense (Wiki: since
   * June 2025 "always split completely"); beside another player the two share it.
   */
  landRock(players) {
    const base = this.maxHit(this.teamSize > 1 ? MAX_HIT.ROCK_PARTY : MAX_HIT.ROCK_SOLO);
    for (const player of players) {
      player.performGraphic(Shared.gfx(GRAPHIC.ROCK_IMPACT, { height: 50 }));
      Shared.sound(player, SOUND.ROCK_IMPACT);
      if (this.coverFor(player)) continue;
      const beside = players.filter((other) => other !== player && other.getLocation().getDistance(player.getLocation()) <= 1).length;
      Shared.damage(player, Math.floor(base / (1 + beside)));
      this.failPerfect(`${Shared.displayName(player)} was hit by Ba-Ba's rock.`);
    }
    let destroyed = false;
    for (const rubble of this.rubble) {
      if (rubble && rubble.__toaCover.pending > 0) {
        rubble.setHitpoints(Math.max(0, rubble.getHitpoints() - rubble.__toaCover.pending));
        rubble.__toaCover.pending = 0;
        if (rubble.getHitpoints() <= 0) {
          this.rubble[this.rubble.indexOf(rubble)] = null;
          this.removeRubble(rubble);
          destroyed = true;
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
    if (destroyed) this.state.fallTicks = FALL_AFTER_ROCK;
    else this.state.rockDue = Shared.cycle() + ROCK_AGAIN;
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

  /** An opened sarcophagus spits two or three shots every three ticks, into a cone by path level. */
  openSarcophagus(sarcophagus) {
    sarcophagus.open = true;
    this.failPerfect("A sarcophagus was opened.");
    const origin = Shared.loc(sarcophagus.tile, 0);
    const south = sarcophagus.index > 3;
    this.setObject(SARCOPHAGUS + 1, { ...sarcophagus.tile, z: 0 }, 10, sarcophagus.index < 4 ? 1 : 3);
    const reach = SARCOPHAGUS_REACH[Math.min(2, Math.floor(this.pathLevel() / 2))];
    this.later(SARCOPHAGUS_FIRST_SHOT - SARCOPHAGUS_INTERVAL, () => this.repeat(SARCOPHAGUS_INTERVAL, () => {
      if (!this.baba || this.baba.getHitpoints() <= 0) return false;
      this.graphic(GRAPHIC.SARCO_OPEN, origin, { height: 150 });
      const tiles = [];
      for (let dx = -reach.width; dx <= reach.width; dx++) {
        for (let dy = 1; dy <= reach.depth; dy++) {
          const tile = origin.transform(dx, south ? dy : -dy);
          if (Shared.floorFree(this.area, tile)) tiles.push(tile);
        }
      }
      for (const tile of Shared.shuffle(tiles).slice(0, Shared.random(SARCOPHAGUS_SHOTS.min, SARCOPHAGUS_SHOTS.max))) {
        Shared.tileProjectile(this.area, origin, tile, PROJECTILE.SARCO, { duration: 90, perTile: 0, startHeight: 37, endHeight: 0, angle: 44 });
        this.later(SARCOPHAGUS_LANDS, () => {
          this.graphic(GRAPHIC.SARCO_IMPACT, tile, { delay: 5 });
          for (const player of this.challengePlayers()) {
            if (!player.getLocation().equals(tile)) continue;
            Shared.damage(player, this.sarcophagusDamage(player));
          }
        });
      }
      return true;
    }));
  }

  /** Wiki: Gotta Have Faith adds damage the lower the player's prayer points. */
  sarcophagusDamage(player) {
    let damage = this.maxHit(MAX_HIT.SARCO);
    if (this.settingsCache.faith) {
      const { Skill } = Shared.core();
      const skills = player.getSkillManager();
      damage += Math.floor(Math.max(0, skills.getMaxLevel(Skill.PRAYER) - skills.getCurrentLevel(Skill.PRAYER)) * FAITH_FACTOR);
    }
    return damage + Shared.random(0, 1);
  }

  // -------------------------------------------------------------- baboons

  spawnBaboons() {
    const { NpcIdentifiers, Animation } = Shared.core();
    const free = this.baboons.map((baboon, index) => (!baboon || baboon.getHitpoints() <= 0 ? index : -1)).filter((index) => index !== -1);
    if (free.length === 0) return false;
    const tiles = [];
    for (let dx = -5; dx <= 8; dx++) {
      for (let dy = -4; dy <= 6; dy++) {
        const tile = Shared.loc({ x: BABOON_SPAWN.x + dx, y: BABOON_SPAWN.y + dy }, 0);
        if (Shared.floorFree(this.area, tile) && !overlapsTile(this.baba, tile, 1)) tiles.push(tile);
      }
    }
    const shuffled = Shared.shuffle(tiles);
    free.forEach((slot, index) => {
      const tile = shuffled[index];
      if (!tile) return;
      const baboon = this.spawn(NpcIdentifiers.BABOON, { x: tile.getX(), y: tile.getY(), z: 0 }, { points: 1, scale: false });
      if (!baboon) return;
      baboon.setMaxHitpoints(BABOON_HITPOINTS);
      baboon.setHitpoints(BABOON_HITPOINTS);
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
        if (this.settingsCache.japes) this.dropPeels(baboon.getLocation());
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
      } else if (Shared.cycle() % BABOON_ATTACK_SPEED === 0) {
        baboon.performAnimation(new Animation(ANIMATION.BABOON_MELEE));
        this.damageSarcophagus(sarcophagus, SARCOPHAGUS_HIT);
        if (sarcophagus.open) cover.shots = 3;
      }
    });
  }

  baboonShot(npc, target, method) {
    const { Animation } = Shared.core();
    npc.performAnimation(new Animation(ANIMATION.BABOON_RANGED));
    const ticks = Shared.tileProjectile(this.area, npc, target, PROJECTILE.BABOON, { delay: 67, duration: 0, perTile: 4, startHeight: 17, endHeight: 36, angle: 14 });
    if (npc.__toaCover.shots > 0) npc.__toaCover.shots--;
    return [this.styledHit(npc, target, method, "ranged", MAX_HIT.BABOON, ticks, { scale: false })];
  }

  /** Wiki: since June 2025 two peels from each fallen baboon, on its tile and one beside it. */
  dropPeels(location) {
    this.dropPeel(location);
    for (const [dx, dy] of Shared.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]])) {
      if (this.dropPeel(location.transform(dx, dy))) return;
    }
  }

  dropPeel(location) {
    const tileKey = `${location.getX()},${location.getY()}`;
    if (this.peels.has(tileKey) || !Shared.floorFree(this.area, location)) return false;
    const tile = { x: location.getX(), y: location.getY(), z: 0 };
    this.peels.set(tileKey, tile);
    this.setObject(BANANA_PEEL, tile, 10, Shared.random(0, 3));
    return true;
  }

  /** Jungle Japes: banana skins left by fallen baboons trip you up. */
  onStep(player, _from, to) {
    const tileKey = `${to.getX()},${to.getY()}`;
    const tile = this.peels.get(tileKey);
    if (!tile) return;
    const { Animation } = Shared.core();
    this.peels.delete(tileKey);
    this.setObject(-1, tile, 10);
    Shared.damage(player, this.maxHit(MAX_HIT.BANANA) + Shared.random(-1, 1));
    player.performAnimation(new Animation(ANIMATION.SLIP));
    player.performGraphic(Shared.gfx(GRAPHIC.SLIP, { height: 124 }));
    Shared.sound(player, SOUND.SLIP);
    player.getMovementQueue().reset();
    player.getMovementQueue().setBlockMovement(true);
    Shared.later(player, PEEL_STUN, () => player.getMovementQueue().setBlockMovement(false));
  }

  // -------------------------------------------------------------- boulders

  /** She leaps back, throws everyone against the pit wall, then rolls waves of boulders. */
  boulderPhase() {
    const { Animation, NpcIdentifiers } = Shared.core();
    const baba = this.baba;
    const state = this.state;
    baba.getCombat().reset();
    baba.getMovementQueue().reset();
    baba.getMovementQueue().setBlockMovement(true);
    baba.setUntargetable(true);
    state.boulders = true;
    state.cracked = Shared.random(1, 3);
    state.rockDue = 0;
    state.rockImpact = 0;
    state.fallTicks = 0;
    state.slam = null;
    state.underneath = 2;
    this.clearRockfall();
    const script = [];
    script.push([3, () => {}]);
    script.push([2, () => {
      baba.moveTo(Shared.loc(SPAWN));
      baba.performAnimation(new Animation(ANIMATION.FLY));
    }]);
    script.push([THROW_TO_ROLL, () => {
      baba.setNpcTransformationId(NpcIdentifiers.BA_BA_3);
      this.knockToWall();
      baba.setUntargetable(false);
    }]);
    const interval = this.settingsCache.dash ? THROW_INTERVAL_DASH : THROW_INTERVAL;
    for (let wave = 0; wave < BOULDER_SETS; wave++) {
      script.push([THROW_TO_ROLL, () => {
        for (const player of this.challengePlayers()) Shared.sound(player, SOUND.BOULDERS);
        for (const start of BOULDER_STARTS) {
          Shared.tileProjectile(this.area, Shared.loc(BOULDER_THROWN_FROM, 0), Shared.loc({ x: start.x + 2, y: start.y }, 0), PROJECTILE.BOULDER,
            { delay: 30, duration: 60, perTile: 0, startHeight: 50, endHeight: 5, angle: 35 });
        }
        baba.performAnimation(new Animation(ANIMATION.THROW_BOULDERS));
        // Wiki: the first in the middle three, then up to two places from the last.
        if (wave > 0) state.cracked = Math.max(0, Math.min(4, state.cracked + Shared.random(0, 4) - 2));
      }]);
      script.push([interval - THROW_TO_ROLL, () => {
        BOULDER_STARTS.forEach((start, index) => this.rollBoulder(start, index === state.cracked));
      }]);
    }
    script.push([0, () => this.endBoulders()]);
    state.script = script;
    state.scriptDelay = 0;
  }

  /** The set is over, or (Wiki) someone hit her with melee: back to fighting, the second time as 11779. */
  endBoulders() {
    const { Animation, NpcIdentifiers } = Shared.core();
    const baba = this.baba;
    const state = this.state;
    if (!state.boulders) return;
    state.boulders = false;
    state.script = [];
    state.scriptDelay = 0;
    state.phasesDone++;
    baba.setNpcTransformationId(state.phasesDone > 1 ? NpcIdentifiers.BA_BA_2 : NpcIdentifiers.BA_BA);
    baba.performAnimation(new Animation(ANIMATION.END_BOULDERS));
    baba.getMovementQueue().setBlockMovement(false);
    state.shadowCycle = 3;
    state.fallTicks = FIRST_ROCKFALL;
    const target = Shared.randomOf(this.challengePlayers());
    if (target) baba.getCombat().attack(target);
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
      player.sendMessage("<col=ff289d>Ba-Ba screams and knocks you back!</col>");
      player.performAnimation(new Animation(ANIMATION.PLAYER_FLYBACK));
      player.performGraphic(Shared.gfx(GRAPHIC.STUN, { height: 124 }));
      Shared.sound(player, SOUND.FLYBACK);
      const location = player.getLocation();
      const gap = this.settingsCache.gap && this.intoGap(location.getY());
      const targetX = PIT_WALL_X + (gap ? -2 : 0);
      if (targetX !== location.getX()) Shared.knockback(player, targetX - location.getX(), 0, { ticks: 1, speed: 120 });
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
    const boulder = this.spawn(id, { ...start, z: 0 }, { scale: false, points: 1 }); // Wiki: 1 point for most NPCs
    if (!boulder) return;
    boulder.__toaScripted = true;
    boulder.__toaBoulder = { cracked, life: BOULDER_LIFE };
    boulder.canWalkThroughNPCs = () => true;
    const level = this.pathLevel();
    const health = BOULDER_HITPOINTS[Math.min(8, Math.max(1, this.teamSize)) - 1][level >= 4 ? 2 : level >= 2 ? 1 : 0];
    boulder.setMaxHitpoints(health);
    boulder.setHitpoints(health);
    this.boulders.add(boulder);
  }

  /** Boulders roll a tile west each tick, flattening whoever they meet, baboons and debris too. */
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
        if (at.getX() < location.getX() || at.getX() >= location.getX() + BOULDER_SIZE - 1 || at.getY() < location.getY() || at.getY() >= location.getY() + BOULDER_SIZE) continue;
        Shared.sound(player, SOUND.COLLISION);
        const pushTo = at.getX() - BOULDER_PUSH;
        if (this.settingsCache.gap && pushTo < PIT_WALL_X && this.intoGap(at.getY())) {
          Shared.knockback(player, PIT_WALL_X - 1 - at.getX(), 0, { ticks: 1, speed: 30 });
          this.later(1, () => this.fallIntoPit(player));
        } else {
          player.performAnimation(new Animation(ANIMATION.COLLISION));
          Shared.knockback(player, Math.max(PIT_WALL_X, pushTo) - at.getX(), 0, { ticks: 1, speed: 30 });
          this.later(1, () => Shared.damage(player, Math.floor(Shared.random(COLLISION.min, COLLISION.max) * this.damageFactor())));
        }
        this.failPerfect(`${Shared.displayName(player)} was hit by a rolling boulder.`);
      }
      for (const baboon of this.baboons) {
        if (baboon && overlaps(boulder, baboon)) Shared.kill(baboon);
      }
      for (let side = 0; side < 2; side++) {
        const rubble = this.rubble[side];
        if (rubble && overlaps(boulder, rubble)) {
          this.removeRubble(rubble);
          this.rubble[side] = null;
        }
      }
      if (--boulder.__toaBoulder.life <= 0) {
        this.boulders.delete(boulder);
        this.despawn(boulder);
        continue;
      }
      // No animate here: the boulder's own idle and walk animation is the roll (9518), and
      // restarting it every tick held the boulder still on the client (the sequence blocks
      // movement while it plays), however far it moved on the server.
      Shared.walkStraight(boulder, location.transform(-1, 0));
    }
  }

  /** Her death plays out before the room is over (03280 6323-6327). */
  died() {
    if (this.dying) return;
    this.dying = true;
    this.later(4, () => this.complete());
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
  const npc = event.npc;
  const room = babaRoom(npc);
  if (!room) return;
  if (npc.__toaBaba) room.died();
  else if (npc.__toaBoulder) room.boulderDestroyed(npc);
}

/** Who last hit a boulder (for the tasks); melee on Ba-Ba ends the boulders (Wiki). */
function boulderStruck(event) {
  const npc = event.npc;
  const room = babaRoom(npc);
  if (!room) return;
  const attacker = event.hit.getAttacker?.();
  if (npc.__toaBoulder) npc.__toaLastHit = attacker;
  if (npc.__toaBaba && room.state?.boulders && attacker?.isPlayer?.()
    && event.hit.getCombatType?.() === Shared.core().CombatType.MELEE) room.endBoulders();
}

/** Baboons always take a maximum hit (Wiki, June 2025); so does a cracked boulder from ranged. */
function certainHits(roll) {
  const npc = roll.target;
  if (!roll.attacker?.isPlayer?.() || !babaRoom(npc)) return;
  const baboon = npc.__toaCover?.kind === "baboon";
  const cracked = npc.__toaBoulder?.cracked && roll.combatType === Shared.core().CombatType.RANGED;
  if (baboon || cracked) {
    roll.forceAccurate = true;
    roll.forceMaxHit = true;
  }
}

module.exports = function registerBaBa(api) {
  Shared.bind(api);
  Raid.registerRoom("APMEKEN_BOSS", BaBaRoom);
  api.onNpcBeforeDeath(babaDowned);
  api.onNpcHitModify(boulderStruck);
  api.onCombatHitRoll(certainHits);
  registerBaBaCombat(api);
};

function registerBaBaCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers } = api.core;

  class BaBaCombatMethod extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackSpeed() {
      return ATTACK_SPEED;
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

    attackSpeed() {
      return BABOON_ATTACK_SPEED;
    }

    attackDistance() {
      return 7;
    }

    hits(npc, target) {
      const room = babaRoom(npc);
      return room && npc.__toaCover ? room.baboonShot(npc, target, Raid.styleMethod("ranged")) : [];
    }
  }

  api.registerNpcCombatMethodProvider([NpcIdentifiers.BA_BA, NpcIdentifiers.BA_BA_2, NpcIdentifiers.BA_BA_3], BaBaCombatMethod, { singleton: false });
  api.registerNpcCombatMethodProvider(NpcIdentifiers.BABOON, BaBaBaboonCombatMethod);
}
