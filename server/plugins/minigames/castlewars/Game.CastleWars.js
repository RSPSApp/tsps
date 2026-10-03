"use strict";

/**
 * Castle Wars match state and the helpers every unit shares: teams, the overlay vars, team
 * colours and game items, the flags, barricade bookkeeping, castle object swaps, and the match
 * lifecycle (countdown, start, rewards, end). The returned object is the `game` each
 * *.CastleWars.js unit receives; Areas.CastleWars.js fills in the areas.
 */

const castleWarsData = require("./Data.CastleWars");

let api;
let core;
let data;
let AreaManager;
let BonusManager;
let ObjectManager;
let RegionManager;
let TaskManager;
let World;
let game;

const PHASE = { IDLE: "idle", STARTING: "starting", ACTIVE: "active", ENDING: "ending" };
// Player attribute keys (objects, so they can't collide with anyone else's).
const BOT_KEY = {};
const TRANSITION_KEY = {};
const IDLE_TICKS_KEY = "castlewars:idle-ticks";
const SPAWN_IDLE_TICKS = 200;

const teamByPlayer = new WeakMap();
const sentVars = new WeakMap();
const braceletEffect = new WeakSet();
const barricades = new Set();
const objectSwaps = [];
let teamVars;
let flagStatus;
let score;
let droppedFlagObjects;
let phase = PHASE.IDLE;
let startTask = null;
let endTask = null;

// --- Vars and overlays -------------------------------------------------------------------

/** Sends a varp/varbit only when it changed for this player. */
function setVar(player, id, value, varbit = false) {
  let cache = sentVars.get(player);
  if (!cache) {
    sentVars.set(player, (cache = new Map()));
  }
  const key = `${varbit ? "b" : "p"}${id}`;
  if (cache.get(key) === value) {
    return;
  }
  cache.set(key, value);
  const sender = player.getPacketSender();
  if (varbit) {
    sender.sendVarbit(id, value);
  } else {
    sender.sendConfig(id, value);
  }
}

function closeOverlay(player) {
  sentVars.delete(player);
  player.getPacketSender().closeSubInterface(data.OVERLAY_HUD_UID);
}

function secondsToTicks(seconds) {
  return Math.max(1, Math.ceil(core.Misc.getTicks(seconds)));
}

function startSecondsLeft() {
  return startTask?.isRunning?.() ? Math.ceil((startTask.getRemainingTicks() | 0) * 0.6) : 0;
}

function gameMinutesLeft() {
  return Math.ceil(((endTask?.getRemainingTicks?.() ?? 0) * 0.6) / 60);
}

// --- Tiles -------------------------------------------------------------------------------

function getLocationTile(target) {
  const location = target?.getLocation?.() ?? target;
  if (!location) {
    return null;
  }
  return {
    x: location.getX?.() ?? location.x,
    y: location.getY?.() ?? location.y,
    z: location.getZ?.() ?? location.z,
  };
}

function isAt(target, x, y, z) {
  const tile = getLocationTile(target);
  return tile != null && tile.x === x && tile.y === y && tile.z === z;
}

function inGameBounds(location) {
  return data.GAME_BOUNDS.some((boundary) => boundary.inside(location));
}

// --- Teams -------------------------------------------------------------------------------

function getTeamId(player) {
  return teamByPlayer.get(player) ?? null;
}

function setTeamId(player, teamId) {
  if (!player) {
    return;
  }
  if (teamId == null) {
    teamByPlayer.delete(player);
    return;
  }
  teamByPlayer.set(player, teamId);
}

function getTeamData(teamId) {
  return teamId ? data.TEAM_DATA[teamId] ?? null : null;
}

function opposingTeam(teamId) {
  return teamId === data.TEAM.SARADOMIN ? data.TEAM.ZAMORAK : data.TEAM.SARADOMIN;
}

function getTeamMembersInGame(teamId) {
  return game.gameArea.getPlayers().filter((player) => getTeamId(player) === teamId);
}

function getTeamVar(teamId, varbit) {
  return teamVars[teamId]?.get(varbit) ?? data.TEAM_VARBIT_DEFAULTS[varbit] ?? 0;
}

