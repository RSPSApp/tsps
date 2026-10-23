"use strict";

/**
 * The Fractured Archive (Raids 4): ids, tiles and the small helpers every unit uses.
 *
 * Wiki: https://oldschool.runescape.wiki/w/The_Fractured_Archive
 * docs/fractured-archive.md says where each value comes from (rsprox captures, the Wiki, guesses).
 *
 * Ids are looked up by their cache gameval names, the names rsprox prints, the first time they
 * are needed. The client scripts' names are not in the cache (rsprox shows `script10094`), so
 * those stay numbers. Rooms stay at their real cache coordinates; each raid gets one
 * PrivateArea over them, as the other raids do.
 */

const state = { api: null, core: null, ids: null };

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

/** The gameval names this raid uses, by kind. Resolved through the cache by `ids()`. */
const NAMES = {
  npc: {
    GUARDIAN_START: "tfa_guardian_start",
    GUARDIAN: "tfa_guardian",
    GUARDIAN_UNSHIELDED: "tfa_guardian_unshielded",
    GUARDIAN_DEAD: "tfa_guardian_dead",
    BATTERY_INACTIVE: "tfa_guardian_battery_inactive",
    BATTERY_ACTIVE: "tfa_guardian_battery_active",
    BATTERY_DESTROYED: "tfa_guardian_battery_destroyed",
    TENTACLE: "archive_guardian_tentacle",
    GATHERING_SPRITE: "tfa_gathering_sprite",
    NAVIGATOR: "tfa_room_navigator",
    RECORD_KEEPER: "tfa_record_keeper",
    WIZARD_APPRENTICE: "tfa_wizard_apprentice",
    BUILDERS: ["alliance_builder_1", "alliance_builder_2", "alliance_builder_3", "alliance_builder_4"],
    IVY_CUTSCENE: "tfa_ivy_sophista_cutscene",
    ARMACUS_CUTSCENE: "armacus_selles_cutscene",
    EVA_CUTSCENE: "eva_cashien_cutscene",
  },
  loc: {
    CHASM_ENTRY: "luc2_raid_entry_multi",
    LOBBY_EXIT: "tfa_lobby_raid_exit",
    RAID_DOOR: "tfa_lobby_raid_entry",
    GROUPING_BOARD: "tfa_grouping_board",
    RECORDS: "tfa_out_of_raid_scoreboard",
    BANK_CHEST: "tfa_lobby_bankchest_open",
    ROCK_ACTIVE: ["tfa_gathering_rock_active01", "tfa_gathering_rock_active02", "tfa_gathering_rock_active03"],
    ROCK_INACTIVE: ["tfa_gathering_rock_inactive01", "tfa_gathering_rock_inactive02", "tfa_gathering_rock_inactive03"],
    EXIT: "tfa_exit_large",
    SECTION_DOOR: "tfa_nexus_section_door_closed",
    OCELLUS_DOOR: "tfa_nexus_ocellus_door_closed",
    OCELLUS_DOOR_OPEN: "tfa_nexus_ocellus_door_open",
    MUSHROOM_SPAWN: "tfa_guardian_mushroom_spawn",
    MUSHROOM_ACTIVE: "tfa_guardian_mushroom_active",
    MUSHROOM_DESPAWN: "tfa_guardian_mushroom_despawn",
  },
  obj: {
    ASCENSION_SHARDS: "ascension_shards",
  },
  seq: {
    LONGCRAWL: "human_longcrawl",
    BOW: "emote_bow",
    LAUGH: "emote_laugh",
    ROCK_RAISE: ["crystal_ascension01_raise", "crystal_ascension02_raise", "crystal_ascension03_raise"],
    ROCK_LOWER: ["crystal_ascension01_lower", "crystal_ascension02_lower", "crystal_ascension03_lower"],
    SPRITE_EXPLODE: "tfa_gathering_sprite_explode",
    BUILD_FLOOR: "human_poh_build_floor",
    GUARDIAN_SPAWN: "npc_archive_guardian_spawn01",
    GUARDIAN_IDLE: "npc_archive_guardian_idle01",
    GUARDIAN_RANGED: "npc_archive_guardian_range_attack01",
    GUARDIAN_MELEE: "npc_archive_guardian_melee_attack01",
    GUARDIAN_SPECIAL: "npc_archive_guardian_special_attack01",
    GUARDIAN_SWOOSH: "npc_archive_guardian_swoosh_attack01",
    GUARDIAN_ENRAGED: "npc_archive_guardian_enraged_phase01",
    GUARDIAN_LAND: "npc_archive_guardian_idle_to_ground01",
    GUARDIAN_TAKE_OFF: "npc_archive_guardian_ground_to_flying01",
    GUARDIAN_DEATH: "npc_archive_guardian_death01",
    TENTACLE_SPAWN: "npc_guardian_archive_tentacle_spawn01",
    TENTACLE_ATTACK: "npc_guardian_archive_tentacle_attack01",
    TENTACLE_DESPAWN: "npc_guardian_archive_tentacle_despawn01",
    BATTERY_DESPAWN: "guthixian_battery_despawn",
    MUSHROOM_IDLE: "nightmare_infection_spotanim_idle",
  },
  spotanim: {
    GUARDIAN_IDLE: "vfx_guardian_spawn_idle_spotanim01",
    GUARDIAN_SPAWN: "vfx_guardian_spawn_spotanim01",
    RANGED_CAST: "vfx_guardian_ranged_spotanim01",
    RANGED_PROJECTILE: "vfx_guardian_ranged_projanim01",
    RANGED_HIT: "vfx_guardian_ranged_hitanim01",
    SPECIAL: "vfx_guardian_special_attack_spotanim01",
    ENRAGED: "vfx_guardian_enraged_phase_spotanim01",
    LAND: "vfx_guardian_idletoground_spotanim01",
    TAKE_OFF: "vfx_guardian_groundtoidle_spotanim01",
    LANDING_BLAST: "tfa_arena_sword_drop_explosion_instant",
    TENTACLE_INTRO: "vfx_guardian_tentacle_intro_spotanim01",
    DEATH: "vfx_ocellus_null",
  },
  varbit: {
    SHORTCUT: "wgs_tfa_shortcut_unlocked",
    MINIQUEST: "tfa_miniquest",
    FRIENDS_FILTER: "tfa_lobby_friends_filter",
    PARTY_STATUS: "tfa_client_partystatus",
    PARTY_SLOT: "tfa_client_partyslot",
    SLOTS: ["tfa_client_p0", "tfa_client_p1", "tfa_client_p2", "tfa_client_p3", "tfa_client_p4", "tfa_client_p5", "tfa_client_p6", "tfa_client_p7"],
    SPECTATE_MODE: "tfa_client_spectate_mode",
    SPECTATE_SLOT: "tfa_spectate_slot",
    CUTSCENE_STATUS: "cutscene_status",
    MINIMAP_STATE: "minimap_state",
  },
  varp: {
    CONTROLLER: "tfa_mycontroller",
    GATHERING_COORD: "tfa_gathering_coord_temp",
    SHOW_EXTRA_BAR: "hpbar_hud_show_extra_bar",
  },
  iface: {
    HUD: "tfa_hud",
    LOBBY: "tfa_lobby",
    PARTY_DETAILS: "tfa_partydetails",
    PARTY_LIST: "tfa_partylist",
    SPECTATE_INVENTORY: "tfa_spectate_hud_inv",
    CHESTS: "tfa_chests",
    STATS: "tfa_stats",
    FADE: "fade_overlay",
    INVENTORY: "inventory",
    COMBAT: "combat_interface",
  },
  component: {
    LOBBY_NAMES: "tfa_lobby:names",
    HUD_NAMES: "tfa_hud:content_names",
    LIST_CONTENTS: "tfa_partylist:contents",
    LIST_ROWS: "tfa_partylist:list",
    DETAILS_BUTTONS: "tfa_partydetails:pausebuttons",
    SPECTATE_ITEMS: "tfa_spectate_hud_inv:items",
    CHEST_BANK_ALL: "tfa_chests:bank",
    CHEST_TAKE_ALL: "tfa_chests:inventory",
    CHEST_DISCARD_ALL: "tfa_chests:discard",
    CHEST_ITEMS: "tfa_chests:items",
    OVERLAY_HUD: "toplevel_osrs_stretch:overlay_hud",
    OVERLAY_ATMOSPHERE: "toplevel_osrs_stretch:overlay_atmosphere",
    SIDE_INVENTORY: "toplevel_osrs_stretch:side3",
    SIDE_COMBAT: "toplevel_osrs_stretch:side0",
  },
};

