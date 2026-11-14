"use strict";

/**
 * Pyramid Plunder, Jalsavrah (https://oldschool.runescape.wiki/w/Pyramid_Plunder): shared ids,
 * room data, rolls and the run's lifecycle. The entrance, the room containers, the passages,
 * the session and Simon Templeton each live in the units beside this file.
 *
 * Every container and door in the eight rooms is a cache multiloc whose child follows a
 * per-player varbit (ntk_urn1..15_state, ntk_golden_chest_state, ntk_sarcophagus_state,
 * ntk_door1..4_state, ntk_trap_active), so a run is the varbits this player was sent. The
 * client's own overlay (ntk_overlay) draws "Room n of 8", the Thieving level and the time bar
 * from ntk_room_number, ntk_thieving_required and ntk_player_timer_count (ticks elapsed).
 * Room data, loot and fitted success chances are in ./data/pyramid-plunder.json.
 *
 * rsprox captures (recordings 545, 549, 552, 1788, 1843, 1857): the tomb's lines are spam
 * messages, except "This door leads to a dead end." and its "already opened" twin; each search,
 * pick and push holds the `busy` varbit while it runs.
 */

const DATA = require("./data/pyramid-plunder.json");

const RUN_ATTRIBUTE = "pyramid-plunder:run";
const PLAYED_ATTRIBUTE = "pyramid-plunder:played";
const TIMED_OUT_ATTRIBUTE = "pyramid-plunder:timed-out";

const OVERLAY_HUD_UID = (161 << 16) | 8;
const ROOMS = DATA.rooms;
const LAST_ROOM = ROOMS.length;

const MESSAGES = {
  level: (level) => `You need a Thieving level of ${level} to enter this room.`,
  entryLevel: `You need a Thieving level of at least ${DATA.entryLevel} to play Pyramid Plunder.`,
  quest: "You need to have started Icthlarin's Little Helper to play Pyramid Plunder.",
  timeUp: "Your time is up...",
  guardianTimeUp: "You've had your five minutes of plundering. Now be off with you!",
  looted: "You have already looted this.",
  deadEnd: "This door leads to a dead end.",
  doorFail: "Your attempt fails.",
  lockpick: "You use your lockpick and attempt to open the door.",
  noLockpick: "You attempt to open the door. Lockpicks would make it easier...",
  trapTry: "You carefully try to temporarily deactivate the trap mechanism.",
  trapDisarmed: "You deactivate the trap!",
  trapFail: "You fail to deactivate the trap.",
  urnLooted: "You successfully loot the urn!",
  bitten: "You've been bitten by something moving inside the urn.",
  urnPoisoned: "You've been poisoned by something moving inside the urn.",
  lastRoomDoor: "This is the last room, opening this door will cause you to leave the game. Do you really want to leave the Tomb?",
  leaveTomb: "Do you really want to leave the Tomb?",
  mummyVanishes: "The mummy you're fighting vanishes in a cloud of smoke.",
  scarabsLeave: "The scarabs scuttle away.",
  deadEndOpened: "You've already opened this door and it leads to a dead end.",
  sceptre: "You have found the Pharaoh's Sceptre.",
  // Not yet checked against a capture: the snake check/charm lines, the swarm, the
  // sarcophagus's Strength line, the mummy and the dropped sceptre below.
  snake: "There's a snake in the urn!",
  noCharm: "You need a snake charm to do this.",
  charmed: "You charm the snake.",
  swarm: "A swarm of scarabs emerges from the chest!",
  sarcophagusWeak: "You need more Strength to push the lid of this sarcophagus.",
  mummy: "A mummy awakens!",
  sceptreDropped: "You find a golden sceptre but have no space for it. It falls to the ground.",
  panelSearch: "You use your thieving skills to search the stone panel.",
};

const state = {
  api: null,
  core: null,
  ids: null,
  /** Which of the four outer panels (north, east, south, west) opens on the Guardian mummy. */
  entrance: 0,
  entranceChangesAt: 0,
};

/** player -> the live run: { room, startCycle, cleared, exits, busyUntil, lastSafe, hostiles } */
const sessions = new Map();

function bind(api) {
  state.api = api;
  state.core = api.core;
  if (!state.ids) state.ids = resolveIds(api.core.CacheDefinitions);
}

