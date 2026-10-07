"use strict";

/**
 * Doom of Mokhaiotl: ids, tiles and small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Doom_of_Mokhaiotl
 * docs/doom-of-mokhaiotl.md records the live capture (delve 1) these ids, tiles and timings
 * come from.
 */

const state = { api: null, core: null };

function bind(api) {
  state.api = api;
  state.core = api.core;
}

function core() {
  return state.core;
}

function api() {
  return state.api;
}

/** Capture: the ruins' entrance (Pass-through) and where it puts you, the lobby's exit back. */
const TILES = {
  ENTRANCE: { x: 1310, y: 9533, z: 1 },
  /** Where the entrance puts you (capture). */
  LOBBY: { x: 1311, y: 9540, z: 0 },
  /** Where the lobby's exit puts you: just outside the entrance, in the ruins. */
  RUINS: { x: 1311, y: 9531, z: 1 },
  GAP: { x: 1310, y: 9557, z: 0 },
  /** The lobby side of the gap, where leaving the arena puts you. */
  LOBBY_GAP: { x: 1311, y: 9556, z: 0 },
  /** Where jumping the gap lands you, inside your instance (capture). */
  ARRIVAL: { x: 1311, y: 9559, z: 0 },
  /** Where descending puts you (capture: delves 2-5), in delve 1's frame (see DEEP). */
  DESCENT: { x: 1311, y: 9566, z: 0 },
  /** The Doom surfaces here (capture: its south-west tile; it is 5x5). */
  BOSS: { x: 1309, y: 9571, z: 0 },
  /** Capture: death puts you in the lobby, by the gap. */
  RESPAWN: { x: 1313, y: 9555, z: 0 },
};

/**
 * Capture: jumping the gap copies the whole map square (1280-1343, 9536-9599) into an
 * instance. The lobby is in the same square, so the private area covers only the gap and the
 * arena north of it.
 */
const ARENA = { minX: 1280, maxX: 1343, minY: 9557, maxY: 9599, z: 0 };
/**
 * Capture: from delve 2 the instance is a copy of another map square, 53_100 (3392-3455,
 * 6400-6463), with the same arena at the same local tiles. Everything here is written in delve
 * 1's frame; `shift` moves a tile into the deeper square and `frame` brings one back.
 */
const DEEP = { dx: 53 * 64 - 20 * 64, dy: 100 * 64 - 149 * 64 };
const DEEP_ARENA = { minX: 3392, maxX: 3455, minY: 6400, maxY: 6463, z: 0 };
/** The arena floor (the cache's collision): larvae, debris and shockwaves stay inside it. */
const FLOOR = { minX: 1299, maxX: 1323, minY: 9559, maxY: 9585 };
/** The ruins around the entrance, where The Final Dawn's varbit is set (see Lobby.*). */
const RUINS = { minX: 1280, maxX: 1343, minY: 9472, maxY: 9599 };

const NPC = {
  DOOM: 14707,
  DOOM_SHIELDED: 14708,
  DOOM_BURROWED: 14709,
  LARVA: 14710,
  LARVA_RANGED: 14711,
  LARVA_MAGIC: 14712,
  LARVA_MELEE: 14713,
  VOLATILE_EARTH: 14714,
  EARTHEN_SHIELD: 14715,
  GIANT_LARVA_RANGED: 14788,
  GIANT_LARVA_MAGIC: 14789,
};

const OBJECT = {
  /** The ruins' entrance: a multiloc on The Final Dawn's varbit (56616 Pass-through at 68). */
  ENTRANCE: 56613,
  ENTRANCE_OPEN: 56616,
  EXIT: 56618,
  GAP: 57289,
  /** The gap inside the instance (capture), Exit / Quick-exit. */
  GAP_EXIT: 57290,
  ROCK: 57286,
  /** Left where the Doom burrowed (Wiki), Investigate / Descend. */
  BURROW_HOLE: 57285,
  SCOREBOARD: 57288,
  REWARD_CHEST: 50938,
};