/** Client scripts, by number (the cache does not name them). */
const SCRIPT = {
  /** The party list's rows: (row, "8 names|size|preferred size|?|mode|?"). */
  PARTY_ROW: 10094,
  /** Party details: a member's line (rights, "name|combat|levels...|0|0"). */
  PARTY_MEMBER: 10053,
  /** Party details: an applicant's line ("name|combat|levels...|0|0"). */
  PARTY_APPLICANT: 10058,
  /** Party details: the footer and settings. */
  PARTY_FOOTER: 10060,
  /** The raid HUD's eight names. */
  HUD_NAMES: 10042,
  /** The raid HUD's timer: (ticks, 1 while the challenge has not started). */
  HUD_TIMER: 10036,
  /** Run as the raid's map loads (no arguments). */
  RAID_ENTER: 10013,
  /** fade_overlay's fade: (from colour, from transparency, to colour, to transparency, cycles). */
  FADE: 948,
  /** The sprite's shards flying to the inventory. */
  SPRITE_SHARDS: 7192,
};

/** The captured synth sounds, by number (rsprox names none of them). */
const SOUND = {
  CRAWL: 2454,
  ROCK_SHIFT: 2661,
  SHARD: 3600,
  SPRITE_APPEAR: 10391,
  SPRITE_SHATTER: 10467,
  MUSHROOM_POP: 12175,
  TENTACLE: 12218,
  BATTERY_EXPLODE: 12184,
};

