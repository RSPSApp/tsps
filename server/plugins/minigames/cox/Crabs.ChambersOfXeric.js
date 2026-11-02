"use strict";

/**
 * The Crabs room: an energy focus (a floating orb) travels the room, turning at every jewelled
 * crab and taking its colour; brought to the small crystal of its colour, it lights it. Four
 * lit crystals shatter the dark crystal blocking the way on.
 *
 * Wiki (Jewelled Crab; Chambers of Xeric/Strategies, Crab puzzle; Gaining points):
 * - The crabs can't be hurt; striking one turns it red (melee), blue (magic) or green (ranged),
 *   and a player's attack doesn't repeat after changing its colour. "Smash" with a hammer or a
 *   blunt weapon turns it red and stuns it: 50-60 ticks solo, 30-40 for 2-3 raiders, 20-30
 *   for 4-5, 10-20 for 6+.
 * - Points come with each crystal lit, to whoever's crab sent the orb there.
 * - Black crystals take white orbs, yellow blue, magenta green, cyan red (the cache's loc names
 *   on the crystals' tiles match NEEDS). A coloured orb meeting a crab of another colour goes.
 * rsprox captures (recording 3389, a solo room, the east version turned):
 * - The orb goes a tile a tick from beside the carving, turning clockwise at each crab in its way
 *   (S to W, W to N, N to E; 27 orbs). It fizzles at the end of its path, and at a lit crystal
 *   (gfx 119 at height 80 on it, sound 219 x6, range 6) and goes the tick after, the next one
 *   appearing then. Meeting a crab it takes its colour (sound 3274, range 6). On the tick it
 *   arrives at a crystal or a player: at the wrong crystal it bursts as its colour's bolt (white
 *   119, red 128, blue 122, green 125; sound 1294), on a player as its wave (white 160, red 157;
 *   sound 223); both at height 80 with 10 client cycles' delay. The wave hit 22 at 96 and at 99
 *   hitpoints, four times: 23% of them, which is all that can be told from that range.
 * - Lighting a crystal: it turns white (29762) with the colour's bolt gfx and sound 1476 (10
 *   cycles' delay), 400 points, and the dark crystal brightens a step 2-3 ticks later (1 for the
 *   last, with sound 2425, range 10). With four lit: the crabs go 4 ticks later and the dark
 *   crystal shatters at 5 (gfx 1326 on three tiles, 5 cycles apart; sounds 1021 and, 5 cycles
 *   later, 3821, range 10).
 * - Struck, a crab blocks (1313) and keeps its colour 11-13 ticks. Smashing: the player 1755; on
 *   the crab gfx 245 (30 cycles' delay, height 100), sounds 556 and 2727 (range 5); it stays put
 *   for the Wiki's stun but is red only 7-9 ticks. Crabs bite with 2368 every 4 ticks (9 at most).
 * - The carving, crystals and dark crystal's tiles of the east version fit the recording; its
 *   crabs start in a line, 2 tiles apart.
 * Not on the Wiki (to check against a capture): the crabs' tiles in the west and north versions;
 *   anyone beside a player in the orb's way being hit too; two crabs at once fizzling it;
 *   blue and green waves; the crab count by party size (4 solo; the Wiki says more with more
 *   players). The recording also turns twice at walls with no crab in sight (10320,7186 going
 *   north; 10308,7181 going west), and that rule can't be told from one room; here walls fizzle.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");
const Achievements = require("./CombatAchievements.ChambersOfXeric");

const CRAB = { WHITE: 7576, RED: 7577, GREEN: 7578, BLUE: 7579 };
const FOCUS = { WHITE: 7580, RED: 7581, GREEN: 7582, BLUE: 7583 };
const OBJECT = { DARK: 29753, LIT: 29762 };
const HAMMER = 2347;
const COLOUR_TICKS = 12;
/** rsprox captures: how long a smashed crab stays red. */
const SMASH_COLOUR_TICKS = [7, 9];
/** rsprox captures: the orb's wave on a player (22 at 96 and at 99 hitpoints). */
const WAVE_SHARE = 0.23;
const POINTS_PER_CRYSTAL = 400;
const SOUND = { FIZZLE: 219, COLOUR: 3274, LIT: 1476, SMASH: 556, STUN: 2727, BRIGHTEN: 2425, SHATTER: 1021, SHATTER_AFTER: 3821 };
const ANIM = { SMASH: 1755, BITE: 2368 };
const FOCUS_DELAY = 5;
/** The orb each small crystal (by index) needs. */
const NEEDS = [FOCUS.WHITE, FOCUS.BLUE, FOCUS.GREEN, FOCUS.RED];
/** East, south, west, north: clockwise. */
const DIRECTIONS = [[1, 0], [0, -1], [-1, 0], [0, 1]];

