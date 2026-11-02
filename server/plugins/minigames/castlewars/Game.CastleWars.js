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
let flagCarriers;
let score;
let droppedFlagObjects;
let phase = PHASE.IDLE;
let startTask = null;
let endTask = null;
let flagHintTask = null;

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
  for (const varbit of Object.values(data.TEAM_PLAYING_VARBIT)) setVar(player, varbit, 0, true);
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

/** Castle Wars stairs change floor immediately, so another click can follow on the next tick. */
function climbTo(player, to) {
  const destination = new core.Location(to[0], to[1], to[2]);
  player.getMovementQueue().reset();
  player.moveTo(destination);
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
  const { CAPE_SLOT, WEAPON_SLOT } = core.Equipment;
  let weaponChanged = false;
  for (const slot of [CAPE_SLOT, WEAPON_SLOT]) {
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

function removeDroppedFlagObject(flagTeam) {
  const dropped = droppedFlagObjects[flagTeam];
  if (!dropped) {
    return;
  }
  ObjectManager.deregister(dropped, true);
  droppedFlagObjects[flagTeam] = null;
}

function updateFlagStand(flagTeam, objectId) {
  const team = getTeamData(flagTeam);
  ObjectManager.register(new core.GameObject(objectId, team.standLocation, team.standType, team.standFace, null), true);
}

function restoreFlagToBase(flagTeam, cause = "reset") {
  removeDroppedFlagObject(flagTeam);
  flagStatus[flagTeam] = 0;
  flagCarriers[flagTeam] = null;
  updateFlagStand(flagTeam, getTeamData(flagTeam).safeStandId);
  if (process.env.CW_BOT_DEBUG === "1") {
    console.log(`[cw_flag] restore ${flagTeam} (${cause})`);
  }
}

function carryFlag(player, flagTeam) {
  player.getCombat().reset();
  player.getCombat().setCastSpell(null);
  flagStatus[flagTeam] = 1;
  flagCarriers[flagTeam] = player;
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(getTeamData(flagTeam).bannerId, 1));
  refreshPlayerAppearance(player, true);
  if (process.env.CW_BOT_DEBUG === "1") {
    console.log(`[cw_flag] carry ${flagTeam} by ${player.getUsername?.()}`);
  }
}

function isSteppingStone(tile) {
  return (
    (tile.x >= 2418 && tile.x <= 2420 && tile.y >= 3122 && tile.y <= 3125) ||
    (tile.x >= 2377 && tile.x <= 2378 && tile.y >= 3084 && tile.y <= 3088)
  );
}

function isInsideCastle(player, teamId) {
  const { x, y, z } = getLocationTile(player);
  if (z < 0 || z > 3) return false;
  // The large and side doors bound the interior; their outside approach tiles
  // must still allow defenders to hold their standard.
  return teamId === data.TEAM.SARADOMIN
    ? x >= 2415 && x <= 2432 && y >= 3072 && y <= 3087
    : x >= 2368 && x <= 2384 && y >= 3120 && y <= 3136;
}

/** The team this player is recorded as carrying for, banner still equipped or not. */
function carriedTeamOf(player) {
  for (const teamId of Object.keys(flagCarriers)) {
    if (flagCarriers[teamId] === player) {
      return teamId;
    }
  }
  return null;
}

/** Put the dropped standard on the floor where the player stands. */
function placeDroppedFlag(flagTeam, player) {
  // One standard per team: remove whatever drop a previous life left behind, so repeated
  // deaths in the same spot cannot stack flag objects.
  removeDroppedFlagObject(flagTeam);
  const otherTeam = opposingTeam(flagTeam);
  const otherDrop = droppedFlagObjects[otherTeam];
  // The client has one scenery slot per tile. Returning the dropper's own standard
  // keeps the enemy standard available instead of hiding one beneath the other.
  if (otherDrop?.getLocation().equals(player.getLocation())) {
    const ownTeam = getTeamId(player);
    restoreFlagToBase(ownTeam, "overlap");
    if (flagTeam === ownTeam) return;
  }
  flagStatus[flagTeam] = 2;
  flagCarriers[flagTeam] = null;
  if (process.env.CW_BOT_DEBUG === "1") {
    const tile = getLocationTile(player);
    console.log(`[cw_flag] drop ${flagTeam} by ${player.getUsername?.()} at ${tile.x},${tile.y},${tile.z}`);
  }
  const dropped = new core.GameObject(
    getTeamData(flagTeam).droppedFlagObjectId,
    player.getLocation().clone(),
    10,
    0,
    player.getPrivateArea()
  );
  droppedFlagObjects[flagTeam] = dropped;
  ObjectManager.register(dropped, true);
}

/**
 * Removes every dropped-standard object inside the arena, tracked or stray: drops from
 * older sessions lingered on the floor and each new carry stacked another one.
 */
function clearStrayDroppedFlags() {
  // The dropped-standard ids are Castle Wars-only, so every instance goes no matter the
  // floor: AreaManager.inside is z-gated and never matched the flag rooms upstairs, which
  // let orphaned drops pile up there across matches.
  const ids = new Set(Object.values(data.TEAM_DATA).map((team) => team.droppedFlagObjectId));
  for (const list of [...core.MapObjects.mapObjects.values()]) {
    for (const object of [...list]) {
      if (ids.has(object.getId())) {
        ObjectManager.deregister(object, true);
      }
    }
  }
  droppedFlagObjects[data.TEAM.SARADOMIN] = null;
  droppedFlagObjects[data.TEAM.ZAMORAK] = null;
}

/** Drops a carried flag where the carrier stands; dropped on the stepping stones, it goes home. */
function dropCarriedFlag(player) {
  // The equipment is authoritative for live carries; the tracked carrier covers deaths
  // whose item processing stripped the banner before this ran (bot deaths are handled
  // by the bot loot system, which removes the banner without emitting an item drop).
  const carriedFlagTeam = getCarriedFlagTeam(player) ?? carriedTeamOf(player);
  if (!carriedFlagTeam) {
    return;
  }
  if (flagStatus[carriedFlagTeam] !== 1) {
    flagCarriers[carriedFlagTeam] = null;
    return;
  }
  clearWeaponSlot(player);
  const tile = getLocationTile(player);
  if (tile && isSteppingStone(tile)) {
    restoreFlagToBase(carriedFlagTeam, "stones");
    return;
  }
  placeDroppedFlag(carriedFlagTeam, player);
}

// --- Barricades --------------------------------------------------------------------------

function trackBarricade(npc, teamId) {
  npc.castleWarsTeam = teamId;
  npc.setFlag(core.NPC.BLOCKS_PLAYERS_FLAG);
  barricades.add(npc);
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
  npc.removeFlag(core.NPC.BLOCKS_PLAYERS_FLAG);
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
  clearStrayDroppedFlags();
  clearFlagHints();
}

function beginStartCountdown() {
  if (phase !== PHASE.IDLE || !bothTeamsQueued()) {
    return;
  }
  phase = PHASE.STARTING;
  const hasBots = Object.values(game.waitingAreas).some((area) =>
    area.getPlayers().some((player) => player.getAttribute(BOT_KEY) === true));
  const seconds = hasBots ? data.BOT_START_COUNTDOWN_SECONDS : data.START_COUNTDOWN_SECONDS;
  startTask = new core.CountdownTask(data.START_TASK_KEY, secondsToTicks(seconds), startGame);
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
  const award = { player, minigame: "castle-wars", points: own === other ? (own === 0 ? 1 : 2) : own < other ? 1 : other === 0 ? 3 : 2 };
  api.emitCustomEvent("minigame:points", award);
  const tickets = award.points;
  const result = own === other ? "Tie game!" : own > other ? "You won the game." : "You lost the game.";
  if (player.getAttribute(BOT_KEY) !== true) {
    api.emitCustomEvent("castlewars:player-result", { player, result: own === other ? "tie" : own > other ? "win" : "loss" });
  }
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
      api.emitCustomEvent("castlewars:started-player", { player });
      player.setAttribute(TRANSITION_KEY, true);
      closeOverlay(player);
      player.smartMove(getTeamData(teamId).startRoom, 3);
    }
  }
  // A bot that missed the waiting room (still walking, or queued late) would sit in the lobby
  // for the whole match — and its presence then blocks the next empty-lobby prompt.
  for (const player of [...(game.lobbyArea?.getPlayers() ?? [])]) {
    if (player.getAttribute(BOT_KEY) !== true) {
      continue;
    }
    const teamId = getTeamId(player);
    if (teamId == null) {
      continue;
    }
    resetIdleTicks(player);
    chargeBracelet(player);
    api.emitCustomEvent("castlewars:started-player", { player });
    player.setAttribute(TRANSITION_KEY, true);
    closeOverlay(player);
    player.moveTo(getTeamData(teamId).startRoom);
  }
  endTask = new core.CountdownTask(data.END_TASK_KEY, secondsToTicks(data.GAME_SECONDS), endGame);
  TaskManager.submit(endTask);
  startFlagHints();
}