/** Music tracks (midi ids) and their unlock-list entries, as captured. */
const MUSIC = {
  INTO_THE_ARCHIVE: 891,
  IN_RAID: 147,
  ARCHIVE_GUARDIAN: 887,
  FAILED_JINGLE: 90,
};

/** The lobby (region 16470) and the Archive's first map square (region 16471, Nexus and Guardian). */
const LOBBY = { minX: 4096, maxX: 4159, minY: 5504, maxY: 5567, z: 0 };
/**
 * The Archive's map squares (64x64), as the captures' instances copy them: the Nexus (the
 * Guardian on level 0, the hub on level 2), each boss's room, Ocellus (level 1) and the vault
 * (level 2). One raid's PrivateArea covers them all, every plane.
 */
const ARCHIVE_SQUARES = [[64, 87], [65, 87], [63, 86], [65, 88], [65, 86], [64, 88], [64, 90]];
const ARCHIVE_PLANES = [0, 1, 2, 3];
const ARCHIVE_BOXES = ARCHIVE_SQUARES.map(([mx, my]) => ({ minX: mx * 64, maxX: mx * 64 + 63, minY: my * 64, maxY: my * 64 + 63 }));
/** The Chasm of Tears map square, where the shortcut is. */
const CHASM = { minX: 4032, maxX: 4095, minY: 4544, maxY: 4607 };

const TILE = {
  /** Where crawling in from the Chasm puts you (captured). */
  LOBBY_ARRIVAL: { x: 4127, y: 5508, z: 0 },
  /** The first visit's cutscene: where it starts and where it leaves you (captured). */
  INTRO_START: { x: 4131, y: 5540, z: 0 },
  INTRO_END: { x: 4135, y: 5548, z: 0 },
  /** Inside the Archive, at its south entrance (captured). */
  RAID_ARRIVAL: { x: 4127, y: 5571, z: 0 },
  /** Where the dead watch from (captured: the room's south-west corner). */
  SPECTATE: { x: 4097, y: 5569, z: 0 },
  /** Outside spectators leaving (captured ~4117,5547, beside the Strategy board). */
  SPECTATOR_LEAVE: { x: 4117, y: 5546, z: 0 },
  /** Back in the lobby after a wipe, in front of the Archive Door (captured). */
  WIPE_RETURN: { x: 4130, y: 5560, z: 0 },
  /** Leaving the raid by its exit, abandoning it (captured). */
  LEAVE: { x: 4128, y: 5559, z: 0 },
  /** The Chasm of Tears' side of the shortcut, east of the cavity where players crawl in (estimate). */
  CHASM_EXIT: { x: 4053, y: 4568, z: 0 },
};

