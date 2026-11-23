const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ObjectIdentifiers: Objects } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");
const { NpcIdentifiers: Npcs } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { ItemIdentifiers: Items } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");

const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
/** A door's crossing is a walk through its doorway (236/03929): clipping is ignored for that step. */
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
/**
 * The crossing's tick swaps each leaf for an invisible wall and puts the open (inactive) leaf on the
 * wall's outer tile, with two sounds; two ticks later the leaves are back (234/03276, 227/1000436
 * ticks 10236-10241 and 10243-10245, 236/03929 ticks 378-380). The player is not held.
 */
const DOOR_OPEN_TICKS = 2;
const DOOR_OPEN_SOUNDS = [62, 41];
const DOOR_INVISWALL = "inviswall";
const DOOR_INACTIVE = { l: "barrows_door_inactive_l", r: "barrows_door_inactive_r" };
/** The chest-room door's puzzle (236/03929 ticks 415 and 417): a solve opens it, another click crosses. */
const PUZZLE_LOCKED = "The door is locked with a strange puzzle.";
const PUZZLE_SOLVED = "You hear the doors' locking mechanism grind open.";
/**
 * A brother gives up once the player is more than this many tiles (either axis) from where he rose:
 * his face resets, then he goes the tick after (227/00086 ticks 12498-12500 and 12507-12509,
 * 227/1000433 ticks 17109-17111).
 */
const BROTHER_LEASH = 8;
/** "We'll finish this later..." (227/1000565 tick 2832, 227/1000444 tick 33710, 227/1000265 tick 5994). */
const BROTHER_FAREWELL = "We'll finish this later...";
/** The line follows a move into the tunnels or another crypt by three ticks (1000565 ticks 2829-2832). */
const FAREWELL_MOVE_TICKS = 3;
/** ... and a leash despawn by one (1000433 ticks 17111-17112). */
const FAREWELL_LEASH_TICKS = 1;
/** The brothers chase their target through the tunnels; the leash above is theirs, not the open-world one. */
const NO_RETREAT_FLAG = "combat:no-retreat";
const KEEP_TARGET_FLAG = "combat:keep-target";
const { MagicCombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/impl/MagicCombatMethod");
const { CombatSpells } = require("../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { MOBILE_CLIENT_ATTRIBUTE } = require("../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
const { decodeRegionObjects, initRegionBuildingAnalysisCoreAccess } = require("../world/procedural/RegionBuildingAnalysisUtil.ProceduralRegionStream");
const CameraShake = require("../interface/CameraShake.plugin");

const REGION_ID = 14231;
const ATTRIBUTE = "barrows";
const DIG_ANIMATION = new Animation(830);
const OVERLAY_ID = 24;
// The face needs the full-screen atmosphere slot, not the smaller HUD slot (226/01694).
const OVERLAY_HUD_UID = (161 << 16) | 1;
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
const REWARDS_ID = 155;
const REWARDS_INVENTORY = 141;
/** The reward window is a main modal: toplevel_mainmodal_open, then barrows_reward in mainmodal, items Examine-able. */
const MAIN_MODAL_UID = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
const REWARDS_ITEMS_UID = (REWARDS_ID << 16) | 3;
const REWARDS_ITEM_SLOTS = 11;
const OP10 = 1 << 10;
/** Opening the chest's lid, and closing it. */
const CHEST_OPEN_SOUND = 54;
const CHEST_CLOSE_SOUND = 53;
/** Looting plays this jingle over the area's track. */
const LOOT_JINGLE = 77;
const PUZZLE_ID = 25;
const PUZZLE_BUTTONS = [12, 14, 16];
const PUZZLE_SEQUENCE_MODELS = [3, 5, 7];
const PUZZLE_OPTION_MODELS = [13, 15, 17];
const GAMEFRAME_OVERLAY_UID = (161 << 16) | 92;
const CLOSE_INTERFACE_ATTRIBUTE = "interface:close-on-interface-close";
const POTENTIAL_VARBIT = 463;
const KILL_COUNT_VARBIT = 464;
const CHEST_OPEN_VARBIT = 1394;
/**
 * The tunnels shake (slot, random amplitude) from the looting until the player leaves them. Nothing
 * else follows the loot: no damage, and the doors stay as they were (37 loots in 227/01885,
 * 227/1000444, 237/04057, 226/01694, 227/1000436 and 234/03276; one player stayed 135 ticks).
 */
const LOOTED_SHAKE = [0, 5, 0, 0];
const LADDER_VISIBLE_VARBIT = 4743;
const PRAYER_DRAIN_TICKS = 30;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_SHOWN = 0;
const MINIMAP_HIDDEN = 2;
const MAP_USED_ATTRIBUTE = "his-faithful-servants:crypt-map-studied";
/**
 * barrows_warning_toggle: the Strange Old Man condenses the tunnel warning into the menu's title
 * (user rsprox captures BarrowsMiniQuest.bin tick 1034, set as his "AAAA" line shows; and
 * StrangeOldLockpickBarrows.bin, 1 at login, the prompt as the title at tick 23). Saved.
 */
const WARNINGS_VARBIT = 12434;
const WARNINGS_ATTRIBUTE = "barrows:warnings-condensed";
const TUNNEL_PROMPT = "You've found a hidden tunnel, do you want to enter?";
// His transcripts' warning branches: the Strange Old Man page's conditions and screams, and the
// His Faithful Servants page's two "If the warnings are ..." directions and its scream.
const WARNINGS_PAGE_SCREAM = { "Strange Old Man": "AAAAAAAAARRRRRRGGGGGHHHHHHHH?", "His Faithful Servants": "AAAAAAAAARRRRRRGGGGGHHHHHHHH!" };
const WARNINGS_NOT_CONDENSED = /^if the (?:barrows catacomb warning is not condensed|warnings are not combined):?$/i;
const WARNINGS_CONDENSED = /^if the (?:barrows catacomb warning is condensed|warnings are combined):?$/i;
/** "Your Strange old lockpick has 48 charges remaining." (user capture StrangeOldLockpickBarrows.bin tick 52). */
const LOCKPICK_CHARGES = 50;
const LOCKPICK_CHARGES_KEY = "barrows:lockpick-charges";
/** A pick on its last charge that has given the Wiki's warning: its next hallway takes that charge. */
const LOCKPICK_WARNED_KEY = "barrows:lockpick-warned";
const LOCKPICKS = new Set([Items.STRANGE_OLD_LOCKPICK, Items.STRANGE_OLD_LOCKPICK_FULL_]);
/** Wiki (Strange old lockpick, Trivia): the last charge's hallway. */
const LOCKPICK_LAST_USE = "The Strange old lockpick almost breaks, but seems in good enough shape for one more use.";
const CORNERS = [0, 2, 6, 8];
// Room numbers run NW to SE through a 3x3 grid. The outside corridors wrap around the corners.
const DOOR_LINKS = [
  [469, 0, 2], [470, 0, 6], [471, 0, 3], [472, 0, 1],
  [473, 1, 4], [474, 1, 2], [475, 2, 5], [476, 2, 8],
  [477, 3, 4], [478, 4, 5], [479, 3, 6], [480, 4, 7],
  [481, 5, 8], [482, 6, 7], [483, 7, 8], [484, 6, 8],
];
const HILTS = new Set([Items.GHOMMALS_HILT_2, Items.GHOMMALS_HILT_3, Items.GHOMMALS_HILT_4, Items.GHOMMALS_HILT_5, Items.GHOMMALS_HILT_6,
  Items.GHOMMALS_AVERNIC_DEFENDER_5, Items.GHOMMALS_AVERNIC_DEFENDER_5_L_, Items.GHOMMALS_AVERNIC_DEFENDER_6, Items.GHOMMALS_AVERNIC_DEFENDER_6_L_]);
// The pairs are the ordinary and alternate face models seen in rsprox captures 1694 and 4057.
// Ours: the 1/4 alternate probability approximates the observed frequency; the exact odds are unknown.
const PRAYER_FACES = [[6737, 29228], [6738, 29225], [6739, 29224], [6740, 29226], [6741, 29227], [6742, 29223]];
const PRAYER_FACE_SCRIPT = 894; // barrows_nodnod: component, model
const PRAYER_FACE_FIRST_COMPONENT = 6;
// These model sequences and options are present in the current cache's model archive.
const PUZZLES = [
  { sequence: [6716, 6717, 6718], options: [6713, 6714, 6715] },
  { sequence: [6722, 6723, 6724], options: [6719, 6720, 6721] },
  { sequence: [6728, 6729, 6730], options: [6725, 6726, 6727] },
  { sequence: [6734, 6735, 6736], options: [6731, 6732, 6733] },
];

const BROTHERS = [
  {
    npcId: Npcs.AHRIM_THE_BLIGHTED, coffin: Objects.SARCOPHAGUS_11, stairs: Objects.STAIRCASE_120,
    mound: new Boundary(3562, 3568, 3285, 3292, 0), surface: new Location(3565, 3288),
    crypt: new Location(3557, 9703, 3), spawn: new Location(3557, 9701, 3), killedVarbit: 457,
  },
  {
    npcId: Npcs.DHAROK_THE_WRETCHED, coffin: Objects.SARCOPHAGUS_8, stairs: Objects.STAIRCASE_121,
    mound: new Boundary(3572, 3578, 3294, 3301, 0), surface: new Location(3574, 3297),
    crypt: new Location(3556, 9718, 3), spawn: new Location(3553, 9716, 3), killedVarbit: 458,
  },
  {
    npcId: Npcs.GUTHAN_THE_INFESTED, coffin: Objects.SARCOPHAGUS_10, stairs: Objects.STAIRCASE_122,
    mound: new Boundary(3574, 3584, 3279, 3285, 0), surface: new Location(3577, 3282),
    crypt: new Location(3534, 9704, 3), spawn: new Location(3540, 9705, 3), killedVarbit: 459,
  },
  {
    npcId: Npcs.KARIL_THE_TAINTED, coffin: Objects.SARCOPHAGUS_12, stairs: Objects.STAIRCASE_123,
    mound: new Boundary(3564, 3568, 3273, 3278, 0), surface: new Location(3566, 3275),
    crypt: new Location(3546, 9684, 3), spawn: new Location(3549, 9685, 3), killedVarbit: 460,
  },
  {
    npcId: Npcs.TORAG_THE_CORRUPTED, coffin: Objects.SARCOPHAGUS_9, stairs: Objects.STAIRCASE_124,
    mound: new Boundary(3550, 3556, 3280, 3284, 0), surface: new Location(3554, 3282),
    crypt: new Location(3568, 9683, 3), spawn: new Location(3568, 9688, 3), killedVarbit: 461,
  },
  {
    npcId: Npcs.VERAC_THE_DEFILED, coffin: Objects.SARCOPHAGUS_13, stairs: Objects.STAIRCASE_125,
    mound: new Boundary(3553, 3560, 3294, 3301, 0), surface: new Location(3557, 3297),
    crypt: new Location(3578, 9706, 3), spawn: new Location(3575, 9708, 3), killedVarbit: 462,
  },
];
const BOUNDS = [
  new Boundary(3545, 3584, 3265, 3306, 0),
  new Boundary(3520, 3583, 9664, 9727, 0),
  new Boundary(3521, 3582, 9662, 9724, 3),
];
const EQUIPMENT = [
  Items.AHRIMS_HOOD, Items.AHRIMS_STAFF, Items.AHRIMS_ROBETOP, Items.AHRIMS_ROBESKIRT,
  Items.DHAROKS_HELM, Items.DHAROKS_GREATAXE, Items.DHAROKS_PLATEBODY, Items.DHAROKS_PLATELEGS,
  Items.GUTHANS_HELM, Items.GUTHANS_WARSPEAR, Items.GUTHANS_PLATEBODY, Items.GUTHANS_CHAINSKIRT,
  Items.KARILS_COIF, Items.KARILS_CROSSBOW, Items.KARILS_LEATHERTOP, Items.KARILS_LEATHERSKIRT,
  Items.TORAGS_HELM, Items.TORAGS_HAMMERS, Items.TORAGS_PLATEBODY, Items.TORAGS_PLATELEGS,
  Items.VERACS_HELM, Items.VERACS_FLAIL, Items.VERACS_BRASSARD, Items.VERACS_PLATESKIRT,
];
const CREATURES = new Set([Npcs.BLOODWORM, Npcs.CRYPT_RAT, Npcs.GIANT_CRYPT_RAT, Npcs.GIANT_CRYPT_RAT_2, Npcs.GIANT_CRYPT_RAT_3, Npcs.CRYPT_SPIDER, Npcs.GIANT_CRYPT_SPIDER,
  Npcs.SKELETON_17, Npcs.SKELETON_18, Npcs.SKELETON_19, Npcs.SKELETON_20]);
const sessions = new WeakMap();
const minimapHidden = new WeakSet();
let World;
let RegionManager;
let TaskManager;
let pluginApi;

/** A spam-channel line (filtered chat), as these are recorded. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(pluginApi.core.ChatType.SPAM, text);
}
let tunnelMap;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function roomLocation(room) {
  return new Location(3534 + room % 3 * 17, 9712 - Math.floor(room / 3) * 17);
}

function roomAt(location) {
  if (location.getZ() !== 0) return -1;
  for (let room = 0; room < 9; room++) {
    if (location.getDistance(roomLocation(room)) <= 7) return room;
  }
  return -1;
}

function inBarrows(player) {
  return BOUNDS.some((boundary) => boundary.inside(player.getLocation()));
}

function inTunnels(player) {
  return BOUNDS[1].inside(player.getLocation());
}

function phaseOf(player) {
  return !inBarrows(player) ? "outside" : inTunnels(player) ? "tunnels" : player.getLocation().getZ() === 3 ? "crypt" : "surface";
}

/**
 * Crypt map 28133 permanently reveals the Barrows minimap. Only touch the
 * minimap when entering/leaving the crypt or after study, and only restore it
 * when this session actually hid it; never overwrite another area's minimap.
 */
function syncMinimap(player, phase) {
  const inside = phase === "crypt" || phase === "tunnels";
  const studied = Number(player.getAttribute(MAP_USED_ATTRIBUTE)) === 1;
  if (inside && !studied) {
    if (minimapHidden.has(player)) return;
    minimapHidden.add(player);
    player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_HIDDEN);
    return;
  }
  if (!minimapHidden.has(player)) return;
  minimapHidden.delete(player);
  player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_SHOWN);
}