/** Capture: the delve varps (RuneLite names dom_*). Levels are 0-based. */
const VARP = {
  /** The delve level's start cycle, as the boss surfaces. */
  LEVEL_START: 4805,
  CURRENT_LEVEL: 4828,
  LAST_LEVEL: 4798,
  LAST_DURATION: 4804,
  TOTAL_DURATION: 4803,
  TOTAL_LEVELS: 4807,
  /** dom_level_1_completions; levels 2-8 and 8+ follow (4808-4816). */
  LEVEL_COMPLETIONS: 4808,
  HUD_NPC: 1683,
};

const VARBIT = {
  /** The Final Dawn's progress; 68 is complete and opens the entrance. */
  FINAL_DAWN: 16663,
  /** Demonic charge: larvae that reached the Doom (capture: dom_missed_orbs). */
  MISSED_ORBS: 17758,
  HUD_HP: 6099,
  HUD_MAX: 6100,
  HUD_BOSS: 12401,
};
const FINAL_DAWN_COMPLETE = 68;

const INTERFACE = { HUD: 303 };
const HUD_UID = (161 << 16) | 2;
const FADE_OVERLAY_UID = (161 << 16) | 1;
const FADE_GROUP = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

function loc(tile, z) {
  const { Location } = core();
  return new Location(tile.x, tile.y, z ?? tile.z ?? 0);
}

function tileOf(entity) {
  const at = entity.getLocation();
  return { x: at.getX(), y: at.getY(), z: at.getZ() };
}

function inBox(location, box) {
  const x = location.getX();
  const y = location.getY();
  if (box.z !== undefined && location.getZ() !== box.z) return false;
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function inArena(location) {
  return inBox(location, ARENA) || inBox(location, DEEP_ARENA);
}

function isDeep(tile) {
  const x = tile.getX ? tile.getX() : tile.x;
  return x >= DEEP_ARENA.minX;
}

/** A tile in delve 1's frame, wherever it is. */
function frame(tile) {
  const x = tile.getX ? tile.getX() : tile.x;
  const y = tile.getY ? tile.getY() : tile.y;
  return isDeep(tile) ? { x: x - DEEP.dx, y: y - DEEP.dy, z: 0 } : { x, y, z: 0 };
}

/** A delve-1 tile moved into the deeper square when `deep`. */
function shift(tile, deep) {
  return deep ? { x: tile.x + DEEP.dx, y: tile.y + DEEP.dy, z: tile.z ?? 0 } : { ...tile, z: tile.z ?? 0 };
}

function cycle() {
  return core().World.getProcessCycle();
}

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function later(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(0, ticks), key, ticks <= 0);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  TaskManager.submit(task);
  return task;
}

function repeat(key, ticks, action) {
  const { Task, TaskManager } = core();
  const task = new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), key, false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })();
  TaskManager.submit(task);
  return task;
}

function statement(player, text) {
  const { DialogueChainBuilder, StatementDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    new EndDialogue(1),
  ));
}

/** A chatbox choice: options("Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** Capture: the fade overlay (174) and its script, out to black or back in. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(FADE_OVERLAY_UID, FADE_GROUP, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/** Fades out, runs `action` two ticks later while the screen is black, then fades back in. */
function fadeMove(player, action) {
  fade(player, true);
  later(player, 2, () => {
    action();
    fade(player, false);
  });
}

/** A graphic with an explicit delay (client cycles) and height; Graphic's own overloads guess. */
function gfx(id, { delay = 0, height = 0 } = {}) {
  const { Graphic } = core();
  return Object.assign(new Graphic(id), { delay, height });
}

function graphicAt(player, id, tile, options = {}) {
  player.getPacketSender().sendGraphic(gfx(id, options), tile.getX ? tile : loc(tile));
}

