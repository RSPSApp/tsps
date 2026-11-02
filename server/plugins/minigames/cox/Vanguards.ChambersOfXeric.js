"use strict";

/**
 * The Vanguards' room: three vanguards (melee, ranged, magic) burst from the ground and must be
 * worn down evenly; whenever one falls too far behind the others they all retreat into their
 * shells, swap places and heal.
 *
 * Wiki (Vanguard):
 * - They rise when a player comes near. Each attack is three: the melee one hits its target
 *   three times; the ranged and magic ones fire at their target and two tiles around it.
 *   Protection prayers reduce, not stop, the damage.
 * - A difference of more than 40% of their health (33.3% in parties of five or more) makes them
 *   shuffle at once and heal to full. Otherwise they shuffle every 20-36 ticks.
 * - In their shells they can't be hurt; a fatal hit landing in the shell leaves 1 hitpoint.
 *   Shuffling, they drop their targets. Retreating into their shells restores drained stats.
 *   Max hits: melee 3 x 18, ranged and magic 22 (27 and 33 in Challenge Mode).
 * - Strategies: those in the shells' path take 3-6 every few ticks.
 * rsprox captures (recordings 843, 3285, 3389):
 * - Woken, the dormant three play 7428 and 5 ticks later become melee (7527), ranged (7528)
 *   and magic (7529) with their transitions 7438 / 7443 / 7433.
 * - Attacks every 4 ticks, the first 5 after standing up: melee 7441 (sound 3308, range 10);
 *   ranged 7446 (sound 239) with projectiles 1334, 1333 and 1332, the first locked on the target
 *   and the others up to 4 tiles round it (from 23 / 25 / 26 client cycles to 40 + 6 a tile
 *   from the target, angles 10 / 16 / 19, progress 96, heights 100 to 5), landing as gfx 305
 *   with sound 360 (range 8) after end / 30 ticks; magic 7436 (sound 3530) with three
 *   projectiles 1331 the same way (from 45 / 30 / 30 to 21 + 25 a tile, angles 60-62, heights
 *   150 to 5) landing as gfx 659 (10 cycles' delay) with sound 156. Impact sounds come 0, 3 and
 *   6 cycles apart.
 * - Their balance is checked every 2 ticks: past the Wiki's limit they shuffle on that tick.
 *   Short of it, from about half the limit (fitted: none at 16%, seen at 23%), a swirl shows
 *   on the healthiest (57) and the lowest (56).
 * - They fall into their shells (7442 / 7447 / 7437, walking form 7526) on one tick and stand
 *   up in their new roles 9-13 ticks later, each a spot along from its own, all clockwise or
 *   all not, wherever the melee one had wandered to; out of balance, they heal to full 4 ticks
 *   in (7431, heal hitsplats).
 * - Dying: 7432; gone 3 ticks later with "As the Vanguard is slain by <name>, supplies are
 *   dropped for all."; the others fight on whatever the gap to the dead one (3389).
 * Tiles: the three spots and the exit crystal 30017 are checked for the west version (3389) and
 *   the east one (843, 3285). No capture has the north version: its tiles are unverified.
 * Not on the Wiki (to check against a capture): the shells' trample every 3 ticks; the ranged
 *   one never moving out of turn; prayers letting a third through; "The Vanguard is protected
 *   by its shell.".
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Monsters = require("./Monsters.ChambersOfXeric");
const Achievements = require("./CombatAchievements.ChambersOfXeric");

const FORM = { BURIED: 7525, SHELL: 7526, MELEE: 7527, RANGED: 7528, MAGIC: 7529 };
const CRYSTAL = 30017;
const STYLE = {
  [FORM.MELEE]: { rise: 7438, fall: 7442, attack: 7441, base: 18, stat: 1, style: "melee", sound: 3308 },
  [FORM.RANGED]: {
    rise: 7443, fall: 7447, attack: 7446, base: 22, stat: 3, style: "ranged", sound: 239,
    impact: { gfx: 305, gfxDelay: 0, sound: 360 },
    flights: [
      { id: 1334, start: 23, angle: 10 }, { id: 1333, start: 25, angle: 16 }, { id: 1332, start: 26, angle: 19 },
    ],
    end: 40, endPerTile: 6, progress: 96, startHeight: 25,
  },
  [FORM.MAGIC]: {
    rise: 7433, fall: 7437, attack: 7436, base: 22, stat: 4, style: "magic", sound: 3530,
    impact: { gfx: 659, gfxDelay: 10, sound: 156 },
    flights: [
      { id: 1331, start: 45, angle: 60 }, { id: 1331, start: 30, angle: 61 }, { id: 1331, start: 30, angle: 62 },
    ],
    end: 21, endPerTile: 25, progress: 64, startHeight: 37,
  },
};
const ANIM = { RISE: 7428, HEAL: 7431 };
const SWIRL = { HIGH: 57, LOW: 56, FROM: 0.5 };
const TIMING = { BALANCE: 2, RISE: 5, FIRST_ATTACK: 5, HEAL: 4, STAND_UP: [9, 13], TRAMPLE: 3 };
const TOGETHER_TICKS = Math.floor(10 / 0.6);

/** Cache tiles by version: the three spots' centres. */
const SPOTS = [
  [{ x: 3282, y: 5325 }, { x: 3277, y: 5333 }, { x: 3273, y: 5326 }],
  [{ x: 3317, y: 5330 }, { x: 3309, y: 5334 }, { x: 3309, y: 5324 }],
  [{ x: 3348, y: 5325 }, { x: 3342, y: 5332 }, { x: 3338, y: 5325 }],
];
const CRYSTAL_TILES = [{ x: 3267, y: 5327 }, { x: 3311, y: 5339 }, { x: 3350, y: 5328 }];

class VanguardRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.vanguards = [];
    this.stage = "buried";
  }

  load() {
    this.spots = SPOTS[this.record.variant].map((spot) => this.tile(spot.x - 1, spot.y - 1, 3));
    this.spots.forEach((spot, index) => {
      const vanguard = this.spawnNpc(FORM.BURIED, spot.clone());
      if (!vanguard) return;
      vanguard.__coxShell = true;
      vanguard.__coxSpot = index;
      this.vanguards.push(vanguard);
    });
    this.blockExit(CRYSTAL_TILES, CRYSTAL);
  }

  combatPoints() {
    return Number.MAX_SAFE_INTEGER;
  }

  living() {
    return this.vanguards.filter((npc) => npc.isRegistered() && npc.getHitpoints() > 0);
  }

  /** Wiki: 40% of their health apart (33.3% with five or more raiders). */
  balanceLimit() {
    return (this.raid.scale >= 5 ? 1 / 3 : 0.4) * Math.max(...this.living().map((npc) => npc.getMaxHitpoints()));
  }

  healthGap() {
    const health = this.living().map((npc) => npc.getHitpoints());
    return health.length < 2 ? 0 : Math.max(...health) - Math.min(...health);
  }

  unbalanced() {
    return this.healthGap() > this.balanceLimit();
  }

  tick() {
    if (this.stage === "buried") {
      if (this.raiders().some((player) => this.vanguards.some((npc) => player.getLocation().getDistance(npc.getLocation()) < 7))) this.rise();
      return;
    }
    if (this.stage !== "fighting" || this.living().length === 0) return;
    for (const npc of this.living()) if (this.raid.ticks >= npc.__coxAttackFrom) this.engage(npc);
    if (this.raid.ticks % TIMING.BALANCE === 0) this.swirl();
    if (this.raid.ticks >= this.nextShuffle || (this.raid.ticks % TIMING.BALANCE === 0 && this.unbalanced())) this.shuffle();
  }

  /** They stir (7428) and 5 ticks later take their roles. */
  rise() {
    this.stage = "rising";
    const forms = Shared.shuffle([FORM.MELEE, FORM.RANGED, FORM.MAGIC]);
    this.vanguards.forEach((npc, index) => {
      Shared.animate(npc, ANIM.RISE);
      npc.__coxForm = forms[index];
      Monsters.restat(npc, npc.__coxForm, this.raid.scaling);
    });
    Shared.later(this.raid, TIMING.RISE, () => {
      for (const npc of this.living()) {
        npc.setNpcTransformationId(npc.__coxForm);
        Shared.animate(npc, STYLE[npc.__coxForm].rise);
      }
      this.standUp();
    });
  }

  standUp() {
    for (const npc of this.living()) {
      npc.__coxShell = false;
      npc.__coxAttackFrom = this.raid.ticks + TIMING.FIRST_ATTACK;
    }
    this.stage = "fighting";
    this.nextShuffle = this.raid.ticks + Shared.random(20, 36);
  }

  /** Near the limit, a swirl on the healthiest and on the lowest. */
  swirl() {
    if (this.healthGap() < this.balanceLimit() * SWIRL.FROM) return;
    const living = this.living();
    const health = living.map((npc) => npc.getHitpoints());
    const highest = Math.max(...health);
    living.filter((npc) => npc.getHitpoints() === highest).forEach((npc) => npc.performGraphic(Shared.gfx(SWIRL.HIGH)));
    living[health.indexOf(Math.min(...health))].performGraphic(Shared.gfx(SWIRL.LOW));
  }

  /** Into their shells on one tick, drains restored; each walks to the next spot; the unbalanced heal to full. */
  shuffle() {
    const heal = this.unbalanced();
    this.stage = "shuffling";
    const clockwise = Shared.random(0, 1) === 0;
    for (const npc of this.living()) {
      npc.__coxShell = true;
      npc.getCombat().reset();
      Shared.animate(npc, STYLE[npc.__coxForm].fall);
      npc.setNpcTransformationId(FORM.SHELL);
      npc.setStatDrainImmune(true);
      npc.setStatDrainImmune(false);
      npc.__coxSpot = (npc.__coxSpot + (clockwise ? 1 : 2)) % 3;
      Shared.walkStraight(npc, this.spots[npc.__coxSpot]);
    }
    if (heal) {
      this.resetHealth = true;
      Shared.later(this.raid, TIMING.HEAL, () => {
        for (const npc of this.living()) {
          Shared.animate(npc, ANIM.HEAL);
          Shared.healSplat(npc, npc.getMaxHitpoints() - npc.getHitpoints());
        }
      });
    }
    Shared.later(this.raid, Shared.random(...TIMING.STAND_UP), () => {
      for (const npc of this.living()) {
        npc.setNpcTransformationId(npc.__coxForm);
        Shared.animate(npc, STYLE[npc.__coxForm].rise);
      }
      this.standUp();
    });
  }

  /** Shells crush whoever they walk over. */
  modifyHit(npc, hit) {
    if (!this.vanguards.includes(npc) || !npc.__coxShell) return;
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    const attacker = hit.getAttacker?.();
    if (attacker?.isPlayer?.()) attacker.getAsPlayer().sendMessage("The Vanguard is protected by its shell.");
  }

  /** A fatal hit in the shell leaves 1. */
  beforeNpcDeath(npc) {
    if (!this.vanguards.includes(npc) || !npc.__coxShell) return false;
    npc.setHitpoints(1);
    return true;
  }

  /** One gone: the supplies' message; the last, the exit and the Combat Achievements. */
  onNpcDeath(npc, killer) {
    if (!this.vanguards.includes(npc)) return;
    if (killer) {
      for (const player of this.raid.players) Shared.raidMessage(player, `As the Vanguard is slain by ${Shared.displayName(killer)}, supplies are dropped for all.`);
    }
    this.firstDeathTick ??= this.raid.ticks;
    if (this.living().filter((other) => other !== npc).length > 0) return;
    this.clearExit();
    const raiders = this.raiders();
    if (this.raid.ticks - this.firstDeathTick <= TOGETHER_TICKS) Achievements.complete(raiders, "Together We'll Fall");
    if (!this.resetHealth) Achievements.complete(raiders, "Perfectly Balanced");
  }

  /** Strategies: 3-6 every few ticks in their path. */
  shellsTrample() {
    if (this.raid.ticks % TIMING.TRAMPLE !== 0) return;
    for (const npc of this.living()) {
      if (!npc.__coxShell || !npc.getMovementQueue().isMovings()) continue;
      const at = npc.getLocation();
      for (const player of this.raiders()) {
        const x = player.getLocation().getX() - at.getX();
        const y = player.getLocation().getY() - at.getY();
        if (x >= 0 && x < 3 && y >= 0 && y < 3) Shared.damage(player, Shared.random(3, 6));
      }
    }
  }

  /** Three tiles: the target's and two free ones within 4 of it. */
  volleyTiles(npc, target) {
    const { Location, RegionManager } = Shared.core();
    const at = target.getLocation();
    const tiles = [at.clone()];
    for (let tries = 0; tries < 50 && tiles.length < 3; tries++) {
      const tile = new Location(at.getX() + Shared.random(-4, 4), at.getY() + Shared.random(-4, 4), at.getZ());
      if (tiles.some((other) => other.equals(tile)) || RegionManager.blocked(tile, this.map)) continue;
      const inside = tile.getX() >= npc.getLocation().getX() && tile.getX() < npc.getLocation().getX() + 3
        && tile.getY() >= npc.getLocation().getY() && tile.getY() < npc.getLocation().getY() + 3;
      if (!inside) tiles.push(tile);
    }
    return tiles;
  }

  attack(npc, target) {
    const form = STYLE[npc.__coxForm];
    if (!form) return;
    const max = Monsters.maxHitFor(npc, form.base, form.stat);
    Shared.animate(npc, form.attack);
    Shared.areaSound(this.raiders(), form.sound, npc.getLocation(), { range: 10 });
    if (npc.__coxForm === FORM.MELEE) {
      for (let i = 0; i < 3; i++) Shared.strike(npc, target, "melee", max, 1, { prayerMultiplier: 1 / 3 });
      return;
    }
    const { Projectile } = Shared.core();
    const from = Projectile.centreOf(npc);
    const tiles = this.volleyTiles(npc, target);
    const end = form.end + form.endPerTile * from.getDistance(target.getLocation());
    const lands = Math.floor(end / 30);
    tiles.forEach((tile, index) => {
      const flight = form.flights[index % form.flights.length];
      new Projectile(from, tile, index === 0 ? target : null, flight.id, flight.start, end, form.startHeight, 1, this.map)
        .withAngle(flight.angle)
        .withProgress(form.progress)
        .sendProjectile();
      for (const player of this.raiders()) {
        if (player.getLocation().equals(tile)) Shared.strike(npc, player, form.style, max, lands, { prayerMultiplier: 1 / 3 });
      }
    });
    Shared.later(this.raid, lands, () => {
      tiles.forEach((tile, index) => {
        Shared.graphicAt(this.raiders(), form.impact.gfx, tile, { delay: form.impact.gfxDelay });
        Shared.areaSound(this.raiders(), form.impact.sound, tile, { delay: index * 3, range: 8 });
      });
    });
  }
}

Raid.registerRoom("VANGUARD", VanguardRoom);

Raid.onTick(function vanguardsTrample(raid) {
  for (const room of raid.rooms) if (room instanceof VanguardRoom && room.stage === "shuffling") room.shellsTrample();
});

function vanguardCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class VanguardCombat extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackDistance(npc) {
      return npc.__coxForm === FORM.MELEE ? 1 : 10;
    }

    attackSpeed() {
      return 4;
    }

    canAttack(npc) {
      return !npc.__coxShell && npc.__coxRoom?.raid.ticks >= npc.__coxAttackFrom;
    }

    canPursue(npc) {
      return npc.__coxForm === FORM.MELEE;
    }

    start(npc, target) {
      const room = npc.__coxRoom;
      if (room instanceof VanguardRoom && target?.isPlayer?.()) room.attack(npc, target.getAsPlayer());
    }

    hits() {
      return [];
    }
  };
}

module.exports = function registerCoxVanguards(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider(Object.values(FORM), vanguardCombat(api));
};

Object.assign(module.exports, { VanguardRoom });
