/**
 * The Hueycoatl's ids, tiles and helpers, shared by every unit. Ids are the rev 241 cache's
 * (gameval names beside them); tiles are the world map's, as captured, and a private fight
 * maps them into its instance with session.tile (docs/hueycoatl.md).
 */
const DATA = require("../data/hueycoatl.json");

/** NPCs (gamevals huey_*). */
const NPC = Object.freeze({
  TAALA: 13996, // huey_lobby_leader
  ARENA_SEER: 14008, // huey_seer
  HEAD: 14009, // huey_head
  HEAD_SHIELDED: 14011, // huey_head_invulnerable
  HEAD_DEFEATED: 14012, // huey_head_defeated
  TAIL: 14014, // huey_tail
  TAIL_BROKEN: 14015, // huey_tail_broken
  BODY: 14017, // huey_body_part
  RUBBLE: 14018, // huey_body_part_broken
  VICTORY_WORKER_1: 14005, // huey_victory_worker_1
  VICTORY_WORKER_2: 14006, // huey_victory_worker_2
});

/** Locs. */
const LOC = Object.freeze({
  CHAIN: 55401, // huey_fight_entrance (multiloc on huey_in_area: Peek outside only)
  SLOPE: 55234, // huey_fight_exit_shortcut
  FLAG: 55203, // huey_holding_instance_creator
  FLAG_PRIVATE: 55204, // huey_holding_instance_creator_instanced
  ROCKSLIDE_PRIVATE: 55205, // huey_holding_entrance_instanced
  SCOREBOARD: 55198, // huey_scoreboard
  BARRIER: 55206, // huey_p2_barrier
  BARRIER_RETRACTED: 55207, // huey_p2_barrier_retracted
  BARRIER_RESPAWN: 55208, // huey_p2_barrier_respawn
  SYMBOL: 55209, // huey_attack_tiles_loc
  CAVE: 55242, // df_cave_snow01_entrance03
  CAVE_BODY: 55243, // df_cave_snow01_entrance03_huey
  CAVE_RESPAWN: 55244, // df_cave_snow01_entrance03_huey_respawn
  CAVE_DIAG: 55245, // df_cave_snow01_entrance03_diag
  CAVE_DIAG_BODY: 55246, // df_cave_snow01_entrance03_diag_huey
  CAVE_DIAG_RESPAWN: 55247, // df_cave_snow01_entrance03_diag_huey_respawn
});

/** The pillars west of the head: engraving (empty, s1-s5) and brazier locs per prayer. */
const PILLARS = Object.freeze([
  { kind: "magic", tile: [1504, 3287], stages: [55212, 55213, 55214, 55215, 55216, 55217], off: 55211, on: 55210 },
  { kind: "missiles", tile: [1505, 3289], stages: [55220, 55221, 55222, 55223, 55224, 55225], off: 55219, on: 55218 },
  { kind: "melee", tile: [1507, 3290], stages: [55228, 55229, 55230, 55231, 55232, 55233], off: 55227, on: 55226 },
]);
const PILLAR_ENGRAVING_SHAPE = 6;
const PILLAR_BRAZIER_SHAPE = 11;
const PILLAR_BRAZIER_ROTATION = 3;
const PILLAR_STAGES = 5;

/** Sequences. */
const SEQ = Object.freeze({
  HEAD_ATTACK: { melee: 11669, missiles: 11670, magic: 11671 }, // huey_attack_*
  HEAD_SHIELD_ATTACK: { melee: 11673, missiles: 11674, magic: 11675 }, // huey_shield_attack_*
  SHIELD_ACTIVATION: 11676,
  SCREECH: 11677,
  SCREECH_RESET: 11678,
  KNOCKOUT: 11679,
  AWAKEN: 11681,
  AWAKEN_RESET: 11682,
  BODY_DEATH: 11687, // huey_body_death (on the cave loc)
  BODY_DEATH_DIAG: 11688,
  BARRIER_TRANSITION: 11700,
  BARRIER_DAMAGE: 11706,
  TAIL_APPEAR: 11720,
  TAIL_DISAPPEAR: 11721,
  TAIL_BREAK: 11723,
  SEER_ORB: 11698, // npc_dwarf_summon_orb
  SEER_ORB_END: 11699,
  SEER_LIGHT: 8321, // human_sun_prayer
  KNOCKDOWN: 7211, // human_knockdown_loop
  GETUP: 534, // human_getup
  SLIDE: 11589, // human_knockdown_loop_nodelay
});