/**
 * A projectile as the capture logs it: `delay` and `end` in client cycles from now, heights
 * as the client sees them (the wire carries them x4). Returns the landing tick.
 */
function projectile(area, from, to, id, { delay = 0, end = 30, startHeight = 0, endHeight = 0, angle = 0, progress = 0 } = {}) {
  const { Projectile } = core();
  const start = from.getLocation ? Projectile.centreOf(from) : (from.getX ? from : loc(from));
  const target = to.getLocation ? Projectile.centreOf(to) : (to.getX ? to : loc(to));
  const lockon = to.getLocation ? to : null;
  // Capture: every Doom projectile has its arc set (0 and 0 unless noted: orbs, rock launches).
  new Projectile(start, target, lockon, id, delay, end, Math.round(startHeight / 4), Math.round(endHeight / 4), area)
    .withAngle(angle)
    .withProgress(progress)
    .sendProjectile();
  return Math.ceil(end / 30);
}

/**
 * Capture: the Doom's sounds. Orbs: a launch sound (delay 55) and, when it isn't prayed against,
 * an impact sound; area sounds for a rock splitting (range 10) and each piece landing (range 1,
 * delayed as its impact), acid flying (range 10) and a larva dying (range 7); burrowing, a
 * rumble (5 loops), rocks falling (delay 45) and landing (delay 160).
 * Guess: the red orb's impact sound, 7025, between the magic and ranged ones.
 */
const SOUND = {
  ORB_LAUNCH: { ranged: 10341, magic: 10375, melee: 10367 },
  ORB_IMPACT: { ranged: 7026, magic: 7023, melee: 7025 },
  ORB_LAUNCH_DELAY: 55,
  ROCK_SPLIT: 10331, ROCK_PIECE: 10297, ACID: 10345, LARVA_DEATH: 163,
  BURROW_RUMBLE: 10303, BURROW_ROCKS_FALL: 10301, BURROW_ROCKS_LAND: 10372,
};

/** A sound for the player alone; `delay` in client cycles. */
function sound(player, id, { delay = 0, loops = 1 } = {}) {
  player?.getPacketSender?.().sendSoundEffect?.(id, loops, delay, 255);
}

/** A sound heard around a tile, `range` tiles out. */
function areaSound(player, id, tile, { delay = 0, range = 10, loops = 1 } = {}) {
  player?.getPacketSender?.().sendAreaSound?.(id, tile.x, tile.y, tile.z ?? 0, loops, delay, range);
}

/**
 * Capture: the Special Beam. Anim 12411 and five projectiles from the Doom's centre to the player
 * (a head, three middle segments, an end; heights 100, flat), then the next tick graphic 3413 on
 * the player (height 50) and the hit.
 */
const BEAM = {
  anim: 12411, impact: 3413, impactHeight: 50, height: 100,
  segments: [[3409, 0, 25], [3410, 1, 26], [3410, 1, 27], [3410, 1, 28], [3411, 2, 29]],
};

function fireBeam(run, damage) {
  const { Animation } = core();
  const { boss, player } = run;
  boss.performAnimation(new Animation(BEAM.anim));
  for (const [id, delay, end] of BEAM.segments) {
    projectile(run.area, boss, player, id, { delay, end, startHeight: BEAM.height, endHeight: BEAM.height });
  }
  run.attacks.after(1, () => {
    player.performGraphic(gfx(BEAM.impact, { height: BEAM.impactHeight }));
    run.hurt(damage);
  });
}

/** Typeless damage, queued for the next hit processing. */
/** Typeless damage, queued for the next hit processing; `splat` picks the cache hitsplat. */
function damage(target, amount, mask = "RED", splat = null) {
  const { HitDamage, HitMask } = core();
  if (!target || amount <= 0 || target.getHitpoints() <= 0) return;
  const hit = new HitDamage(Math.trunc(amount), HitMask[mask]);
  if (splat != null) hit.setSplatTypes(splat, splat);
  target.getCombat().getHitQueue().addPendingDamage([hit]);
}