/** Cache tiles by version. */
const FOCUS_TILES = [{ x: 3277, y: 5353 }, { x: 3318, y: 5363 }, { x: 3346, y: 5358 }];
const CRAB_TILES = [
  [{ x: 3286, y: 5354 }, { x: 3280, y: 5358 }, { x: 3281, y: 5365 }, { x: 3287, y: 5361 }],
  [{ x: 3306, y: 5358 }, { x: 3311, y: 5353 }, { x: 3313, y: 5361 }, { x: 3318, y: 5356 }],
  [{ x: 3333, y: 5364 }, { x: 3335, y: 5364 }, { x: 3337, y: 5364 }, { x: 3339, y: 5364 }],
];
const DARK_CRYSTAL_TILES = [{ x: 3272, y: 5365 }, { x: 3308, y: 5366 }, { x: 3349, y: 5366 }];
const SMALL_CRYSTAL_TILES = [
  [{ x: 3283, y: 5356 }, { x: 3279, y: 5366 }, { x: 3282, y: 5362 }, { x: 3287, y: 5359 }],
  [{ x: 3311, y: 5356 }, { x: 3320, y: 5360 }, { x: 3306, y: 5361 }, { x: 3305, y: 5356 }],
  [{ x: 3341, y: 5355 }, { x: 3337, y: 5354 }, { x: 3340, y: 5363 }, { x: 3340, y: 5367 }],
];
/**
 * Graphics by orb colour, the bolt (at a crystal) and the wave (on a player): the spell hits. The
 * bolts are all in the recording, the waves red's and white's only.
 */
const BURST = { [FOCUS.WHITE]: [119, 160], [FOCUS.RED]: [128, 157], [FOCUS.GREEN]: [125, 166], [FOCUS.BLUE]: [122, 163] };
/** The burst's sound: bolts 1294, waves 223 (captured for red and white). */
const BURST_SOUND = [1294, 223];

/** Wiki (Mod Ash): the stun by party size. */
function stunTicks(raiders) {
  if (raiders <= 1) return Shared.random(50, 60);
  if (raiders <= 3) return Shared.random(30, 40);
  if (raiders <= 5) return Shared.random(20, 30);
  return Shared.random(10, 20);
}

function isHammer(id) {
  if (id == null || id < 0) return false;
  const name = Shared.core().ItemDefinition.forId(id)?.getName?.()?.toLowerCase() ?? "";
  return /hammer|maul|bludgeon|frying pan|meat tenderiser/.test(name);
}

class CrabsRoom extends Raid.Room {
  constructor(raid, record) {
    super(raid, record);
    this.crabs = [];
    this.lit = [false, false, false, false];
    this.focus = null;
    this.wastedOrb = false;
  }

