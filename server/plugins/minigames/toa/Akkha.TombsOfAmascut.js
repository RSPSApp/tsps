"use strict";

/**
 * Path of Het, Akkha (Sands of Time). Akkha cycles melee, ranged and magic (each form only
 * hurt by the style it fears), and between attacks runs one of three specials: the memory
 * of glowing quadrants, a trail of orbs behind every player, or detonations around them.
 * At 80/60/40/20% his four shadows appear and blast their quadrant on a timer; while he
 * stands on a quadrant whose shadow lives he is immune. At zero he makes a final stand as
 * four shadows, only one real and only hurt in melee.
 * Wiki: https://oldschool.runescape.wiki/w/Akkha
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

const UNSTABLE_ORB_PATHS = [
  [3670, 5405, "NORTH_EAST"], [3670, 5406, "NORTH_EAST"], [3670, 5406, "EAST"], [3670, 5407, "NORTH_EAST"],
  [3670, 5407, "EAST"], [3670, 5407, "SOUTH_EAST"], [3670, 5408, "NORTH_EAST"], [3670, 5408, "EAST"],
  [3670, 5408, "SOUTH_EAST"], [3670, 5409, "EAST"], [3670, 5409, "SOUTH_EAST"], [3670, 5410, "SOUTH_EAST"],
  [3671, 5402, "NORTH_EAST"], [3671, 5403, "NORTH_EAST"], [3671, 5403, "EAST"], [3671, 5404, "NORTH_EAST"],
  [3671, 5404, "EAST"], [3671, 5404, "SOUTH_EAST"], [3671, 5405, "NORTH"], [3671, 5405, "NORTH_EAST"],
  [3671, 5405, "EAST"], [3671, 5405, "SOUTH_EAST"], [3671, 5410, "SOUTH"], [3671, 5410, "NORTH_EAST"],
  [3671, 5410, "EAST"], [3671, 5410, "SOUTH_EAST"], [3671, 5411, "NORTH_EAST"], [3671, 5411, "EAST"],
  [3671, 5411, "SOUTH_EAST"], [3671, 5412, "EAST"], [3671, 5412, "SOUTH_EAST"], [3671, 5413, "SOUTH_EAST"],
  [3672, 5401, "NORTH_EAST"], [3672, 5402, "NORTH"], [3672, 5402, "NORTH_EAST"], [3672, 5402, "EAST"],
  [3672, 5413, "SOUTH"], [3672, 5413, "EAST"], [3672, 5413, "SOUTH_EAST"], [3672, 5414, "SOUTH_EAST"],
  [3673, 5400, "NORTH_EAST"], [3673, 5401, "NORTH"], [3673, 5401, "NORTH_EAST"], [3673, 5401, "EAST"],
  [3673, 5414, "SOUTH"], [3673, 5414, "EAST"], [3673, 5414, "SOUTH_EAST"], [3673, 5415, "SOUTH_EAST"],
  [3674, 5399, "NORTH_EAST"], [3674, 5400, "NORTH"], [3674, 5400, "NORTH_EAST"], [3674, 5400, "EAST"],
  [3674, 5415, "SOUTH"], [3674, 5415, "EAST"], [3674, 5415, "SOUTH_EAST"], [3674, 5416, "SOUTH_EAST"],
  [3675, 5398, "NORTH_EAST"], [3675, 5399, "NORTH"], [3675, 5399, "NORTH_EAST"], [3675, 5399, "EAST"],
  [3675, 5416, "SOUTH"], [3675, 5416, "EAST"], [3675, 5416, "SOUTH_EAST"], [3675, 5417, "SOUTH_EAST"],
  [3676, 5398, "NORTH"], [3676, 5398, "NORTH_EAST"], [3676, 5417, "SOUTH"], [3676, 5417, "SOUTH_EAST"],
  [3677, 5398, "NORTH_WEST"], [3677, 5398, "NORTH"], [3677, 5398, "NORTH_EAST"], [3677, 5417, "SOUTH"],
  [3677, 5417, "SOUTH_WEST"], [3677, 5417, "SOUTH_EAST"], [3678, 5397, "NORTH_EAST"],
  [3678, 5398, "NORTH_WEST"], [3678, 5398, "NORTH"], [3678, 5398, "NORTH_EAST"], [3678, 5398, "EAST"],
  [3678, 5417, "SOUTH"], [3678, 5417, "SOUTH_WEST"], [3678, 5417, "EAST"], [3678, 5417, "SOUTH_EAST"],
  [3678, 5418, "SOUTH_EAST"], [3679, 5397, "NORTH"], [3679, 5397, "NORTH_EAST"], [3679, 5418, "SOUTH"],
  [3679, 5418, "SOUTH_EAST"], [3680, 5397, "NORTH_WEST"], [3680, 5397, "NORTH"], [3680, 5397, "NORTH_EAST"],
  [3680, 5418, "SOUTH"], [3680, 5418, "SOUTH_WEST"], [3680, 5418, "SOUTH_EAST"], [3681, 5397, "NORTH_WEST"],
  [3681, 5397, "NORTH"], [3681, 5397, "NORTH_EAST"], [3681, 5418, "SOUTH"], [3681, 5418, "SOUTH_WEST"],
  [3681, 5418, "SOUTH_EAST"], [3682, 5397, "NORTH_WEST"], [3682, 5397, "NORTH"], [3682, 5418, "SOUTH"],
  [3682, 5418, "SOUTH_WEST"], [3683, 5397, "NORTH_WEST"], [3683, 5398, "WEST"], [3683, 5398, "NORTH_WEST"],
  [3683, 5398, "NORTH"], [3683, 5398, "NORTH_EAST"], [3683, 5417, "SOUTH"], [3683, 5417, "SOUTH_WEST"],
  [3683, 5417, "WEST"], [3683, 5417, "SOUTH_EAST"], [3683, 5418, "SOUTH_WEST"], [3684, 5398, "NORTH_WEST"],
  [3684, 5398, "NORTH"], [3684, 5398, "NORTH_EAST"], [3684, 5417, "SOUTH"], [3684, 5417, "SOUTH_WEST"],
  [3684, 5417, "SOUTH_EAST"], [3685, 5398, "NORTH_WEST"], [3685, 5398, "NORTH"], [3685, 5417, "SOUTH"],
  [3685, 5417, "SOUTH_WEST"], [3686, 5398, "NORTH_WEST"], [3686, 5399, "WEST"], [3686, 5399, "NORTH_WEST"],
  [3686, 5399, "NORTH"], [3686, 5416, "SOUTH"], [3686, 5416, "SOUTH_WEST"], [3686, 5416, "WEST"],
  [3686, 5417, "SOUTH_WEST"], [3687, 5399, "NORTH_WEST"], [3687, 5400, "WEST"], [3687, 5400, "NORTH_WEST"],
  [3687, 5400, "NORTH"], [3687, 5415, "SOUTH"], [3687, 5415, "SOUTH_WEST"], [3687, 5415, "WEST"],
  [3687, 5416, "SOUTH_WEST"], [3688, 5400, "NORTH_WEST"], [3688, 5401, "WEST"], [3688, 5401, "NORTH_WEST"],
  [3688, 5401, "NORTH"], [3688, 5414, "SOUTH"], [3688, 5414, "SOUTH_WEST"], [3688, 5414, "WEST"],
  [3688, 5415, "SOUTH_WEST"], [3689, 5401, "NORTH_WEST"], [3689, 5402, "WEST"], [3689, 5402, "NORTH_WEST"],
  [3689, 5402, "NORTH"], [3689, 5413, "SOUTH"], [3689, 5413, "SOUTH_WEST"], [3689, 5413, "WEST"],
  [3689, 5414, "SOUTH_WEST"], [3690, 5402, "NORTH_WEST"], [3690, 5403, "WEST"], [3690, 5403, "NORTH_WEST"],
  [3690, 5404, "SOUTH_WEST"], [3690, 5404, "WEST"], [3690, 5404, "NORTH_WEST"], [3690, 5405, "SOUTH_WEST"],
  [3690, 5405, "WEST"], [3690, 5405, "NORTH_WEST"], [3690, 5405, "NORTH"], [3690, 5410, "SOUTH"],
  [3690, 5410, "SOUTH_WEST"], [3690, 5410, "WEST"], [3690, 5410, "NORTH_WEST"], [3690, 5411, "SOUTH_WEST"],
  [3690, 5411, "WEST"], [3690, 5411, "NORTH_WEST"], [3690, 5412, "SOUTH_WEST"], [3690, 5412, "WEST"],
  [3690, 5413, "SOUTH_WEST"], [3691, 5405, "NORTH_WEST"], [3691, 5406, "WEST"], [3691, 5406, "NORTH_WEST"],
  [3691, 5407, "SOUTH_WEST"], [3691, 5407, "WEST"], [3691, 5407, "NORTH_WEST"], [3691, 5408, "SOUTH_WEST"],
  [3691, 5408, "WEST"], [3691, 5408, "NORTH_WEST"], [3691, 5409, "SOUTH_WEST"], [3691, 5409, "WEST"],
  [3691, 5410, "SOUTH_WEST"],
];
// Per quadrant: [x, firstY, lastY] column runs.
const QUADRANT_COLUMNS = [
  [[3681, 5408, 5417], [3682, 5408, 5417], [3683, 5408, 5416], [3684, 5408, 5416], [3685, 5408, 5416], [3686, 5408, 5415], [3687, 5408, 5414], [3688, 5408, 5413], [3689, 5408, 5412], [3690, 5408, 5409]],
  [[3681, 5398, 5407], [3682, 5398, 5407], [3683, 5399, 5407], [3684, 5399, 5407], [3685, 5399, 5407], [3686, 5400, 5407], [3687, 5401, 5407], [3688, 5402, 5407], [3689, 5403, 5407], [3690, 5406, 5407]],
  [[3671, 5406, 5407], [3672, 5403, 5407], [3673, 5402, 5407], [3674, 5401, 5407], [3675, 5400, 5407], [3676, 5399, 5407], [3677, 5399, 5407], [3678, 5399, 5407], [3679, 5398, 5407], [3680, 5398, 5407]],
  [[3671, 5408, 5409], [3672, 5408, 5412], [3673, 5408, 5413], [3674, 5408, 5414], [3675, 5408, 5415], [3676, 5408, 5416], [3677, 5408, 5416], [3678, 5408, 5416], [3679, 5408, 5417], [3680, 5408, 5417]],
];

const Z = 1;
const SPAWN = { x: 3673, y: 5407, z: Z };
const MEMORY_TILE = { x: 3680, y: 5406, z: Z };
const QUADRANT_BASE = { x: 3681, y: 5408 };
const QUADRANT_ORIGINS = [{ x: 3681, y: 5408 }, { x: 3681, y: 5407 }, { x: 3680, y: 5407 }, { x: 3680, y: 5408 }];
const SHADOW_TILES = [{ x: 3685, y: 5412 }, { x: 3685, y: 5401 }, { x: 3674, y: 5401 }, { x: 3674, y: 5412 }];
const QUADRANT_LIGHTS = [
  [45871, 3682, 5409], [45869, 3682, 5406], [45870, 3679, 5406], [45868, 3679, 5409],
];
const QUADRANT_GRAPHICS = [2257, 2256, 2259, 2258];
const QUADRANT_SOUNDS = [5591, 3887, 173, 156];
const QUADRANT_NAMES = ["shadow", "lightning", "ice", "fire"];

const ANIMATION = {
  MELEE: 9770, RANGED: 9772, MAGIC: 9774, VANISH: 9784, APPEAR: 9785, DETONATION: 9776, MEMORY: 9777,
  TRAIL: 9778, FINAL_STAND: 9779, SHADOW_SPAWN: 9790, SHADOW_BLAST: 9777, SHADOW_DEATH: 9792,
};
const PROJECTILE = { RANGED: 2255, MAGIC: 2253 };
const SOUND = { STYLE: 5585, SYMBOL: 5667, QUADRANT: 5727, TRAIL: 5722, FIRE: 4827, RANGED_HIT: 5640, MAGIC_HIT: 5774 };
const GRAPHIC = { FIRE: 128, UNSTABLE_BURST: 2260 };

const MAX_HIT = { STYLE: 22, QUADRANT: 14, TRAIL: 13, DETONATION: 15, UNSTABLE: 13 };
const PRAYER_THROUGH = { melee: 0.25, ranged: 0.15, magic: 0.15 };
const SHADOW_TIMER = 50;
const TRAIL_TICKS = 22;
const DETONATION_TICKS = 10;
const TRAIL_ORB_LIFE = 8;
const UNSTABLE_INTERVAL = 3;
const FINAL_SHARE = 0.2;

class AkkhaRoom extends Raid.Room {
  build() {
    const { NpcIdentifiers } = Shared.core();
    this.forms = [NpcIdentifiers.AKKHA, NpcIdentifiers.AKKHA_3, NpcIdentifiers.AKKHA_4];
    this.styles = ["melee", "ranged", "magic"];
    this.formIndex = 0;
    this.attackCycles = Shared.random(5, 7);
    this.specialIndex = Shared.random(0, 2);
    this.memory = [];
    this.memoryDelay = 0;
    this.trailTicks = 0;
    this.detonationTicks = 0;
    this.shadows = [null, null, null, null];
    this.finalShadows = [];
    this.realIndex = -1;
    this.trailOrbs = new Map();
    this.unstableOrbs = new Set();
    this.unstableTicks = -1;
    this.lastTrailTile = new Map();
    this.effects = new Map();
    this.standing = false;
    this.lastHp = null;
    const settings = this.settings;
    this.doubleTrouble = settings.isActive("DOUBLE_TROUBLE");
    this.keepBack = settings.isActive("KEEP_BACK");
    this.stayVigilant = settings.isActive("STAY_VIGILANT");
    this.feelingSpecial = settings.isActive("FEELING_SPECIAL");
    this.memoryIterations = 4 + Math.min(2, Math.floor(this.pathLevel() / 2));
    this.akkha = this.spawn(NpcIdentifiers.AKKHA, SPAWN, { points: 1 });
    // Wiki: "while it is a distance attack, he will always try to close the gap between him and
    // his target", so he can be led into the quadrant of a dispelled shadow.
    this.akkha?.setFlag("combat:close-in");
    if (this.akkha) this.akkha.__toaAkkha = true;
  }

  onStart() {
    this.raid.scale(this.akkha, this.pathLevel());
    this.lastHp = this.akkha.getHitpoints();
    this.openBossHud(this.akkha);
  }

  lootSource() {
    return this.akkha;
  }

  onComplete() {
    this.clearAdds();
  }

  onReset() {
    this.clearAdds();
    this.despawn(this.akkha);
    for (const shadow of this.finalShadows) this.despawn(shadow);
    this.build();
  }

  clearAdds() {
    for (const shadow of this.shadows) if (shadow) this.despawn(shadow);
    this.shadows = [null, null, null, null];
    for (const orb of this.trailOrbs.keys()) this.despawn(orb);
    this.trailOrbs.clear();
    for (const orb of this.unstableOrbs) this.despawn(orb);
    this.unstableOrbs.clear();
  }

  get style() {
    return this.styles[this.formIndex];
  }

  quadrantOf(location) {
    if (location.getX() >= QUADRANT_BASE.x) return location.getY() >= QUADRANT_BASE.y ? 0 : 1;
    return location.getY() >= QUADRANT_BASE.y ? 3 : 2;
  }

  /** He can't be hurt while standing in a quadrant whose shadow is alive. */
  onShadedQuadrant() {
    const centre = this.akkha.getLocation().transform(1, 1);
    const shadow = this.shadows[this.quadrantOf(centre)];
    return !!shadow && shadow.getHitpoints() > 0 && shadow.isRegistered?.() !== false;
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted()) return;
    this.tickMemory();
    this.tickTimers();
    this.tickShadows();
    this.tickTrailOrbs();
    if (this.realIndex !== -1 && this.unstableTicks > 0 && --this.unstableTicks <= 0) {
      this.unstableTicks = UNSTABLE_INTERVAL;
      this.spawnUnstableOrbs();
    }
    this.moveUnstableOrbs();
    this.checkThresholds();
  }

  /** At 80/60/40/20% of his health the shadows appear (and later return). */
  checkThresholds() {
    const akkha = this.akkha;
    if (!akkha || this.standing || this.lastHp === null) return;
    const now = akkha.getHitpoints();
    for (let share = 0.8; share > 0.1; share -= 0.2) {
      const threshold = Math.floor(akkha.getMaxHitpoints() * share);
      if (this.lastHp > threshold && now <= threshold && now > 0) {
        this.spawnShadows(share > 0.7);
        break;
      }
    }
    this.lastHp = now;
  }

  tickTimers() {
    if (this.detonationTicks > 0) {
      if (--this.detonationTicks === 8) {
        for (const player of this.challengePlayers()) player.sendMessage("<col=a53fff>You have been marked for detonation!</col>");
      } else if (this.detonationTicks <= 0) {
        this.detonate();
      }
    }
    if (this.trailTicks > 0) {
      if (--this.trailTicks === 20) {
        for (const player of this.challengePlayers()) {
          player.sendMessage("<col=a53fff>Magical orbs begin to materialise behind you!</col>");
          this.lastTrailTile.set(player, player.getLocation().clone());
        }
      } else if (this.trailTicks <= 0) {
        for (const player of this.challengePlayers()) player.sendMessage("<col=229628>The magical orbs stop materialising.</col>");
        this.lastTrailTile.clear();
      }
    }
  }

  trailing() {
    return this.trailTicks > 0 && this.trailTicks <= 20;
  }

  // -------------------------------------------------------------- attacks

  /** One swing: every few attacks a special and (usually) a change of style. */
  attack(target) {
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    if (this.standing || this.memory.length > 0) return;
    if (this.style === "melee" && akkha.getLocation().getDistance(target.getLocation()) > 3) return;
    if (this.attackCycles > 0 && --this.attackCycles <= 0) {
      this.attackCycles = Shared.random(5, 7);
      const players = this.challengePlayers().length;
      if (this.doubleTrouble) {
        this.specialIndex %= players < 2 ? 1 : 2;
        if (this.specialIndex === 0) this.memoryBlast();
        else this.startDetonation();
        this.trailTicks = TRAIL_TICKS;
      } else {
        this.specialIndex %= players < 2 ? 2 : 3;
        if (this.specialIndex === 0) this.memoryBlast();
        else if (this.specialIndex === 1) {
          akkha.performAnimation(new Animation(ANIMATION.TRAIL));
          this.trailTicks = TRAIL_TICKS;
        } else this.startDetonation();
      }
      this.specialIndex++;
      if (!this.stayVigilant || Shared.random(0, 2) === 0) this.changeStyle();
      return;
    }
    if (this.style === "melee") {
      akkha.performAnimation(new Animation(ANIMATION.MELEE));
      this.cleave(target);
    } else {
      this.volley(this.style === "magic");
      if (this.keepBack) this.cleave(null);
    }
    if (this.stayVigilant && Shared.random(0, 2) === 0) this.changeStyle();
  }

  /** Melee hits his target and anyone beside them in reach. */
  cleave(target) {
    const akkha = this.akkha;
    for (const player of this.challengePlayers()) {
      if (target && player.getLocation().getDistance(target.getLocation()) > 1) continue;
      if (!withinReach(akkha, player)) continue;
      this.strike(akkha, player, this.methodFor("melee"), "melee", MAX_HIT.STYLE, 0, { prayerMultiplier: PRAYER_THROUGH.melee });
    }
  }

  /** Ranged and magic hit everyone in the fight. */
  volley(magic) {
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    akkha.performAnimation(new Animation(magic ? ANIMATION.MAGIC : ANIMATION.RANGED));
    this.later(1, () => {
      if (!this.akkha || this.akkha.getHitpoints() <= 0) return;
      for (const player of this.challengePlayers()) {
        const ticks = Shared.tileProjectile(this.area, akkha, player, magic ? PROJECTILE.MAGIC : PROJECTILE.RANGED,
          { duration: 30, perTile: 3, startHeight: 101, endHeight: 34 });
        Shared.sound(player, magic ? SOUND.MAGIC_HIT : SOUND.RANGED_HIT);
        const style = magic ? "magic" : "ranged";
        this.strike(akkha, player, this.methodFor(style), style, MAX_HIT.STYLE, ticks, { prayerMultiplier: PRAYER_THROUGH[style] });
      }
    });
  }

  methodFor(style) {
    return Raid.styleMethod(style);
  }

  changeStyle() {
    this.akkha.getCombat().reset();
    for (const player of this.roomPlayers()) Shared.sound(player, SOUND.STYLE);
    this.formIndex = (this.formIndex + 1) % this.forms.length;
    this.akkha.setNpcTransformationId(this.forms[this.formIndex]);
  }

  startDetonation() {
    const { Animation } = Shared.core();
    this.akkha.performAnimation(new Animation(ANIMATION.DETONATION));
    this.detonationTicks = DETONATION_TICKS;
  }

  /** Three tiles out from every player in a plus (or with Feeling Special, maybe an x). */
  detonate() {
    const cross = this.feelingSpecial && Shared.random(0, 1) === 0;
    const steps = cross ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const hit = new Set();
    const players = this.challengePlayers();
    for (const player of players) {
      const quadrant = this.quadrantOf(player.getLocation());
      for (const [dx, dy] of steps) {
        let tile = player.getLocation();
        for (let i = 0; i < 3; i++) {
          tile = tile.transform(dx, dy);
          const key = `${tile.getX()},${tile.getY()}`;
          if (hit.has(key) || !Shared.floorFree(this.area, tile)) continue;
          hit.add(key);
          this.graphic(QUADRANT_GRAPHICS[quadrant], tile, { height: quadrant === 3 ? 124 : 0 });
          for (const victim of players) {
            if (!victim.getLocation().equals(tile)) continue;
            Shared.damage(victim, this.maxHit(MAX_HIT.DETONATION) + Shared.random(0, 2));
            this.applyEffect(victim, quadrant);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- memory

  /** He vanishes, lights the quadrants in an order, then blasts every quadrant but the lit one, in turn. */
  memoryBlast() {
    const { Animation } = Shared.core();
    const akkha = this.akkha;
    akkha.getCombat().reset();
    akkha.getMovementQueue().reset();
    akkha.getMovementQueue().setBlockMovement(true);
    akkha.performAnimation(new Animation(ANIMATION.MEMORY));
    const order = [Shared.random(0, 3)];
    for (let i = 1; i < 4; i++) order.push((order[i - 1] + (Shared.random(0, 1) === 0 ? 3 : 1)) % 4);
    let shown = 0;
    const light = () => {
      const [id, x, y] = QUADRANT_LIGHTS[order[shown++ % 4]];
      this.setObject(id, { x, y, z: Z }, 10, 0);
      this.later(1, () => this.setObject(-1, { x, y, z: Z }, 10));
      for (const player of this.challengePlayers()) Shared.sound(player, SOUND.SYMBOL);
    };
    const steps = [];
    steps.push([1, () => {
      for (const player of this.challengePlayers()) player.sendMessage("<col=6800bf>Sections of the room start to glow...</col>");
    }]);
    steps.push([1, () => {
      akkha.setUntargetable(true);
      akkha.performAnimation(new Animation(ANIMATION.VANISH));
    }]);
    steps.push([2, () => {
      akkha.setVisible(false);
      akkha.moveTo(Shared.loc(MEMORY_TILE));
      light();
    }]);
    for (let i = 1; i < this.memoryIterations; i++) {
      steps.push([this.feelingSpecial && i === this.memoryIterations - 1 ? 0 : 2, light]);
    }
    for (let i = 0; i < this.memoryIterations; i++) {
      const lit = order[i % 4];
      steps.push([i === this.memoryIterations - 1 ? 3 : this.feelingSpecial ? 2 : 4, () => {
        this.quadrantBlast(false, [0, 1, 2, 3].filter((quadrant) => quadrant !== lit));
      }]);
    }
    steps.push([1, () => {
      akkha.moveTo(Shared.loc(MEMORY_TILE));
      akkha.setVisible(true);
      akkha.performAnimation(new Animation(ANIMATION.APPEAR));
    }]);
    steps.push([0, () => {
      akkha.setUntargetable(false);
      akkha.getMovementQueue().setBlockMovement(false);
    }]);
    this.memory = steps;
    this.memoryDelay = 2;
  }

  tickMemory() {
    if (this.memory.length === 0) return;
    if (this.memoryDelay > 0 && --this.memoryDelay > 0) return;
    while (this.memory.length > 0 && this.memoryDelay <= 0) {
      const [delay, action] = this.memory.shift();
      action();
      this.memoryDelay = delay;
    }
  }

  /** Fire across whole quadrants from their corner (or, from a shadow, towards it). */
  quadrantBlast(fromShadow, quadrants) {
    for (const player of this.challengePlayers()) Shared.sound(player, SOUND.QUADRANT);
    for (const quadrant of quadrants) {
      const origin = QUADRANT_ORIGINS[quadrant];
      const tiles = quadrantTiles(quadrant);
      for (const tile of tiles) {
        const distance = Math.max(Math.abs(tile.x - origin.x), Math.abs(tile.y - origin.y)) * 3;
        this.graphic(QUADRANT_GRAPHICS[quadrant], tile, { delay: 30 + (fromShadow ? 27 - distance : distance), height: quadrant === 3 ? 124 : 0 });
      }
      for (const tick of [0, 1]) {
        this.later(tick, () => {
          for (const tile of tiles) {
            const distance = Math.max(Math.abs(tile.x - origin.x), Math.abs(tile.y - origin.y)) * 3;
            const delay = fromShadow ? 27 - distance : distance;
            if ((tick === 0 && delay >= 18) || (tick === 1 && delay < 18)) continue;
            for (const player of this.challengePlayers()) {
              const location = player.getLocation();
              if (location.getX() !== tile.x || location.getY() !== tile.y) continue;
              Shared.damage(player, this.maxHit(MAX_HIT.QUADRANT) + Shared.random(0, 2));
              this.applyEffect(player, quadrant);
            }
          }
        });
      }
    }
  }

  // -------------------------------------------------------------- shadows

  spawnShadows(first) {
    const { NpcIdentifiers, Animation } = Shared.core();
    for (const player of this.challengePlayers()) {
      player.sendMessage(first ? "<col=ef0083>Shadows appear throughout the room!</col>" : "<col=ef0083>The shadows in the room are restored!</col>");
    }
    for (let i = 0; i < 4; i++) {
      const shadow = this.shadows[i];
      if (!shadow || shadow.getHitpoints() <= 0 || shadow.isRegistered?.() === false) {
        const spawned = this.spawn(NpcIdentifiers.AKKHAS_SHADOW, { ...SHADOW_TILES[i], z: Z }, { points: 1 });
        if (!spawned) continue;
        spawned.__toaScripted = true;
        spawned.__toaShadow = { index: i, counter: 0, delay: 0, immune: !first };
        spawned.getMovementQueue().setBlockMovement(true);
        spawned.performAnimation(new Animation(ANIMATION.SHADOW_SPAWN));
        this.shadows[i] = spawned;
      } else {
        shadow.setHitpoints(shadow.getMaxHitpoints());
        shadow.__toaShadow.counter = 0;
        shadow.__toaShadow.delay = 0;
        if (shadow.__toaShadow.immune !== "restored") shadow.__toaShadow.immune = false;
      }
    }
  }

  /** Each shadow fills its timer and then blasts its own quadrant. */
  tickShadows() {
    const { Animation } = Shared.core();
    for (const shadow of this.shadows) {
      if (!shadow || shadow.getHitpoints() <= 0 || this.memory.length > 0) continue;
      const state = shadow.__toaShadow;
      if (state.delay <= 0) {
        if (++state.counter >= SHADOW_TIMER) {
          state.counter = 0;
          state.delay = 4;
        }
      } else if (--state.delay === 3) {
        shadow.performAnimation(new Animation(ANIMATION.SHADOW_BLAST));
      } else if (state.delay === 2) {
        this.quadrantBlast(true, [state.index]);
      }
    }
  }

  /** Killing a shadow shields the others until the next threshold. */
  shadowDied(index) {
    this.shadows.forEach((shadow, i) => {
      if (i !== index && shadow && shadow.getHitpoints() > 0 && shadow.__toaShadow.immune !== "restored") shadow.__toaShadow.immune = true;
    });
  }

  // -------------------------------------------------------------- orbs

  onStep(player, from, to) {
    if (!this.trailing() || !this.inChallenge(player) || !from) return;
    Shared.sound(player, SOUND.TRAIL);
    this.spawnTrailOrb(from);
    if (this.feelingSpecial) this.spawnTrailOrb(to.transform(Math.sign(to.getX() - from.getX()), Math.sign(to.getY() - from.getY())));
  }

  spawnTrailOrb(location) {
    if (!Shared.floorFree(this.area, location)) return;
    for (const orb of this.trailOrbs.keys()) if (orb.getLocation().equals(location)) return;
    const { NpcIdentifiers } = Shared.core();
    const quadrant = this.quadrantOf(location);
    const ids = [NpcIdentifiers.COL_00FFFF_ORB_OF_DARKNESS_COL_2, NpcIdentifiers.COL_00FFFF_ORB_OF_LIGHTNING_COL,
      NpcIdentifiers.COL_00FFFF_FROZEN_ORB_COL, NpcIdentifiers.COL_00FFFF_BURNING_ORB_COL];
    const orb = this.spawn(ids[quadrant], { x: location.getX(), y: location.getY(), z: Z }, { scale: false, points: 0 });
    if (!orb) return;
    orb.__toaScripted = true;
    orb.setUntargetable(true);
    orb.getMovementQueue().setBlockMovement(true);
    this.trailOrbs.set(orb, { life: TRAIL_ORB_LIFE, quadrant });
  }

  tickTrailOrbs() {
    for (const [orb, state] of [...this.trailOrbs]) {
      const victim = this.challengePlayers().find((player) => player.getLocation().equals(orb.getLocation()));
      if (victim) {
        Shared.damage(victim, this.maxHit(MAX_HIT.TRAIL) + Shared.random(0, 2));
        Shared.sound(victim, QUADRANT_SOUNDS[state.quadrant]);
        victim.performGraphic(Shared.gfx(QUADRANT_GRAPHICS[state.quadrant], { height: state.quadrant === 3 ? 124 : 0 }));
        this.applyEffect(victim, state.quadrant);
      }
      if (victim || --state.life <= 0) {
        this.trailOrbs.delete(orb);
        this.despawn(orb);
      }
    }
  }

  spawnUnstableOrbs() {
    const { NpcIdentifiers } = Shared.core();
    for (const [x, y, direction] of Shared.shuffle(UNSTABLE_ORB_PATHS).slice(0, 6)) {
      const orb = this.spawn(NpcIdentifiers.COL_00FFFF_UNSTABLE_ORB_COL, { x, y, z: Z }, { scale: false, points: 0 });
      if (!orb) continue;
      orb.__toaScripted = true;
      orb.__toaDirection = direction;
      orb.setUntargetable(true);
      orb.canWalkThroughNPCs = () => true;
      this.unstableOrbs.add(orb);
    }
  }

  /** Unstable orbs roll in a straight line, splitting their damage between up to two players. */
  moveUnstableOrbs() {
    const directions = {
      NORTH: [0, 1], SOUTH: [0, -1], EAST: [1, 0], WEST: [-1, 0],
      NORTH_EAST: [1, 1], NORTH_WEST: [-1, 1], SOUTH_EAST: [1, -1], SOUTH_WEST: [-1, -1],
    };
    for (const orb of [...this.unstableOrbs]) {
      const location = orb.getLocation();
      const victims = this.challengePlayers().filter((player) => player.getLocation().equals(location));
      if (victims.length > 0) {
        const damage = Math.floor(Math.floor(this.raid.damageFactor(0) * MAX_HIT.UNSTABLE) / Math.min(2, victims.length)) + Shared.random(0, 2);
        for (const victim of victims) Shared.damage(victim, damage);
        this.unstableOrbs.delete(orb);
        this.despawn(orb);
        continue;
      }
      const [dx, dy] = directions[orb.__toaDirection];
      const next = location.transform(dx, dy);
      if (!Shared.floorFree(this.area, next)) {
        orb.performGraphic(Shared.gfx(GRAPHIC.UNSTABLE_BURST, { delay: 10, height: 158 }));
        this.unstableOrbs.delete(orb);
        this.later(1, () => this.despawn(orb));
        continue;
      }
      Shared.walkStraight(orb, next);
    }
  }

  // -------------------------------------------------------------- effects

  /** Each quadrant's element: darkness, lightning, ice or fire. */
  applyEffect(player, quadrant) {
    const now = Shared.cycle();
    const last = this.effects.get(player) ?? {};
    const kind = QUADRANT_NAMES[quadrant];
    const cooldown = { shadow: 4, lightning: 6, ice: 25, fire: 30 }[kind];
    if (now <= (last[kind] ?? -Infinity) + cooldown) return;
    last[kind] = now;
    this.effects.set(player, last);
    if (kind === "shadow") {
      player.sendMessage("<col=ff3045>You have been consumed by darkness!</col>");
      let ticks = 0;
      this.repeat(1, () => {
        if (!this.affected(player) || ticks++ >= 4) return false;
        Shared.damage(player, 5);
        return true;
      });
    } else if (kind === "lightning") {
      const { PrayerHandler } = Shared.core();
      player.sendMessage("<col=ff3045>You have been struck by lightning and can't use protection prayers!</col>");
      for (const prayer of PrayerHandler.PROTECTION_PRAYERS) PrayerHandler.deactivatePrayer(player, prayer);
      player.getCombat().getPrayerBlockTimer().start(5);
    } else if (kind === "ice") {
      player.sendMessage("<col=ff3045>Your attacks have been slowed by some ice!</col>");
      player.__toaIcedUntil = now + 24;
      this.later(24, () => this.affected(player) && player.sendMessage("<col=229628>The ice around you melts away.</col>"));
    } else {
      player.forceChat?.("Argh! It burns!");
      player.sendMessage("<col=ff3045>You have been set alight!</col>");
      let burns = 0;
      this.later(1, () => this.repeat(2, () => {
        if (!this.affected(player)) return false;
        Shared.sound(player, SOUND.FIRE);
        Shared.damage(player, 3);
        player.performGraphic(Shared.gfx(GRAPHIC.FIRE, { height: 124 }));
        for (const other of this.challengePlayers()) {
          if (other !== player && other.getLocation().getDistance(player.getLocation()) <= 1) this.applyEffect(other, 3);
        }
        if (burns++ >= 4) {
          player.sendMessage("<col=229628>The fire around you goes out.</col>");
          return false;
        }
        return true;
      }));
    }
  }

  affected(player) {
    return this.isStarted() && player.getHitpoints() > 0 && this.inChallenge(player);
  }

  // -------------------------------------------------------------- final stand

  /** Out of health: he makes a final stand as four shadows, one of them him. */
  finalStand() {
    const { Animation, NpcIdentifiers } = Shared.core();
    const akkha = this.akkha;
    this.standing = true;
    akkha.setHitpoints(1);
    akkha.setUntargetable(true);
    akkha.getCombat().reset();
    akkha.getMovementQueue().reset();
    akkha.performAnimation(new Animation(ANIMATION.FINAL_STAND));
    for (const player of this.challengePlayers()) player.sendMessage("<col=ef0083>Akkha makes his final stand!</col>");
    for (const shadow of this.shadows) if (shadow) this.despawn(shadow);
    this.shadows = [null, null, null, null];
    this.trailTicks = 0;
    this.detonationTicks = 0;
    this.later(3, () => {
      const max = akkha.getMaxHitpoints();
      this.despawn(akkha);
      this.realIndex = Shared.random(0, 3);
      this.finalShadows = SHADOW_TILES.map((tile, index) => {
        const real = index === this.realIndex;
        const shadow = this.spawn(real ? NpcIdentifiers.AKKHA_7 : NpcIdentifiers.AKKHAS_SHADOW_2, { ...tile, z: Z }, { scale: false, points: real ? 1 : 0 });
        if (!shadow) return null;
        shadow.__toaScripted = true;
        shadow.__toaFinal = { real, hits: 0 };
        shadow.getMovementQueue().setBlockMovement(true);
        shadow.performAnimation(new Animation(ANIMATION.APPEAR));
        shadow.setMaxHitpoints(max);
        shadow.setHitpoints(Math.floor(max * FINAL_SHARE));
        return shadow;
      });
      this.openBossHud(this.finalShadows[this.realIndex]);
      this.unstableTicks = UNSTABLE_INTERVAL;
    });
  }

  /** Enough hits on the real one and it swaps places with one of the fakes. */
  finalShadowHit(shadow) {
    const state = shadow.__toaFinal;
    if (!state.real || ++state.hits < 1 + this.teamSize * 2) return;
    state.hits = 0;
    const others = this.finalShadows.filter((other) => other && other !== shadow);
    const swap = Shared.randomOf(others);
    if (!swap) return;
    const { Animation } = Shared.core();
    shadow.performAnimation(new Animation(ANIMATION.VANISH));
    swap.performAnimation(new Animation(ANIMATION.VANISH));
    shadow.setUntargetable(true);
    this.later(1, () => {
      const here = shadow.getLocation().clone();
      shadow.moveTo(swap.getLocation().clone());
      swap.moveTo(here);
      shadow.performAnimation(new Animation(ANIMATION.APPEAR));
      swap.performAnimation(new Animation(ANIMATION.APPEAR));
      shadow.setUntargetable(false);
    });
  }

  realShadowDied() {
    const { Animation } = Shared.core();
    const real = this.finalShadows[this.realIndex];
    real.setHitpoints(1);
    real.setUntargetable(true);
    real.performAnimation(new Animation(ANIMATION.SHADOW_DEATH));
    for (const shadow of this.finalShadows) {
      if (shadow && shadow !== real) this.despawn(shadow);
    }
    this.complete();
  }

  graphic(id, tile, options = {}) {
    const viewer = this.roomPlayers()[0];
    if (!viewer) return;
    const location = tile.getX ? tile : Shared.loc({ x: tile.x, y: tile.y, z: Z });
    Shared.graphicAt(viewer, id, location, options);
  }
}

function quadrantTiles(quadrant) {
  const tiles = [];
  for (const [x, first, last] of QUADRANT_COLUMNS[quadrant]) {
    for (let y = first; y <= last; y++) tiles.push({ x, y });
  }
  return tiles;
}

function withinReach(npc, player) {
  const size = npc.getSize?.() ?? 1;
  const location = npc.getLocation();
  const target = player.getLocation();
  const dx = target.getX() < location.getX() ? location.getX() - target.getX() : Math.max(0, target.getX() - (location.getX() + size - 1));
  const dy = target.getY() < location.getY() ? location.getY() - target.getY() : Math.max(0, target.getY() - (location.getY() + size - 1));
  return Math.max(dx, dy) <= 1 && !(dx === 1 && dy === 1);
}

function akkhaRoom(npc) {
  const room = npc?.__toaRoom;
  return room instanceof AkkhaRoom && !room.destroyed ? room : null;
}

// ------------------------------------------------------------------ hooks

/** Immunities: his form's weakness only, never on a shaded quadrant; shadows and the final stand. */
function filterDamage(event) {
  const npc = event.npc;
  const room = akkhaRoom(npc);
  if (!room) return;
  const { CombatType } = Shared.core();
  const type = event.hit.getCombatType?.();
  const attacker = event.hit.getAttacker?.();
  let blocked = false;
  if (npc.__toaAkkha) {
    if (room.onShadedQuadrant()) {
      attacker?.sendMessage?.("<col=ef0083>Akkha is currently immune to your attacks, but his shadows are still disrupted.</col>");
      blocked = true;
    }
    const weakness = { melee: CombatType.MAGIC, ranged: CombatType.MELEE, magic: CombatType.RANGED }[room.style];
    if (type !== weakness) blocked = true;
  } else if (npc.__toaShadow) {
    if (npc.__toaShadow.immune) {
      attacker?.sendMessage?.("<col=ff289d>This shadow is currently immune to your attacks.</col>");
      blocked = true;
    }
  } else if (npc.__toaFinal) {
    if (!npc.__toaFinal.real || type !== CombatType.MELEE) blocked = true;
    room.finalShadowHit(npc);
  }
  if (!blocked) return;
  for (const hit of event.hit.getHits()) hit.setDamage(0);
  event.hit.updateTotalDamage();
}

function akkhaDowned(event) {
  const npc = event.npc;
  const room = akkhaRoom(npc);
  if (!room) return;
  if (npc.__toaAkkha) {
    event.preventDeath = true;
    if (!room.standing) room.finalStand();
  } else if (npc.__toaFinal?.real) {
    event.preventDeath = true;
    room.realShadowDied();
  } else if (npc.__toaShadow) {
    room.shadowDied(npc.__toaShadow.index);
  }
}

/** Ice slows the frozen player's attacks by a tick. */
function iceSlows(event) {
  const player = event.player;
  if (player?.__toaIcedUntil && Shared.cycle() < player.__toaIcedUntil) {
    const combat = player.getCombat();
    combat.setAttackDelay?.((combat.getAttackDelay?.() ?? 0) + 1);
  }
}

module.exports = function registerAkkha(api) {
  Shared.bind(api);
  Raid.registerRoom("HET_BOSS", AkkhaRoom);
  api.onNpcHitModify(filterDamage);
  api.onNpcBeforeDeath(akkhaDowned);
  api.onPlayerDealtDamage(iceSlows);
  registerAkkhaCombat(api);
};

function registerAkkhaCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers } = api.core;
  const TYPES = { melee: CombatType.MELEE, ranged: CombatType.RANGED, magic: CombatType.MAGIC };

  class AkkhaCombatMethod extends CombatMethod {
    type() {
      return TYPES.melee;
    }

    attackDistance(npc) {
      return akkhaRoom(npc)?.style === "melee" ? 1 : 10;
    }

    canAttack(npc) {
      const room = akkhaRoom(npc);
      return !!room && room.isStarted() && !room.standing && room.memory.length === 0;
    }

    start(npc, target) {
      akkhaRoom(npc)?.attack(target);
    }

    hits() {
      return [];
    }
  }

  api.registerNpcCombatMethodProvider([NpcIdentifiers.AKKHA, NpcIdentifiers.AKKHA_3, NpcIdentifiers.AKKHA_4], AkkhaCombatMethod, { singleton: false });
}