/**
 * Capture: the hitsplats the Doom shows besides ordinary damage - healing (6), and the bonus
 * damage of a melee punish, a larva bursting on it, or on its shield (17).
 */
const SPLAT = { HEAL: 6, BONUS: 17 };

/**
 * Capture: the charge bar over the Doom (headbar 81, 100 wide) fills over the charge - 390
 * cycles for the melee charge, 510 for the shield, 600 burrowed - and empties when it ends.
 */
const CHARGE_BAR = { id: 81, width: 100 };

function chargeBar(npc, cycles) {
  npc?.showHeadbar?.(CHARGE_BAR.id, { fill: 0, endFill: CHARGE_BAR.width, duration: cycles });
}

function emptyChargeBar(npc) {
  npc?.showHeadbar?.(CHARGE_BAR.id, { fill: 0, endFill: 0, duration: 1 });
}

/**
 * Capture: while the Doom charges its beam (the melee charge and the shield), each tick it plays
 * the charge loop (12409) with graphic 3412 in spotanim slot 2.
 */
const CHARGE_LOOP = { anim: 12409, gfx: 3412, slot: 2 };

/** The charge loop's graphic, taken back on a tick a hit cancels the charge (hits come after it). */
function withdrawChargeGraphic(npc, slot = CHARGE_LOOP.slot) {
  npc?.withdrawGraphicInSlot?.(slot);
}

function chargeLoop(npc) {
  const { Animation } = core();
  npc.performAnimation(new Animation(CHARGE_LOOP.anim));
  const graphic = gfx(CHARGE_LOOP.gfx);
  if (npc.performGraphicInSlot) npc.performGraphicInSlot(CHARGE_LOOP.slot, graphic);
  else npc.performGraphic(graphic);
}

function isProtected(player, style) {
  const { PrayerHandler } = core();
  const prayer = style === "magic" ? PrayerHandler.PROTECT_FROM_MAGIC
    : style === "ranged" ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MELEE;
  return PrayerHandler.isActivated(player, prayer);
}

/** Chebyshev distance from a tile to an actor's footprint (0 when on it). */
function distanceTo(actor, tile) {
  const at = actor.getLocation();
  const size = actor.getSize?.() ?? 1;
  const x = tile.getX ? tile.getX() : tile.x;
  const y = tile.getY ? tile.getY() : tile.y;
  const dx = x < at.getX() ? at.getX() - x : x > at.getX() + size - 1 ? x - (at.getX() + size - 1) : 0;
  const dy = y < at.getY() ? at.getY() - y : y > at.getY() + size - 1 ? y - (at.getY() + size - 1) : 0;
  return Math.max(dx, dy);
}

function floorFree(area, tile) {
  const { RegionManager } = core();
  const location = tile.getX ? tile : loc(tile);
  return (RegionManager.getClipping(location.getX(), location.getY(), location.getZ(), area) & 0x1280100) === 0;
}

function onFloor(at) {
  const tile = frame(at);
  return tile.x >= FLOOR.minX && tile.x <= FLOOR.maxX && tile.y >= FLOOR.minY && tile.y <= FLOOR.maxY;
}

module.exports = {
  bind, core, api,
  TILES, ARENA, DEEP, DEEP_ARENA, FLOOR, RUINS, NPC, OBJECT, VARP, VARBIT, FINAL_DAWN_COMPLETE, INTERFACE, HUD_UID,
  loc, tileOf, inBox, inArena, isDeep, frame, shift, cycle, random, randomOf, later, repeat, statement, options, fade, fadeMove,
  gfx, graphicAt, projectile, damage, isProtected, distanceTo, floorFree, onFloor,
  SPLAT, CHARGE_BAR, chargeBar, emptyChargeBar, CHARGE_LOOP, chargeLoop, withdrawChargeGraphic,
  SOUND, sound, areaSound, BEAM, fireBeam,
};