  load() {
    const variant = this.record.variant;
    for (const spot of CRAB_TILES[variant]) {
      const crab = this.spawnNpc(CRAB.WHITE, this.tile(spot.x, spot.y), { scale: false, wanderRadius: 3 });
      if (crab) this.crabs.push(crab);
    }
    this.crystalTiles = SMALL_CRYSTAL_TILES[variant].map((spot) => this.tile(spot.x, spot.y));
    const dark = DARK_CRYSTAL_TILES[variant];
    const { GameObject, ObjectManager } = Shared.core();
    this.dark = new GameObject(OBJECT.DARK, this.tile(dark.x, dark.y, 2), 10, this.record.rotation, this.map);
    ObjectManager.register(this.dark, true);
    this.nextFocusAt = this.raid.ticks + FOCUS_DELAY;
  }

  tick() {
    if (this.completed) return;
    for (const crab of this.crabs) {
      if (crab.__coxColourUntil != null && this.raid.ticks >= crab.__coxColourUntil) {
        crab.__coxColourUntil = null;
        crab.setNpcTransformationId(-1);
      }
    }
    // Not on the Wiki (to check against a capture): the crabs go for anyone within 3 tiles.
    for (const crab of this.crabs) {
      if (crab.__coxColourUntil != null || crab.getCombat().getTarget()) continue;
      const near = this.raiders().find((player) => player.getLocation().getDistance(crab.getLocation()) <= 3);
      if (near) crab.getCombat().attack(near);
    }
    if (!this.focus && this.raid.ticks >= this.nextFocusAt) this.sendFocus();
    else if (this.focus) this.moveFocus();
  }

  sendFocus() {
    const spot = FOCUS_TILES[this.record.variant];
    this.focus = this.spawnNpc(FOCUS.WHITE, this.tile(spot.x, spot.y), { scale: false });
    if (!this.focus) return;
    this.focus.__coxColour = FOCUS.WHITE;
    this.direction = (this.record.variant + this.record.rotation) & 3;
    this.sender = null;
  }

  /**
   * The orb is gone: fizzling on itself, bursting on its tile, or used; it is removed the tick
   * after, when the next one comes.
   */
  endFocus(how, tile = null) {
    const focus = this.focus;
    this.focus = null;
    this.nextFocusAt = this.raid.ticks + 1;
    if (!focus) return;
    if (how !== "used" && this.lit.some(Boolean)) this.wastedOrb = true;
    const viewers = this.raiders();
    const at = (tile ?? focus.getLocation()).clone();
    if (how === "fizzle") {
      focus.performGraphic(Shared.gfx(BURST[focus.__coxColour][0], { height: 80 }));
      Shared.areaSound(viewers, SOUND.FIZZLE, at, { loops: 6, range: 6 });
    } else if (how === "bolt" || how === "wave") {
      const size = how === "bolt" ? 0 : 1;
      Shared.graphicAt(viewers, BURST[focus.__coxColour][size], at, { height: 80, delay: 10 });
      Shared.areaSound(viewers, BURST_SOUND[size], at, { delay: 10, range: 6 });
    }
    if (!tile) focus.getMovementQueue().reset();
    Shared.later(this.raid, 1, () => this.removeNpc(focus));
  }

  crabAt(x, y) {
    return this.crabs.find((crab) => crab.isRegistered() && crab.getLocation().getX() === x && crab.getLocation().getY() === y) ?? null;
  }

  playerAt(location) {
    return this.raiders().find((player) => player.getHitpoints() > 0 && player.getLocation().equals(location)) ?? null;
  }