function session(player) {
  let value = sessions.get(player);
  if (!value) {
    value = { npcs: new Set(), brother: null, phase: "outside", puzzle: null, dig: null, crossing: null, farewell: 0 };
    sessions.set(player, value);
  }
  return value;
}

function randomiseLayout(run) {
  // Connect all eight outside rooms, then choose exactly one entrance to the chest room.
  const connected = new Set([0]);
  const openDoors = [];
  const outer = DOOR_LINKS.filter(([, a, b]) => a !== 4 && b !== 4);
  while (connected.size < 8) {
    const candidates = outer.filter(([, a, b]) => connected.has(a) !== connected.has(b));
    const [varbit, a, b] = candidates[randomInt(0, candidates.length - 1)];
    openDoors.push(varbit);
    connected.add(a);
    connected.add(b);
  }
  const inner = DOOR_LINKS.filter(([, a, b]) => a === 4 || b === 4);
  run.puzzleDoor = inner[randomInt(0, inner.length - 1)][0];
  run.openDoors = [...openDoors, run.puzzleDoor];
  run.exitRoom = CORNERS[randomInt(0, CORNERS.length - 1)];
  run.puzzleSolved = false;
  // Hallways a strange old lockpick has opened: passable for the rest of this layout, with no
  // door varbit change (StrangeOldLockpickBarrows.bin ticks 56-64: barrows_door_m stays 1).
  run.pickedDoors = [];
}

function freshRun(chests = 0) {
  const run = { tunnel: randomInt(0, 5), killed: [], points: 0, kills: 0, chests,
    chestOpen: false, looted: false, prayerTicks: PRAYER_DRAIN_TICKS,
    // For the Combat Achievements: a brother's damage, a melee brother's attack, any prayer points.
    brotherDamage: false, meleeBrotherAttacked: false, hadPrayer: false };
  randomiseLayout(run);
  return run;
}

function getRun(player) {
  let run = player.getAttribute(ATTRIBUTE);
  if (!run) {
    run = freshRun();
    player.setAttribute(ATTRIBUTE, run);
  }
  return run;
}

function getTunnelMap() {
  if (tunnelMap) return tunnelMap;
  const objects = decodeRegionObjects(REGION_ID).filter((object) => object.z === 0);
  const doors = [];
  const ladders = [];
  let chest;
  for (const object of objects) {
    const definition = CacheDefinitions.getObject(object.id);
    const varbit = definition.transformVarbit;
    if (DOOR_LINKS.some(([id]) => id === varbit)) doors.push({ ...object, varbit });
    if (varbit === LADDER_VISIBLE_VARBIT) ladders.push(object);
    if (varbit === CHEST_OPEN_VARBIT) chest = object;
  }
  if (!chest || ladders.length !== 4 || doors.length !== 64) throw new Error("Barrows: region 14231 is missing its chest, ladders, or doors");
  return tunnelMap = { doors, ladders, chest };
}