/** Every id from its cache gameval name, so nothing here is a bare number. */
function resolveIds(cache) {
  const loc = (name) => cache.getLocId(name);
  const varbit = (name) => cache.getVarbitId(name);
  const urnMultis = [loc("ntk_urn_type1_multi_1")];
  for (let i = 2; i <= 15; i++) {
    const type = i <= 5 ? 1 : i <= 10 ? 2 : 3;
    urnMultis.push(loc(`ntk_urn_type${type}_multi_${i}`));
  }
  const urnVarbits = [];
  for (let i = 1; i <= 15; i++) urnVarbits.push(varbit(`ntk_urn${i}_state`));
  const artefacts = {};
  const noted = {};
  for (const [key, artefact] of Object.entries(DATA.artefacts)) {
    artefacts[key] = cache.getObjId(artefact.gameval);
    const note = cache.getItem(artefacts[key])?.note;
    if (note > 0) noted[key] = note;
  }
  return {
    urns: new Map(urnMultis.map((id, i) => [id, urnVarbits[i]])),
    urnVarbits,
    chest: loc("ntk_golden_chest_multi"),
    sarcophagus: loc("ntk_sarcophagus_multi"),
    tombDoors: new Map([1, 2, 3, 4].map((n) => [loc(`ntk_tomb_door${n}`), n])),
    outerPanels: [
      loc("ntk_pyramid_door_north_multi"), loc("ntk_pyramid_door_east_multi"),
      loc("ntk_pyramid_door_south_multi"), loc("ntk_pyramid_door_west_multi"),
    ],
    varbit: {
      chest: varbit("ntk_golden_chest_state"),
      sarcophagus: varbit("ntk_sarcophagus_state"),
      sarcophagusPush: varbit("ntk_sarcophagus_push"),
      busy: varbit("busy"),
      roomLevel: varbit("ntk_current_room_level"),
      trap: varbit("ntk_trap_active"),
      doors: [1, 2, 3, 4].map((n) => varbit(`ntk_door${n}_state`)),
      outerPanels: [1, 2, 3, 4].map((n) => varbit(`ntk_outside_door${n}_state`)),
      timer: varbit("ntk_player_timer_count"),
      level: varbit("ntk_thieving_required"),
      room: varbit("ntk_room_number"),
      playedBefore: varbit("ntk_played_before"),
      simonNamed: varbit("agility_pyramid_simon_named"),
      simonJob: varbit("agility_pyramid_simon_job"),
      simonJobDone: varbit("agility_pyramid_simon_job_done"),
    },
    overlay: cache.getInterfaceId("ntk_overlay"),
    tombExit: loc("ntk_tomb_door_exit"),
    antechamberExit: loc("ntk_antechamber_exit"),
    simon: cache.getNpcId("agility_pyramid_simon"),
    anim: {
      urnSearch: cache.getSeqId("urn_search"),
      urnBitten: cache.getSeqId("urn_search_bit"),
      urnSuccess: cache.getSeqId("urn_search_success"),
      charm: cache.getSeqId("snake_charming"),
      chest: cache.getSeqId("human_pickuptable"),
      push: cache.getSeqId("ntk_tomb_push_loop"),
      lidOff: cache.getSeqId("ntk_tomb_open"),
      pick: cache.getSeqId("human_pickuptable"),
      door: cache.getSeqId("ntk_tomb_door"),
      walk: cache.getSeqId("human_walk_f"),
    },
    /**
     * Captured synths (rsprox, see the review on #935): the trap's work and disarm (also a panel's
     * search), the chest, a door, a looted urn, a bite; and the area sounds of a door and the lid.
     */
    sound: { trapWork: 1220, trapDisarmed: 2387, chest: 1215, door: 87, urnLooted: 1217, bitten: 797, doorArea: 54, lidArea: 1218 },
    npc: {
      guardian: cache.getNpcId("ntk_mummy_guardian"),
      scarabs: cache.getNpcId("ntk_scarab_swarm"),
      mummy: cache.getNpcId("ntk_mummy_1"),
    },
    item: {
      artefacts,
      noted,
      sceptre: cache.getObjId("pharaohs_sceptre_charged_initial"),
      snakeCharm: cache.getObjId("snake_flute"), // "Snake charm" in game
      lockpick: cache.getObjId("lockpick"),
      coins: cache.getObjId("coins"),
      pyramidTop: cache.getObjId("agility_pyramid_gold_pyramid"),
    },
  };
}