  moveFocus() {
    const focus = this.focus;
    if (focus.__coxFizzling) {
      this.endFocus("fizzle");
      return;
    }
    const here = focus.getLocation();
    if (this.burstOn(here)) return;
    let turns = 0;
    for (;;) {
      const [dx, dy] = DIRECTIONS[this.direction];
      const x = here.getX() + dx;
      const y = here.getY() + dy;
      const crab = this.crabAt(x, y);
      if (crab) {
        const crabColour = crab.getNpcTransformationId() > 0 ? crab.getNpcTransformationId() : crab.getId();
        const crabFocus = FOCUS.WHITE + (crabColour - CRAB.WHITE);
        // Wiki: a coloured orb can't make contact with a crab of another colour.
        if (focus.__coxColour !== FOCUS.WHITE && focus.__coxColour !== crabFocus) {
          this.endFocus("fizzle");
          return;
        }
        if (crabColour !== CRAB.WHITE && focus.__coxColour !== crabFocus) {
          focus.__coxColour = crabFocus;
          focus.setNpcTransformationId(focus.__coxColour);
          Shared.areaSound(this.raiders(), SOUND.COLOUR, here, { range: 6 });
        }
        const target = crab.getCombat().getTarget();
        this.sender = target?.isPlayer?.() ? target.getAsPlayer() : this.sender;
        if (++turns >= 2) {
          this.endFocus("fizzle");
          return;
        }
        this.direction = (this.direction + 1) & 3;
        continue;
      }
      const { Location, RegionManager } = Shared.core();
      const next = new Location(x, y, here.getZ());
      const crystal = this.crystalTiles.findIndex((tile) => tile.equals(next));
      if (crystal < 0 && RegionManager.blocked(next, this.map)) {
        this.endFocus("fizzle");
        return;
      }
      Shared.walkStraight(focus, next);
      if (crystal >= 0) this.reachCrystal(crystal);
      else this.burstOn(next, next);
      return;
    }
  }

  /** A player in the orb's way: a share of their hitpoints, to them and anyone beside them. */
  burstOn(location, tile = null) {
    const player = this.playerAt(location);
    if (!player) return false;
    const damage = Math.floor(Math.min(99, player.getHitpoints()) * WAVE_SHARE);
    for (const raider of this.raiders()) {
      if (raider.getLocation().getDistance(player.getLocation()) <= 1) Shared.damage(raider, damage);
    }
    this.endFocus("wave", tile);
    return true;
  }

  /** ::coxclear: every crystal lit in turn. */
  devFinish() {
    NEEDS.forEach((colour, index) => {
      if (this.lit[index]) return;
      if (!this.focus) this.sendFocus();
      this.focus.__coxColour = colour;
      this.reachCrystal(index);
    });
  }

  reachCrystal(index) {
    const colour = this.focus.__coxColour;
    const tile = this.crystalTiles[index];
    if (this.lit[index]) {
      this.focus.__coxFizzling = true;
      return;
    }
    if (colour !== NEEDS[index]) {
      this.endFocus("bolt", tile);
      return;
    }
    this.lit[index] = true;
    const small = this.map.getTemplateObjects(tile).find((object) => object.getType() === 10);
    if (small) Shared.replaceObject(this.map, small, OBJECT.LIT);
    const viewers = this.raiders();
    Shared.graphicAt(viewers, BURST[colour][0], tile, { height: 80, delay: 10 });
    Shared.areaSound(viewers, SOUND.LIT, tile, { delay: 10, range: 6 });
    if (this.sender && this.raid.players.has(this.sender)) this.raid.addPoints(this.sender, POINTS_PER_CRYSTAL);
    this.endFocus("used", tile);
    const litCount = this.lit.filter(Boolean).length;
    const last = litCount >= 4;
    Shared.later(this.raid, last ? 1 : 3, () => {
      this.dark = Shared.replaceObject(this.map, this.dark, OBJECT.DARK + litCount);
      if (last) Shared.areaSound(this.raiders(), SOUND.BRIGHTEN, this.dark.getLocation(), { range: 10 });
    });
    if (!last) return;
    this.completed = true;
    if (!this.wastedOrb) Achievements.complete(viewers, "Playing with Lasers");
    Shared.later(this.raid, 4, () => {
      for (const crab of this.crabs) this.removeNpc(crab);
    });
    Shared.later(this.raid, 5, () => {
      const { Location, ObjectManager } = Shared.core();
      const at = this.dark.getLocation();
      const offsets = [[0, 0, 0, 10], [-1, 1, 5, 0], [-1, 0, 10, 0]];
      for (const [dx, dy, delay, height] of offsets) {
        Shared.graphicAt(this.raiders(), 1326, new Location(at.getX() + dx, at.getY() + dy, at.getZ()), { delay, height });
      }
      Shared.areaSound(this.raiders(), SOUND.SHATTER, at, { range: 10 });
      Shared.areaSound(this.raiders(), SOUND.SHATTER_AFTER, at, { delay: 5, range: 10 });
      ObjectManager.deregister(this.dark, true);
    });
  }

