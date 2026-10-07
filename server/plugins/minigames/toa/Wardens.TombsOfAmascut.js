"use strict";

/**
 * Tombs of Amascut: the Wardens (Amascut's Promise).
 *
 * WARDENS_P1 holds the first two phases. Osmumten waits until everyone chooses Begin (or two
 * minutes after the first does). Phase one: the obelisk is attacked while charging orbs feed
 * the two Wardens' platforms; a full platform calls rotating blades or an energy ball (spread
 * out for Elidinis, stack for Tumeken). Phase two: the stronger Warden fights, the obelisk
 * casts thunder, isolation, skull bombs and the wheel; breaking the Warden's shield exposes
 * its core, whose damage passes through five-fold.
 *
 * WARDENS_P3 is the final phase: the other Warden slams the floor, sends energy siphons at
 * 80/60/40/20% (with the boss phantoms joining), and at 5% heals and enrages while the floor
 * collapses under thunder. Its defeat completes the raid and raises the teleport crystal.
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");
const Data = require("./ToaWardensData");

const Z = 1;

// ------------------------------------------------------------------ phases one and two

const OSMUMTEN_SPOT = { x: 3808, y: 5158, z: Z };
const OBELISK_SPOT = { x: 3807, y: 5153, z: Z };
const OBELISK_MIDDLE = { x: 3808, y: 5154 };
const WARDEN_SPOTS = { elidinis: { x: 3792, y: 5152, z: Z }, tumeken: { x: 3820, y: 5152, z: Z } };
const ORB_SPAWNS = { elidinis: { x: 3806, y: 5154 }, tumeken: { x: 3810, y: 5154 } };
const ORB_PATHS = {
  elidinis: [[[3797, 5154]], [[3805, 5154], [3803, 5156], [3797, 5156]], [[3805, 5154], [3803, 5152], [3797, 5152]]],
  tumeken: [[[3811, 5154], [3813, 5152], [3819, 5152]], [[3819, 5154]], [[3811, 5154], [3813, 5156], [3819, 5156]]],
};
const READY_TIMEOUT = 200;
const WARDEN_POINTS = { OBELISK: 1.5, WARDEN: 2, CORE: 10, FINAL: 2.5 };

/** Unnamed cache NPCs and objects with no identifier constant. */
const CHARGING_ORB = 11769;
const HIDDEN_WARDEN = 11765;
const TRAP_OBJECTS = { elidinis: 45748, tumeken: 45749 };
const PLATFORM_BASE = 45606;
const SIPHON_BLOCK = 26209;

const ANIMATION = {
  OSMUMTEN_FLY: 5546,
  OBELISK_ORBS: 9721, OBELISK_IDLE: 9723, OBELISK_EXPLODE: 9734,
  OBELISK_CHARGED: 9728, OBELISK_RELEASE: 9727, OBELISK_CANCEL: 9729, OBELISK_CHARGING: [9724, 9725, 9726],
  TRAP_START: 9524, TRAP_END: 9526,
  STONE: [9713, 9714, 9715], PUSHED: 1114,
  WARDEN_SPECIAL: 9667, WARDEN_DEATH: 9669, WARDEN_REVIVED: 9664,
  ORB_MOVE: 7571, ORB_CHARGE: 9735,
  AWAKE: 9663, MELEE: 9659, DOWN: 9670, REVIVE: 9672, THROW_MAGE: 9661, THROW_RANGED: 9660, EXPLODE: 9662,
  FLOOR_SLAM: 9674, SKULL_SEND: 9682, SKULL_RETURN: 9680, SKULL_FAIL: 9681, ENRAGED: 9685, LAST_PHASE: 9684,
  HIDDEN_BASE: 9691,
  ZEBAK: 9626, AKKHA_RANGED: 9772, AKKHA_MAGE: 9774, AKKHA_SWITCH: 9777, BABA: 9743, KEPHRI: 9577,
};

const GRAPHIC = {
  SPECIAL_TRAPS: 2214, SPECIAL_BALL: 2215, WARDEN_DEATH: 2216, WARDEN_LEGS: 2217, WARDEN_REVIVE: 2218,
  BALL_LAND: 1605, CORE_EXPLODE: 2157, THUNDER: 2198, WHEEL_START: 2236, WHEEL_END: 2234,
  INCOMING: 1447, ISOLATION: 2235, IMPRISON_MISS: 2212, PATH: 2196, PATH_END: 2158,
  FLOOR_BASE: 2220, EXPLOSION: 2158, THUNDER_INCOMING: 1446, FINAL_THUNDER: 2197,
  ZEBAK_MAGE: 131, ZEBAK_RANGED: 1103, KEPHRI_EXPLODE: 2157, RUBBLE_BASE: 2250,
};

const PROJECTILE = {
  ELIDINIS_BALL: 2238, TUMEKEN_BALL: 2237, CORE: 2240, SKULL_BOMB: 2225,
  MAGE: 2224, RANGED: 2241, IMPRISON: 2210, DIVINE: { melee: 2204, magic: 2208, ranged: 2206 },
  SIPHON: 2227, SKULL: 2226, FLOOR_REMOVAL: 2228,
  ZEBAK: { magic: 2176, ranged: 2178 }, ZEBAK_SPLIT: { magic: 2181, ranged: 2187 },
  AKKHA: { magic: 2253, ranged: 2255 }, KEPHRI_LAUNCH: 1481, KEPHRI_BOMB: 2266,
};

const SOUND = {
  START: 6081, TRAP_LAND: 6132, ELIDINIS_BALL: 6119, TUMEKEN_BALL: 6148, BALL_LAND: 6073,
  STONE: 4207, CORE_RETURN: 6083, REVIVE: 167, THUNDER: 6116, SKULL_SEND: 3614, SKULL_FAIL: 6179,
  LAST_PHASE: 1465, SELF_HEAL: 167,
};

const DIVINE = [
  { style: "melee", message: "<col=ff3045>The warden throws an arcane scimitar.</col>", sound: 217 },
  { style: "magic", message: "<col=a53fff>The warden launches an arcane spell.</col>", sound: 208 },
  { style: "ranged", message: "<col=229628>The warden fires an arcane arrow.</col>", sound: 129 },
];

// ------------------------------------------------------------------ phase three

const FINAL_WARDEN_SPOT = { x: 3934, y: 5152, z: Z };
const FACE_NORTH = 1;
const FINAL_ARRIVAL = { x: 3937, y: 5164, z: Z };
const FLOOR_BASE = { x: 3936, y: 5157 };
const FLOOR_MIN = { x: 3926, y: 5157 };
const FLOOR_VOID = { x: 3936, y: 5130 };
// Where the map keeps the collapsed floor's art, a plane above the final arena.
const VOID_ART = { minX: 3920, maxX: 3952, minY: 5130, maxY: 5190 };
const CRYSTAL_SPOT = { x: 3936, y: 5154, z: Z };
// The crystal stands over the void where the Warden was; it's used from the floor's south
// edge (y 5157, walkable from x 3932 to 3940), as no route reaches its tile.
const CRYSTAL_EDGE = { minX: 3932, maxX: 3940, y: 5157 };
const PHANTOM_SPOTS = [{ x: 3943, y: 5153, z: Z }, { x: 3925, y: 5153, z: Z }];
const ZEBAK_LAUNCH = { x: 3941, y: 5159 };
const KEPHRI_LAUNCH = { x: 3928, y: 5156 };
const HIDDEN_WARDEN_SPOTS = [5152, 5147, 5142, 5137, 5132].map((y) => ({ x: 3934, y, z: Z }));

function ids() {
  return Shared.core().NpcIdentifiers;
}

function tile(x, y) {
  return Shared.loc({ x, y }, Z);
}

function tileOf(entry) {
  return Array.isArray(entry) ? tile(entry[0], entry[1]) : tile(entry.x, entry.y);
}