const getCore = () => state.core;
const getApi = () => state.api;
const ids = () => state.ids;
const roomData = (room) => ROOMS[room - 1] ?? null;
const sessionOf = (player) => sessions.get(player) ?? null;

function thievingLevel(player) {
  return player.getSkillManager().getCurrentLevel(getCore().Skill.THIEVING);
}

/** Room and entry gates use the unboosted level (the Wiki: levels cannot be boosted). */
function baseThievingLevel(player) {
  return player.getSkillManager().getMaxLevel(getCore().Skill.THIEVING);
}

function strengthLevel(player) {
  return player.getSkillManager().getCurrentLevel(getCore().Skill.STRENGTH);
}

// --- Rolls. Pure, with an injectable random, so the tests can pin both ends.

/** The OSRS skilling roll in 256ths, from the chance at level 1 (low) and 99 (high). */
function skillChance(low, high, level) {
  const capped = Math.max(1, Math.min(99, level));
  return 1 + Math.floor((low * (99 - capped)) / 98 + (high * (capped - 1)) / 98 + 0.5);
}

/** A fitted chance from data.chances for this room, as a probability. */
function chanceOf(name, level, room) {
  const curve = DATA.chances[name];
  const per256 = skillChance(curve.low, curve.high, level) - (curve.perRoom ?? 0) * (room - 1);
  return Math.max(0, Math.min(256, per256)) / 256;
}

function sarcophagusChance(strength, room) {
  const curve = DATA.chances.sarcophagus[room - 1];
  return Math.max(0, Math.min(256, skillChance(curve.low, curve.high, strength))) / 256;
}

function roll(chance, random = Math.random) {
  return random() < chance;
}

/** A weighted key from { key: weight }. */
function pickWeighted(weights, random = Math.random) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let at = random() * total;
  for (const [key, weight] of entries) {
    if ((at -= weight) < 0) return key;
  }
  return entries[entries.length - 1][0];
}

function pickEven(keys, random = Math.random) {
  return keys[Math.min(keys.length - 1, Math.floor(random() * keys.length))];
}

function rollChestArtefact(room, random = Math.random) {
  return pickWeighted(roomData(room).chest, random);
}

function rollSarcophagusArtefact(room, random = Math.random) {
  return pickWeighted(roomData(room).sarcophagus, random);
}

function rollUrnArtefact(room, random = Math.random) {
  return pickEven(roomData(room).urn, random);
}

/** The Wiki's per-room sceptre chance, rolled on every chest and sarcophagus opening, `multiplier` times as likely. */
function rollSceptre(room, random = Math.random, multiplier = 1) {
  return random() < multiplier / roomData(room).sceptre;
}

/** "minigame:chance" for the sceptre: how many times as likely, never rarer than the Wiki's. */
function sceptreMultiplier(player) {
  const request = { player, minigame: "pyramid-plunder", kind: "pharaohs-sceptre", multiplier: 1 };
  getApi()?.emitCustomEvent?.("minigame:chance", request);
  return Math.max(1, Number(request.multiplier) || 1);
}

function rollHit(random = Math.random, min = 1, max = 4) {
  return min + Math.min(max - min, Math.floor(random() * (max - min + 1)));
}

// --- Tiles

function roomAt(x, y, z) {
  if (z !== 0) return 0;
  for (const room of ROOMS) {
    const b = room.bounds;
    if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return room.room;
  }
  return 0;
}

function location(tile, z = 0) {
  return new (getCore().Location)(tile.x, tile.y, tile.z ?? z);
}

// --- Varbits

function send(player, varbitId, value) {
  player.getPacketSender().sendVarbit(varbitId, value);
}

function varbitOf(player, varbitId) {
  return player.getPacketSender().getVarbit(varbitId) | 0;
}

/** Every container, door and the trap back to its closed form (between rooms and on exit). */
function resetRoomVarbits(player) {
  const v = ids().varbit;
  for (const id of ids().urnVarbits) send(player, id, 0);
  send(player, v.chest, 0);
  send(player, v.sarcophagus, 0);
  send(player, v.trap, 0);
  for (const id of v.doors) send(player, id, 0);
  send(player, v.sarcophagusPush, 0);
  send(player, v.busy, 0);
}