function asObject(object) {
  return new GameObject(object.id, new Location(object.x, object.y, object.z), object.type, object.orientation, null);
}

function updateOverlay(player, run) {
  const sender = player.getPacketSender();
  for (let i = 0; i < BROTHERS.length; i++) sender.sendVarbit(BROTHERS[i].killedVarbit, run.killed.includes(i) ? 1 : 0);
  sender.sendVarbit(POTENTIAL_VARBIT, run.points);
  sender.sendVarbit(KILL_COUNT_VARBIT, run.kills);
}

/** The brothers overlay closes as the chest is looted and stays shut until the next run starts. */
function showOverlay(player) {
  if (player.getAttribute(ATTRIBUTE)?.looted) return;
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, OVERLAY_ID, 1);
  updateOverlay(player, getRun(player));
}

function restoreOverlayAfterWelcome({ player }) {
  // WelcomeScreen replaces the gameframe during this click; mount after all its handlers finish.
  queueMicrotask(() => {
    if (inBarrows(player)) showOverlay(player);
  });
  return false;
}

function syncTunnels(player, run) {
  const sender = player.getPacketSender();
  for (const [id] of DOOR_LINKS) sender.sendVarbit(id, run.openDoors.includes(id) ? 0 : 1);
  sender.sendVarbit(CHEST_OPEN_VARBIT, run.chestOpen ? 1 : 0);
  sender.sendVarbit(LADDER_VISIBLE_VARBIT, 1);
  for (const ladder of getTunnelMap().ladders) {
    if (roomAt(new Location(ladder.x, ladder.y)) === run.exitRoom) sender.sendObject(asObject(ladder));
    else sender.sendObjectRemoval(asObject(ladder));
  }
}

function removeNpc(player, npc) {
  const state = session(player);
  state.npcs.delete(npc);
  if (state.brother === npc) {
    state.brother = null;
    player.getPacketSender().sendEntityHintRemoval(false);
  }
  npc.getCombat().reset();
  npc.__skipDefaultRespawn = true;
  const pending = World.getAddNPCQueue();
  const index = pending.indexOf(npc);
  if (index !== -1) pending.splice(index, 1);
  if (npc.isRegistered() && !World.getRemoveNPCQueue().includes(npc)) World.getRemoveNPCQueue().push(npc);
}

function cleanupNpcs(player, keepDying = false) {
  for (const npc of [...session(player).npcs]) {
    if (!keepDying || !npc.isDyingFunction()) removeNpc(player, npc);
  }
}

/** A live brother, not yet dying: one whose removal ends an unfinished fight. */
function liveBrother(state) {
  const npc = state.brother;
  return npc && !npc.isDyingFunction() && npc.getHitpoints() > 0 ? npc : null;
}

/** The brother's "We'll finish this later..." once `ticks` have passed (processPlayer). */
function queueFarewell(state, ticks) {
  state.farewell = ticks;
}

/**
 * A brother takes the player from the crypt monster fighting them: that monster stops facing them
 * the tick he appears, and attacks again once he is dead (20 cases, e.g. 227/01885 ticks 12108-12119,
 * 227/1000265 tick 6463). The tunnels are single-way (multiway_indicator is never set there), so the
 * monster's hold on the player is released for him.
 */
function takeOver(player, brother) {
  for (const npc of session(player).npcs) {
    if (npc === brother || npc.getCombat().getTarget() !== player) continue;
    npc.getCombat().reset();
    player.getCombat().clearAttackerIf(npc);
  }
}

function onNpcAdded() {
  NPC.prototype.onAdd.call(this);
  const player = this.getOwner();
  if (session(player).brother === this) {
    // A brother woken in his crypt says "You dare disturb my rest!", the tunnel's brother rising at the chest
    // "You dare steal from us!" (rsprox_transcripts/227/00086.txt:233215, and 546 times over the recordings);
    // one met at a tunnel door says nothing (226/01694 tick 9139, 227/00086 tick 12490).
    if (this.__barrowsLine) this.forceChat(this.__barrowsLine);
    // His first attack is three ticks after he appears (226/01694 ticks 8804-8807, 227/00550 ticks 27406-27409).
    this.getTimers().extendOrRegister(TimerKey.COMBAT_ATTACK, 3);
    player.getPacketSender().sendEntityHint(this);
    takeOver(player, this);
  }
  this.getCombat().attack(player);
}

function spawnNpc(player, npcId, location, brother = false, line = null) {
  const npc = new NPC(npcId, location.clone());
  npc.setOwner(player);
  npc.__skipDefaultRespawn = true;
  npc.onAdd = onNpcAdded;
  const state = session(player);
  state.npcs.add(npc);
  if (brother) {
    state.brother = npc;
    npc.__barrowsLine = line;
    npc.__barrowsRose = location.clone();
    npc.setFlag(NO_RETREAT_FLAG, true);
    npc.setFlag(KEEP_TARGET_FLAG, true);
  }
  World.getAddNPCQueue().push(npc);
  return npc;
}

function dig({ player }) {
  const location = player.getLocation();
  // Barrows owns only its own mounds: quest digs elsewhere (X Marks the Spot,
  // Making History, Corsair Curse, ...) must fall through to their handlers.
  if (!BOUNDS.some((bounds) => bounds.inside(location))) return false;
  const state = session(player);
  if (state.dig || player.getForceMovement()) return true;
  const brother = BROTHERS.find((entry) => entry.mound.inside(location));
  player.performAnimation(DIG_ANIMATION);
  if (!brother) {
    player.sendMessage("You dig into the ground, but find nothing.");
    return true;
  }
  // A looted run ends as the next crypt is dug into: a new layout, no kills, the chest shut
  // (237/04057: the spade's click resets them, not leaving the tunnels).
  const run = player.getAttribute(ATTRIBUTE);
  if (run?.looted) {
    player.setAttribute(ATTRIBUTE, freshRun(run.chests));
    updateOverlay(player, getRun(player));
    player.getPacketSender().sendVarbit(CHEST_OPEN_VARBIT, 0);
  }
  // Keep the animation on the mound for two ticks before changing planes.
  state.dig = { from: player.getLocation().clone(), to: brother.crypt, ticks: 2 };
  // The line goes with the dig's sequence, the tick before the plane change (rsprox_transcripts/226/01694.txt tick
  // 8800, moved 8801; 237/04057.txt tick 1840, moved 1841): spam.
  spam(player, "You've broken into a crypt!");
  return true;
}

/**
 * A plugin can refuse a brother's mound before the spade's dig starts (`barrows:dig`, `blocked`):
 * His Faithful Servants before the Strange Old Man's talk gives his line, with no dig sequence or
 * sound (user rsprox capture BarrowsMiniQuest.bin tick 16).
 */
function refuseMoundDig(request) {
  const { player, location } = request;
  // Only the mounds' own spade digs them (dig is registered for "Spade").
  if (request.itemId !== Items.SPADE) return;
  const brother = BROTHERS.find((entry) => entry.mound.inside(location));
  if (!brother || session(player).dig) return;
  const mound = { player, brother: brother.npcId, blocked: false };
  pluginApi.emitCustomEvent("barrows:dig", mound);
  if (mound.blocked) request.refused = true;
}

function enterTunnel(player, run, brother) {
  if (getRun(player) !== run || player.getLocation().getZ() !== 3 ||
      player.getLocation().getDistance(brother.crypt) > 10) return;
  const state = session(player);
  // An unfinished crypt fight ends with his line (227/1000565 ticks 2829-2832).
  if (liveBrother(state)) queueFarewell(state, FAREWELL_MOVE_TICKS);
  cleanupNpcs(player, true);
  player.getPacketSender().sendInterfaceRemoval();
  const ladder = getTunnelMap().ladders.find((object) => roomAt(new Location(object.x, object.y)) === run.exitRoom);
  player.moveTo(new Location(ladder.x, ladder.y - 1));
  syncTunnels(player, run);
}

function searchCrypt(player, index) {
  const run = getRun(player);
  const state = session(player);
  const brother = BROTHERS[index];
  if (index === run.tunnel) {
    // rsprox_transcripts/226/01694.txt:169415-169442: a message box (and its mesbox chat line), then on continue the
    // menu "Select an option": "Yeah I'm fearless!" / "No way, that looks scary!". Condensed warnings
    // (WARNINGS_VARBIT) skip the box: the menu itself is titled with the line (StrangeOldLockpickBarrows.bin tick 23).
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = pluginApi.core;
    const menu = (title) => pluginApi.sendMultiChatboxPrompt(player, title,
      "Yeah I'm fearless!", () => enterTunnel(player, run, brother),
      "No way, that looks scary!", () => player.getPacketSender().sendInterfaceRemoval());
    if (warningsCondensed(player)) {
      menu(TUNNEL_PROMPT);
      return;
    }
    player.getDialogueManager().startDialogues(new DialogueChainBuilder()
      .add(new StatementDialogue(0, TUNNEL_PROMPT))
      .add(new ActionDialogue(1, { execute: () => menu("Select an option") })));
  } else if (state.brother || run.killed.includes(index)) {
    player.sendMessage("The sarcophagus appears to be empty.");
  } else {
    // rsprox_transcripts/226/01694.txt:165522 (then the brother's "You dare disturb my rest!" at :165530).
    spam(player, "You don't find anything.");
    spawnNpc(player, brother.npcId, brother.spawn, true, "You dare disturb my rest!");
  }
}