function setTeamVar(teamId, varbit, value) {
  teamVars[teamId].set(varbit, value);
}

function isPlaying(player) {
  return phase === PHASE.ACTIVE && getTeamId(player) != null;
}

/** For castle-only objects: refuses out loud instead of letting the click fall through silently. */
function resetIdleTicks(player) {
  player.setAttribute(IDLE_TICKS_KEY, SPAWN_IDLE_TICKS);
}

function requirePlaying(player) {
  if (isPlaying(player)) {
    return true;
  }
  player.sendMessage("You can only do that during a game of Castle Wars.");
  return false;
}

// --- Castle objects ----------------------------------------------------------------------

/** Swaps one castle object for another (either may be null) and remembers it, so the castle is rebuilt between games. */
function swapObject(from, to) {
  if (from) {
    ObjectManager.deregister(from, true);
  }
  if (to) {
    ObjectManager.register(to, true);
  }
  objectSwaps.push([from, to]);
}

function restoreObjects() {
  for (const [from, to] of objectSwaps.splice(0).reverse()) {
    if (to) {
      ObjectManager.deregister(to, true);
    }
    if (from) {
      ObjectManager.register(from, true);
    }
  }
}

/**
 * Castle stairs, ladders and trapdoors use the shared ladder climb (Ladders.plugin.js): it waits
 * out the arrival step (arriveDelay) and plays the climb before moving.
 */
function climbTo(player, to) {
  const destination = new core.Location(to[0], to[1], to[2]);
  const direction = to[2] < player.getLocation().getZ() ? "ladders:climbDown" : "ladders:climbUp";
  api.emitCustomEvent(direction, { player, destination });
}

// --- Equipment and game items ------------------------------------------------------------

function refreshPlayerAppearance(player, weaponChanged = false) {
  if (weaponChanged) {
    core.WeaponInterfaceManager.assign(player);
    player.setSpecialActivated(false);
    player.getPacketSender().sendSpecialAttackState(false);
  }
  BonusManager.update(player);
  player.getEquipment().refreshItems();
  player.getInventory().refreshItems();
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function equipTeamColours(player, teamId) {
  const team = getTeamData(teamId);
  player.getEquipment().setItem(core.Equipment.CAPE_SLOT, new core.Item(team.capeId, 1));
  player.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(team.hoodId, 1));
  refreshPlayerAppearance(player);
}

function clearWeaponSlot(player) {
  if (player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT) === -1) {
    return;
  }
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  refreshPlayerAppearance(player, true);
}

function clearCastleWarsItems(player, ids = data.CLEANUP_ITEM_IDS) {
  const { HEAD_SLOT, CAPE_SLOT, WEAPON_SLOT } = core.Equipment;
  let weaponChanged = false;
  for (const slot of [HEAD_SLOT, CAPE_SLOT, WEAPON_SLOT]) {
    if (!ids.has(player.getEquipment().getSlot(slot))) {
      continue;
    }
    weaponChanged ||= slot === WEAPON_SLOT;
    player.getEquipment().setItem(slot, new core.Item(-1, 0));
  }
  for (const itemId of ids) {
    const amount = player.getInventory().getAmount(itemId);
    if (amount > 0) {
      player.getInventory().delete(itemId, amount);
    }
  }
  refreshPlayerAppearance(player, weaponChanged);
}

/** A worn Castle wars bracelet spends a charge as the game starts, and is active for that game. */
function chargeBracelet(player) {
  const { HANDS_SLOT } = core.Equipment;
  const next = data.BRACELET_NEXT[player.getEquipment().getSlot(HANDS_SLOT)];
  if (next === undefined) {
    return;
  }
  player.getEquipment().setItem(HANDS_SLOT, new core.Item(next, next === -1 ? 0 : 1));
  braceletEffect.add(player);
  refreshPlayerAppearance(player);
}

function hasBraceletEffect(player) {
  return braceletEffect.has(player);
}

function clearBraceletEffect(player) {
  braceletEffect.delete(player);
}

// --- Flags -------------------------------------------------------------------------------