/** Spotanims. */
const GFX = Object.freeze({
  CHARGE: { melee: 2968, missiles: 2971, magic: 2974 }, // vfx_huey_attack_*_spotanim_01
  FEATHER: { melee: 2969, missiles: 2972, magic: 2975 }, // *_projanim_01
  IMPACT: { melee: 2970, missiles: 2973, magic: 2976 }, // *_impactanim_01
  SYMBOL: 3001, // vfx_hueycoatl_prayer_02
  LOOT_BEAM: 3002,
  /** The wave's direction spotanim (2977-2984) -> the impact it lands with (2993-3000). */
  SHOCKWAVE_IMPACT: { 2977: 2993, 2978: 2994, 2979: 2995, 2980: 2996, 2981: 2997, 2982: 2998, 2983: 2999, 2984: 3000 },
});

/** Sounds, as captured (rsprox: launch on the feather, impact on the hit). */
const SOUND = Object.freeze({
  FEATHER_LAUNCH: { melee: 9652, missiles: 9671, magic: 9607 },
  FEATHER_IMPACT: { melee: 9655, missiles: 9608, magic: 9642 },
  LIGHTNING: 9612,
  SLAM: [9568, 9573],
  BODY_DEATH: 9664,
  TAIL_BREAK: 9678,
  SLIDE: 7572,
  LAND: 2485,
});

const VARBIT = Object.freeze({
  IN_AREA: 11362, // huey_in_area: the chain shows Peek outside only
  ENCOUNTERED: 11363, // huey_encountered
  INTRO: 11413, // huey_intro: Taala has explained the fight
  MINIMAP_STATE: 6719,
});

const MUSIC = Object.freeze({ FIGHT: 801, CAMP: 813 }); // The Feathered Serpent, Whispering Wind

const MESSAGE = Object.freeze({
  PATH: "<col=a53fff>The Hueycoatl shifts, opening a path up the mountain.</col>",
  SHIELD: "<col=a53fff>The Hueycoatl shields itself!</col>",
  UNSHIELD: "<col=a53fff>The Hueycoatl's shield falls!</col>",
  AWAKEN: "<col=a53fff>The Hueycoatl begins to awaken...</col>",
  FEWER_REWARDS: "<col=ff3045>As you didn't damage the Hueycoatl's body enough, you will receive fewer rewards.</col>",
  SLIDE: "You slide down the slope...",
  LAND: "... and land skillfully.",
});

/** Hitpoints and damage (Wiki). */
const HEAD_HITPOINTS = 2500;
const BODY_HITPOINTS = 250;
const TAIL_HITPOINTS = 300;
const TOTAL_HITPOINTS = 5 * BODY_HITPOINTS + HEAD_HITPOINTS + TAIL_HITPOINTS;
const SHIELD_AT = HEAD_HITPOINTS / 2;
const RAIN_FIRE_MAX = 14;
const RAIN_FIRE_PRAYED_MAX = 2;
const LIGHTNING_MAX = 16;
const SHOCKWAVE_MIN = 20;
const SHOCKWAVE_MAX = 25;
const TAIL_CAP = 4;
const TAIL_CAP_CRUSH = 9;
const BRAZIER_BONUS = 1.3;