function standingOn(player, location) {
  const at = player.getLocation();
  return at.getX() === location.getX() && at.getY() === location.getY();
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

/** The tiles a straight-then-diagonal walk takes towards each waypoint, as the orbs move. */
function walkTiles(start, waypoints) {
  const tiles = [];
  let x = start.x;
  let y = start.y;
  for (const [tx, ty] of waypoints) {
    while (x !== tx || y !== ty) {
      x += Math.sign(tx - x);
      y += Math.sign(ty - y);
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Caps a pending hit's total at `allowed`, trimming its splats in order. */
function limitHit(hit, allowed) {
  let left = Math.max(0, allowed);
  for (const part of hit.getHits()) {
    const damage = Math.min(part.getDamage(), left);
    part.setDamage(damage);
    left -= damage;
  }
  hit.updateTotalDamage();
}

function zeroHit(hit) {
  for (const part of hit.getHits()) part.setDamage(0);
  hit.updateTotalDamage();
}

/** Shared bits of both Warden rooms. */
class WardenRoomBase extends Raid.Room {
  graphic(id, location, options) {
    const viewer = this.roomPlayers()[0];
    if (viewer) Shared.graphicAt(viewer, id, location.getX ? location : tileOf(location), options);
  }

  soundAll(id, delay = 0) {
    for (const player of this.roomPlayers()) Shared.sound(player, id, delay);
  }

  message(text) {
    for (const player of this.roomPlayers()) player.sendMessage(text);
  }

  alive(npc) {
    return !!npc && npc.getHitpoints() > 0 && npc.isRegistered?.() !== false;
  }

  /** A fixed NPC the raid scripts: no wandering and no ordinary attacks. */
  spawnFixed(id, spot, options) {
    const npc = this.spawn(id, spot, options);
    if (!npc) return null;
    npc.__toaScripted = true;
    npc.getMovementQueue().setBlockMovement(true);
    return npc;
  }

  /** Unblockable tile damage, scaled for raid level, plus a little random. */
  tileHit(player, base, spread = 0) {
    Shared.damage(player, this.maxHit(base) + (spread > 0 ? Shared.random(0, spread) : 0));
  }

  disablePrayers(player) {
    const { PrayerHandler } = Shared.core();
    for (const prayer of PrayerHandler.PROTECTION_PRAYERS) PrayerHandler.deactivatePrayer(player, prayer);
    player.sendMessage("<col=ff3045>Your protection prayers have been disabled!</col>");
    player.getCombat().getPrayerBlockTimer().start(5);
  }

  /** NR WardenEncounter.movePlayer: shove a player one or two tiles to the first free spot. */
  shove(player) {
    const location = player.getLocation();
    for (let radius = 1; radius <= 2; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          if (!Shared.floorFree(this.area, location.transform(dx, dy))) continue;
          player.getMovementQueue().reset();
          Shared.knockback(player, dx, dy, { ticks: 1, animation: ANIMATION.PUSHED });
          return;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ WARDENS_P1

class WardensRoom extends WardenRoomBase {
  build() {
    const I = ids();
    const settings = this.settings;
    this.ancientHaste = settings.isActive("ANCIENT_HASTE");
    this.acceleration = settings.isActive("ACCELERATION");
    this.penetration = settings.isActive("PENETRATION");
    this.phase = 0;
    this.ready = new Set();
    this.readyDeadline = -1;
    this.orbs = new Set();
    this.orbIndex = { elidinis: 0, tumeken: 0 };
    this.obeliskTicks = 2;
    this.trapsLive = { elidinis: false, tumeken: false };
    this.stoned = new Map();
    this.moving = null;
    this.core = null;
    this.osmumten = this.spawnFixed(I.OSMUMTEN_2, OSMUMTEN_SPOT, { scale: false, points: 0, face: 6 });
    this.obelisk = this.spawnFixed(I.COL_00FFFF_OBELISK_COL_3, OBELISK_SPOT, { points: WARDEN_POINTS.OBELISK, pathLevel: 0 });
    this.obelisk?.setUntargetable(true);
    this.wardens = {
      elidinis: this.spawnStaticWarden("elidinis", I.ELIDINIS_WARDEN, 4),
      tumeken: this.spawnStaticWarden("tumeken", I.TUMEKENS_WARDEN, 3),
    };
  }

  spawnStaticWarden(key, id, face) {
    const npc = this.spawnFixed(id, WARDEN_SPOTS[key], { scale: false, points: 0, face });
    npc?.setUntargetable(true);
    const warden = { key, npc, percent: 0, chargeTicks: 3, fullCharges: 0, legs: false };
    this.setPlatform(warden);
    return warden;
  }

  setPlatform(warden) {
    this.setObject(PLATFORM_BASE + Math.floor(warden.percent / 5), WARDEN_SPOTS[warden.key], 10, warden.key === "tumeken" ? 1 : 3);
  }

  // -------------------------------------------------------------- the start

  /** Osmumten's Begin: wait for the party, or two minutes from the first to ready up. */
  setReady(player) {
    if (this.stage !== Raid.STAGE.IDLE) return;
    const fresh = !this.ready.has(player);
    this.ready.add(player);
    if (this.readyDeadline < 0) this.readyDeadline = Shared.cycle() + READY_TIMEOUT;
    const required = this.roomPlayers().length;
    const current = this.roomPlayers().filter((member) => this.ready.has(member)).length;
    if (current >= required) {
      this.begin();
      return;
    }
    if (fresh) this.message(`${current}/${required} party members are now ready.`);
    Shared.statement(player, "The challenge will either begin once everyone else in your party is ready or after 2 minutes have passed from the first ready up.");
  }

  begin() {
    if (this.stage !== Raid.STAGE.IDLE) return;
    this.start();
    this.message(`Challenge started: ${this.challengeName()}`);
  }

  onStart() {
    const I = ids();
    const { Animation } = Shared.core();
    this.readyDeadline = -1;
    if (this.osmumten) {
      this.osmumten.performAnimation(new Animation(ANIMATION.OSMUMTEN_FLY));
      const osmumten = this.osmumten;
      this.osmumten = null;
      this.later(1, () => this.despawn(osmumten));
    }
    this.obelisk?.setNpcTransformationId(I.COL_00FFFF_OBELISK_COL_4);
    this.obelisk?.setUntargetable(false);
    this.wardens.elidinis.npc?.setNpcTransformationId(I.ELIDINIS_WARDEN_2);
    this.wardens.tumeken.npc?.setNpcTransformationId(I.TUMEKENS_WARDEN_2);
    this.soundAll(SOUND.START);
    if (this.obelisk) this.openBossHud(this.obelisk);
  }

  onReset() {
    for (const npc of [...this.npcs]) this.despawn(npc);
    this.resetObjects();
    for (const player of this.stoned.keys()) player.getMovementQueue().setBlockMovement(false);
    this.build();
  }

  passBarrier(player, object, quick) {
    if (this.stage === Raid.STAGE.IDLE && !this.raid.member(player).ghost) {
      Raid.walkThrough(player, object);
      return;
    }
    super.passBarrier(player, object, quick);
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (this.stage === Raid.STAGE.IDLE && this.readyDeadline > 0 && Shared.cycle() >= this.readyDeadline) this.begin();
    if (!this.isStarted()) return;
    if (this.phase === 0) {
      this.tickOrbSpawns();
      this.moveOrbs();
      this.chargeWardens();
      this.checkTraps();
    } else if (this.phase === 1) {
      this.tickObelisk();
      this.tickCore();
      for (const warden of Object.values(this.wardens)) {
        if (warden.legs && this.alive(warden.npc)) warden.npc.performGraphic(Shared.gfx(GRAPHIC.WARDEN_LEGS));
      }
    }
  }

  tickPlayer(player) {
    const until = this.stoned.get(player);
    if (until === undefined) return;
    const { Animation } = Shared.core();
    const remaining = until - Shared.cycle();
    if (remaining > 0) {
      player.performAnimation(new Animation(remaining <= 6 ? ANIMATION.STONE[1] : ANIMATION.STONE[0]));
      return;
    }
    player.performAnimation(new Animation(ANIMATION.STONE[2]));
    player.getMovementQueue().setBlockMovement(false);
    this.stoned.delete(player);
  }

  isStoned(player) {
    return (this.stoned.get(player) ?? -1) > Shared.cycle();
  }

  // -------------------------------------------------------------- phase one

  tickOrbSpawns() {
    if (this.obeliskTicks <= 0 || --this.obeliskTicks % 2 !== 0) return;
    for (const key of ["elidinis", "tumeken"]) {
      const paths = ORB_PATHS[key];
      const path = walkTiles(ORB_SPAWNS[key], paths[this.orbIndex[key]]);
      this.orbIndex[key] = (this.orbIndex[key] + 1) % paths.length;
      const npc = this.spawnFixed(CHARGING_ORB, { ...ORB_SPAWNS[key], z: Z }, { scale: false, points: 0, face: key === "elidinis" ? 3 : 4 });
      if (!npc) continue;
      npc.setUntargetable(true);
      this.orbs.add({ npc, path, index: 0, warden: this.wardens[key], charged: false });
    }
    if (this.obeliskTicks <= 0) {
      this.obelisk?.performAnimation(new (Shared.core().Animation)(ANIMATION.OBELISK_ORBS));
      this.obeliskTicks = 4;
    }
  }

  moveOrbs() {
    const { Animation, PathFinder } = Shared.core();
    for (const orb of [...this.orbs]) {
      const npc = orb.npc;
      if (orb.charged || !npc) {
        this.orbs.delete(orb);
        this.despawn(npc);
        continue;
      }
      if (orb.index >= orb.path.length) {
        this.charge(orb.warden, this.ancientHaste ? 2 : 1);
        npc.performAnimation(new Animation(ANIMATION.ORB_CHARGE));
        orb.charged = true;
        continue;
      }
      const location = npc.getLocation();
      const victim = this.challengePlayers().find((player) => standingOn(player, location));
      if (victim) {
        Shared.damage(victim, 3);
        this.orbs.delete(orb);
        this.despawn(npc);
        continue;
      }
      const next = orb.path[orb.index++];
      npc.getMovementQueue().setBlockMovement(false);
      PathFinder.calculateWalkRoute(npc, next.x, next.y);
      npc.performAnimation(new Animation(ANIMATION.ORB_MOVE));
    }
  }

  chargeWardens() {
    for (const warden of Object.values(this.wardens)) {
      if (warden.chargeTicks > 0 && --warden.chargeTicks <= 0) {
        this.charge(warden, 2);
        warden.chargeTicks = this.ancientHaste ? 1 : 2;
      }
    }
  }

  /** A full platform fires the Warden's special: blades and the energy ball in turn. */
  charge(warden, amount) {
    if (this.phase !== 0 || !this.alive(warden.npc)) return;
    warden.percent = Math.min(100, warden.percent + amount);
    if (warden.percent < 100) {
      this.setPlatform(warden);
      return;
    }
    const { Animation } = Shared.core();
    warden.npc.performAnimation(new Animation(ANIMATION.WARDEN_SPECIAL));
    if (warden.fullCharges % 2 === 0) {
      warden.npc.performGraphic(Shared.gfx(GRAPHIC.SPECIAL_TRAPS));
      this.sendTraps(warden.key);
    } else {
      warden.npc.performGraphic(Shared.gfx(GRAPHIC.SPECIAL_BALL));
      this.sendBall(warden);
    }
    warden.fullCharges++;
    warden.percent = 0;
    this.setPlatform(warden);
  }

  totalCharged(warden) {
    return warden.fullCharges * 100 + warden.percent;
  }

  sendTraps(key) {
    const tiles = key === "elidinis" ? Data.ELIDINIS_TRAPS : Data.TUMEKEN_TRAPS;
    const id = TRAP_OBJECTS[key];
    this.later(2, () => {
      for (const [x, y] of tiles) this.setObject(id, { x, y, z: Z }, 10, 0);
      this.soundAll(SOUND.TRAP_LAND);
    });
    this.later(3, () => {
      for (const [x, y] of tiles) this.setObject(id + 2, { x, y, z: Z }, 10, 0);
    });
    this.later(5, () => { this.trapsLive[key] = true; });
    this.later(6, () => this.animateTraps(tiles, id + 2, ANIMATION.TRAP_START));
    this.later(10, () => {
      this.animateTraps(tiles, id + 2, ANIMATION.TRAP_END);
      this.trapsLive[key] = false;
    });
    this.later(12, () => {
      for (const [x, y] of tiles) this.setObject(-1, { x, y, z: Z }, 10, 0);
    });
  }

  animateTraps(tiles, id, animation) {
    const { GameObject, Animation } = Shared.core();
    for (const [x, y] of tiles) {
      const object = new GameObject(id, tile(x, y), 10, 0, null);
      for (const player of this.roomPlayers()) player.getPacketSender().sendObjectAnimation(object, new Animation(animation));
    }
  }

  checkTraps() {
    for (const key of ["elidinis", "tumeken"]) {
      if (!this.trapsLive[key]) continue;
      const tiles = key === "elidinis" ? Data.ELIDINIS_TRAPS : Data.TUMEKEN_TRAPS;
      for (const player of this.challengePlayers()) {
        const location = player.getLocation();
        const caught = tiles.some(([x, y]) => location.getX() >= x && location.getX() <= x + 2
          && location.getY() >= y && location.getY() <= y + 2);
        if (caught) this.tileHit(player, 11, 2);
      }
    }
  }

  /** Elidinis' ball punishes standing near others; Tumeken's punishes standing apart. */
  sendBall(warden) {
    const players = this.challengePlayers();
    if (players.length === 0) return;
    const elidinis = warden.key === "elidinis";
    let landing = 0;
    for (const player of players) {
      Shared.sound(player, elidinis ? SOUND.ELIDINIS_BALL : SOUND.TUMEKEN_BALL);
      player.sendMessage(`${elidinis ? "<col=3366ff>" : "<col=ff8e32>"}A large ball of energy is shot your way...</col>`);
      landing = Math.max(landing, Shared.tileProjectile(this.area, warden.npc, player, elidinis ? PROJECTILE.ELIDINIS_BALL : PROJECTILE.TUMEKEN_BALL,
        { delay: 30, duration: 360, perTile: 0, startHeight: 87, endHeight: 20 }));
    }
    this.later(landing, () => {
      if (this.phase !== 0 || !this.alive(this.obelisk)) return;
      const targets = this.challengePlayers().filter((player) => players.includes(player));
      const base = this.maxHit(elidinis ? 12 : 13);
      for (const player of targets) {
        Shared.sound(player, SOUND.BALL_LAND);
        player.performGraphic(Shared.gfx(GRAPHIC.BALL_LAND));
        const others = targets.filter((other) => other !== player && (elidinis
          ? chebyshev(other.getLocation(), player.getLocation()) <= 1
          : chebyshev(other.getLocation(), player.getLocation()) > 0)).length;
        Shared.damage(player, base + base * 3 * others);
      }
    });
  }

  // -------------------------------------------------------------- phase two

  /** The obelisk falls: the more charged Warden rises to fight, the other collapses. */
  startWardenPhase() {
    if (this.phase !== 0) return;
    const I = ids();
    const { Animation } = Shared.core();
    this.phase = 1;
    this.obelisk.setNpcTransformationId(I.COL_00FFFF_OBELISK_COL_5);
    this.obelisk.setUntargetable(true);
    this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_IDLE));
    for (const orb of this.orbs) this.despawn(orb.npc);
    this.orbs.clear();
    this.elidinisStart = this.totalCharged(this.wardens.elidinis) > this.totalCharged(this.wardens.tumeken);
    this.sendPowerTrails();
    this.closeBossHud();
    this.obeliskCharge = this.acceleration ? 30 : 40;
    this.obeliskTicks2 = this.obeliskCharge;
    this.thunderTicks = 0;
    this.performingSpecial = false;
    this.specialIndex = Shared.random(0, 2);
    this.wheelIndex = 0;
    this.downCycles = 0;
    this.canDoSpecial = false;
    this.later(1, () => this.raiseWarden());
  }

  /** NR: lines of energy from the obelisk to the fallen Warden's side. */
  sendPowerTrails() {
    const key = this.elidinisStart ? "tumeken" : "elidinis";
    const start = this.elidinisStart ? { x: ORB_SPAWNS.tumeken.x + 1, y: ORB_SPAWNS.tumeken.y } : { x: ORB_SPAWNS.elidinis.x - 1, y: ORB_SPAWNS.elidinis.y };
    for (const path of ORB_PATHS[key]) {
      const end = path[path.length - 1];
      const tiles = walkTiles(start, [end]);
      tiles.forEach((step, index) => this.graphic(GRAPHIC.PATH, step, { delay: 6 + index * 6 }));
      this.graphic(GRAPHIC.PATH_END, { x: end[0], y: end[1] }, { delay: 6 + tiles.length * 6, height: 60 });
    }
  }

  raiseWarden() {
    const I = ids();
    const { Animation } = Shared.core();
    const alive = this.elidinisStart ? this.wardens.elidinis : this.wardens.tumeken;
    const fallen = this.elidinisStart ? this.wardens.tumeken : this.wardens.elidinis;
    this.forms = this.elidinisStart
      ? { magic: I.ELIDINIS_WARDEN_3, ranged: I.ELIDINIS_WARDEN_4, down: I.ELIDINIS_WARDEN_5 }
      : { magic: I.TUMEKENS_WARDEN_3, ranged: I.TUMEKENS_WARDEN_4, down: I.TUMEKENS_WARDEN_5 };
    const firstForm = this.elidinisStart ? this.forms.magic : this.forms.ranged;
    const moving = this.spawn(firstForm, WARDEN_SPOTS[alive.key], { points: WARDEN_POINTS.WARDEN, pathLevel: 0, face: alive.key === "elidinis" ? 4 : 3 });
    if (!moving) return;
    this.despawn(alive.npc);
    alive.npc = null;
    this.setObject(-1, WARDEN_SPOTS[alive.key], 10);
    this.moving = moving;
    moving.__toaWardenMoving = true;
    moving.__toaScripted = true;
    moving.setUntargetable(true);
    moving.getMovementQueue().setBlockMovement(true);
    moving.performAnimation(new Animation(ANIMATION.AWAKE));
    this.shieldHp = moving.getMaxHitpoints();
    this.realTotal = this.scaledHitpoints(this.forms.down);
    this.realHp = this.realTotal;
    this.down = false;
    this.movingCanAttack = false;
    if (fallen.npc) {
      fallen.npc.setNpcTransformationId(this.elidinisStart ? I.TUMEKENS_WARDEN_6 : I.ELIDINIS_WARDEN_6);
      fallen.npc.performAnimation(new Animation(ANIMATION.WARDEN_DEATH));
      fallen.npc.performGraphic(Shared.gfx(GRAPHIC.WARDEN_DEATH));
    }
    this.message(this.elidinisStart
      ? "<col=3366ff>As Tumeken's Warden falls, Elidinis' Warden powers up!</col>"
      : "<col=ff8e32>As Elidinis' Warden falls, Tumeken's Warden powers up!</col>");
    this.openBossHud(moving);
    this.later(9, () => { fallen.legs = true; });
    this.later(14, () => {
      const location = moving.getLocation();
      Shared.walkStraight(moving, location.transform(this.elidinisStart ? 5 : -6, 0));
    });
    this.later(17, () => moving.setUntargetable(false));
    this.later(20, () => this.setMovingCanAttack(true));
  }

  scaledHitpoints(id) {
    const base = Shared.core().NpcDefinition.forId(id)?.getHitpoints?.() || 880;
    const hitpoints = base * this.raid.hitpointFactor(0);
    return Math.max(1, hitpoints >= 100 ? Math.round(hitpoints / 10) * 10 : Math.round(hitpoints / 5) * 5);
  }

  setMovingCanAttack(value) {
    const moving = this.moving;
    this.movingCanAttack = value;
    if (!moving) return;
    moving.__toaScripted = !value;
    if (!value) return;
    moving.getMovementQueue().setBlockMovement(false);
    const target = this.nearestTo(moving);
    if (target) moving.getCombat().attack(target);
  }

  nearestTo(npc) {
    const centre = npc.getLocation().transform(1, 1);
    let best = null;
    let distance = Infinity;
    for (const player of this.challengePlayers()) {
      const d = chebyshev(centre, player.getLocation());
      if (d < distance) {
        best = player;
        distance = d;
      }
    }
    return best;
  }

  /** The moving Warden's turn: an occasional slam up close, otherwise bolts, prayer-breaking throws or stone. */
  movingAttack(target) {
    const moving = this.moving;
    if (!moving || !this.movingCanAttack) return;
    const { Animation } = Shared.core();
    if (target && chebyshev(moving.getLocation().transform(1, 1), target.getLocation()) <= 2 && Shared.random(0, 3) === 0) {
      moving.performAnimation(new Animation(ANIMATION.MELEE));
      this.strike(moving, target, null, "melee", 16, 0, { prayerMultiplier: 0.15 });
      return;
    }
    const players = this.challengePlayers();
    if (players.length === 0) return;
    if (this.canDoSpecial && Shared.random(0, 5) === 0) {
      this.canDoSpecial = false;
      moving.performAnimation(new Animation(ANIMATION.THROW_MAGE));
      if (this.downCycles < 1 || Shared.random(0, 1) === 0) this.sendDivine(Shared.randomOf(DIVINE));
      else this.sendImprisonment();
      return;
    }
    const magic = Shared.random(0, 1) === 0;
    moving.performAnimation(new Animation(magic ? ANIMATION.THROW_MAGE : ANIMATION.THROW_RANGED));
    for (const player of players) {
      Shared.tileProjectile(this.area, moving, player, magic ? PROJECTILE.MAGE : PROJECTILE.RANGED,
        { delay: 25, duration: 90, perTile: 0, startHeight: 100, endHeight: 25 });
      this.strike(moving, player, null, magic ? "magic" : "ranged", 22, 4, { prayerMultiplier: 0.15 });
    }
    this.canDoSpecial = true;
  }

  /** Drops every protection prayer; only re-praying the right one in time stops the hit. */
  sendDivine(kind) {
    const moving = this.moving;
    const players = this.challengePlayers();
    for (const player of players) {
      Shared.tileProjectile(this.area, moving, player, PROJECTILE.DIVINE[kind.style], { delay: 25, duration: 120, perTile: 0, startHeight: 100, endHeight: 25 });
      const { PrayerHandler } = Shared.core();
      for (const prayer of PrayerHandler.PROTECTION_PRAYERS) PrayerHandler.deactivatePrayer(player, prayer);
      player.sendMessage("<col=ff3045>Your protection prayers have been disabled!</col>");
      player.sendMessage(kind.message);
    }
    this.later(5, () => {
      if (!this.movingCanAttack) return;
      for (const player of this.challengePlayers().filter((member) => players.includes(member))) {
        Shared.sound(player, kind.sound);
        if (!Shared.isProtected(player, kind.style)) Shared.damage(player, this.maxHit(22) + Shared.random(0, 10));
      }
    });
  }

  sendImprisonment() {
    const moving = this.moving;
    const tiles = [];
    for (const player of this.challengePlayers()) {
      const location = player.getLocation();
      if (tiles.some((other) => other.getX() === location.getX() && other.getY() === location.getY())) continue;
      tiles.push(location.clone());
    }
    for (const location of tiles) {
      Shared.tileProjectile(this.area, moving, location, PROJECTILE.IMPRISON, { delay: 10, duration: 120, perTile: 0, startHeight: 100, endHeight: 0 });
      this.graphic(GRAPHIC.INCOMING, location);
    }
    this.later(5, () => {
      if (!this.movingCanAttack) return;
      for (const location of tiles) {
        const victims = this.challengePlayers().filter((player) => standingOn(player, location));
        if (victims.length === 0) this.graphic(GRAPHIC.IMPRISON_MISS, location);
        for (const victim of victims) this.entomb(victim);
      }
    });
  }

  entomb(player) {
    const { Animation } = Shared.core();
    player.sendMessage("<col=ff3045>You've been entombed in stone!</col>");
    Shared.sound(player, SOUND.STONE);
    player.performAnimation(new Animation(ANIMATION.STONE[0]));
    player.getMovementQueue().reset();
    player.getMovementQueue().setBlockMovement(true);
    player.getCombat().reset();
    this.stoned.set(player, Shared.cycle() + 7);
  }

  /** The shield breaks: the Warden kneels and throws out its core. */
  wardenDown() {
    const moving = this.moving;
    if (!moving || this.down || !this.movingCanAttack) return;
    const { Animation } = Shared.core();
    moving.performAnimation(new Animation(ANIMATION.DOWN));
    moving.setUntargetable(true);
    moving.getCombat().reset();
    moving.getMovementQueue().reset();
    moving.getMovementQueue().setBlockMovement(true);
    this.setMovingCanAttack(false);
    this.downCycles++;
    this.resetObelisk();
    this.later(4, () => {
      this.down = true;
      this.previousForm = moving.getId();
      moving.setNpcTransformationId(this.forms.down);
      moving.setMaxHitpoints(this.realTotal);
      moving.setHitpoints(this.realHp);
      this.openBossHud(moving);
      const target = this.nearestTo(moving);
      const centre = moving.getLocation().transform(1, 1);
      const dx = target ? Math.sign(target.getLocation().getX() - centre.getX()) : 0;
      const dy = target ? Math.sign(target.getLocation().getY() - centre.getY()) : -1;
      const coreTile = this.freeTileNear(centre.transform(dx * 3, dy * 3));
      const ticks = Shared.tileProjectile(this.area, moving, coreTile, PROJECTILE.CORE, { delay: 12, duration: 60, perTile: 0, startHeight: 95, endHeight: 0 });
      this.later(ticks, () => this.spawnCore(coreTile));
    });
  }

  freeTileNear(location) {
    for (let radius = 0; radius < 10; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const next = location.transform(dx, dy);
          if (Shared.floorFree(this.area, next)) return next;
        }
      }
    }
    return location;
  }

  coreTicks() {
    const share = this.realHp / this.realTotal;
    if (share > 0.8) return 21;
    if (share > 0.6) return 29;
    if (share > 0.4) return 37;
    if (share > 0.2) return 45;
    return 53;
  }

  spawnCore(location) {
    if (!this.down) return;
    const I = ids();
    const core = this.spawnFixed(I.COL_00FFFF_CORE_COL_2, { x: location.getX(), y: location.getY(), z: Z }, { scale: false, points: WARDEN_POINTS.CORE });
    if (!core) return;
    core.__toaWardenCore = true;
    this.core = core;
    this.coreTicksLeft = this.coreTicks();
    for (const player of this.challengePlayers()) if (standingOn(player, location)) this.shove(player);
  }

  tickCore() {
    if (!this.core || !this.down) return;
    if (--this.coreTicksLeft <= 0) this.coreReturns();
  }

  /** Damage on the core passes to the kneeling Warden five-fold (NR WardenCoreNPC). */
  coreHit(hit) {
    const moving = this.moving;
    if (!moving || !this.down) return;
    const damage = hit.getTotalDamage();
    if (damage > 0) Shared.damage(moving, damage * 5);
  }

  coreReturns() {
    const core = this.core;
    if (!core) return;
    this.core = null;
    Shared.tileProjectile(this.area, core, this.moving, PROJECTILE.CORE, { delay: 12, duration: 30, perTile: 0, startHeight: 20, endHeight: 62 });
    this.soundAll(SOUND.CORE_RETURN);
    this.despawn(core);
    this.later(2, () => this.revive());
  }

  revive() {
    const moving = this.moving;
    if (!moving || !this.down || !this.isStarted()) return;
    const { Animation } = Shared.core();
    this.down = false;
    this.realHp = moving.getHitpoints();
    moving.performAnimation(new Animation(ANIMATION.REVIVE));
    moving.setNpcTransformationId(this.previousForm === this.forms.ranged ? this.forms.magic : this.forms.ranged);
    moving.setMaxHitpoints(this.shieldHp);
    moving.setHitpoints(this.shieldHp);
    this.openBossHud(moving);
    this.later(3, () => {
      moving.setUntargetable(false);
      this.setMovingCanAttack(true);
    });
  }

  /** Only the Warden's current form's style breaks its shield; the kneeling Warden takes no direct hits. */
  filterMovingHit(hit) {
    const { CombatType } = Shared.core();
    if (this.down) {
      zeroHit(hit);
      return;
    }
    const form = this.moving.getId();
    const wanted = form === this.forms.magic ? CombatType.MAGIC : CombatType.RANGED;
    if (hit.getCombatType?.() !== wanted) zeroHit(hit);
  }

  // -------------------------------------------------------------- the obelisk in phase two

  tickObelisk() {
    if (!this.movingCanAttack || this.performingSpecial || !this.obelisk) return;
    const { Animation } = Shared.core();
    if (this.thunderTicks > 0) {
      if (--this.thunderTicks === 0) {
        this.specialIndex = (this.specialIndex + 1) % 3;
        this.performingSpecial = true;
        if (this.specialIndex === 0) this.sendIsolation(true);
        else if (this.specialIndex === 1) this.sendSkullBombs();
        else this.sendWheel();
      } else {
        this.sendThunders();
      }
      return;
    }
    this.obeliskTicks2--;
    if (this.obeliskTicks2 <= 0) {
      this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_RELEASE));
      this.thunderTicks = 5;
    } else if (this.obeliskTicks2 === 1) {
      this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_CHARGED));
    } else {
      const share = this.obeliskTicks2 / this.obeliskCharge;
      const stage = share > 0.66 ? 0 : share > 0.33 ? 1 : 2;
      if (stage !== this.chargeStage) {
        this.chargeStage = stage;
        this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_CHARGING[stage]));
      }
    }
  }

  resetObelisk() {
    if (!this.obelisk) return;
    const { Animation } = Shared.core();
    this.obeliskTicks2 = this.obeliskCharge;
    if (this.performingSpecial) this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_CANCEL));
    this.chargeStage = 0;
    this.obelisk.performAnimation(new Animation(ANIMATION.OBELISK_CHARGING[0]));
    this.performingSpecial = false;
    this.thunderTicks = 0;
  }

  specialHit(player, base, penetratedBase) {
    this.tileHit(player, this.penetration ? penetratedBase : base, 2);
    if (this.penetration) this.disablePrayers(player);
  }

  sendThunders() {
    const ring = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.abs(dx) === 2 || Math.abs(dy) === 2) ring.push(tile(OBELISK_MIDDLE.x + dx, OBELISK_MIDDLE.y + dy));
      }
    }
    for (const location of Shared.shuffle(ring).slice(0, Shared.random(3, 5))) {
      this.graphic(GRAPHIC.THUNDER, location);
      for (const player of this.challengePlayers()) if (standingOn(player, location)) this.specialHit(player, 9, 14);
    }
  }

  /** Lines out from the obelisk that close in, first north-south and then east-west. */
  sendIsolation(vertical) {
    let delta = vertical ? 12 : 11;
    let ticks = 0;
    const middle = tile(OBELISK_MIDDLE.x, OBELISK_MIDDLE.y);
    this.repeat(1, () => {
      if (!this.movingCanAttack || delta < 0) {
        if (!vertical) this.resetObelisk();
        return false;
      }
      if (ticks === 0) {
        for (let distance = 2; distance <= delta; distance++) {
          this.graphic(GRAPHIC.WHEEL_END, middle.transform(vertical ? 0 : distance, vertical ? distance : 0), { delay: distance * 2 });
          this.graphic(GRAPHIC.WHEEL_END, middle.transform(vertical ? 0 : -distance, vertical ? -distance : 0), { delay: distance * 2 });
        }
      } else {
        if (vertical && ticks === 6) this.sendIsolation(false);
        const first = middle.transform(vertical ? 0 : delta, vertical ? delta : 0);
        const second = middle.transform(vertical ? 0 : -delta, vertical ? -delta : 0);
        const tiles = [first, second];
        for (let spread = (vertical ? 12 : 11) - delta; spread > 0; spread--) {
          if (vertical) {
            tiles.push(first.transform(-spread, spread), first.transform(spread, spread), second.transform(-spread, -spread), second.transform(spread, -spread));
          } else {
            tiles.push(first.transform(spread, spread), first.transform(spread, -spread), second.transform(-spread, spread), second.transform(-spread, -spread));
          }
        }
        for (const location of tiles) {
          this.graphic(GRAPHIC.ISOLATION, location);
          for (const player of this.challengePlayers()) if (standingOn(player, location)) this.specialHit(player, 13, 18);
        }
        delta--;
      }
      ticks++;
      return true;
    });
  }

  sendSkullBombs() {
    let count = Data.SKULL_BOMBS.length;
    let index = Shared.random(0, count - 1);
    this.repeat(2, () => {
      if (!this.movingCanAttack || count-- <= 0) {
        this.resetObelisk();
        return false;
      }
      const target = tileOf(Data.SKULL_BOMBS[index]);
      index = (index + 1) % Data.SKULL_BOMBS.length;
      Shared.tileProjectile(this.area, this.obelisk, target, PROJECTILE.SKULL_BOMB, { delay: 23, duration: 97, perTile: 0, startHeight: 100, endHeight: 3 });
      this.graphic(GRAPHIC.INCOMING, target);
      this.later(3, () => this.explodeSkullBomb(target));
      return true;
    });
  }

  explodeSkullBomb(centre) {
    if (!this.movingCanAttack) return;
    const inner = [];
    const outer = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        if ((dx === 0 && dy !== 0 && Math.abs(dy) < 3) || (dy === 0 && dx !== 0 && Math.abs(dx) < 3)) continue;
        const location = centre.transform(dx, dy);
        (Math.abs(dx) === 3 || Math.abs(dy) === 3 ? outer : inner).push(location);
      }
    }
    for (const location of inner) this.graphic(GRAPHIC.THUNDER, location, { delay: chebyshev(centre, location) * 10 });
    for (const location of outer) this.graphic(GRAPHIC.THUNDER, location, { delay: 30 });
    const strike = (tiles) => {
      for (const location of tiles) {
        for (const player of this.challengePlayers()) if (standingOn(player, location)) this.specialHit(player, 13, 18);
      }
    };
    strike(inner);
    this.later(1, () => this.movingCanAttack && strike(outer));
  }

  sendWheel() {
    let previous = -1;
    let cycles = 0;
    const middle = tile(OBELISK_MIDDLE.x, OBELISK_MIDDLE.y);
    this.repeat(2, () => {
      if (!this.movingCanAttack) {
        this.resetObelisk();
        return false;
      }
      if (previous !== -1) {
        for (const entry of Data.WHEELS[previous]) {
          const location = tileOf(entry);
          this.graphic(GRAPHIC.WHEEL_END, location, { delay: 2 * chebyshev(middle, location) });
          for (const player of this.challengePlayers()) if (standingOn(player, location)) this.specialHit(player, 13, 18);
        }
      }
      if (++cycles >= 12) {
        this.resetObelisk();
        return false;
      }
      for (const entry of Data.WHEELS[this.wheelIndex]) this.graphic(GRAPHIC.WHEEL_START, tileOf(entry), { delay: 30 });
      previous = this.wheelIndex;
      this.wheelIndex = (this.wheelIndex + 1) % Data.WHEELS.length;
      return true;
    });
  }

  // -------------------------------------------------------------- into phase three

  /** The kneeling Warden's last strength revives the other, who rises for the final phase. */
  killMovingWarden() {
    if (this.phase !== 1) return;
    this.phase = 2;
    const { Animation } = Shared.core();
    if (this.core) {
      this.graphic(GRAPHIC.CORE_EXPLODE, this.core.getLocation(), { delay: 30, height: 50 });
      this.despawn(this.core);
      this.core = null;
    }
    this.message(this.elidinisStart
      ? "<col=ff8e32>Elidinis' Warden uses the last of its power to restore Tumeken's Warden!</col>"
      : "<col=3366ff>Tumeken's Warden uses the last of its power to restore Elidinis' Warden!</col>");
    this.moving?.performAnimation(new Animation(ANIMATION.EXPLODE));
    this.moving?.setUntargetable(true);
    this.closeBossHud();
    const revived = this.elidinisStart ? this.wardens.tumeken : this.wardens.elidinis;
    revived.legs = false;
    revived.npc?.performAnimation(new Animation(ANIMATION.WARDEN_REVIVED));
    revived.npc?.performGraphic(Shared.gfx(GRAPHIC.WARDEN_REVIVE, { delay: 120 }));
    this.later(5, () => {
      this.soundAll(SOUND.REVIVE);
      const middle = tile(OBELISK_MIDDLE.x, OBELISK_MIDDLE.y);
      const tiles = [];
      for (let dx = -4; dx <= 4; dx++) {
        for (let dy = -4; dy <= 4; dy++) if (Math.abs(dx) > 1 || Math.abs(dy) > 1) tiles.push(middle.transform(dx, dy));
      }
      Shared.shuffle(tiles).slice(0, 35).forEach((location, index) => {
        this.graphic(Shared.random(0, 1) === 0 ? GRAPHIC.CORE_EXPLODE : GRAPHIC.THUNDER, location, { delay: Math.floor(index / 5) * 30 + 30 });
      });
    });
    this.later(8, () => this.obelisk?.performAnimation(new Animation(ANIMATION.OBELISK_EXPLODE)));
    this.later(11, () => this.toFinalPhase());
  }

  toFinalPhase() {
    const raid = this.raid;
    const players = this.roomPlayers();
    const inside = new Set(this.challengePlayers());
    const handover = {
      startCycle: this.startCycle,
      wardenId: this.elidinisStart ? ids().TUMEKENS_WARDEN_7 : ids().ELIDINIS_WARDEN_7,
    };
    for (const player of this.stoned.keys()) player.getMovementQueue().setBlockMovement(false);
    this.stoned.clear();
    const final = raid.buildRoom("WARDENS_P3");
    for (const player of players) {
      raid.member(player).roomKey = final.key;
      const destination = inside.has(player) ? tileOf(FINAL_ARRIVAL) : Shared.spread(final.def.spawn, final.def.spread);
      Shared.fadeMove(player, () => {
        player.getMovementQueue().reset();
        player.moveTo(destination);
      });
    }
    final.prepare(handover);
    raid.refreshHudStates();
  }
}