function doorAt(object) {
  const location = object.getLocation();
  return getTunnelMap().doors.find((entry) => entry.x === location.getX() && entry.y === location.getY() &&
    entry.z === location.getZ() && (entry.id === object.getId() ||
      [Objects.DOOR_415, Objects.DOOR_416, Objects.DOOR_418, Objects.DOOR_419].includes(object.getId())));
}

function doorSides(door) {
  const { x, y, orientation } = door;
  if (orientation === 0) return [new Location(x - 1, y), new Location(x, y)];
  if (orientation === 2) return [new Location(x, y), new Location(x + 1, y)];
  if (orientation === 1) return [new Location(x, y), new Location(x, y + 1)];
  return [new Location(x, y - 1), new Location(x, y)];
}

function routeDoor(event) {
  if (!inTunnels(event.player)) return;
  const door = doorAt(event.object);
  if (!door) return;
  const from = event.player.getLocation();
  const sides = doorSides(door).sort((a, b) => from.getDistance(a) - from.getDistance(b));
  event.destination = { x: sides[0].getX(), y: sides[0].getY(), z: 0 };
}

function lockpickCharges(item) {
  return item.getId() === Items.STRANGE_OLD_LOCKPICK_FULL_ ? LOCKPICK_CHARGES : Number(item.getMetaValue(LOCKPICK_CHARGES_KEY) ?? LOCKPICK_CHARGES);
}

function usableLockpick(item) {
  if (!item || !LOCKPICKS.has(item.getId())) return false;
  const charges = lockpickCharges(item);
  return Number.isInteger(charges) && charges >= 1 && charges <= LOCKPICK_CHARGES;
}

/**
 * Opens a hallway that was impassable with a strange old lockpick: the one used on its door, else
 * one carried ("When placed in your inventory, this lockpick will allow you to bypass all Barrows
 * doors. A charge is consumed when you use the lockpick to open a door which was previously impassable
 * to you": Jagex, Darkmeyer news). One charge per hallway: its other door is free (user captures
 * StrangeOldLockpickBarrows.bin ticks 56/63, 48 -> 47 -> 47; BarrowsMiniQuest.bin ticks 543/553). A
 * full pick becomes the used one in its slot (BarrowsMiniQuest.bin tick 543).
 *
 * Its last charge (Wiki, Strange old lockpick, Trivia): the first hallway opened with one charge left
 * gives the warning and keeps that charge ("presumably to prevent players from getting stuck"); the next
 * impassable hallway uses it and the pick crumbles. "If teleporting out without using the last charge,
 * the strange old lockpick still crumbles to dust" (crumbleWarnedLockpicks). Ours: no chat line as it
 * crumbles (none is recorded or quoted).
 */
function pickLock(player, run, door, used = null) {
  const inventory = player.getInventory();
  const item = usableLockpick(used) ? used : inventory.getItems().find(usableLockpick);
  if (!item) return false;
  const charges = lockpickCharges(item);
  if (charges === 1 && item.getMetaValue(LOCKPICK_WARNED_KEY) !== true) {
    item.setMetaValue(LOCKPICK_WARNED_KEY, true);
    player.sendMessage(LOCKPICK_LAST_USE);
  } else if (charges === 1) {
    inventory.deleteItem(item, inventory.getItems().indexOf(item));
  } else {
    item.setId(Items.STRANGE_OLD_LOCKPICK);
    item.setMetaValue(LOCKPICK_CHARGES_KEY, charges - 1);
    inventory.refreshItems();
  }
  run.pickedDoors = [...(run.pickedDoors ?? []), door.varbit];
  return true;
}

/**
 * Wiki: "If teleporting out without using the last charge, the strange old lockpick still crumbles to dust."
 * A warned pick leaving the tunnels with its last charge unused goes, without a chat line (Ours).
 */
function crumbleWarnedLockpicks(player) {
  const inventory = player.getInventory();
  inventory.getItems().forEach((item, slot) => {
    if (item && LOCKPICKS.has(item.getId()) && item.getMetaValue(LOCKPICK_WARNED_KEY) === true) inventory.deleteItem(item, slot);
  });
}

function inspectLockpick({ player, item }) {
  player.sendMessage(`Your Strange old lockpick has ${lockpickCharges(item)} charges remaining.`);
}

/** The lockpick used on a tunnel door: opens it as Open does, a charge only for an impassable hallway. */
function useLockpickOnDoor(event) {
  const { player, object, item } = event;
  if (!LOCKPICKS.has(event.itemId) || !inTunnels(player)) return false;
  const door = doorAt(object);
  if (!door) return false;
  event.handled = true;
  useDoor(player, door, item);
  return true;
}

/** A doorway's two leaves: the door and its neighbour on the same varbit. */
function doorLeaves(door) {
  return getTunnelMap().doors.filter((entry) => entry.varbit === door.varbit &&
    Math.abs(entry.x - door.x) + Math.abs(entry.y - door.y) <= 1);
}

/** The tile beyond the leaf's wall edge (the west, north, east or south one). */
function outerTile(leaf) {
  const { x, y, orientation } = leaf;
  if (orientation === 0) return new Location(x - 1, y);
  if (orientation === 1) return new Location(x, y + 1);
  if (orientation === 2) return new Location(x + 1, y);
  return new Location(x, y - 1);
}

/**
 * The open leaf a crossing shows: on the wall's outer tile, the left one turned three quarters and
 * the right one a quarter from the door (1000436: barrows_door_l_r rotation 3 -> inactive_r 0 at
 * tick 10239, barrows_door_n_l rotation 2 -> inactive_l 1 at tick 10243).
 */
function openLeaf(leaf) {
  const side = /_r$/.test(CacheDefinitions.getLocNames().get(leaf.id) ?? "") ? "r" : "l";
  const rotation = (leaf.orientation + (side === "l" ? 3 : 1)) % 4;
  return new GameObject(CacheDefinitions.getLocId(DOOR_INACTIVE[side]), outerTile(leaf), leaf.type, rotation, null);
}

/** Which way the player stands at a doorway: the index into either leaf's doorSides, or -1. */
function doorwaySide(leaves, location) {
  for (const leaf of leaves) {
    const index = doorSides(leaf).findIndex((side) => side.equals(location));
    if (index !== -1) return index;
  }
  return -1;
}

/** The crossing's two ticks are up (or another door is opened first): the leaves are back. */
function shutDoor(player, crossing) {
  const sender = player.getPacketSender();
  crossing.leaves.forEach((leaf, i) => {
    sender.sendObject(asObject(leaf));
    sender.sendObjectRemoval(crossing.opened[i]);
  });
}

function endCrossing(player, state, phase = phaseOf(player)) {
  const crossing = state.crossing;
  if (!crossing) return;
  state.crossing = null;
  player.removeFlag(IGNORE_CLIPPING_FLAG);
  if (phase === "tunnels") shutDoor(player, crossing);
}

function crossDoor(player, door) {
  const state = session(player);
  if (player.getForceMovement()) return;
  const leaves = doorLeaves(door);
  const from = player.getLocation().clone();
  // From either leaf's tile: live steps diagonally past the other leaf to the tile beyond the one
  // clicked (227/1000436 tick 10239: (3552,9684) -> (3551,9683) for barrows_door_l_r at 3551,9684).
  const index = doorwaySide(leaves, from);
  if (index === -1) return;
  const to = doorSides(door)[1 - index];
  endCrossing(player, state);
  const sender = player.getPacketSender();
  const inviswall = CacheDefinitions.getLocId(DOOR_INVISWALL);
  const opened = leaves.map(openLeaf);
  leaves.forEach((leaf, i) => {
    sender.sendObject(new GameObject(inviswall, new Location(leaf.x, leaf.y, leaf.z), leaf.type, leaf.orientation, null));
    sender.sendObject(opened[i]);
  });
  for (const sound of DOOR_OPEN_SOUNDS) sender.sendSoundEffect(sound, 1, 0);
  state.crossing = { leaves, opened, from, to, ticks: DOOR_OPEN_TICKS };
  // Live walks through the doorway as the door opens (rsprox_transcripts/236/03929.txt: a
  // walk/run step across barrows_door_o_l at 3562,9678, no exact move), not a slide.
  player.setFlag(IGNORE_CLIPPING_FLAG, true);
  const movement = player.getMovementQueue();
  movement.reset();
  movement.addSteps(to.clone());
  // The monster rises beside the player on the crossing's own tick, whatever they click next
  // (330 crossings: 236/03929 tick 378, 227/1000436 ticks 10236, 10239, 10243).
  spawnEncounter(player, roomAt(to), to);
}