/** Up to eight players (Wiki); the HUD and the party screens have eight slots. */
const MAX_PARTY_SIZE = 8;
const MAX_APPLICANTS = 8;
/** The party list's rows (977:14 is set up for 0-44). */
const LIST_ROWS = 45;

/** HUD slot values (tfa_client_p0-7), as ToB's: 1-27 health, 30 dead, 31 elsewhere. */
const SLOT = { EMPTY: 0, DEAD: 30, AWAY: 31, HEALTH_MAX: 27 };

function ids() {
  if (state.ids) return state.ids;
  const { CacheDefinitions } = core();
  const resolve = (kind, lookup) => {
    const out = {};
    for (const [key, value] of Object.entries(NAMES[kind])) {
      out[key] = Array.isArray(value) ? value.map((name) => lookup(name)) : lookup(value);
    }
    return out;
  };
  const strict = (fn, kind) => (name) => {
    const id = fn(name);
    if (id === null || id === undefined) throw new Error(`[FracturedArchive] no ${kind} named ${name} in the cache`);
    return id;
  };
  state.ids = {
    npc: resolve("npc", strict((n) => CacheDefinitions.getNpcId(n), "npc")),
    loc: resolve("loc", strict((n) => CacheDefinitions.getLocId(n), "loc")),
    obj: resolve("obj", strict((n) => CacheDefinitions.getObjId(n), "obj")),
    seq: resolve("seq", strict((n) => CacheDefinitions.getSeqId(n), "seq")),
    spotanim: resolve("spotanim", strict((n) => CacheDefinitions.getSpotanimId(n), "spotanim")),
    varbit: resolve("varbit", strict((n) => CacheDefinitions.getVarbitId(n), "varbit")),
    varp: resolve("varp", strict((n) => CacheDefinitions.getVarpId(n), "varp")),
    iface: resolve("iface", strict((n) => CacheDefinitions.getInterfaceId(n), "interface")),
    component: resolve("component", strict((n) => CacheDefinitions.getComponentId(n), "component")),
  };
  return state.ids;
}

/** An id by kind and key: `id("npc", "GUARDIAN")`. */
function id(kind, key) {
  return ids()[kind][key];
}

const LOOKUPS = {
  npc: "getNpcId", loc: "getLocId", obj: "getObjId", seq: "getSeqId", spotanim: "getSpotanimId",
  varbit: "getVarbitId", varp: "getVarpId", dbrow: "getDbRowId",
};
const namedCache = new Map();

/**
 * Any id by its cache gameval name, looked up once: `named("seq", "npc_bork_death01")`. The
 * boss units name what they use this way instead of carrying numbers.
 */
function named(kind, name) {
  const key = `${kind}:${name}`;
  let found = namedCache.get(key);
  if (found === undefined) {
    found = core().CacheDefinitions[LOOKUPS[kind]](name);
    if (found === null || found === undefined) throw new Error(`[FracturedArchive] no ${kind} named ${name} in the cache`);
    namedCache.set(key, found);
  }
  return found;
}

/** An Animation by its sequence's gameval name. */
function anim(name) {
  return new (core().Animation)(named("seq", name));
}

/** A Graphic by its spotanim's gameval name (`gfx` options: delay, height). */
function spot(name, options) {
  return gfx(named("spotanim", name), options);
}

function loc(tile, z) {
  const { Location } = core();
  return new Location(tile.x, tile.y, z ?? tile.z ?? 0);
}

function tileOf(entity) {
  const location = entity.getLocation();
  return { x: location.getX(), y: location.getY(), z: location.getZ() };
}