function getCarriedFlagTeam(player) {
  const carriedId = player?.getEquipment?.()?.getSlot?.(core.Equipment.WEAPON_SLOT) ?? -1;
  const { SARADOMIN_BANNER, ZAMORAK_BANNER } = core.ItemIdentifiers;
  return carriedId === SARADOMIN_BANNER ? data.TEAM.SARADOMIN : carriedId === ZAMORAK_BANNER ? data.TEAM.ZAMORAK : null;
}

function sendGameHintRemoval(location = null) {
  for (const player of game.gameArea.getPlayers()) {
    player.getPacketSender().sendEntityHintRemoval(true);
    if (location) {
      player.getPacketSender().sendPositionalHint(location, -1);
    }
  }
}

function showCarrierHint(carrier, flagTeam) {
  sendGameHintRemoval();
  for (const player of getTeamMembersInGame(flagTeam)) {
    player.getPacketSender().sendEntityHint(carrier);
  }
  carrier.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function showDroppedFlagHint(location) {
  sendGameHintRemoval();
  for (const player of game.gameArea.getPlayers()) {
    player.getPacketSender().sendPositionalHint(location, 2);
  }
}

function removeDroppedFlagObject(flagTeam) {
  const dropped = droppedFlagObjects[flagTeam];
  if (!dropped) {
    return;
  }
  ObjectManager.deregister(dropped, true);
  sendGameHintRemoval(dropped.getLocation());
  droppedFlagObjects[flagTeam] = null;
}

function updateFlagStand(flagTeam, objectId) {
  ObjectManager.register(new core.GameObject(objectId, getTeamData(flagTeam).standLocation, 10, 2, null), true);
}

function restoreFlagToBase(flagTeam) {
  removeDroppedFlagObject(flagTeam);
  flagStatus[flagTeam] = 0;
  updateFlagStand(flagTeam, getTeamData(flagTeam).safeStandId);
  sendGameHintRemoval();
}

function carryFlag(player, flagTeam) {
  flagStatus[flagTeam] = 1;
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(getTeamData(flagTeam).bannerId, 1));
  refreshPlayerAppearance(player, true);
  showCarrierHint(player, flagTeam);
}

function isSteppingStone(tile) {
  return (
    (tile.x >= 2418 && tile.x <= 2420 && tile.y >= 3122 && tile.y <= 3125) ||
    (tile.x >= 2377 && tile.x <= 2378 && tile.y >= 3084 && tile.y <= 3088)
  );
}

/** Drops a carried flag where the carrier stands; dropped on the stepping stones, it goes home. */
function dropCarriedFlag(player) {
  const carriedFlagTeam = getCarriedFlagTeam(player);
  if (!carriedFlagTeam) {
    return;
  }
  clearWeaponSlot(player);
  const tile = getLocationTile(player);
  if (tile && isSteppingStone(tile)) {
    restoreFlagToBase(carriedFlagTeam);
    return;
  }
  flagStatus[carriedFlagTeam] = 2;
  const dropped = new core.GameObject(
    getTeamData(carriedFlagTeam).droppedFlagObjectId,
    player.getLocation().clone(),
    10,
    0,
    player.getPrivateArea()
  );
  droppedFlagObjects[carriedFlagTeam] = dropped;
  ObjectManager.register(dropped, true);
  showDroppedFlagHint(dropped.getLocation());
}

// --- Barricades --------------------------------------------------------------------------

function trackBarricade(npc, teamId) {
  const location = npc.getLocation();
  npc.castleWarsTeam = teamId;
  barricades.add(npc);
  RegionManager.addClipping(location.getX(), location.getY(), location.getZ(), RegionManager.BLOCKED_TILE, npc.getPrivateArea());
}

function teamBarricadeCount(teamId) {
  return [...barricades].filter((npc) => npc.castleWarsTeam === teamId).length;
}

function isBarricade(npc) {
  return barricades.has(npc);
}

function releaseBarricade(npc) {
  if (!barricades.delete(npc)) {
    return;
  }
  const location = npc.getLocation();
  RegionManager.removeClipping(location.getX(), location.getY(), location.getZ(), RegionManager.BLOCKED_TILE, npc.getPrivateArea());
}