/** Entering a room arms its speartrap (ntk_trap_active 1, as live sets it on entry). */
function armTrap(player) {
  send(player, ids().varbit.trap, 1);
}

function sound(player, id) {
  player.getPacketSender().sendSound(id, 255, 0);
}

/** Captured range of the tomb's area sounds (a door, the lid). */
const AREA_SOUND_RANGE = 5;

function areaSound(player, id, at) {
  player.getPacketSender().sendAreaSound(id, at.x, at.y, at.z ?? 0, 1, 0, AREA_SOUND_RANGE);
}

/** The tomb's chat lines are spam messages. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(getCore().ChatType.SPAM, text);
}

/** The client's `busy` varbit, held while a search, pick or push runs. */
function busy(player, on) {
  send(player, ids().varbit.busy, on ? 1 : 0);
}

/** The room varbits; ntk_current_room_level runs one ahead of the room (2 in room 1, as captured). */
function sendRoomHud(player, run) {
  const v = ids().varbit;
  send(player, v.room, run.room);
  send(player, v.level, roomData(run.room).level);
  send(player, v.roomLevel, run.room + 1);
}

function elapsedTicks(run) {
  return getCore().World.getProcessCycle() - run.startCycle;
}

function sendTimer(player, run) {
  send(player, ids().varbit.timer, Math.max(0, Math.min(DATA.timerTicks, elapsedTicks(run))));
}

// --- Exits

/**
 * Which tomb door leads on from each room, drawn when a run starts (the Wiki: the right doors
 * change when a player starts a round). Kept per run, so a door this player was already told
 * is a dead end stays one when someone else starts.
 */
function rollRoomExits(random = Math.random) {
  return ROOMS.map(() => 1 + Math.min(3, Math.floor(random() * 4)));
}

/** The outer panel that reaches the Guardian mummy changes every 25 minutes. */
function currentEntrance(random = Math.random) {
  const now = getCore().World.getProcessCycle();
  if (now >= state.entranceChangesAt) {
    state.entrance = Math.min(3, Math.floor(random() * 4));
    state.entranceChangesAt = now + DATA.entranceRotateTicks;
  }
  return state.entrance;
}

// --- The run

function startRun(player, random = Math.random) {
  endRun(player, { silent: true, keepPosition: true });
  const run = {
    room: 1,
    startCycle: getCore().World.getProcessCycle(),
    cleared: new Set(),
    exits: rollRoomExits(random),
    busyUntil: 0,
    lastSafe: null,
    hostiles: [],
  };
  sessions.set(player, run);
  player.setAttribute(RUN_ATTRIBUTE, true);
  player.setAttribute(PLAYED_ATTRIBUTE, true);
  player.setAttribute(TIMED_OUT_ATTRIBUTE, false);
  send(player, ids().varbit.playedBefore, 1);
  resetRoomVarbits(player);
  armTrap(player);
  sendRoomHud(player, run);
  sendTimer(player, run);
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, ids().overlay, 1);
  player.moveTo(location(roomData(1).entry));
  return run;
}

function enterRoom(player, run, room) {
  run.room = room;
  run.cleared = new Set();
  run.lastSafe = null;
  run.trapDisarmed = false;
  run.pushing = false;
  resetRoomVarbits(player);
  armTrap(player);
  sendRoomHud(player, run);
  sendTimer(player, run);
  player.moveTo(location(roomData(room).entry));
}

/**
 * Ends the run: the rooms close again for this player, the overlay goes and (unless the player
 * is already being moved) they land in front of the northern panel. Loot already taken stays.
 */