function inBox(location, box, planes) {
  const x = location.getX();
  const y = location.getY();
  if (box.z !== undefined && location.getZ() !== box.z) return false;
  if (planes && !planes.includes(location.getZ())) return false;
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function inLobby(location) {
  return inBox(location, LOBBY);
}

function inArchive(location) {
  return ARCHIVE_BOXES.some((box) => inBox(location, box, ARCHIVE_PLANES));
}

function cycle() {
  return core().World.getProcessCycle();
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

function cancel(key) {
  core().TaskManager.cancelTasks(key);
}

/** A messagebox (229) with "Click here to continue", then `next` if given. */
function mesbox(player, text, next) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, text),
    next ? new ActionDialogue(1, { execute: next }) : new EndDialogue(1),
  ));
}

/** A chatbox choice: options(player, "Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

/** fade_overlay (174) on overlay_atmosphere: to black (`out`) or back, over 50 client cycles. */
function fade(player, out) {
  const sender = player.getPacketSender();
  sender.sendString("", (id("iface", "FADE") << 16) | 4);
  sender.sendSubInterface(id("component", "OVERLAY_ATMOSPHERE"), id("iface", "FADE"), 1, {
    postScripts: [{ scriptId: SCRIPT.FADE, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
  });
}

function closeFade(player) {
  player.getPacketSender().closeSubInterface(id("component", "OVERLAY_ATMOSPHERE"));
}

function displayName(player) {
  return player.getUsername();
}

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomOf(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function gfx(graphicId, { delay = 0, height = 0 } = {}) {
  const { Graphic } = core();
  return Object.assign(new Graphic(graphicId), { delay, height });
}

/** Whether a viewer sees a tile: 15 tiles, or as far as they see NPCs (a spectator sees the room). */
function sees(viewer, location) {
  return location.isViewableFromWithin?.(viewer.getLocation(), Math.max(15, viewer.getNpcViewDistance?.() ?? 15)) !== false;
}

/** A graphic on a tile, for everyone in `area` who can see it. */
function graphicAt(area, graphicId, tile, options = {}) {
  const location = tile.getX ? tile : loc(tile);
  for (const viewer of area.getPlayers()) {
    if (!sees(viewer, location)) continue;
    viewer.getPacketSender().sendGraphic(gfx(graphicId, options), location);
  }
}

function sound(player, soundId, delay = 0) {
  player.getPacketSender().sendSound(soundId, 1, delay);
}

/** A sound from an actor (or tile) for everyone in `area` who can see it. */
function areaSound(area, source, soundId, delay = 0) {
  const at = source.getLocation ? source.getLocation() : (source.getX ? source : loc(source));
  for (const viewer of area.getPlayers()) {
    if (!sees(viewer, at)) continue;
    sound(viewer, soundId, delay);
  }
}

/**
 * Typeless damage now, with its hitsplat this tick: queued damage waits for the target's next
 * turn, a tick late when a room's tick runs after it (an impact that must land as it shows).
 */
function damageNow(target, amount, mask = "RED") {
  const { HitDamage, HitMask } = core();
  if (!target || amount <= 0 || target.getHitpoints() <= 0) return;
  target.addTickHit(target.decrementHealth(new HitDamage(Math.trunc(amount), HitMask[mask])));
}

/** Typeless damage, queued for the next hit processing. */
function damage(target, amount, mask = "RED") {
  const { HitDamage, HitMask } = core();
  if (!target || amount <= 0 || target.getHitpoints() <= 0) return;
  // A player takes it now: the rooms' ticks run after the player's turn, where queued damage
  // would wait a tick, so an attack would land a tick after its graphic. An NPC keeps the
  // queue, whose death handling the rooms' phase changes hang off.
  if (target.isPlayer?.()) {
    damageNow(target, amount, mask);
    return;
  }
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.trunc(amount), HitMask[mask])]);
}

/**
 * A projectile between actors or tiles, seen inside `area`, with every value as rsprox prints
 * map_projanim_v2: it leaves after `delay` client cycles and lands at `end`, and its heights are
 * four times the packet's (so they are divided here). Fired from an actor, that actor is the
 * packet's source, as live sends it, so the client starts it from the model. Returns the
 * flight in game ticks.
 */