/** Every ground item inside the arena: arrows, bones and dropped supplies go with the match. */
function clearGroundItems() {
  const area = game.gameArea;
  if (!area || typeof World.getItems !== "function") {
    return;
  }
  for (const item of [...World.getItems()]) {
    const at = item.getPosition();
    // The arena's boundaries carry z0; probe at z0 so items left on the upper floors
    // (flag rooms, battlements walkways) are cleared too.
    if (AreaManager.inside(new core.Location(at.getX(), at.getY(), 0), area)) {
      core.ItemOnGroundManager.deregister(item);
    }
  }
}

/**
 * The yellow flag arrow every player sees: their opponents' standard while it is carried
 * (an overhead player hint, so it rides the carrier's head like a head icon) or lying
 * dropped (a tile hint at the flag). The client blinks both natively.
 *
 * This task is the only writer of the match's native hint arrow. Its WeakMap holds the last
 * target sent per player so a stationary flag does not spam packets, and it still re-sends
 * every HINT_REFRESH_MS in case any other system cleared the arrow behind its back.
 */
// Keyed by player so a hint can be cleared later even after the player has left the arena
// (area-membership lists miss anyone who crossed the boundary at the wrong tick).
const hintState = new Map();
const HINT_REFRESH_MS = 2000;
/** OSRS hint height byte (x2 world units): about 0.7 of a tile, where the arrow sat before heights were sent. */
const FLAG_HINT_HEIGHT = 45;