function removeBarricade(npc) {
  releaseBarricade(npc);
  const addQueue = World.getAddNPCQueue();
  const removeQueue = World.getRemoveNPCQueue();
  const pendingIndex = addQueue.indexOf(npc);
  if (pendingIndex !== -1) {
    addQueue.splice(pendingIndex, 1);
  } else if (npc.isRegistered?.() && !removeQueue.includes(npc)) {
    removeQueue.push(npc);
  }
}

// --- Match lifecycle ---------------------------------------------------------------------

function queueCounts() {
  const { SARADOMIN, ZAMORAK } = data.TEAM;
  return {
    [SARADOMIN]: game.waitingAreas[SARADOMIN].getPlayers().length,
    [ZAMORAK]: game.waitingAreas[ZAMORAK].getPlayers().length,
  };
}

function bothTeamsQueued() {
  const counts = queueCounts();
  return counts[data.TEAM.SARADOMIN] > 0 && counts[data.TEAM.ZAMORAK] > 0;
}

function cancelStartCountdown() {
  if (startTask?.isRunning?.()) {
    startTask.stop();
  }
  TaskManager.cancelTasks(data.START_TASK_KEY);
  startTask = null;
  if (phase === PHASE.STARTING) {
    phase = PHASE.IDLE;
  }
}

function cancelEndCountdown() {
  if (endTask?.isRunning?.()) {
    endTask.stop();
  }
  TaskManager.cancelTasks(data.END_TASK_KEY);
  endTask = null;
}

function resetMatchState() {
  for (const npc of [...barricades]) {
    removeBarricade(npc);
  }
  restoreObjects();
  teamVars[data.TEAM.SARADOMIN].clear();
  teamVars[data.TEAM.ZAMORAK].clear();
  api.emitCustomEvent("castlewars:reset", {});
  score[data.TEAM.SARADOMIN] = 0;
  score[data.TEAM.ZAMORAK] = 0;
  restoreFlagToBase(data.TEAM.SARADOMIN);
  restoreFlagToBase(data.TEAM.ZAMORAK);
}

function beginStartCountdown() {
  if (phase !== PHASE.IDLE || !bothTeamsQueued()) {
    return;
  }
  phase = PHASE.STARTING;
  startTask = new core.CountdownTask(data.START_TASK_KEY, secondsToTicks(data.START_COUNTDOWN_SECONDS), startGame);
  TaskManager.submit(startTask);
}

/** Cancels a pending start when one side of the queue has emptied. */
function checkStartCountdown() {
  if (phase === PHASE.STARTING && !bothTeamsQueued()) {
    cancelStartCountdown();
  }
}

function rewardPlayer(player) {
  const teamId = getTeamId(player);
  if (!teamId) {
    return;
  }
  // OSRS Wiki, non-dedicated worlds: shut-out win 3, win 2, loss 1, 0-0 draw 1, scoring draw 2.
  const own = score[teamId];
  const other = score[opposingTeam(teamId)];
  const tickets = own === other ? (own === 0 ? 1 : 2) : own < other ? 1 : other === 0 ? 3 : 2;
  const result = own === other ? "Tie game!" : own > other ? "You won the game." : "You lost the game.";
  player.getInventory().adds(core.ItemIdentifiers.CASTLE_WARS_TICKET, tickets);
  player.sendMessage(`${result} You received ${tickets} Castle Wars ticket${tickets === 1 ? "" : "s"}.`);
}

function returnToLobby(player, message = null) {
  if (message) {
    player.sendMessage(message);
  }
  if (player.getAttribute(BOT_KEY) === true) {
    player.getForcedLogoutTimer().start(0);
    player.requestLogout();
    return;
  }
  player.smartMove(data.LOBBY_TELEPORT, 4);
}