// ------------------------------------------------------------------ WARDENS_P3

class WardensFinalRoom extends WardenRoomBase {
  build() {
    const settings = this.settings;
    this.insanity = settings.isActive("INSANITY");
    this.attackSpeed = 6 - (settings.isActive("OVERCLOCKED") ? 1 : 0) - (settings.isActive("OVERCLOCKED_2") ? 1 : 0) - (this.insanity ? 1 : 0);
    this.stayVigilant = settings.isActive("STAY_VIGILANT");
    this.aerialAssault = settings.isActive("AERIAL_ASSAULT");
    this.phase = 2;
    this.warden = null;
    this.floorRotation = 0;
    this.skullAttack = false;
    this.attackTicks = 6;
    this.siphons = [];
    this.siphonsDone = null;
    this.skullTimer = 0;
    this.phantoms = [];
    this.thunderTicks = this.insanity ? 6 : 7;
    this.thunderTaken = new Set();
    this.floorIndex = 0;
    this.floorTicks = 10;
    this.enragedTicks = 1;
    this.hideVoidArt();
  }

  /**
   * The map keeps the collapsed floor's "Void" pieces on the plane above the arena (z 2).
   * OSRS builds the room from template chunks without them; shown as-is they hang over the
   * fight before the floor falls, so they're cleared for this party.
   */
  hideVoidArt() {
    const { MapObjects } = Shared.core();
    const z = Z + 1;
    for (let x = VOID_ART.minX; x <= VOID_ART.maxX; x++) {
      for (let y = VOID_ART.minY; y <= VOID_ART.maxY; y++) {
        const object = MapObjects.getType(Shared.loc({ x, y }, z), 22, null);
        if (object?.getDefinition?.()?.getName?.() === "Void") this.setObject(-1, { x, y, z }, 22);
      }
    }
  }

