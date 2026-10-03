"use strict";

/**
 * Tombs of Amascut: shared constants, room/path tables and small helpers every ToA unit uses.
 *
 * Rooms sit at their real cache coordinates. Each raid party gets one PrivateArea covering
 * the whole tombs region, so parties never see each other's NPCs, objects or floor items
 * (the same isolation TzHaar Fight Cave uses), instead of a copied dynamic region.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Tombs_of_Amascut
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

// The Jaltevas pyramid lobby beneath Necropolis, and the street outside it.
const LOBBY = { minX: 3340, maxX: 3377, minY: 9100, maxY: 9132, z: 0 };
const LOBBY_RETURN = { x: 3358, y: 9113, z: 0 };
const LOBBY_ENTRANCE = { x: 3359, y: 9128, z: 0 };
const NECROPOLIS_EXIT = { x: 3357, y: 2713, z: 0 };
const OBELISK_TILE = { x: 3358, y: 9119, z: 0 };

// Every ToA room lies in this block of the map (chunks 440-495 x 640-679).
const TOMBS_REGION = { minX: 3520, maxX: 3967, minY: 5120, maxY: 5439 };
const TOMBS_PLANES = [0, 1, 2, 3];

const MAX_PARTY_SIZE = 8;
const MAX_LOBBY_PARTIES = 45;

// Raid level -> mode name (wiki: Entry 0-149, Normal 150-299, Expert 300+).
function modeName(raidLevel) {
  if (raidLevel >= 300) return "Expert";
  if (raidLevel >= 150) return "Normal";
  return "Entry";
}

/** Cache varps/varbits the ToA interfaces read. */
const VARBIT = {
  PARTY_STATUS: 14345,
  HUD_PLAYER_BASE: 14346,
  HUD_PLAYER_ME: 14354,
  HUD_PLAYER_SIGHT_BASE: 14362,
  HUD_PATH_LEVEL_BASE: 14376,
  HUD_RAID_LEVEL: 14380,
  HUD_PATH: 14381,
  FRIENDS_ONLY: 14318,
  PRESET_SELECT: 14541,
  REWARD_CHEST_PURPLE: 14373,
};
const VARP = {
  CURRENT_PARTY: 3603,
  PRESET_BASE: 3680,
};

/** Interface groups (RuneLite InterfaceID: TOA_*). */
const INTERFACE = {
  LOOT: 771,
  PARTY_OVERVIEW: 772,
  PARTY_OVERLAY: 773,
  PARTY_MANAGEMENT: 774,
  INVOCATION_INFO: 776,
  SUPPLIES_SHOP: 777,
  SUPPLIES_BAG: 778,
  RAID_HUD: 481,
  REWARD_POTENTIAL: 289,
};

/** Clientscripts the ToA interfaces use to populate their lists. */
const SCRIPT = {
  PARTY_LIST_ROW: 6601,
  PARTY_MEMBER_ROW: 6722,
  PARTY_APPLICANT_ROW: 6727,
  PARTY_MANAGEMENT_INIT: 6729,
  HUD_PLAYER_NAMES: 6585,
  HUD_TIMER: 6580,
  TEXT_POPUP: 4212,
  CAMERA_RESET: 626,
  FADE: 948,
};

const OVERLAY_HUD_UID = (161 << 16) | 8;
const MAIN_MODAL_UID = (161 << 16) | 16;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY_GROUP = 174;
const FADE_CYCLES = 15;

/** Interface event masks (if_setevents). */
const EVENT = {
  CONTINUE: 1 << 0,
  OP1: 1 << 1,
  OP2: 1 << 2,
  OP3: 1 << 3,
  OP4: 1 << 4,
  OP9: 1 << 9,
  DRAG: 1 << 17,
  DRAG_TARGET: 1 << 20,
};

const JINGLE = {
  PUZZLE_DONE: 295,
  OSMUMTEN: 296,
  FAILURE: 90,
};

