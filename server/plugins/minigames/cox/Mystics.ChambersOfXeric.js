"use strict";

/**
 * The Skeletal Mystics' room (the dark altar): mystics casting fire and a damaging
 * Vulnerability, or meleeing those in reach; the Mark of Power blocks the way on until they're
 * all dead. Portals carry raiders between the room's start, middle and end.
 *
 * Wiki (Skeletal Mystic):
 * - Two Magic attacks (a standard one and a damaging Vulnerability) and Melee. They answer
 *   overhead prayers: one that can reach its target who prays against Magic melees it; one
 *   that can't keeps casting. Attack range 10. Protect from Magic about halves them (Strategies).
 * - By raid scale: 3 at 1-2, then one more each 3 up to 12 at 27+ (Strategies).
 * rsprox captures (recordings 3282, 3285, 3389):
 * - They leave raiders alone until attacked or close: one raider drew a mystic at 6 tiles (3282),
 *   others were left alone at 7 and further.
 * - Casting: 5528. Fire: gfx 1322 (height 164) on the mystic, projectile 130 (from 30 client
 *   cycles to 46 + 10 a tile from its centre, 96-136 seen, heights 340 to 124), sounds 155 then
 *   156 on landing, and on the target gfx 131 (or 85 splashing) sent with the flight's delay.
 *   Vulnerability: gfx 1321, projectile 109, sounds 127 then 3012, impact gfx 110; 7 of 20 casts,
 *   and two that landed (3285) changed no Defence.
 * - Dying: 5491; gone 5 ticks later, with "The Skeletal Mystic slain by <name> dropped seeds for
 *   all.".
 * - The Mark and every portal are sent unturned, however the room is turned; tiles fitted in all
 *   three recordings, all variant 0 (turned 2, 3 and 0). No capture has variants 1 or 2.
 * - The portals appear as the last mystic goes: 49996 at the start (Travel-End), 49997 in
 *   the middle (Travel: "Choose location", "End of the room" or "Start of the room") and 49998
 *   at the end (Travel-Start). Travelling opens the portal overlay (634, script 2893, sound
 *   3952) and moves the player 2 ticks later as it closes (script 2894). Live leaves the
 *   points overlay closed after that until the next floor; here it is put back.
 * Not on the Wiki and not in any capture: fire's base 25 + raiders / 4; melee anim 5485 (base 25;
 *   no recording has a mystic meleeing); the spawn tiles (first-seen tiles differ by a few, and
 *   they wander). 1 in 3 for Vulnerability is 20 casts' worth of evidence.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Monsters = require("./Monsters.ChambersOfXeric");

const NPC = { MYSTICS: [7604, 7605, 7606] };
const AGGRESSION_RANGE = 6;
const MAX_MYSTICS = 12;
const OBJECT = { MARK: 29741, PORTAL_START: 49996, PORTAL_MIDDLE: 49997, PORTAL_END: 49998 };
const ANIM = { CAST: 5528, MELEE: 5485 };
const SPELL = {
  FIRE: { cast: 1322, projectile: 130, hit: 131, sound: 155, landing: 156 },
  VULNERABILITY: { cast: 1321, projectile: 109, hit: 110, sound: 127, landing: 3012 },
};
const SPLASH = 85;
const PORTAL_OVERLAY = { INTERFACE: 634, OPEN: 2893, CLOSE: 2894, MODEL: 39504, COLOUR: 4128927, SOUND: 3952, MOVE_AFTER: 2 };
const BASE = { MELEE: 25, FIRE: 25 };

/** Cache tiles by version. */
const SPAWNS = [
  [{ x: 3278, y: 5261 }, { x: 3286, y: 5265 }, { x: 3284, y: 5271 }, { x: 3277, y: 5273 }, { x: 3273, y: 5265 }, { x: 3278, y: 5270 }],
  [{ x: 3315, y: 5262 }, { x: 3318, y: 5259 }, { x: 3309, y: 5258 }, { x: 3301, y: 5256 }, { x: 3306, y: 5264 }, { x: 3312, y: 5259 }],
  [{ x: 3342, y: 5262 }, { x: 3342, y: 5266 }, { x: 3340, y: 5268 }, { x: 3338, y: 5274 }, { x: 3337, y: 5268 }, { x: 3338, y: 5260 }],
];
const MARK_TILES = [{ x: 3270, y: 5264 }, { x: 3309, y: 5272 }, { x: 3348, y: 5268 }];
/** Start, middle, end. */
const PORTAL_TILES = [
  [{ x: 3278, y: 5250 }, { x: 3284, y: 5266 }, { x: 3271, y: 5266 }],
  [{ x: 3311, y: 5250 }, { x: 3308, y: 5260 }, { x: 3307, y: 5270 }],
  [{ x: 3341, y: 5255 }, { x: 3342, y: 5268 }, { x: 3348, y: 5271 }],
];