  /** Picks up from WARDENS_P1 without a pause: the fight is already on. */
  prepare({ startCycle, wardenId }) {
    this.stage = Raid.STAGE.STARTED;
    this.startCycle = startCycle;
    this.teamSize = this.raid.original.size;
    // Faces north, over the floor the party stands on (6 was south, its back to them).
    const warden = this.spawnFixed(wardenId, FINAL_WARDEN_SPOT, { points: WARDEN_POINTS.FINAL, pathLevel: 0, face: FACE_NORTH });
    if (!warden) return;
    warden.__toaFinalWarden = true;
    this.warden = warden;
    this.baseId = wardenId;
    this.tumeken = wardenId === ids().TUMEKENS_WARDEN_7;
    this.openBossHud(warden);
  }

  onComplete() {
    const { Animation } = Shared.core();
    this.clearAdds();
    this.phase = 4;
    HIDDEN_WARDEN_SPOTS.forEach((spot, index) => {
      const npc = this.spawnFixed(HIDDEN_WARDEN, spot, { scale: false, points: 0 });
      npc?.setUntargetable(true);
      npc?.performAnimation(new Animation(ANIMATION.HIDDEN_BASE + index));
    });
    for (const player of this.roomPlayers()) this.raid.sendHud(player);
    this.later(12, () => this.setObject(Shared.core().ObjectIdentifiers.TELEPORT_CRYSTAL_3, CRYSTAL_SPOT, 10, 0));
  }