const SOUND = {
  INVOCATION_ON: 6589,
  INVOCATION_OFF: 6588,
  CONFIRM: 2655,
  DECLINE: 2277,
  CLEAR: 2381,
  TELEPORT: 198,
};

const GRAPHIC = { TELEPORT: 409 };

/**
 * The rooms, in the order the entries lead through them. `spawn` is where a player arrives
 * (randomised by up to `spread`), `challenge` where the teleport crystal and a completed room
 * put them, and `bounds` the fight/puzzle floor that counts as "in the challenge".
 */
const ROOMS = {
  MAIN_HALL: {
    key: "MAIN_HALL", name: "Beneath Cursed Sands",
    spawn: { x: 3550, y: 5161, z: 0 }, spread: { x: 2, y: 0 },
  },
  CRONDIS_PUZZLE: {
    key: "CRONDIS_PUZZLE", name: "Test of Resourcefulness", path: "CRONDIS", puzzle: true,
    spawn: { x: 3954, y: 5279, z: 0 }, spread: { x: 0, y: 2 },
    challenge: { x: 3943, y: 5280, z: 0 },
    bounds: { minX: 3923, minY: 5250, maxX: 3949, maxY: 5311, z: 0 },
    next: "CRONDIS_BOSS",
  },
  CRONDIS_BOSS: {
    key: "CRONDIS_BOSS", name: "Jaws of Gluttony", path: "CRONDIS", boss: "Zebak",
    spawn: { x: 3958, y: 5407, z: 0 }, spread: { x: 0, y: 2 },
    challenge: { x: 3941, y: 5408, z: 0 },
    bounds: { minX: 3904, minY: 5387, maxX: 3962, maxY: 5429, z: 0 },
    // The entrance corridor east of the arena is not part of the fight.
    excluded: [
      { minX: 3957, minY: 5404, maxX: 3960, maxY: 5414 },
      { minX: 3952, minY: 5406, maxX: 3957, maxY: 5410 },
    ],
    osmumten: { x: 3928, y: 5408, z: 0 },
  },
  SCABARAS_PUZZLE: {
    key: "SCABARAS_PUZZLE", name: "Test of Isolation", path: "SCABARAS", puzzle: true,
    spawn: { x: 3522, y: 5279, z: 0 }, spread: { x: 0, y: 2 },
    challenge: { x: 3575, y: 5280, z: 0 },
    bounds: { minX: 3533, minY: 5268, maxX: 3574, maxY: 5292, z: 0 },
    next: "SCABARAS_BOSS",
  },
  SCABARAS_BOSS: {
    key: "SCABARAS_BOSS", name: "A Mother's Curse", path: "SCABARAS", boss: "Kephri",
    spawn: { x: 3535, y: 5408, z: 0 }, spread: { x: 0, y: 2 },
    challenge: { x: 3544, y: 5408, z: 0 },
    bounds: { minX: 3543, minY: 5400, maxX: 3559, maxY: 5416, z: 0 },
    osmumten: { x: 3558, y: 5408, z: 0 },
  },
  HET_PUZZLE: {
    key: "HET_PUZZLE", name: "Test of Strength", path: "HET", puzzle: true,
    spawn: { x: 3698, y: 5279, z: 0 }, spread: { x: 0, y: 2 },
    challenge: { x: 3667, y: 5280, z: 0 },
    bounds: { minX: 3670, minY: 5267, maxX: 3690, maxY: 5293, z: 0 },
    next: "HET_BOSS",
  },
  HET_BOSS: {
    key: "HET_BOSS", name: "Sands of Time", path: "HET", boss: "Akkha",
    spawn: { x: 3698, y: 5406, z: 1 }, spread: { x: 0, y: 2 },
    challenge: { x: 3689, y: 5408, z: 1 },
    bounds: { minX: 3670, minY: 5395, maxX: 3691, maxY: 5419, z: 1 },
    osmumten: { x: 3673, y: 5407, z: 1 },
  },
  APMEKEN_PUZZLE: {
    key: "APMEKEN_PUZZLE", name: "Test of Companionship", path: "APMEKEN", puzzle: true,
    spawn: { x: 3792, y: 5279, z: 0 }, spread: { x: 0, y: 2 },
    challenge: { x: 3814, y: 5280, z: 0 },
    bounds: { minX: 3797, minY: 5267, maxX: 3819, maxY: 5293, z: 0 },
    next: "APMEKEN_BOSS",
  },
  APMEKEN_BOSS: {
    key: "APMEKEN_BOSS", name: "Ape-ex Predator", path: "APMEKEN", boss: "Ba-Ba",
    spawn: { x: 3790, y: 5407, z: 0 }, spread: { x: 0, y: 2 },
    challenge: { x: 3800, y: 5408, z: 0 },
    bounds: { minX: 3796, minY: 5399, maxX: 3823, maxY: 5418, z: 0 },
    osmumten: { x: 3817, y: 5408, z: 0 },
  },
  WARDENS_P1: {
    key: "WARDENS_P1", name: "Amascut's Promise", boss: "The Wardens", wardens: true,
    spawn: { x: 3807, y: 5176, z: 1 }, spread: { x: 2, y: 0 },
    challenge: { x: 3808, y: 5166, z: 1 },
    bounds: { minX: 3792, minY: 5137, maxX: 3825, maxY: 5171, z: 1 },
    next: "WARDENS_P3",
  },
  WARDENS_P3: {
    key: "WARDENS_P3", name: "Amascut's Promise", boss: "The Wardens", wardens: true,
    spawn: { x: 3935, y: 5168, z: 1 }, spread: { x: 2, y: 0 },
    challenge: { x: 3936, y: 5157, z: 1 },
    bounds: { minX: 3924, minY: 5151, maxX: 3947, maxY: 5166, z: 1 },
    next: "REWARD",
  },
  REWARD: {
    key: "REWARD", name: "Laid to Rest",
    spawn: { x: 3680, y: 5170, z: 0 }, spread: { x: 0, y: 0 },
    challenge: { x: 3680, y: 5170, z: 0 },
  },
};