function updateFlagHint(player) {
  const teamId = getTeamId(player);
  if (teamId == null) {
    return;
  }
  const flagTeam = opposingTeam(teamId);
  const sender = player.getPacketSender();
  let flagLocation = null;
  let carrier = null;
  if (flagStatus[flagTeam] === 1) {
    for (const other of game.gameArea.getPlayers()) {
      if (getCarriedFlagTeam(other) === flagTeam) {
        carrier = other;
        flagLocation = other.getLocation();
        break;
      }
    }
  } else if (flagStatus[flagTeam] === 2 && droppedFlagObjects[flagTeam]) {
    flagLocation = droppedFlagObjects[flagTeam].getLocation();
  }
  if (!flagLocation) {
    if (
      flagStatus[flagTeam] !== 0 &&
      process.env.CW_BOT_DEBUG === "1" &&
      player.getUsername?.() === process.env.CW_BOT_DEBUG_USER
    ) {
      console.log(`[cw_hint] ${player.getUsername?.()} flag=${flagTeam} out (status=${flagStatus[flagTeam]}) but no carrier found`);
    }
    if (hintState.has(player)) {
      hintState.delete(player);
      sender.clearHintArrow();
    }
    return;
  }
  const key = carrier
    ? `p:${carrier.getIndex()}`
    : `t:${flagLocation.getX()},${flagLocation.getY()},${flagLocation.getZ()}`;
  const sent = hintState.get(player);
  const nowMs = Date.now();
  if (sent?.key !== key || nowMs - sent.at >= HINT_REFRESH_MS) {
    hintState.set(player, { key, at: nowMs });
    if (carrier) {
      // Type 3 (player) renders through the head-icon pass, following the head smoothly.
      sender.sendPlayerHint(carrier);
    } else {
      // A little above the flag's tile, on its own plane: a client on another floor must not draw it.
      sender.sendPositionalHint(flagLocation, 2, FLAG_HINT_HEIGHT, flagLocation.getZ());
    }
    if (process.env.CW_BOT_DEBUG === "1" && player.getUsername?.() === process.env.CW_BOT_DEBUG_USER) {
      console.log(`[cw_hint] ${player.getUsername?.()} flag=${flagTeam} at ${key}`);
    }
  }
}

function clearFlagHints() {
  let cleared = 0;
  for (const player of hintState.keys()) {
    player.getPacketSender?.()?.clearHintArrow?.();
    cleared += 1;
  }
  hintState.clear();
  if (process.env.CW_BOT_DEBUG === "1" && cleared > 0) {
    console.log(`[cw_hint] clearFlagHints cleared=${cleared}`);
  }
}