function startGame() {
  startTask = null;
  if (!bothTeamsQueued()) {
    phase = PHASE.IDLE;
    return;
  }
  phase = PHASE.ACTIVE;
  resetMatchState();
  for (const teamId of Object.values(data.TEAM)) {
    for (const player of [...game.waitingAreas[teamId].getPlayers()]) {
      resetIdleTicks(player);
      chargeBracelet(player);
      player.setAttribute(TRANSITION_KEY, true);
      closeOverlay(player);
      player.smartMove(getTeamData(teamId).startRoom, 3);
    }
  }
  endTask = new core.CountdownTask(data.END_TASK_KEY, secondsToTicks(data.GAME_SECONDS), endGame);
  TaskManager.submit(endTask);
}

function endGame() {
  if (phase === PHASE.ENDING || phase === PHASE.IDLE) {
    return;
  }
  phase = PHASE.ENDING;
  cancelStartCountdown();
  cancelEndCountdown();
  for (const player of [...game.gameArea.getPlayers()]) {
    rewardPlayer(player);
    clearCastleWarsItems(player);
    setTeamId(player, null);
    closeOverlay(player);
    player.getPacketSender().sendInteractionOption("null", 2, true);
    returnToLobby(player);
  }
  resetMatchState();
  phase = PHASE.IDLE;
}

/** Ends the game once a side has nobody left in it. */
function checkTeamsRemain() {
  if (phase !== PHASE.ACTIVE) {
    return;
  }
  const { SARADOMIN, ZAMORAK } = data.TEAM;
  if (game.gameArea.getPlayers().length < 2 || getTeamMembersInGame(SARADOMIN).length === 0 || getTeamMembersInGame(ZAMORAK).length === 0) {
    endGame();
  }
}

function later(ticks, callback) {
  TaskManager.submit(new core.CountdownTask({}, ticks, callback));
}

module.exports = function createCastleWarsGame(registry) {
  api = registry;
  core = registry.core;
  data = castleWarsData(core);
  AreaManager = registry.getAreaManager();
  BonusManager = registry.getBonusManager();
  ObjectManager = registry.getObjectManager();
  RegionManager = registry.getRegionManager();
  TaskManager = registry.getTaskManager();
  World = registry.getWorld();
  const { SARADOMIN, ZAMORAK } = data.TEAM;
  teamVars = { [SARADOMIN]: new Map(), [ZAMORAK]: new Map() };
  flagStatus = { [SARADOMIN]: 0, [ZAMORAK]: 0 };
  score = { [SARADOMIN]: 0, [ZAMORAK]: 0 };
  droppedFlagObjects = { [SARADOMIN]: null, [ZAMORAK]: null };

  game = {
    data,
    TEAM: data.TEAM,
    TEAM_VARBIT: data.TEAM_VARBIT,
    PHASE,
    BOT_KEY,
    TRANSITION_KEY,
    IDLE_TICKS_KEY,
    AreaManager,
    // Filled in by Areas.CastleWars.js.
    lobbyArea: null,
    waitingAreas: null,
    gameArea: null,
    castleWarsAreas: null,
    getPhase: () => phase,
    flagStatus,
    score,
    setVar,
    closeOverlay,
    startSecondsLeft,
    gameMinutesLeft,
    getLocationTile,
    isAt,
    inGameBounds,
    getTeamId,
    setTeamId,
    getTeamData,
    opposingTeam,
    getTeamMembersInGame,
    getTeamVar,
    setTeamVar,
    isPlaying,
    requirePlaying,
    resetIdleTicks,
    swapObject,
    climbTo,
    refreshPlayerAppearance,
    equipTeamColours,
    clearWeaponSlot,
    clearCastleWarsItems,
    hasBraceletEffect,
    clearBraceletEffect,
    getCarriedFlagTeam,
    sendGameHintRemoval,
    removeDroppedFlagObject,
    updateFlagStand,
    restoreFlagToBase,
    carryFlag,
    dropCarriedFlag,
    trackBarricade,
    teamBarricadeCount,
    isBarricade,
    releaseBarricade,
    removeBarricade,
    queueCounts,
    beginStartCountdown,
    checkStartCountdown,
    checkTeamsRemain,
    resetMatchState,
    returnToLobby,
    later,
  };
  return game;
};