/**
 * The four paths off the Nexus, in the HUD's order (path varbit = index + 1). `entrance` is
 * the doorway object in the Nexus, and `back` the westmost of the `spread` + 1 tiles you land
 * on returning from that path; they must clear the doorway's footprint.
 */
const PATHS = [
  // Apmeken's doorway (3x2, turned) covers x 3562-3563, so the return tiles lie west of it.
  { key: "APMEKEN", name: "Apmeken", first: "APMEKEN_PUZZLE", entrance: { x: 3562, y: 5146 }, back: { x: 3559, y: 5146 }, spread: 2 },
  { key: "SCABARAS", name: "Scabaras", first: "SCABARAS_PUZZLE", entrance: { x: 3559, y: 5155 }, back: { x: 3558, y: 5154 }, spread: 0 },
  { key: "HET", name: "Het", first: "HET_PUZZLE", entrance: { x: 3539, y: 5146 }, back: { x: 3541, y: 5146 }, spread: 2 },
  { key: "CRONDIS", name: "Crondis", first: "CRONDIS_PUZZLE", entrance: { x: 3541, y: 5155 }, back: { x: 3544, y: 5154 }, spread: 0 },
];
const PATH_BY_KEY = Object.fromEntries(PATHS.map((path, index) => [path.key, { ...path, index }]));
const WARDENS_ENTRANCE = { x: 3548, y: 5134 };

function loc(tile, z) {
  const { Location } = core();
  return new Location(tile.x, tile.y, z ?? tile.z ?? 0);
}