/** The fight's spawn tiles, as captured (unanimous across recordings). */
const HEAD_TILE = [1509, 3290];
const SEER_TILE = [1530, 3284];
const SEER_BODY_POST = [1527, 3276];
const SEER_GATE_POST = [1518, 3271];
const SEER_PILLAR_POST = [1506, 3288];
/** Each body segment with the cave it lies in (loc tile, rotation, diagonal art). */
const SEGMENTS = Object.freeze([
  { tile: [1530, 3276], cave: [1530, 3275], rotation: 1, diag: false },
  { tile: [1524, 3277], cave: [1523, 3276], rotation: 3, diag: false },
  { tile: [1527, 3273], cave: [1527, 3271], rotation: 1, diag: true },
  { tile: [1520, 3273], cave: [1519, 3273], rotation: 0, diag: false },
  { tile: [1524, 3270], cave: [1523, 3269], rotation: 2, diag: false },
]);
const BARRIER_TILE = [1515, 3268];
const SCENERY_SHAPE = 10;

/** The tail's two sides (it rises east, then shows west first) and its slams. */
const TAIL_EAST = DATA.shockwaves.east.tail;
const TAIL_WEST = DATA.shockwaves.west.tail;
const SHOCKWAVES = Object.freeze({ east: DATA.shockwaves.east.tiles, west: DATA.shockwaves.west.tiles });
/**
 * The tail never turns (turn speed 0), so it is held at its side's angle: facing west out of the
 * east cave, east out of the west one (npc face_angle, instant, recordings 4052 and 4054).
 */
const TAIL_FACE = Object.freeze({ east: 512, west: 1536 });
/** Sunk, the tail is drawn as nothing: every model of its form replaced by -1 (recording 4052). */
const TAIL_HIDDEN_MODELS = Object.freeze({ [NPC.TAIL]: [-1], [NPC.TAIL_BROKEN]: [-1, -1, -1] });

const SYMBOLS = DATA.symbols;
const LOBBY_SPAWNS = DATA.lobby.spawns;

/** Where the chain lands (captured 1528/1529, 3284) and the slope's foot. */
const ARENA_ENTRY = [1528, 3284];
const SLOPE_TOP = [1520, 3290];
const CAMP_LANDING = [1524, 3290];
/** A private fight is entered by the meeting flag, as captured. */
const PRIVATE_LANDING = [1524, 3294];
/** Summit players are knocked back here when she recovers (captured). */
const KNOCKBACK_TILE = [1530, 3283];
/** Loot lands on a tile in front of the head (captured x 1510-1514, y 3287-3289). */
const LOOT_TILES = Object.freeze({ minX: 1510, maxX: 1514, minY: 3287, maxY: 3289 });

/** The arena beyond the chain: the mountainside and summit, west and south of the camp. */
const ARENA_BOUNDS = Object.freeze([
  { minX: 1496, maxX: 1520, minY: 3262, maxY: 3299 },
  { minX: 1521, maxX: 1535, minY: 3262, maxY: 3284 },
]);
/** The summit (beyond the barrier, by the pillars and the head). */
const SUMMIT_BOUNDS = Object.freeze({ minX: 1500, maxX: 1518, minY: 3279, maxY: 3290 });
/** The mountainside, where the body lies. */
const MOUNTAINSIDE_BOUNDS = Object.freeze({ minX: 1518, maxX: 1531, minY: 3268, maxY: 3280 });
/** A private fight copies the camp and the arena: chunks 187-192 x 408-412 (x 1496-1543, y 3264-3303). */
const INSTANCE_SOURCE_CHUNK = Object.freeze({ x: 187, y: 408 });
const INSTANCE_CHUNKS = Object.freeze({ width: 6, height: 5 });

/** Required protection prayers per pillar by team size (Wiki). */
function prayersPerPillar(teamSize) {
  if (teamSize >= 18) return 6;
  if (teamSize >= 15) return 5;
  if (teamSize >= 12) return 4;
  if (teamSize >= 9) return 3;
  if (teamSize >= 6) return 2;
  return 1;
}