function useDoor(player, door, lockpick = null) {
  if (player.getForceMovement()) return;
  const run = getRun(player);
  if (doorwaySide(doorLeaves(door), player.getLocation()) === -1) return;
  const centre = DOOR_LINKS.find(([id]) => id === door.varbit).slice(1).includes(4);
  const picked = (run.pickedDoors ?? []).includes(door.varbit);
  if (!run.openDoors.includes(door.varbit) && !picked) {
    if (!pickLock(player, run, door, lockpick)) {
      player.sendMessage("This door is locked.");
      return;
    }
  } else if (centre && !picked && !run.puzzleSolved && roomAt(player.getLocation()) !== 4 && !run.looted) {
    if (!pickLock(player, run, door, lockpick)) {
      spam(player, PUZZLE_LOCKED);
      showPuzzle(player, door);
      return;
    }
  }
  crossDoor(player, door);
}

/**
 * A crossing's monster, beside the tile it leads to (`arrival`). Live's crossings raise only crypt
 * rats, bloodworms, and armed and unarmed skeletons (barrows_skeleton_armed 1687, _unarmed 1685),
 * besides a brother; the Wiki gives the odds. Ours: the two skeletons are even.
 */
function spawnEncounter(player, room, arrival = player.getLocation()) {
  if (room < 0) return;
  const state = session(player);
  const run = getRun(player);
  if ([...state.npcs].filter((npc) => roomAt(npc.getLocation()) === room).length >= 11) return;
  const remaining = BROTHERS.map((_, i) => i).filter((index) => !run.killed.includes(index));
  const roll = randomInt(0, 127);
  const brother = !state.brother && remaining.length && (run.looted || roll < 12)
    ? remaining[randomInt(0, remaining.length - 1)] : -1;
  if (run.looted && brother === -1) return;
  const skeleton = randomInt(0, 1) === 0 ? Npcs.SKELETON_19 : Npcs.SKELETON_17;
  const id = brother !== -1 ? BROTHERS[brother].npcId : roll < 64 ? skeleton : roll < 96 ? Npcs.BLOODWORM : Npcs.CRYPT_RAT;
  // Room bounds overlap the doorway/corridor. An empty tile near the room centre may be
  // behind the door, so spawn beside the arrival tile and check the actual wall clipping.
  const area = player.getPrivateArea();
  for (const [dx, dy] of shuffled([[0, 1], [1, 0], [0, -1], [-1, 0]])) {
    const location = new Location(arrival.getX() + dx, arrival.getY() + dy, arrival.getZ());
    if (!RegionManager.blocked(location, area) && RegionManager.canMovestart(location, arrival, 1, 1, area)) {
      spawnNpc(player, id, location, brother !== -1);
      return;
    }
  }
}

class AhrimCombat extends MagicCombatMethod {
  start(npc, target) {
    const spells = [CombatSpells.FIRE_WAVE, CombatSpells.FIRE_WAVE, CombatSpells.FIRE_WAVE,
      CombatSpells.CONFUSE, CombatSpells.WEAKEN, CombatSpells.CURSE];
    npc.getCombat().setCastSpell(spells[randomInt(0, spells.length - 1)]);
    super.start(npc, target);
  }

  hits(npc, target) {
    const hits = super.hits(npc, target);
    if (npc.getCombat().getSelectedSpell().maximumHit() < 0) {
      for (const hit of hits) hit.setTotalDamage(0);
    }
    return hits;
  }

  finished(npc) {
    npc.getCombat().setPreviousCast(npc.getCombat().getSelectedSpell());
    npc.getCombat().setCastSpell(null);
  }
}

/**
 * The chest's rolls. `boost(itemId)` (a league's boosted drops, "drops:chance" with source
 * "Barrows") makes an equipment piece that many times as likely: the equipment roll's chance
 * grows by the remaining pieces' mean boost, and a boosted piece is picked by its weight.
 */
function rollRewards(run, runeBonus, boost = null) {
  const potential = Math.min(1000, run.points) + run.killed.length * 2;
  if (potential === 0) return [];
  const equipment = run.killed.flatMap((index) => EQUIPMENT.slice(index * 4, index * 4 + 4));
  const rewards = new Map();
  const runeIds = [Items.MIND_RUNE, Items.CHAOS_RUNE, Items.DEATH_RUNE, Items.BLOOD_RUNE];
  // Apply the diary bonus per integer roll; odd amounts round down as a server convention.
  const add = (id, amount) => rewards.set(id, (rewards.get(id) ?? 0)
    + (runeBonus && runeIds.includes(id) ? Math.floor(amount * 1.5) : amount));
  for (let i = 0; i <= run.killed.length; i++) {
    const odds = 450 - 58 * run.killed.length;
    let index = -1;
    if (equipment.length) index = boost ? boostedEquipment(equipment, odds, boost)
      : randomInt(1, odds) === 1 ? randomInt(0, equipment.length - 1) : -1;
    if (index >= 0) {
      add(equipment.splice(index, 1)[0], 1);
    } else {
      // The table uses a zero-based potential roll; quantities scale with that roll.
      const roll = randomInt(0, potential - 1);
      if (roll < 380) add(Items.COINS, Math.max(2, roll * 2 + randomInt(0, 16)));
      else if (roll < 505) add(Items.MIND_RUNE, Math.floor(roll * 2 / 3));
      else if (roll < 630) add(Items.CHAOS_RUNE, Math.floor(roll * 2 / 9));
      else if (roll < 755) add(Items.DEATH_RUNE, Math.floor(roll / 9));
      else if (roll < 880) add(Items.BLOOD_RUNE, Math.floor(roll / 20));
      else if (roll < 1005) add(Items.BOLT_RACK, Math.floor(roll / 25));
      else if (roll < 1008) add(Items.LOOP_HALF_OF_KEY, 1);
      else if (roll < 1011) add(Items.TOOTH_HALF_OF_KEY, 1);
      else add(Items.DRAGON_MED_HELM, 1);
    }
    if (!rewards.has(Items.CLUE_SCROLL_ELITE_) && randomInt(1, 200) === 1) add(Items.CLUE_SCROLL_ELITE_, 1);
  }
  return [...rewards].map(([id, amount]) => new Item(id, amount));
}