function inBox(location, box) {
  const x = location.getX();
  const y = location.getY();
  if (box.z !== undefined && location.getZ() !== box.z) return false;
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

function inTombs(location) {
  return inBox(location, TOMBS_REGION);
}

function inLobby(location) {
  return inBox(location, LOBBY);
}

function random(min, max) {
  return core().Misc.randomInclusive(min, max);
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

function spread(tile, offsets) {
  return loc({ x: tile.x + random(0, offsets?.x ?? 0), y: tile.y + random(0, offsets?.y ?? 0), z: tile.z });
}

function cycle() {
  return core().World.getProcessCycle();
}

/** Runs `action` once after `ticks` game ticks, keyed to `key` so it can be cancelled with it. */
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

/** Runs `action` every `ticks` ticks until it returns false, keyed to `key`. */
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

function npcSay(player, npcId, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, text),
    new EndDialogue(1),
  ));
}

/** A chatbox choice: options("Title?", "Yes.", onYes, "No.", onNo). */
function options(player, title, ...pairs) {
  const args = [];
  for (let i = 0; i < pairs.length; i += 2) args.push(pairs[i], pairs[i + 1] ?? (() => {}));
  api().sendMultiChatboxPrompt(player, title, ...args);
}

function confirm(player, title, onYes) {
  options(player, title, "Yes.", onYes, "No.", () => {});
}

/** Fades the screen out (or back in) with interface 174 and its fade script. */
function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY_GROUP, 1, {
    postScripts: [{ scriptId: SCRIPT.FADE, args }],
  });
}

/** Fades out, runs `action` while the screen is black, then fades back in. */
function fadeMove(player, action) {
  fade(player, true);
  later(player, 2, () => {
    action();
    fade(player, false);
  });
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSound(id, 1, delay);
}

function jingle(player, id) {
  player.getPacketSender().sendJingle(id, 0);
}

/** A graphic with an explicit delay (client cycles) and height; Graphic's own overloads guess. */
function gfx(id, { delay = 0, height = 0 } = {}) {
  const { Graphic } = core();
  const graphic = new Graphic(id);
  graphic.delay = delay;
  graphic.height = height;
  return graphic;
}

function graphicAt(viewer, id, location, { delay = 0, height = 0 } = {}) {
  viewer.getPacketSender().sendGlobalGraphic(gfx(id, { delay, height }), location);
}

function damage(target, amount) {
  const { HitDamage, HitMask } = core();
  if (!target || amount <= 0 || target.getHitpoints() <= 0) return;
  target.getCombat().getHitQueue().addPendingDamage([new HitDamage(Math.trunc(amount), HitMask.RED)]);
}