  /** A wiped party starts the Wardens over from the obelisk. */
  onReset() {
    const raid = this.raid;
    const players = this.roomPlayers();
    this.clearAdds();
    Shared.later(raid, 3, () => {
      for (const player of players) {
        if (raid.players.includes(player)) raid.enterRoom(player, "WARDENS_P1", { leaderOnly: false });
      }
    });
  }

  clearAdds() {
    for (const siphon of this.siphons) if (siphon) this.removeSiphon(siphon);
    this.siphons = [];
    for (const phantom of this.phantoms) this.despawn(phantom.npc);
    this.phantoms = [];
  }

  // -------------------------------------------------------------- tick

  tick() {
    if (!this.isStarted() || !this.alive(this.warden)) return;
    if (this.phase === 2) {
      if (!this.skullAttack) {
        if (this.attackTicks > 0 && --this.attackTicks <= 0) this.floorSlam();
      } else if (this.siphonsDone && this.skullTimer > 0 && --this.skullTimer <= 0) {
        this.skullsFailed();
      }
      this.tickSiphons();
    } else if (this.phase === 3) {
      if (this.enragedTicks > 0 && --this.enragedTicks === 0) {
        this.warden.performAnimation(new (Shared.core().Animation)(ANIMATION.ENRAGED));
      }
      this.tickCollapse();
      this.tickThunder();
    }
    this.tickPhantoms();
  }