/** The remaining equipment piece won on a boosted 1 in `odds` (as rollRewards says), or -1. */
function boostedEquipment(equipment, odds, boost) {
  const weights = equipment.map((id) => Math.max(0, boost(id)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (Math.random() * odds * equipment.length >= total) return -1;
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) if ((roll -= weights[i]) < 0) return i;
  return weights.length - 1;
}

/** "drops:chance" for the chest: an item id's multiplier, or null when nothing is boosted. */
function chestBoost(player) {
  const rules = [];
  pluginApi.emitCustomEvent("drops:chance", { player, source: "Barrows", rules });
  if (rules.length === 0) return null;
  return (itemId) => {
    const name = pluginApi.core.ItemDefinition.forId(itemId)?.getName?.() ?? "";
    return rules.reduce((value, rule) => (rule.pattern.test(name) ? value * rule.multiplier : value), 1);
  };
}

/**
 * The chest's elite clue as Treasure Trails hands it out: none while the player can hold no more
 * of the tier, and a scroll box once boxes are unlocked (X Marks the Spot). The Wiki's Scroll box
 * (elite) lists the Barrows chest as a source.
 */
function eliteClueForm(player, rewards) {
  const clue = rewards.find((item) => item.getId() === Items.CLUE_SCROLL_ELITE_);
  if (!clue) return rewards;
  const allowed = { player, tier: "elite", allowed: null };
  pluginApi.emitCustomEvent("treasure-trails:can-receive", allowed);
  if (allowed.allowed === false) return rewards.filter((item) => item !== clue);
  const form = { player, itemId: clue.getId(), box: false };
  pluginApi.emitCustomEvent("treasure-trails:clue-item", form);
  clue.setId(form.itemId);
  return rewards;
}

function showRewards(player, rewards) {
  player.setAttribute(CLOSE_INTERFACE_ATTRIBUTE, REWARDS_ID);
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendSubInterface(MAIN_MODAL_UID, REWARDS_ID, 0);
  sender.sendInterfaceFlagsRange(REWARDS_ITEMS_UID, 0, REWARDS_ITEM_SLOTS, OP10);
  sender.sendInterfaceScript(1065, [REWARDS_ITEMS_UID], undefined, undefined, {
    [REWARDS_INVENTORY]: { capacity: 8, slots: rewards.map((item, slot) => ({ slot, itemId: item.getId(), quantity: item.getAmount() })) },
  });
}

function showPuzzle(player, door) {
  const puzzle = randomInt(0, PUZZLES.length - 1);
  const options = shuffled([0, 1, 2]);
  session(player).puzzle = { puzzle, options, door, from: player.getLocation().clone(), run: getRun(player) };
  player.setAttribute(CLOSE_INTERFACE_ATTRIBUTE, PUZZLE_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(GAMEFRAME_OVERLAY_UID, PUZZLE_ID, 0);
  const definition = PUZZLES[puzzle];
  for (let slot = 0; slot < 3; slot++) {
    sender.sendInterfaceRawModel((PUZZLE_ID << 16) | PUZZLE_SEQUENCE_MODELS[slot], definition.sequence[slot]);
    sender.sendInterfaceRawModel((PUZZLE_ID << 16) | PUZZLE_OPTION_MODELS[slot], definition.options[options[slot]]);
    sender.sendInterfaceFlags((PUZZLE_ID << 16) | PUZZLE_BUTTONS[slot], 1 << 1);
  }
}

function answerPuzzle(event) {
  const { player, buttonId } = event;
  const slot = PUZZLE_BUTTONS.indexOf(buttonId & 0xffff);
  if ((buttonId >>> 16) !== PUZZLE_ID || slot < 0 || slot > 2) return;
  event.handled = true;
  const state = session(player);
  const pending = state.puzzle;
  state.puzzle = null;
  player.getPacketSender().closeInterface(PUZZLE_ID);
  if (!pending || !inTunnels(player) || !pending.from.equals(player.getLocation()) || getRun(player) !== pending.run) return;
  if (pending.options[slot] !== 0) {
    randomiseLayout(pending.run);
    syncTunnels(player, pending.run);
    player.sendMessage("Wrong! The passages shift around you.");
    return;
  }
  // Solved, the door is unlocked: the next click on it crosses (236/03929 ticks 417-418).
  pending.run.puzzleSolved = true;
  player.sendMessage(PUZZLE_SOLVED);
}

function searchChest(player, clickType) {
  const run = getRun(player);
  const state = session(player);
  const sender = player.getPacketSender();
  if (run.looted) {
    sender.sendMessage("The chest is empty.");
    return;
  }
  if (clickType === 2) {
    if (run.chestOpen) sender.sendSoundEffect(CHEST_CLOSE_SOUND, 1, 0);
    run.chestOpen = false;
    sender.sendVarbit(CHEST_OPEN_VARBIT, 0);
    return;
  }
  if (!run.chestOpen) {
    run.chestOpen = true;
    sender.sendSoundEffect(CHEST_OPEN_SOUND, 1, 0);
    sender.sendVarbit(CHEST_OPEN_VARBIT, 1);
    if (!run.killed.includes(run.tunnel) && !state.brother) {
      spawnNpc(player, BROTHERS[run.tunnel].npcId, new Location(3550, 9694), true, "You dare steal from us!");
    }
    return;
  }
  const diary = { player, diary: "morytania", tier: "hard", complete: false };
  pluginApi.emitCustomEvent("diary:is-complete", diary);
  const rewards = eliteClueForm(player, rollRewards(run, diary.complete === true, chestBoost(player)));
  // Other plugins' items join the loot, in its window (His Faithful Servants' strange icon comes
  // first: BarrowsMiniQuest.bin tick 885, trail_rewardinv's slot 0).
  pluginApi.emitCustomEvent("barrows:chest-rewards", { player, run, rewards });
  run.chests++;
  run.looted = true;
  for (const item of rewards) {
    player.getInventory().forceAdd(player, item);
    pluginApi.emitCustomEvent("collection-log:obtain", { player, itemId: item.getId(), amount: item.getAmount() });
  }
  pluginApi.emitCustomEvent("barrows:chest-looted", { player });
  // rsprox_transcripts/226/01694.txt:170767-170768: the diary's rune line (spam), then the count.
  if (diary.complete === true) spam(player, "You receive more runes for completing the hard tier of the Morytania achievement diary.");
  sender.sendMessage(`Your Barrows chest count is: <col=ff0000>${run.chests}</col>.`);
  combatAchievementsAtChest(player, run);
  // Then the jingle (after the area's track), the reward window, the shaking, and the overlay closes.
  sender.sendJingle(LOOT_JINGLE);
  showRewards(player, rewards);
  CameraShake.send(sender, "barrows", ...LOOTED_SHAKE);
  sender.closeInterface(OVERLAY_ID);
}

/** A looted run's tunnels shake again on each arrival in them; leaving them stills the camera. */
function syncLootedShake(player, from, to) {
  const sender = player.getPacketSender();
  if (to === "tunnels") CameraShake.send(sender, "barrows", ...LOOTED_SHAKE);
  else if (from === "tunnels") sender.sendCameraReset?.();
}

// ------------------------------------------------------------------ Combat Achievements

const MELEE_BROTHERS = new Set([1, 2, 4, 5]); // Dharok, Guthan, Torag and Verac
const ALL_BROTHERS = BROTHERS.length;

/** The chest looted: its count, and the run's tasks (plugins/achievements/combatachievements/). */
function combatAchievementsAtChest(player, run) {
  const complete = (task) => pluginApi.emitCustomEvent("combat-achievements:complete", { player, task });
  pluginApi.emitCustomEvent("combat-achievements:kill", { player, monster: "Barrows", count: run.chests });
  const killedAll = run.killed.length === ALL_BROTHERS;
  if (killedAll && !run.brotherDamage) complete("Pray for Success");
  if (killedAll && !run.hadPrayer) complete("Faithless Crypt Run");
  if ([...MELEE_BROTHERS].every((index) => run.killed.includes(index)) && !run.meleeBrotherAttacked) complete("Can't Touch Me");
}

/** "You have failed <task>: <reason>" (227/00550 ticks 28886, 29246, 28263), as the player's settings allow. */
function failTask(player, task, reason) {
  pluginApi.emitCustomEvent("combat-achievements:failed", { player, task, reason });
}

/** The brother attacking `target` and the target's unlooted run, or null. */
function brotherAttack(attacker, target) {
  if (!target?.isPlayer?.() || !attacker?.isNpc?.()) return null;
  const index = BROTHERS.findIndex((brother) => brother.npcId === attacker.getId());
  const run = index === -1 ? null : target.getAttribute(ATTRIBUTE);
  return run && !run.looted ? { index, run, name: attacker.getDefinition().getName() } : null;
}

/**
 * A melee brother's melee swing fails "Can't Touch Me" as it is made, hit or miss: "Using Protect
 * from Melee to block damage will not count" (Wiki). 227/00550 tick 28886: "Dharok the Wretched
 * performed a melee attack." on the swing's tick, for a 0.
 */
function trackBrotherAttack({ attacker, target, combatType }) {
  const attack = brotherAttack(attacker, target);
  if (!attack || !MELEE_BROTHERS.has(attack.index) || combatType !== pluginApi.core.CombatType.MELEE) return;
  if (attack.run.meleeBrotherAttacked) return;
  attack.run.meleeBrotherAttacked = true;
  failTask(target, "Can't Touch Me", `${attack.name} performed a melee attack.`);
}

/** A brother's damage fails "Pray for Success" (227/00550 tick 29246, the tick after Ahrim's 15). */
function trackBrotherHit({ attacker, target, hit }) {
  const attack = brotherAttack(attacker, target);
  if (!attack || hit.getTotalDamage() <= 0 || attack.run.brotherDamage) return;
  attack.run.brotherDamage = true;
  failTask(target, "Pray for Success", `${attack.name} damaged you.`);
}

/**
 * "Faithless Crypt Run" fails the tick after a brother appears to a player who has had prayer
 * points this run (227/00550 ticks 28262-28263 and 28974-28975).
 */
function checkFaithless(player, state, run) {
  const brother = liveBrother(state);
  if (!brother || !brother.isRegistered() || brother.__faithlessChecked || run.looted) return;
  brother.__faithlessChecked = true;
  if (run.hadPrayer) failTask(player, "Faithless Crypt Run", "You had more than 0 prayer points.");
}

function answerKillCount({ player, counts }) {
  const chests = Number(player.getAttribute(ATTRIBUTE)?.chests) || 0;
  if (chests > 0) counts.Barrows = chests;
}

function handleObject(event) {
  const { player, object, clickType } = event;
  if (!inBarrows(player)) return;
  const id = object.getId();
  const stairs = BROTHERS.find((brother) => brother.stairs === id);
  const crypt = BROTHERS.findIndex((brother) => brother.coffin === id);
  if (player.getLocation().getZ() === 3 && clickType === 1 && (stairs || crypt !== -1)) {
    event.handled = true;
    if (stairs) {
      cleanupNpcs(player, true);
      player.moveTo(stairs.surface.clone());
    } else searchCrypt(player, crypt);
    return;
  }
  if (!inTunnels(player)) return;
  const map = getTunnelMap();
  const location = object.getLocation();
  const ladder = map.ladders.find((entry) => entry.x === location.getX() && entry.y === location.getY() &&
    (entry.id === id || id === Objects.LADDER_270));
  if (ladder) {
    event.handled = true;
    const run = getRun(player);
    if (roomAt(location) !== run.exitRoom) return;
    cleanupNpcs(player, true);
    player.moveTo(BROTHERS[run.tunnel].crypt.clone());
    if (run.looted) player.setAttribute(ATTRIBUTE, freshRun(run.chests));
    return;
  }
  if (location.getX() === map.chest.x && location.getY() === map.chest.y &&
      [map.chest.id, Objects.CHEST_68, Objects.CHEST_69].includes(id)) {
    event.handled = true;
    if (clickType === 1 || clickType === 2) searchChest(player, clickType);
    return;
  }
  const door = doorAt(object);
  if (door) {
    event.handled = true;
    if (clickType === 1) useDoor(player, door);
  }
}

function handleNpcDeath({ npc, killer }) {
  if (!killer) return;
  const owner = npc.getOwner();
  if (owner && owner !== killer) return;
  const index = BROTHERS.findIndex((brother) => brother.npcId === npc.getId());
  if (index === -1 && (!CREATURES.has(npc.getId()) || !inTunnels(killer))) return;
  const state = session(killer);
  if (index !== -1 && !state.npcs.has(npc)) return;
  state.npcs.delete(npc);
  if (state.brother === npc) {
    state.brother = null;
    killer.getPacketSender().sendEntityHintRemoval(false);
  }
  if (owner) npc.__skipDefaultRespawn = true;
  const run = getRun(killer);
  if (run.looted || (index !== -1 && run.killed.includes(index))) return;
  if (index !== -1) run.killed.push(index);
  run.points = Math.min(1000, run.points + npc.getDefinition().getCombatLevel());
  run.kills++;
  updateOverlay(killer, run);
}

const PRAYER_DRAINED = "<col=ff3045>Your prayers have been drained!</col>";

function drainPrayer(player, run) {
  if (--run.prayerTicks > 0) return;
  run.prayerTicks = PRAYER_DRAIN_TICKS;
  if (HILTS.has(player.getEquipment().get(Equipment.SHIELD_SLOT).getId())) return;
  const skills = player.getSkillManager();
  const amount = 8 + run.killed.length;
  const apply = pluginApi.core.applyPrayerDrainModifiers;
  const drain = typeof apply === "function" ? apply(player, amount, { source: "barrows" }) : amount;
  // The drain's chat line, since the 24 September 2025 Interface Uplift (Wiki: Barrows): sent on the drain's tick,
  // before the Prayer drop (rsprox_transcripts/236/03929.txt tick 388, 237/01107.txt:93512). Older recordings
  // (226/01694.txt) have no line.
  player.sendMessage(PRAYER_DRAINED);
  // A defeated brother's face accompanies the drain; none after looting (normal-world 1694,
  // plus repeated observations in Leagues recording 4057).
  if (!run.looted && run.killed.length) {
    const brother = run.killed[randomInt(0, run.killed.length - 1)];
    const models = PRAYER_FACES[brother];
    if (models) player.getPacketSender().sendInterfaceScript(PRAYER_FACE_SCRIPT,
      [(OVERLAY_ID << 16) | (PRAYER_FACE_FIRST_COMPONENT + brother), models[randomInt(0, 3) === 0 ? 1 : 0]]);
  }
  skills.setCurrentLevelCombat(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - drain));
  skills.updateSkill(Skill.PRAYER);
}

function processPlayer({ player }) {
  if (!inBarrows(player) && !sessions.has(player)) return;
  const current = player.getAttribute(ATTRIBUTE);
  if (current && !current.looted && player.getSkillManager().getCurrentLevel(Skill.PRAYER) > 0) current.hadPrayer = true;
  const state = session(player);
  if (state.puzzle && !state.puzzle.from.equals(player.getLocation())) {
    state.puzzle = null;
    player.getPacketSender().closeInterface(PUZZLE_ID);
  }
  if (state.dig && --state.dig.ticks <= 0) {
    const dig = state.dig;
    state.dig = null;
    if (player.getLocation().equals(dig.from) && player.getHitpoints() > 0) {
      cleanupNpcs(player, true);
      player.moveTo(dig.to.clone());
    }
  }
  const phase = phaseOf(player);
  const run = player.getAttribute(ATTRIBUTE) ?? (phase !== "outside" ? getRun(player) : null);
  if (phase !== state.phase) {
    // A looted run stays looted until the next crypt is dug into (dig), as live keeps it: a
    // teleport out and back into the chest room (league Evil eye) finds it empty (237/04057).
    if (state.phase === "tunnels" && phase !== "tunnels") {
      cleanupNpcs(player, true);
      crumbleWarnedLockpicks(player);
    }
    state.puzzle = null;
    // Each entry into a crypt restarts the drain's 30 ticks (rsprox_transcripts/226/01694.txt: in at ticks 8801, 8868,
    // 8916, 8966 and 9046, drained at 8831, 8898, 8946, 8996 and 9076).
    // One more than the interval: this same tick's drainPrayer call below counts the first one down.
    if (run && (phase === "crypt" || (phase === "tunnels" && state.phase !== "crypt" && state.phase !== "tunnels"))) {
      run.prayerTicks = PRAYER_DRAIN_TICKS + 1;
    }
    if (run?.looted) syncLootedShake(player, state.phase, phase);
    state.phase = phase;
    syncMinimap(player, phase);
    if (phase === "outside") player.getPacketSender().closeInterface(OVERLAY_ID);
    else {
      showOverlay(player);
      // This also restores player-specific objects on the first process tick after login.
      if (phase === "tunnels") syncTunnels(player, getRun(player));
    }
  }
  if (state.crossing) {
    // The doorway's clipping is ignored for the step through it only; a click away the next tick
    // walks normally (the player is not held: 227/1000436 ticks 10237 and 10240).
    if (!player.getLocation().equals(state.crossing.from)) player.removeFlag(IGNORE_CLIPPING_FLAG);
    if (--state.crossing.ticks <= 0) endCrossing(player, state, phase);
  }
  if ((phase === "crypt" || phase === "tunnels") && player.getHitpoints() > 0) drainPrayer(player, getRun(player));
  for (const npc of [...state.npcs]) {
    // Let a fatal hit finish crediting its owner even if they climb out on the same tick.
    if (npc.isDyingFunction()) continue;
    if (phase === "outside" || phase === "surface" || npc.getLocation().getZ() !== player.getLocation().getZ() ||
        npc.getLocation().getDistance(player.getLocation()) >= 40) {
      // A brother left behind by a move to another crypt or into the tunnels (a teleport) says his line.
      if (npc === liveBrother(state) && (phase === "crypt" || phase === "tunnels")) queueFarewell(state, FAREWELL_MOVE_TICKS);
      removeNpc(player, npc);
    } else if (npc === state.brother) leashBrother(player, state, npc, phase);
  }
  if (run) checkFaithless(player, state, run);
  if (state.farewell > 0 && --state.farewell === 0 && phase !== "outside" && phase !== "surface") player.sendMessage(BROTHER_FAREWELL);
}

/**
 * A brother out of reach of where he rose turns away, then goes the tick after; in a crypt with his
 * line (the Wiki's Barrows Trivia: the message "can also appear if players run too far away from a
 * brother in the crypts"; 227/1000433 tick 17112 has it in the tunnels, 227/00086 twice without).
 * Otherwise he keeps after his owner: a brother whose attack the single-way rules refused tries again.
 */
function leashBrother(player, state, npc, phase) {
  if (!npc.isRegistered()) return;
  const here = player.getLocation();
  const rose = npc.__barrowsRose ?? npc.getSpawnPosition();
  const away = Math.max(Math.abs(here.getX() - rose.getX()), Math.abs(here.getY() - rose.getY())) > BROTHER_LEASH;
  if (!away) {
    npc.__barrowsLeaving = false;
    if (npc.getCombat().getTarget() == null) npc.getCombat().attack(player);
    return;
  }
  if (!npc.__barrowsLeaving) {
    npc.__barrowsLeaving = true;
    npc.getCombat().reset();
    npc.setMobileInteraction(null);
    return;
  }
  if (phase === "crypt") queueFarewell(state, FAREWELL_LEASH_TICKS);
  removeNpc(player, npc);
}

function cleanupPlayer({ player }) {
  if (sessions.get(player)?.crossing) player.removeFlag?.(IGNORE_CLIPPING_FLAG);
  if (sessions.has(player)) {
    cleanupNpcs(player);
    sessions.delete(player);
  }
  const run = player.getAttribute(ATTRIBUTE);
  if (run?.looted && !inTunnels(player)) player.setAttribute(ATTRIBUTE, freshRun(run.chests));
}

/**
 * A death in the tunnels leaves them too, with the last charge unused: a warned pick the death drops
 * (to a grave or the floor) crumbles rather than going with the rest. One it keeps goes in
 * crumbleKeptLockpicksOnDeath.
 */
function crumbleWarnedLockpickOnDeath(event) {
  const { player, item } = event;
  if (event.kept || event.shouldDropItems === false || !item || !LOCKPICKS.has(item.getId())) return;
  if (item.getMetaValue(LOCKPICK_WARNED_KEY) !== true || !inTunnels(player)) return;
  event.handled = true;
}

/**
 * A warned pick the death keeps (Protect Item, a keep-everything death) crumbles too, as a teleport
 * out does. Every death emits this, after the kept items are back and before the respawn move, so
 * the player is still on the death tile. onPlayerDeath stops at the first handler that takes the
 * death (the Death's Office tutorial on a first grave), so it is not used for this.
 */
function crumbleKeptLockpicksOnDeath({ victim: player }) {
  if (player?.isPlayer?.() && inTunnels(player)) crumbleWarnedLockpicks(player);
}

function playerDeath(event) {
  // A death mid-fight: the brother goes, with his line (227/1000265 ticks 5993-5994, 227/1000565).
  // Ours: on the death's tick, as the session ends with it.
  const fighting = sessions.has(event.player) && liveBrother(session(event.player));
  cleanupPlayer(event);
  if (fighting) event.player.sendMessage(BROTHER_FAREWELL);
  const run = event.player.getAttribute(ATTRIBUTE);
  if (run?.looted) event.player.setAttribute(ATTRIBUTE, freshRun(run.chests));
}

// ------------------------------------------------------------------ The Strange Old Man's tunnel warnings
function warningsCondensed(player) {
  return Number(player.getAttribute(WARNINGS_ATTRIBUTE)) === 1;
}

function sendWarningsVarbit({ player }) {
  player.getPacketSender().sendVarbit(WARNINGS_VARBIT, warningsCondensed(player) ? 1 : 0);
}

const isStrangeOldMan = (npcId) => npcId === Npcs.STRANGE_OLD_MAN;

/** The Strange Old Man page's "If the barrows catacomb warning is (not) condensed:" conditions. */
function answerWarningsCondition({ npcId, player, text }) {
  if (!isStrangeOldMan(npcId)) return null;
  const value = String(text ?? "").trim();
  if (WARNINGS_NOT_CONDENSED.test(value)) return !warningsCondensed(player);
  if (WARNINGS_CONDENSED.test(value)) return warningsCondensed(player);
  return null;
}

/** Per player: the lines of the warnings direction that doesn't apply, left out as they come up. */
const warningLinesSkipped = new WeakMap();

/**
 * His Faithful Servants' "If the warnings are (not) combined:" are directions in the export, each
 * followed by its own lines: the one that applies plays them (BarrowsMiniQuest.bin ticks 1030-1031, not
 * yet condensed), the other's are skipped, and both go on to his scream.
 */
function answerWarningsDirection(event) {
  if (!isStrangeOldMan(event.npcId) || event.kind === "message" || !Array.isArray(event.step?.steps)) return;
  const text = String(event.text ?? "").trim();
  const condensed = warningsCondensed(event.player);
  const applies = WARNINGS_NOT_CONDENSED.test(text) ? !condensed : WARNINGS_CONDENSED.test(text) ? condensed : null;
  if (applies === null) return;
  let skipped = warningLinesSkipped.get(event.player);
  if (!skipped) warningLinesSkipped.set(event.player, skipped = new Set());
  for (const step of event.step.steps) {
    if (applies) skipped.delete(step);
    else skipped.add(step);
  }
}

/** His scream answers the request: the toggle flips as it shows (BarrowsMiniQuest.bin tick 1034). */
function toggleWarningsOnScream(event) {
  if (!isStrangeOldMan(event.npcId)) return;
  if (warningLinesSkipped.get(event.player)?.has(event.step)) {
    event.skip = true;
    return;
  }
  const scream = WARNINGS_PAGE_SCREAM[event.pages?.[0]?.page];
  if (!scream || (event.step?.npc ?? event.step?.text) !== scream) return;
  const previous = event.before;
  event.before = () => {
    previous?.();
    event.player.setAttribute(WARNINGS_ATTRIBUTE, warningsCondensed(event.player) ? 0 : 1);
    sendWarningsVarbit(event);
  };
}

function chestCount(request) {
  if (request.category === "Barrows Chests") request.count = Number(request.player.getAttribute(ATTRIBUTE)?.chests) || 0;
}

module.exports = {
  name: "Barrows",
  description: "Adds the Barrows minigame: the six brothers' crypts and puzzle door, the prayer drain, the reward chest, the Barrows minimap, the strange old lockpick on the tunnel doors and the Strange Old Man's condensed tunnel warnings.",
  members: true,
  register(api) {
    World = api.getWorld();
    RegionManager = api.getRegionManager();
    TaskManager = api.getTaskManager();
    pluginApi = api;
    initRegionBuildingAnalysisCoreAccess(api);
    api.persistAttribute(ATTRIBUTE);
    api.onItemAction("Spade", { Dig: dig });
    api.persistAttribute(WARNINGS_ATTRIBUTE, 0);
    api.onItemAction("Strange old lockpick", { Inspect: inspectLockpick });
    api.onItemAction("Strange old lockpick (full)", { Inspect: inspectLockpick });
    api.onItemOnObject("Strange old lockpick", "Door", useLockpickOnDoor);
    api.onItemOnObject("Strange old lockpick (full)", "Door", useLockpickOnDoor);
    api.onCustomEvent("spade:before-dig", refuseMoundDig);
    api.onNpcDialogueCondition(answerWarningsCondition);
    api.onCustomEvent("npc-dialogue:action", answerWarningsDirection);
    api.onCustomEvent("npc-dialogue:line", toggleWarningsOnScream);
    api.onPlayerLogin(sendWarningsVarbit);
    api.onObjectRoute(routeDoor);
    api.onObjectInteraction(handleObject);
    api.onInterfaceActionClick(answerPuzzle);
    api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, restoreOverlayAfterWelcome);
    // Mobile skips the welcome screen, so its gameframe is never replaced and
    // this mount survives. Desktop keeps waiting for the Play button, which runs
    // after WelcomeScreen re-boots the gameframe.
    api.onPlayerLogin(({ player }) => {
      minimapHidden.delete(player);
      syncMinimap(player, phaseOf(player));
      if (player.getAttribute(MOBILE_CLIENT_ATTRIBUTE) === true) {
        restoreOverlayAfterWelcome({ player });
      }
    });
    api.onCustomEvent("barrows:minimap-reveal", ({ player }) => syncMinimap(player, phaseOf(player)));
    api.onNpcDeath(handleNpcDeath);
    api.onCustomEvent("collection-log:category-count", chestCount);
    api.onCustomEvent("combat-achievements:kill-count", answerKillCount);
    api.onCombatHitPrepare(trackBrotherAttack);
    api.onCombatHitResolved(trackBrotherHit);
    api.onPlayerProcess(processPlayer);
    api.onPlayerDeath(playerDeath);
    api.onPlayerDeathItemDrop(crumbleWarnedLockpickOnDeath);
    api.onPlayerDefeated(crumbleKeptLockpicksOnDeath);
    api.onPlayerDisconnect(cleanupPlayer);
    api.onPlayerLogout(cleanupPlayer);
    api.registerNpcCombatMethodProvider(Npcs.AHRIM_THE_BLIGHTED, AhrimCombat);
  },
  _test: { rollRewards, searchChest, searchCrypt, chestCount, phaseOf, syncMinimap, processPlayer, dig, useDoor, doorSides, getTunnelMap, getRun, IGNORE_CLIPPING_FLAG,
    answerPuzzle, enterTunnel, doorLeaves, session, trackBrotherAttack, trackBrotherHit, BROTHERS,
    useLockpickOnDoor, inspectLockpick, refuseMoundDig, WARNINGS_ATTRIBUTE, playerDeath, crumbleWarnedLockpickOnDeath, crumbleKeptLockpicksOnDeath },
};