/** One lightweight task for the whole match; it stops with the phase and clears on the way out. */
function startFlagHints() {
  stopFlagHints();
  if (process.env.CW_BOT_DEBUG === "1") {
    console.log("[cw_hint] task started");
  }
  // Every tick, not every other: a walking carrier must not drag the arrow a tile behind.
  const task = new core.Task(1);
  task.execute = () => {
    if (phase !== PHASE.ACTIVE || !game.gameArea) {
      clearFlagHints();
      task.stop();
      flagHintTask = null;
      return;
    }
    for (const player of game.gameArea.getPlayers()) {
      updateFlagHint(player);
    }
  };
  flagHintTask = task;
  TaskManager.submit(task);
}

function stopFlagHints() {
  if (flagHintTask) {
    flagHintTask.stop();
    flagHintTask = null;
  }
  clearFlagHints();
}

function endGame() {
  if (phase === PHASE.ENDING || phase === PHASE.IDLE) {
    return;
  }
  phase = PHASE.ENDING;
  cancelStartCountdown();
  cancelEndCountdown();
  clearGroundItems();
  // Clear the flag arrows while everyone is still in the area: the hint task stops below
  // and would otherwise find no players left to clear.
  stopFlagHints();
  recordWinner();
  for (const player of [...game.gameArea.getPlayers()]) {
    rewardPlayer(player);
    clearCastleWarsItems(player);
    setTeamId(player, null);
    closeOverlay(player);
    player.getPacketSender().sendPlayerOption(data.ATTACK_OPTION_SLOT, "", false);
    returnToLobby(player);
  }
  // Bots that missed the start sit in the lobby or a waiting room instead of the game area;
  // log them out here too or they squat the next lobby (and its prompt).
  for (const area of [game.lobbyArea, ...Object.values(game.waitingAreas ?? {})].filter(Boolean)) {
    for (const player of [...area.getPlayers()]) {
      if (player.getAttribute(BOT_KEY) === true) {
        clearCastleWarsItems(player);
        setTeamId(player, null);
        returnToLobby(player);
      }
    }
  }
  resetMatchState();
  phase = PHASE.IDLE;
}

/**
 * The scoreboard's team win: the side ahead, when a real (non-bot) player of that side is still
 * in the game at the end. A bot-only game, or one whose leading side has left, is no team's win.
 */
function recordWinner() {
  const { SARADOMIN, ZAMORAK } = data.TEAM;
  if (score[SARADOMIN] === score[ZAMORAK]) {
    return;
  }
  const team = score[SARADOMIN] > score[ZAMORAK] ? SARADOMIN : ZAMORAK;
  if (getTeamMembersInGame(team).some((player) => player.getAttribute(BOT_KEY) !== true)) {
    api.emitCustomEvent("castlewars:game-won", { team });
  }
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

/**
 * Dev-seeded bots only exist for real players. Once no real player is left in the lobby, a
 * waiting room or the game, the bots log out; an active bot-only match ends instead of running
 * out the clock.
 */
function releaseSeededBots() {
  const waitingAreas = Object.values(game.waitingAreas ?? {});
  const areas = [game.lobbyArea, ...waitingAreas, game.gameArea].filter(Boolean);
  if (areas.some((area) => area.getPlayers().some((player) => player.getAttribute(BOT_KEY) !== true))) {
    return false;
  }
  if (phase === PHASE.ACTIVE) {
    endGame();
    return true;
  }
  let released = false;
  for (const area of [game.lobbyArea, ...waitingAreas].filter(Boolean)) {
    for (const bot of [...area.getPlayers()]) {
      if (bot.getAttribute(BOT_KEY) === true) {
        returnToLobby(bot);
        released = true;
      }
    }
  }
  return released;
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
  // Hint state holds a strong ref only while a hint is live; forget players on logout.
  registry.onPlayerLogout?.(({ player }) => hintState.delete(player));
  const { SARADOMIN, ZAMORAK } = data.TEAM;
  teamVars = { [SARADOMIN]: new Map(), [ZAMORAK]: new Map() };
  flagStatus = { [SARADOMIN]: 0, [ZAMORAK]: 0 };
  flagCarriers = { [SARADOMIN]: null, [ZAMORAK]: null };
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
    isSteppingStone,
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
    isInsideCastle,
    getDroppedFlagObject: (flagTeam) => droppedFlagObjects[flagTeam] ?? null,
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
    endGame,
    releaseSeededBots,
    resetMatchState,
    returnToLobby,
    later,
  };
  return game;
};