  tickPlayer(player) {
    if (this.phase !== 3 || !this.inChallenge(player)) return;
    const edge = FLOOR_MIN.y + 8 - Math.floor(this.floorIndex / 4);
    const location = player.getLocation();
    if (location.getY() > edge) this.pushOff(player, edge);
  }

  // -------------------------------------------------------------- floor slams

  floorSlam() {
    const { Animation } = Shared.core();
    this.attackTicks = this.attackSpeed;
    this.warden.performAnimation(new Animation(ANIMATION.FLOOR_SLAM + this.floorRotation * 2 + (this.attackSpeed <= 4 ? 1 : 0)));
    const base = tileOf(FLOOR_BASE);
    const first = [];
    const second = [];
    Data.FLOOR_ATTACKS[this.floorRotation].forEach((group, groupIndex) => {
      for (const entry of group) {
        const location = tileOf(entry);
        const delay = 90 + chebyshev(location, base) * 6 - (this.floorRotation === 2 ? 6 : 0);
        (delay < 120 ? first : second).push(location);
        this.graphic(GRAPHIC.FLOOR_BASE + groupIndex, location, { delay });
      }
    });
    this.floorRotation = (this.floorRotation + 1) % Data.FLOOR_ATTACKS.length;
    const strike = (tiles) => {
      if (this.skullAttack || this.phase !== 2) return;
      for (const location of tiles) {
        for (const player of this.challengePlayers()) if (standingOn(player, location)) this.tileHit(player, 18, 3);
      }
    };
    const delay = this.attackSpeed < 5 ? 1 : 2;
    this.later(delay, () => strike(first));
    this.later(delay + 1, () => strike(second));
  }

  // -------------------------------------------------------------- skulls

  /** The Warden's health thresholds: siphons at 80/60/40/20%, the last stand at 5%. */
  filterWardenHit(hit) {
    const warden = this.warden;
    if (this.skullAttack) {
      zeroHit(hit);
      return;
    }
    if (this.phase !== 2) return;
    const max = warden.getMaxHitpoints();
    const hp = warden.getHitpoints();
    const after = hp - hit.getTotalDamage();
    const step = max * 0.05;
    for (let index = 0; index < 4; index++) {
      const threshold = step * (16 - index * 4);
      if (hp > threshold && after <= threshold) {
        limitHit(hit, hp - Math.floor(threshold));
        this.sendSkulls(index);
        return;
      }
    }
    if (hp > step && after <= step) {
      limitHit(hit, hp - Math.floor(step));
      this.startLastPhase();
    }
  }

  sendSkulls(index) {
    const I = ids();
    const { Animation } = Shared.core();
    const warden = this.warden;
    this.skullAttack = true;
    // Everyone stops attacking the Warden, free to strike the siphons at once (Near-Reality).
    for (const player of this.challengePlayers()) Shared.skipAttackDelay(player);
    if (!this.insanity) this.floorRotation = 0;
    warden.setUntargetable(true);
    warden.performAnimation(new Animation(ANIMATION.SKULL_SEND));
    warden.setNpcTransformationId(this.tumeken ? I.TUMEKENS_WARDEN_8 : I.ELIDINIS_WARDEN_8);
    const players = this.challengePlayers();
    for (const player of players) player.getCombat().reset();
    this.soundAll(SOUND.SKULL_SEND);
    const tiles = Data.SKULLS[players.length >= 2 ? 1 : 0][index].map(tileOf);
    for (const location of tiles) {
      this.graphic(GRAPHIC.INCOMING, location);
      Shared.tileProjectile(this.area, warden, location, PROJECTILE.SKULL, { delay: 30, duration: 90, perTile: 0, startHeight: 87, endHeight: 20 });
    }
    if (index === 1) this.spawnPhantom(this.tumeken ? ids().ZEBAKS_PHANTOM : ids().AKKHAS_PHANTOM, PHANTOM_SPOTS[0]);
    else if (index === 2) this.spawnPhantom(this.tumeken ? ids().BA_BAS_PHANTOM : ids().KEPHRIS_PHANTOM, PHANTOM_SPOTS[1]);
    this.later(4, () => this.spawnSiphons(tiles, players.length));
  }

  spawnSiphons(tiles, groupSize) {
    if (this.phase !== 2) return;
    const I = ids();
    this.skullTimer = 3 + tiles.length * (this.insanity ? 2 : 3);
    const hitpoints = 1 + (groupSize < 4 ? 0 : Math.floor((groupSize - 2) / 2));
    this.siphonsDone = tiles.map(() => false);
    this.siphons = tiles.map((location, index) => {
      const siphon = this.spawnFixed(I.COL_00FFFF_ENERGY_SIPHON_COL, { x: location.getX(), y: location.getY(), z: Z }, { scale: false, points: 0, inert: true });
      if (!siphon) return null;
      siphon.setMaxHitpoints(hitpoints);
      siphon.setHitpoints(hitpoints);
      siphon.__toaSiphon = { index, location, pulse: 1 };
      this.setObject(SIPHON_BLOCK, { x: location.getX(), y: location.getY(), z: Z }, 10, 0);
      for (const player of this.challengePlayers()) if (standingOn(player, location)) this.shove(player);
      return siphon;
    });
  }