function projectile(area, from, to, projectileId, { delay = 0, end = 60, startHeight = 0, endHeight = 0, angle = 16, progress = 0 } = {}) {
  const { Projectile } = core();
  const start = from.getLocation ? Projectile.centreOf(from) : (from.getX ? from : loc(from));
  const target = to.getLocation ? Projectile.centreOf(to) : (to.getX ? to : loc(to));
  const lockon = to.getLocation ? to : null;
  const shot = new Projectile(start, target, lockon, projectileId, delay, end, Math.round(startHeight / 4), Math.round(endHeight / 4), area)
    .withAngle(angle)
    .withProgress(progress);
  if (from.getLocation) shot.withSource(from);
  shot.sendProjectile();
  return Math.ceil(end / 30);
}

/**
 * A player's forced move to a tile over `cycles` client cycles with an animation (a roll, a push),
 * as OSRS's exact move; their walk and combat stop. They face the way they move, or `facing`
 * (0 north, 1 east, 2 south, 3 west) to keep facing elsewhere (a step back).
 */
function forceMove(player, tile, cycles, animationId = -1, facing = null) {
  const { ForceMovement, ForceMovementTask, TaskManager, Location } = core();
  // One still running (a roll chained straight after another) ends where it was going first.
  const running = player.__tfaForceMove;
  if (running && player.getForceMovement?.() === running.movement) {
    running.task.stop();
    player.moveTo(running.end);
  }
  player.__tfaForceMove = null;
  const start = player.getLocation().clone();
  const dx = tile.x - start.getX();
  const dy = tile.y - start.getY();
  if (dx === 0 && dy === 0) return;
  const direction = facing ?? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 0 : 2));
  const movement = new ForceMovement(start, new Location(dx, dy, 0), 0, cycles, direction, animationId);
  // A tick more than the glide: started from a click (between ticks), a one-tick task would end
  // it in the next tick's task phase, before the flush, and only the teleport would be sent.
  const task = new ForceMovementTask(player, Math.max(1, Math.ceil(cycles / 30)) + 1, movement);
  player.__tfaForceMove = { task, movement, end: new Location(tile.x, tile.y, start.getZ()) };
  TaskManager.submit(task);
}

/** Where a player stands for a hit: a forced move's landing while one is under way, else their tile. */
function standingOn(player) {
  const moving = player.__tfaForceMove;
  if (moving && player.getForceMovement?.() === moving.movement) return { x: moving.end.getX(), y: moving.end.getY(), z: moving.end.getZ() };
  return tileOf(player);
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
  return !RegionManager.blocked(location, area);
}

function isProtected(player, style) {
  const { PrayerHandler } = core();
  const prayer = style === "magic" ? PrayerHandler.PROTECT_FROM_MAGIC
    : style === "ranged" ? PrayerHandler.PROTECT_FROM_MISSILES : PrayerHandler.PROTECT_FROM_MELEE;
  return PrayerHandler.isActivated(player, prayer);
}

/** if_triggeroplocal arguments: ints as zigzag varints (as Omnishop reads them). */
function triggerInts(argsData) {
  const ints = [];
  let value = 0;
  let shift = 0;
  for (const byte of argsData ?? []) {
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) !== 0) continue;
    ints.push((value >>> 1) ^ -(value & 1));
    value = 0;
    shift = 0;
  }
  return ints;
}

/** Whether the player has finished While Guthix Sleeps, which the raid needs (Wiki). */
function questComplete(player) {
  const request = { player, key: "while_guthix_sleeps", complete: false };
  api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** A persisted counter on the player, kept in an attribute (records, miniquest stage). */
function attr(player, key, fallback = 0) {
  return player.getAttribute(key) ?? fallback;
}

module.exports = {
  bind, core, api, ids, id, named, anim, spot, NAMES, SCRIPT, SOUND, MUSIC,
  LOBBY, ARCHIVE_SQUARES, ARCHIVE_BOXES, ARCHIVE_PLANES, CHASM, TILE, MAX_PARTY_SIZE, MAX_APPLICANTS, LIST_ROWS, SLOT,
  loc, tileOf, inBox, inLobby, inArchive, cycle, later, repeat, cancel, mesbox, options, fade, closeFade,
  displayName, random, randomOf, shuffle, gfx, graphicAt, sound, areaSound, damage, projectile,
  distanceTo, floorFree, forceMove, standingOn, damageNow, isProtected, triggerInts, questComplete, attr,
};