const SESSION_ATTRIBUTE = "hueycoatl:session";
const KILLS_ATTRIBUTE = "hueycoatl:kills";
const BEST_TICKS_ATTRIBUTE = "hueycoatl:best-ticks";
const DEATHS_ATTRIBUTE = "hueycoatl:deaths";
const STREAK_ATTRIBUTE = "hueycoatl:perfect-streak";
const INSIDE_PRIVATE_ATTRIBUTE = "hueycoatl:inside-private";

const MONSTER = "Hueycoatl, The";

let core = null;
/** Every live fight: the public one and each private instance. */
const sessions = new Set();

function init(pluginApi) {
  core = pluginApi.core;
}

/** Runs `action` `ticks` ticks from now (at least one). */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function alive(entity) {
  return !!entity?.isRegistered() && entity.getHitpoints() > 0;
}

function within(bounds, x, y) {
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Minutes, seconds and hundredths, as the fight-duration message shows them. */
function formatTicks(ticks) {
  const centis = Math.round(ticks * 60);
  const minutes = Math.floor(centis / 6000);
  const seconds = Math.floor((centis % 6000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

/** A saved counter's value: 0 until it is first set (a player new this session has none). */
function counter(player, key) {
  return Number(player.getAttribute(key)) || 0;
}

function sessionOfNpc(npc) {
  return npc?.getAttribute(SESSION_ATTRIBUTE) ?? null;
}

/** The fight a player is part of (in its arena or its instance's camp). */
function sessionOfPlayer(player) {
  for (const session of sessions) {
    if (session.members.has(player)) return session;
  }
  return null;
}

function isFighter(id) {
  return id === NPC.HEAD || id === NPC.HEAD_SHIELDED || id === NPC.TAIL || id === NPC.BODY;
}

module.exports = {
  NPC, LOC, PILLARS, PILLAR_ENGRAVING_SHAPE, PILLAR_BRAZIER_SHAPE, PILLAR_BRAZIER_ROTATION, PILLAR_STAGES,
  SEQ, GFX, SOUND, VARBIT, MUSIC, MESSAGE,
  HEAD_HITPOINTS, BODY_HITPOINTS, TAIL_HITPOINTS, TOTAL_HITPOINTS, SHIELD_AT,
  RAIN_FIRE_MAX, RAIN_FIRE_PRAYED_MAX, LIGHTNING_MAX, SHOCKWAVE_MIN, SHOCKWAVE_MAX,
  TAIL_CAP, TAIL_CAP_CRUSH, BRAZIER_BONUS,
  HEAD_TILE, SEER_TILE, SEER_BODY_POST, SEER_GATE_POST, SEER_PILLAR_POST, SEGMENTS, BARRIER_TILE, SCENERY_SHAPE,
  TAIL_EAST, TAIL_WEST, TAIL_FACE, TAIL_HIDDEN_MODELS, SHOCKWAVES, SYMBOLS, LOBBY_SPAWNS,
  ARENA_ENTRY, SLOPE_TOP, CAMP_LANDING, PRIVATE_LANDING, KNOCKBACK_TILE, LOOT_TILES,
  ARENA_BOUNDS, SUMMIT_BOUNDS, MOUNTAINSIDE_BOUNDS, INSTANCE_SOURCE_CHUNK, INSTANCE_CHUNKS,
  SESSION_ATTRIBUTE, KILLS_ATTRIBUTE, BEST_TICKS_ATTRIBUTE, DEATHS_ATTRIBUTE, STREAK_ATTRIBUTE,
  INSIDE_PRIVATE_ATTRIBUTE, MONSTER,
  sessions, init, later, alive, within, randomBetween, pick, formatTicks, prayersPerPillar,
  counter, sessionOfNpc, sessionOfPlayer, isFighter,
};