  removeSiphon(siphon) {
    const location = siphon.__toaSiphon.location;
    this.setObject(-1, { x: location.getX(), y: location.getY(), z: Z }, 10, 0);
    this.despawn(siphon);
  }

  tickSiphons() {
    if (!this.skullAttack) return;
    for (const siphon of this.siphons) {
      if (!this.alive(siphon) || --siphon.__toaSiphon.pulse > 0) continue;
      siphon.__toaSiphon.pulse = 2;
      Shared.tileProjectile(this.area, siphon, this.warden, PROJECTILE.SIPHON, { delay: 0, duration: 90, perTile: 0, startHeight: 5, endHeight: 100 });
    }
  }

  /** Siphons only break to melee, one point a hit. */
  filterSiphonHit(hit) {
    const { CombatType } = Shared.core();
    if (hit.getCombatType?.() !== CombatType.MELEE) {
      zeroHit(hit);
      return;
    }
    limitHit(hit, 1);
    if (hit.getTotalDamage() < 1) {
      const first = hit.getHits()[0];
      first?.setDamage(1);
      hit.updateTotalDamage();
    }
  }

  siphonBroken(siphon) {
    const state = siphon.__toaSiphon;
    if (!this.siphonsDone) return;
    this.siphonsDone[state.index] = true;
    this.setObject(-1, { x: state.location.getX(), y: state.location.getY(), z: Z }, 10, 0);
    if (!this.skullAttack || this.siphonsDone.some((done) => !done)) return;
    const I = ids();
    const { Animation } = Shared.core();
    this.attackTicks = 8;
    this.siphonsDone = null;
    for (const other of this.siphons) {
      if (!other) continue;
      Shared.tileProjectile(this.area, other.__toaSiphon.location, this.warden, PROJECTILE.SKULL, { delay: 20, duration: 58, perTile: 0, startHeight: 20, endHeight: 87 });
      if (other !== siphon) this.removeSiphon(other);
    }
    this.later(1, () => {
      this.warden.performAnimation(new Animation(ANIMATION.SKULL_RETURN));
      this.warden.setNpcTransformationId(this.tumeken ? I.TUMEKENS_WARDEN_7 : I.ELIDINIS_WARDEN_7);
    });
    this.later(2, () => {
      this.skullAttack = false;
      this.warden.setUntargetable(false);
      Shared.damage(this.warden, Math.floor(this.warden.getMaxHitpoints() * 0.05));
    });
  }

  /** Siphons left standing: the whole floor erupts, harder for each one missed. */
  skullsFailed() {
    const missing = this.siphonsDone.filter((done) => !done).length;
    if (missing === 0) return;
    const I = ids();
    const { Animation } = Shared.core();
    this.attackTicks = 9;
    this.siphonsDone = null;
    this.warden.performAnimation(new Animation(ANIMATION.SKULL_FAIL));
    const base = tileOf(FLOOR_BASE);
    const first = [];
    const second = [];
    Data.FULL_FLOOR_ATTACK.forEach((group, groupIndex) => {
      for (const entry of group) {
        const location = tileOf(entry);
        const delay = 30 + chebyshev(location, base) * 6;
        (delay < 60 ? first : second).push(location);
        this.graphic(GRAPHIC.FLOOR_BASE + groupIndex, location, { delay });
      }
    });
    for (const siphon of this.siphons) {
      if (!siphon) continue;
      if (this.alive(siphon)) this.graphic(GRAPHIC.EXPLOSION, siphon.getLocation());
      this.removeSiphon(siphon);
    }
    this.siphons = [];
    this.soundAll(SOUND.SKULL_FAIL);
    const damage = (this.insanity ? 33 : 11) * missing;
    const strike = (tiles) => {
      for (const location of tiles) {
        for (const player of this.challengePlayers()) if (standingOn(player, location)) Shared.damage(player, this.maxHit(damage));
      }
    };
    strike(first);
    this.later(1, () => strike(second));
    this.later(3, () => this.warden.setNpcTransformationId(this.tumeken ? I.TUMEKENS_WARDEN_7 : I.ELIDINIS_WARDEN_7));
    this.later(4, () => {
      this.skullAttack = false;
      this.warden.setUntargetable(false);
    });
  }

  // -------------------------------------------------------------- phantoms

  spawnPhantom(id, spot) {
    const I = ids();
    const npc = this.spawnFixed(id, spot, { scale: false, points: 0, face: FACE_NORTH });
    if (!npc) return;
    npc.setUntargetable(true);
    const apmeken = Shared.PATH_BY_KEY.APMEKEN.index;
    this.phantoms.push({
      npc,
      id,
      ticks: id === I.ZEBAKS_PHANTOM ? 8 : 7,
      magic: Shared.random(0, 1) === 0,
      akkhaAttacks: 0,
      dropSpeed: id === I.BA_BAS_PHANTOM ? Math.min(2, Math.floor(this.raid.pathLevels[apmeken] / 2)) : 0,
    });
  }

  tickPhantoms() {
    for (const phantom of this.phantoms) {
      if (phantom.ticks > 0 && --phantom.ticks <= 0) phantom.ticks = this.phantomAttack(phantom);
    }
  }

  phantomAttack(phantom) {
    const I = ids();
    const { Animation } = Shared.core();
    const npc = phantom.npc;
    const players = this.challengePlayers();
    if (phantom.id === I.ZEBAKS_PHANTOM) {
      if (Shared.random(0, 2) === 0) phantom.magic = !phantom.magic;
      const style = phantom.magic ? "magic" : "ranged";
      npc.performAnimation(new Animation(ANIMATION.ZEBAK));
      const launch = tileOf(ZEBAK_LAUNCH);
      Shared.tileProjectile(this.area, npc, launch, PROJECTILE.ZEBAK[style], { delay: 30, duration: 90, perTile: 0, startHeight: 50, endHeight: 125 });
      this.later(3, () => {
        for (const player of this.challengePlayers()) {
          Shared.tileProjectile(this.area, launch, player, PROJECTILE.ZEBAK_SPLIT[style], { delay: 0, duration: 90, perTile: 0, startHeight: 125, endHeight: 22 });
          player.performGraphic(Shared.gfx(style === "magic" ? GRAPHIC.ZEBAK_MAGE : GRAPHIC.ZEBAK_RANGED, { delay: 90, height: 90 }));
        }
        this.later(2, () => {
          for (const player of this.challengePlayers()) this.strike(npc, player, null, style, 20, 0);
        });
      });
      return 8;
    }
    if (phantom.id === I.AKKHAS_PHANTOM) {
      if ((this.stayVigilant && Shared.random(0, 3) === 0) || (!this.stayVigilant && ++phantom.akkhaAttacks > 3)) {
        phantom.akkhaAttacks = 0;
        npc.performAnimation(new Animation(ANIMATION.AKKHA_SWITCH));
        phantom.magic = !phantom.magic;
        return 7;
      }
      const style = phantom.magic ? "magic" : "ranged";
      npc.performAnimation(new Animation(phantom.magic ? ANIMATION.AKKHA_MAGE : ANIMATION.AKKHA_RANGED));
      this.later(1, () => {
        for (const player of players) {
          if (!this.challengePlayers().includes(player)) continue;
          Shared.tileProjectile(this.area, npc, player, PROJECTILE.AKKHA[style], { delay: 0, duration: 54, perTile: 0, startHeight: 101, endHeight: 34 });
          this.strike(npc, player, null, style, 20, 2, { prayerMultiplier: 0.15 });
        }
      });
      return 7;
    }
    if (phantom.id === I.BA_BAS_PHANTOM) {
      npc.performAnimation(new Animation(ANIMATION.BABA));
      const tiles = [];
      for (const player of players) {
        const location = player.getLocation();
        if (!tiles.some((other) => other.getX() === location.getX() && other.getY() === location.getY())) tiles.push(location.clone());
      }
      for (const location of tiles) this.graphic(GRAPHIC.RUBBLE_BASE + phantom.dropSpeed, location, { delay: 20 });
      this.later(5 - phantom.dropSpeed * 2, () => {
        for (const location of tiles) {
          for (const player of this.challengePlayers()) if (standingOn(player, location)) this.tileHit(player, 19, 5);
        }
      });
      return 7 - phantom.dropSpeed;
    }
    npc.performAnimation(new Animation(ANIMATION.KEPHRI));
    const launch = tileOf(KEPHRI_LAUNCH);
    Shared.tileProjectile(this.area, npc, launch, PROJECTILE.KEPHRI_LAUNCH, { delay: 39, duration: 51, perTile: 0, startHeight: 175, endHeight: 250 });
    this.later(2, () => {
      const tiles = [];
      const add = (location) => {
        if (!tiles.some((other) => other.getX() === location.getX() && other.getY() === location.getY())) tiles.push(location);
      };
      for (const player of this.challengePlayers()) {
        const location = player.getLocation().clone();
        Shared.tileProjectile(this.area, launch, location, PROJECTILE.KEPHRI_BOMB, { delay: 0, duration: 120, perTile: 0, startHeight: 250, endHeight: 9 });
        if (this.aerialAssault) {
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(location.transform(dx, dy));
        } else {
          add(location);
        }
      }
      for (const location of tiles) this.graphic(GRAPHIC.INCOMING, location);
      this.later(3, () => {
        for (const location of tiles) {
          if (!Shared.floorFree(this.area, location)) continue;
          this.graphic(GRAPHIC.KEPHRI_EXPLODE, location, { height: 38 });
          for (const player of this.challengePlayers()) {
            if (!standingOn(player, location)) continue;
            const base = this.maxHit(20) + Shared.random(0, 3);
            Shared.damage(player, Shared.isProtected(player, "magic") ? Math.floor(base * 0.75) : base);
          }
        }
      });
    });
    return 7;
  }