function endRun(player, { silent = false, keepPosition = false, timedOut = false } = {}) {
  const run = sessions.get(player);
  for (const npc of run?.hostiles ?? []) {
    if (!silent && npc.isRegistered?.() !== false && npc.getHitpoints?.() > 0) {
      spam(player, npc.getId?.() === ids().npc.scarabs ? MESSAGES.scarabsLeave : MESSAGES.mummyVanishes);
    }
    getApi().removeNpc(npc);
  }
  const had = sessions.delete(player) || player.getAttribute(RUN_ATTRIBUTE) === true;
  player.setAttribute(RUN_ATTRIBUTE, null);
  if (!had) return false;
  resetRoomVarbits(player);
  send(player, ids().varbit.timer, 0);
  // As captured on leaving: back to room 1's level, the entry panel shut again.
  send(player, ids().varbit.roomLevel, 2);
  send(player, ids().varbit.level, roomData(1).level);
  for (const id of ids().varbit.outerPanels) send(player, id, 0);
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
  if (timedOut) player.setAttribute(TIMED_OUT_ATTRIBUTE, true);
  if (!keepPosition) player.moveTo(location(DATA.outside));
  if (!silent && timedOut) {
    spam(player, MESSAGES.timeUp);
    guardianSays(player, MESSAGES.guardianTimeUp);
  }
  return true;
}

/** The Guardian mummy's chatbox line, as live shows it when time runs out. */
function guardianSays(player, text) {
  const { DialogueChainBuilder, NpcDialogue, EndDialogue } = getCore();
  if (!DialogueChainBuilder || !NpcDialogue) return;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, ids().npc.guardian, text),
    new EndDialogue(1),
  ));
}

// --- Loot

function addOrDrop(player, itemId) {
  const { Item } = getCore();
  if (player.getInventory().getFreeSlots() > 0) {
    player.getInventory().addItem(new Item(itemId, 1));
    return true;
  }
  getCore().ItemOnGroundManager.registerLocation(player, new Item(itemId, 1), player.getLocation().clone());
  return false;
}

function giveArtefact(player, key) {
  addOrDrop(player, ids().item.artefacts[key]);
  return key;
}

/** Finding the sceptre ends the run at once, in an item box (as captured); with a full pack it lands outside. */
function awardSceptre(player) {
  endRun(player, { silent: true });
  const { Item, DialogueChainBuilder, ItemStatementDialogue } = getCore();
  const sceptre = ids().item.sceptre;
  if (player.getInventory().getFreeSlots() > 0) {
    player.getInventory().addItem(new Item(sceptre, 1));
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, sceptre, MESSAGES.sceptre)));
  } else {
    getCore().ItemOnGroundManager.registerLocation(player, new Item(sceptre, 1), location(DATA.outside));
    player.sendMessage(MESSAGES.sceptreDropped);
  }
}

function addXp(player, skill, xp) {
  if (xp > 0) player.getSkillManager().addExperiences(getCore().Skill[skill], xp);
}

function hit(player, amount) {
  const { HitDamage, HitMask } = getCore();
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED)]);
}

/** One tick-delayed action (animations land before the result, as in OSRS). */
function later(ticks, action) {
  const { Task, TaskManager } = getCore();
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

/**
 * Searching, picking and disarming each take a moment: a click during the last one is ignored,
 * so a failed roll can't be retried several times a tick. True when the player was free.
 */
function takeAction(run, ticks) {
  const now = getCore().World.getProcessCycle();
  if (now < run.busyUntil) return false;
  run.busyUntil = now + ticks;
  return true;
}

/** A container this run already opened can't be opened again (also after a reconnect). */
function claim(run, key) {
  if (run.cleared.has(key)) return false;
  run.cleared.add(key);
  return true;
}

module.exports = {
  armTrap,
  sound,
  areaSound,
  spam,
  busy,
  DATA,
  ROOMS,
  LAST_ROOM,
  MESSAGES,
  RUN_ATTRIBUTE,
  PLAYED_ATTRIBUTE,
  TIMED_OUT_ATTRIBUTE,
  OVERLAY_HUD_UID,
  state,
  sessions,
  bind,
  getCore,
  getApi,
  ids,
  roomData,
  sessionOf,
  thievingLevel,
  baseThievingLevel,
  strengthLevel,
  skillChance,
  chanceOf,
  sarcophagusChance,
  roll,
  pickWeighted,
  rollChestArtefact,
  rollSarcophagusArtefact,
  rollUrnArtefact,
  rollSceptre,
  sceptreMultiplier,
  rollHit,
  roomAt,
  location,
  send,
  varbitOf,
  resetRoomVarbits,
  sendRoomHud,
  sendTimer,
  elapsedTicks,
  rollRoomExits,
  takeAction,
  currentEntrance,
  startRun,
  enterRoom,
  endRun,
  addOrDrop,
  giveArtefact,
  awardSceptre,
  addXp,
  hit,
  later,
  claim,
};