  /** The crabs take no damage; a hit changes their colour by the attack's style. */
  modifyHit(npc, hit) {
    if (!this.crabs.includes(npc)) return;
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
    const { CombatType } = Shared.core();
    const type = hit.getCombatType?.();
    const colour = type === CombatType.MAGIC ? CRAB.BLUE : type === CombatType.RANGED ? CRAB.GREEN : CRAB.RED;
    this.colour(npc, colour);
    const attacker = hit.getAttacker?.();
    if (attacker?.isPlayer?.()) attacker.getCombat().reset();
  }

  colour(crab, id, ticks = COLOUR_TICKS) {
    crab.setNpcTransformationId(id);
    crab.__coxColourUntil = this.raid.ticks + ticks;
  }

  smash(player, crab) {
    const { Equipment } = Shared.core();
    const weapon = player.getEquipment().getItems()[Equipment.WEAPON_SLOT]?.getId?.();
    if (!isHammer(weapon) && !Shared.has(player, HAMMER)) {
      player.sendMessage("You don't have a suitable weapon equipped for hammering the crab.");
      return;
    }
    Shared.animate(player, ANIM.SMASH);
    Shared.areaSound(this.raiders(), SOUND.SMASH, crab.getLocation(), { delay: 20, range: 5 });
    Shared.areaSound(this.raiders(), SOUND.STUN, crab.getLocation(), { delay: 30, range: 5 });
    const ticks = stunTicks(this.raid.scale);
    this.colour(crab, CRAB.RED, Shared.random(...SMASH_COLOUR_TICKS));
    crab.performGraphic(Shared.gfx(245, { delay: 30, height: 100 }));
    crab.getCombat().reset();
    crab.getMovementQueue().reset();
    crab.getMovementQueue().setBlockMovement?.(true);
    Shared.later(this.raid, ticks, () => crab.getMovementQueue().setBlockMovement?.(false));
  }
}

Raid.registerRoom("CRAB_PUZZLE", CrabsRoom);

function smashCrab(event) {
  const crab = event.npc;
  const room = crab?.__coxRoom;
  if (!(room instanceof CrabsRoom)) return false;
  room.smash(event.player, crab);
  return true;
}

/** Crabs nip at whoever's near for up to 10 every 4 ticks. */
function crabCombat(api) {
  const { CombatMethod, CombatType, Animation } = api.core;
  return class JewelledCrabCombat extends CombatMethod {
    type() {
      return CombatType.MELEE;
    }

    attackSpeed() {
      return 4;
    }

    start(npc, target) {
      npc.performAnimation(new Animation(ANIM.BITE));
      if (target?.isPlayer?.()) {
        Shared.strike(npc, target.getAsPlayer(), "melee", 10, 0);
      }
    }

    hits() {
      return [];
    }
  };
}

module.exports = function registerCoxCrabs(api) {
  Shared.bind(api);
  for (const name of ["Jewelled Crab", "Jewelled Crab (red)", "Jewelled Crab (green)", "Jewelled Crab (blue)"]) {
    api.onNpcInteraction(name, { Smash: smashCrab });
  }
  api.registerNpcCombatMethodProvider(Object.values(CRAB), crabCombat(api));
};

Object.assign(module.exports, { CrabsRoom, stunTicks, NEEDS });