  // -------------------------------------------------------------- the last stand

  startLastPhase() {
    if (this.phase !== 2) return;
    const { Animation } = Shared.core();
    this.phase = 3;
    this.skullAttack = false;
    const warden = this.warden;
    warden.setUntargetable(false);
    this.soundAll(SOUND.SELF_HEAL);
    warden.setHitpoints(Math.min(warden.getMaxHitpoints(), warden.getHitpoints() + Math.floor(warden.getMaxHitpoints() * 0.2)));
    warden.performAnimation(new Animation(ANIMATION.LAST_PHASE));
    this.later(3, () => {
      for (const player of this.challengePlayers()) Shared.sound(player, SOUND.LAST_PHASE);
    });
  }

  /** The floor falls away row by row from the south edge, pushing anyone on it north. */
  tickCollapse() {
    if (this.floorIndex >= Data.FLOOR_COLLAPSE.length || this.floorTicks <= 0 || --this.floorTicks > 0) return;
    this.floorTicks = this.insanity ? 10 : 15;
    const row = FLOOR_MIN.y + 8 - Math.floor(this.floorIndex / 4);
    let ticks = 0;
    this.repeat(1, () => {
      if (ticks++ >= 4 || this.phase !== 3 || this.floorIndex >= Data.FLOOR_COLLAPSE.length) return false;
      for (const [id, type, rotation, x, y] of Data.FLOOR_COLLAPSE[this.floorIndex]) {
        const location = tile(x, y);
        if (y === row) Shared.tileProjectile(this.area, location, tileOf(FLOOR_VOID), PROJECTILE.FLOOR_REMOVAL, { delay: 20, duration: 90, perTile: 0, startHeight: 0, endHeight: 200 });
        this.setObject(id, { x, y, z: Z }, type, rotation);
        for (const player of this.challengePlayers()) if (standingOn(player, location)) this.pushOff(player, row - 1);
      }
      this.floorIndex++;
      return true;
    });
  }

  pushOff(player, row) {
    const location = player.getLocation();
    for (let radius = 0; radius <= 2; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const next = tile(location.getX() + dx, row);
        if (!Shared.floorFree(this.area, next)) continue;
        player.sendMessage("You are pushed off.");
        player.getMovementQueue().reset();
        Shared.knockback(player, next.getX() - location.getX(), next.getY() - location.getY(), { ticks: 1, animation: ANIMATION.PUSHED });
        return;
      }
    }
  }

  tickThunder() {
    if (this.thunderTicks <= 0) return;
    this.thunderTicks--;
    if (this.thunderTicks > 2) return;
    if (this.thunderTicks === 0) {
      this.thunderTicks = 6;
      this.thunderTaken.clear();
    }
    const open = [];
    for (let y = 0; y <= 8 - Math.floor(this.floorIndex / 4); y++) {
      for (let x = 0; x <= 20; x++) {
        const location = tile(FLOOR_MIN.x + x, FLOOR_MIN.y + y);
        const key = `${location.getX()},${location.getY()}`;
        if (!this.thunderTaken.has(key) && Shared.floorFree(this.area, location)) open.push(location);
      }
    }
    const strikes = Shared.shuffle(open).slice(0, Math.max(2, Math.floor(open.length * 0.15)));
    for (const location of strikes) {
      this.graphic(GRAPHIC.THUNDER_INCOMING, location);
      this.thunderTaken.add(`${location.getX()},${location.getY()}`);
    }
    this.later(4, () => {
      if (this.phase !== 3) return;
      this.soundAll(SOUND.THUNDER);
      for (const location of strikes) {
        this.graphic(GRAPHIC.FINAL_THUNDER, location);
        for (const player of this.challengePlayers()) if (standingOn(player, location)) this.tileHit(player, 9, 4);
      }
    });
  }
}

// ------------------------------------------------------------------ hooks

function wardensRoom(entity) {
  const room = entity?.__toaRoom;
  return room instanceof WardensRoom && !room.destroyed ? room : null;
}

function finalRoom(entity) {
  const room = entity?.__toaRoom;
  return room instanceof WardensFinalRoom && !room.destroyed ? room : null;
}

function roomOfPlayer(player) {
  const room = Raid.raidOf(player)?.roomFor(player);
  return room && !room.destroyed ? room : null;
}

function beginWardens({ player }) {
  const room = roomOfPlayer(player);
  if (!(room instanceof WardensRoom)) return false;
  room.setReady(player);
  return true;
}

function talkToWardensOsmumten({ player, npc }) {
  const room = roomOfPlayer(player);
  if (!(room instanceof WardensRoom)) return false;
  Shared.npcSay(player, npc?.getId?.() ?? ids().OSMUMTEN_2, "Amascut's Wardens await beyond. Tell me when you are ready to begin, and we shall start once your whole party is.");
  return true;
}

function filterWardenDamage(event) {
  const npc = event.npc;
  const first = wardensRoom(npc);
  if (first) {
    if (npc === first.moving) first.filterMovingHit(event.hit);
    else if (npc === first.core) first.coreHit(event.hit);
    return;
  }
  const final = finalRoom(npc);
  if (!final) return;
  if (npc === final.warden) final.filterWardenHit(event.hit);
  else if (npc.__toaSiphon) final.filterSiphonHit(event.hit);
}

function wardenDowned(event) {
  const npc = event.npc;
  const first = wardensRoom(npc);
  if (first) {
    if (npc === first.obelisk) {
      event.preventDeath = true;
      npc.setHitpoints(1);
      first.startWardenPhase();
    } else if (npc === first.moving) {
      event.preventDeath = true;
      if (first.down) {
        npc.setHitpoints(1);
        first.killMovingWarden();
      } else {
        npc.setHitpoints(1);
        first.wardenDown();
      }
    } else if (npc === first.core) {
      event.preventDeath = true;
      first.coreReturns();
    }
    return;
  }
  const final = finalRoom(npc);
  if (!final) return;
  if (npc === final.warden) {
    if (final.phase === 2) {
      event.preventDeath = true;
      npc.setHitpoints(1);
      final.startLastPhase();
    } else {
      final.complete();
    }
  } else if (npc.__toaSiphon) {
    final.siphonBroken(npc);
  }
}

/** Entombed players can't fight, and the final Warden can't be hit while its skulls are out. */
function wardenAttackRules(event) {
  const attacker = event.attacker;
  if (!attacker?.isPlayer?.()) return;
  const room = roomOfPlayer(attacker);
  if (room instanceof WardensRoom && room.isStoned(attacker)) {
    event.allow = false;
  } else if (room instanceof WardensFinalRoom && event.target === room.warden && room.skullAttack) {
    attacker.sendMessage("You can't attack the warden right now.");
    event.allow = false;
  }
}

/** A melee hit on a siphon costs no attack delay: the next one can be struck at once (Near-Reality). */
function struckSiphon(event) {
  const { player, target, hit } = event;
  if (!target?.__toaSiphon || !finalRoom(target)) return;
  if (hit?.getCombatType?.() !== Shared.core().CombatType.MELEE) return;
  Shared.skipAttackDelay(player, target);
}

/** Walk to the edge of the floor nearest the crystal rather than to its unreachable tile. */
function routeToCrystal(event) {
  if (event.objectId !== Shared.core().ObjectIdentifiers.TELEPORT_CRYSTAL_3) return;
  if (!(roomOfPlayer(event.player) instanceof WardensFinalRoom)) return;
  const x = Math.min(CRYSTAL_EDGE.maxX, Math.max(CRYSTAL_EDGE.minX, event.player.getLocation().getX()));
  event.destination = { x, y: CRYSTAL_EDGE.y, z: Z };
}

module.exports = function registerWardens(api) {
  Shared.bind(api);
  Raid.registerRoom("WARDENS_P1", WardensRoom);
  Raid.registerRoom("WARDENS_P3", WardensFinalRoom);
  api.onNpcInteraction("Osmumten", { Begin: beginWardens, "Talk-to": talkToWardensOsmumten });
  api.onNpcHitModify(filterWardenDamage);
  api.onNpcBeforeDeath(wardenDowned);
  Raid.onRaidArea("canAttack", wardenAttackRules);
  api.onObjectRoute(routeToCrystal);
  api.onPlayerDealtDamage(struckSiphon);
  registerWardenCombat(api);
};

function registerWardenCombat(api) {
  const { CombatMethod, CombatType, NpcIdentifiers } = api.core;

  class MovingWardenCombatMethod extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 8;
    }

    canAttack(npc) {
      const room = wardensRoom(npc);
      return !!room && room.isStarted() && room.moving === npc && room.movingCanAttack && !room.down;
    }

    start(npc, target) {
      wardensRoom(npc)?.movingAttack(target);
    }

    hits() {
      return [];
    }
  }

  api.registerNpcCombatMethodProvider([
    NpcIdentifiers.ELIDINIS_WARDEN_3, NpcIdentifiers.ELIDINIS_WARDEN_4,
    NpcIdentifiers.TUMEKENS_WARDEN_3, NpcIdentifiers.TUMEKENS_WARDEN_4,
  ], MovingWardenCombatMethod, { singleton: false });
}