function formatTicks(ticks) {
  if (ticks < 0) return "0:00";
  const seconds = Math.floor((ticks * 600) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const secs = seconds % 60;
  const minutePart = hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : String(minutes);
  return `${minutePart}:${String(secs).padStart(2, "0")}`;
}

function displayName(player) {
  return player.getUsername();
}

/** Whether a tile is walkable for this raid (its own objects included). */
function floorFree(area, tile) {
  const { RegionManager } = core();
  const location = tile.getX ? tile : loc(tile);
  return !RegionManager.blocked(location, area);
}

/**
 * Moves an NPC a straight line to `tile` whatever the map blocks there, as Near-Reality's
 * collision-free walk steps (Zebak's waves and jugs, Akkha's unstable orbs, Ba-Ba's boulders,
 * the moving Wardens). The route finder found no way over those tiles, so they stood still.
 */
function walkStraight(npc, tile) {
  const location = tile.getX ? tile : loc(tile);
  npc.setFlag("movement:ignore-clipping");
  const movement = npc.getMovementQueue();
  movement.setBlockMovement?.(false);
  movement.reset();
  movement.addSteps(location);
}

/**
 * A projectile between two tiles (or from/to an actor), seen only inside `area`. It leaves
 * after `delay` client cycles and lands `duration` + `perTile` x distance cycles later.
 * Returns the landing time in game ticks, for lining damage up with it.
 */
function tileProjectile(area, from, to, id, { delay = 0, duration = 30, perTile = 5, startHeight = 43, endHeight = 0 } = {}) {
  const { Projectile } = core();
  const start = from.getLocation ? Projectile.centreOf(from) : (from.getX ? from : loc(from));
  const end = to.getLocation ? Projectile.centreOf(to) : (to.getX ? to : loc(to));
  const lockon = to.getLocation ? to : null;
  const speed = delay + duration + start.getDistance(end) * perTile;
  new Projectile(start, end, lockon, id, delay, speed, startHeight, endHeight, area).sendProjectile();
  return Math.ceil(speed / 30);
}

/** Throws a player `dx`,`dy` tiles over a few client cycles. */
function knockback(player, dx, dy, { ticks = 2, speed = 30, direction = 0, animation = -1 } = {}) {
  const { ForceMovement, ForceMovementTask, Location, TaskManager } = core();
  if (dx === 0 && dy === 0) return;
  TaskManager.submit(new ForceMovementTask(player, ticks,
    new ForceMovement(player.getLocation().clone(), new Location(dx, dy), 0, speed, direction, animation)));
}

/**
 * Hooks every option of the objects with these names. The handler gets the event with
 * `option` set to the clicked option's label and returns false to let others handle it.
 * ToA's barriers, entries and exits share their names and differ only by where they stand,
 * so handlers check the player's raid or position rather than one exact option label.
 */
function onObject(pluginApi, names, handler) {
  const wanted = new Set([].concat(names));
  pluginApi.onObjectInteraction((event) => {
    if (event.handled || !Number.isInteger(event.clickType)) return;
    const definition = event.definition;
    if (!wanted.has(definition?.getName?.())) return;
    event.option = definition.getInteractions?.()?.[event.clickType - 1] ?? "";
    if (handler(event) !== false) event.handled = true;
  });
}

/**
 * Stops the player's attack and clears its delay, so the next target can be hit at once.
 * Near-Reality does this for the Wardens' energy siphons and the Scabaras obelisks. Call it as
 * the attack goes out (onPlayerDealtDamage), after its delay was set; the hit still lands.
 */
function skipAttackDelay(player, target = null) {
  const combat = player.getCombat();
  combat.reset();
  combat.setAttackDelay(0);
  // Stopping the attack also stops facing; keep facing what was just struck.
  if (target) player.setPositionToFace(target.getLocation());
}

function isProtected(player, style) {
  const { PrayerHandler } = core();
  const prayer = style === "magic" ? PrayerHandler.PROTECT_FROM_MAGIC
    : style === "ranged" ? PrayerHandler.PROTECT_FROM_MISSILES
      : PrayerHandler.PROTECT_FROM_MELEE;
  return PrayerHandler.isActivated(player, prayer);
}

module.exports = {
  walkStraight,
  skipAttackDelay,
  bind,
  core,
  api,
  LOBBY,
  LOBBY_RETURN,
  LOBBY_ENTRANCE,
  NECROPOLIS_EXIT,
  OBELISK_TILE,
  TOMBS_REGION,
  TOMBS_PLANES,
  MAX_PARTY_SIZE,
  MAX_LOBBY_PARTIES,
  modeName,
  VARBIT,
  VARP,
  INTERFACE,
  SCRIPT,
  OVERLAY_HUD_UID,
  MAIN_MODAL_UID,
  EVENT,
  JINGLE,
  SOUND,
  GRAPHIC,
  ROOMS,
  PATHS,
  PATH_BY_KEY,
  WARDENS_ENTRANCE,
  loc,
  inBox,
  inTombs,
  inLobby,
  random,
  randomOf,
  shuffle,
  spread,
  cycle,
  later,
  repeat,
  statement,
  npcSay,
  options,
  confirm,
  fade,
  fadeMove,
  sound,
  jingle,
  gfx,
  graphicAt,
  damage,
  formatTicks,
  displayName,
  isProtected,
  onObject,
  floorFree,
  tileProjectile,
  knockback,
};