/** Wiki: 3 at scale 1-2, one more each 3 up to 12 at 27+. */
function mysticCount(scale) {
  return Math.min(MAX_MYSTICS, 3 + Math.floor(scale / 3));
}

class MysticsRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.mystics = [];
  }

  load() {
    const variant = this.record.variant;
    const spots = Shared.shuffle(SPAWNS[variant]);
    for (let i = 0; i < mysticCount(this.raid.scale); i++) {
      const spot = spots[i % spots.length];
      const mystic = this.spawnNpc(Shared.randomOf(NPC.MYSTICS), this.tile(spot.x, spot.y, 2), { wanderRadius: 2 });
      if (mystic) this.mystics.push(mystic);
    }
    const { GameObject, ObjectManager } = Shared.core();
    this.portalTiles = PORTAL_TILES[variant].map((spot) => this.tile(spot.x, spot.y));
    const mark = MARK_TILES[variant];
    this.mark = new GameObject(OBJECT.MARK, this.tile(mark.x, mark.y, 2), 10, 0, this.map);
    ObjectManager.register(this.mark, true);
  }

  combatPoints() {
    return Math.floor(5 * this.mystics.reduce((sum, npc) => sum + npc.getMaxHitpoints(), 0) * 1.05);
  }

  tick() {
    for (const mystic of this.mystics) {
      if (!mystic.isRegistered() || mystic.getHitpoints() <= 0 || mystic.getCombat().getTarget()) continue;
      const near = this.raiders().some((player) => player.getHitpoints() > 0 && player.getLocation().getDistance(mystic.getLocation()) <= AGGRESSION_RANGE);
      if (near) this.engage(mystic);
    }
  }

  onNpcDeath(npc, killer) {
    if (!this.mystics.includes(npc)) return;
    if (killer) {
      for (const player of this.raid.players) {
        Shared.raidMessage(player, `The Skeletal Mystic slain by ${Shared.displayName(killer)} dropped seeds for all.`);
      }
    }
    if (this.mystics.some((other) => other !== npc && other.isRegistered() && other.getHitpoints() > 0)) return;
    this.completed = true;
    const { GameObject, ObjectManager } = Shared.core();
    if (this.mark) ObjectManager.deregister(this.mark, true);
    this.mark = null;
    const portals = [OBJECT.PORTAL_START, OBJECT.PORTAL_MIDDLE, OBJECT.PORTAL_END];
    this.portalTiles.forEach((tile, index) => {
      ObjectManager.register(new GameObject(portals[index], tile, 10, 0, this.map), true);
    });
  }

  adjacent(npc, player) {
    const at = npc.getLocation();
    const x = player.getLocation().getX() - at.getX();
    const y = player.getLocation().getY() - at.getY();
    const inX = x >= 0 && x < 2;
    const inY = y >= 0 && y < 2;
    return (inX && (y === -1 || y === 2)) || (inY && (x === -1 || x === 2));
  }

  attack(npc, player) {
    if (this.adjacent(npc, player) && (Shared.isProtected(player, "magic") || Shared.random(0, 1) === 0)) {
      Shared.animate(npc, ANIM.MELEE);
      Shared.sound(player, 511);
      Shared.strike(npc, player, "melee", Monsters.maxHitFor(npc, BASE.MELEE, Monsters.LEVELS.STRENGTH), 0, { prayerMultiplier: 0.5 });
      return;
    }
    const spell = Shared.random(0, 2) === 0 ? SPELL.VULNERABILITY : SPELL.FIRE;
    Shared.animate(npc, ANIM.CAST);
    npc.performGraphic(Shared.gfx(spell.cast, { height: 164 }));
    const { Projectile } = Shared.core();
    const end = 46 + 10 * Projectile.centreOf(npc).getDistance(player.getLocation());
    new Projectile(Projectile.centreOf(npc), player.getLocation(), player, spell.projectile, 30, end, 85, 31, this.map)
      .withAngle(0)
      .withProgress(96)
      .sendProjectile();
    const lands = Math.floor(end / 30);
    const max = Monsters.maxHitFor(npc, BASE.FIRE + Math.floor(this.raid.scale / 4), Monsters.LEVELS.MAGIC);
    const hit = Shared.strike(npc, player, "magic", max, lands, { prayerMultiplier: 0.5 });
    const landed = hit.isAccurate?.() !== false;
    Shared.sound(player, spell.sound);
    Shared.sound(player, spell.landing, end);
    player.performGraphic(Shared.gfx(landed ? spell.hit : SPLASH, { delay: end, height: 124 }));
  }

  /** The portals: Travel-End, Travel-Start, or from the middle either way. */
  travel(player, option) {
    const start = this.portalTiles[0];
    const end = this.portalTiles[2];
    if (option === "Travel") {
      Shared.options(player, "Choose location",
        "End of the room", () => this.portal(player, end),
        "Start of the room", () => this.portal(player, start));
      return;
    }
    this.portal(player, option === "Travel-Start" ? start : end);
  }

  /** The portal overlay, the move 2 ticks later as it closes, and the points overlay back. */
  portal(player, tile) {
    const sender = player.getPacketSender();
    const uid = (component) => (PORTAL_OVERLAY.INTERFACE << 16) | component;
    sender.sendSubInterface(Shared.OVERLAY_UID, PORTAL_OVERLAY.INTERFACE, 1);
    sender.sendClientScript(PORTAL_OVERLAY.OPEN, uid(1), uid(2), PORTAL_OVERLAY.MODEL, PORTAL_OVERLAY.COLOUR, -1, -1);
    Shared.sound(player, PORTAL_OVERLAY.SOUND);
    Shared.later(player, PORTAL_OVERLAY.MOVE_AFTER, () => {
      player.moveTo(tile.clone());
      sender.sendClientScript(PORTAL_OVERLAY.CLOSE, uid(1), uid(2), -1, -1);
      Shared.later(player, 1, () => {
        sender.sendSubInterface(Shared.OVERLAY_UID, Shared.INTERFACE.OVERLAY, 1);
        this.raid.refreshPoints(player);
      });
    });
  }
}

Raid.registerRoom("DARK_ALTAR_ROOM", MysticsRoom);

function usePortal(event) {
  const room = Raid.raidOf(event.player)?.roomAt(event.player.getLocation());
  if (!(room instanceof MysticsRoom)) return false;
  room.travel(event.player, event.option);
  return true;
}

function mysticCombat(api) {
  const { CombatMethod, CombatType } = api.core;
  return class SkeletalMysticCombat extends CombatMethod {
    type() {
      return CombatType.MAGIC;
    }

    attackDistance() {
      return 10;
    }

    attackSpeed() {
      return 4;
    }

    start(npc, target) {
      const room = npc.__coxRoom;
      if (room instanceof MysticsRoom && target?.isPlayer?.()) room.attack(npc, target.getAsPlayer());
    }

    hits() {
      return [];
    }
  };
}

module.exports = function registerCoxMystics(api) {
  Shared.bind(api);
  api.registerNpcCombatMethodProvider(NPC.MYSTICS, mysticCombat(api));
  Shared.onObjectIds(api, [OBJECT.PORTAL_START, OBJECT.PORTAL_MIDDLE, OBJECT.PORTAL_END], usePortal);
};

Object.assign(module.exports, { MysticsRoom, mysticCount });
