"use strict";

/**
 * The one game every player on the world plays: the lobby, the rift opening, the creatures'
 * attack, the Great Guardian's power, the altars and huge-remains portals it opens, the win or
 * loss and the HUD that shows it all.
 *
 * rsprox captures (rev 241, a normal world, three games), in ticks from the rift opening:
 * - Lobby: "The rift will become active in 30/10/5 seconds." at -50/-16/-8, then "3...",
 *   "2...", "1..." on the last three ticks.
 * - 0: everyone north of the barrier joins (a new game id, `gotr_is_playing` 1,
 *   `gotr_player_has_finished_game` 0, the HUD), "<col=ef1020>The rift becomes active!" and a
 *   tick later "Creatures from the Abyss will attack in 120 seconds."; power is 10% of its
 *   maximum. The HUD's timer counts down to the attack.
 * - 200: "<col=ef1020>Creatures from the Abyss begin their attack!</col>"; an elemental and a
 *   catalytic altar open and change every 33 ticks (the HUD's timer counts down to the change).
 * - 256-266: the first huge-remains portal; later ones every 230-240 ticks, open 44 ticks.
 * - Full power: "@mes_hl_gre@The Great Guardian is fully charged.</col>", creatures die, the
 *   Great Guardian's three lines (+2, +18, +27) and the rift closes at +32 with the rewards and
 *   "The Portal Guardians will keep their rifts open for another 30 seconds."; 51 ticks after
 *   the close "The Portal Guardians close their rifts." and the next game opens 104 ticks after it.
 * - HUD script 5980 every other tick; its maximum power follows the players in the game.
 *
 * Wiki: the maximum power is 250 guardian stones per player, 200 for each past the 20th (the
 * captured maximums are all multiples of 200 that fit it); the game is lost at 0%.
 */

const Shared = require("./Shared.GuardiansOfTheRift");

const PHASE = {
  LOBBY: "lobby",
  PREPARE: "prepare",
  ATTACK: "attack",
  CHARGED: "charged",
  CLOSING: "closing",
};

/** Ticks, from the rsprox captures. */
const TIMING = {
  FIRST_LOBBY: 100,
  ATTACK: 200,
  ALTAR_ROTATION: 33,
  FIRST_PORTAL: [256, 266],
  NEXT_PORTAL: [230, 240],
  PORTAL_OPEN: 44,
  CHARGED_TO_CLOSE: 32,
  CHARGED_LINES: [[2, 0], [18, 1], [27, 2]],
  GRACE: 51,
  CLOSE_TO_OPEN: 104,
};

const COUNTDOWN = new Map([
  [50, "The rift will become active in 30 seconds."],
  [16, "The rift will become active in 10 seconds."],
  [8, "The rift will become active in 5 seconds."],
  [3, "3..."],
  [2, "2..."],
  [1, "1..."],
]);

const START_POWER_PERCENT = 10;
/** The lobby's first countdown line ("30 seconds"): an empty temple holds there, silently. */
const EMPTY_LOBBY_HOLD = 50;
const SURGE_PERCENT = 60;
const SURGE_SOUND = 1465;
const SURGE_SHAKE_TICKS = 2;
/**
 * Pearls for a game (ours; the Wiki awards them through the Rewards Guardian's loot table).
 * Contribution points plus energy are the performance score; a player who did one valid thing
 * gets a pearl, and every 100 points adds another. A player who never contributed earns none.
 */
const PEARL_SCORE_STEP = 100;
const PEARL_MAX_PER_GAME = 100;
/** "Closing the rift" jingle (rsprox captures). */
const VICTORY_JINGLE = 292;

/** Enum 4254 (the portal's direction) and enums 4270/4271 (the HUD's altar icons). */
const PORTAL_DIRECTIONS = { EAST: 1, SOUTH_EAST: 2, SOUTH_WEST: 3, SOUTH: 4 };
const ELEMENTAL_ALTARS = 4;
const CATALYTIC_ALTARS = 8;

const GREAT_GUARDIAN_LINES = [
  "Humans, I now have the power to close the rift. Thank you, brave ones.",
  "Now, for the final blow. Let the Scar be no more!",
  "Brace yourselves!",
];

const game = {
  phase: PHASE.LOBBY,
  /** Ticks into the phase's clock: until the open in the lobby, since the open in a game. */
  timer: TIMING.FIRST_LOBBY,
  elapsed: 0,
  power: 0,
  maxPower: 0,
  surged: false,
  altars: { elemental: 0, catalytic: 0, changesIn: 0 },
  portal: { direction: 0, closesIn: 0, opensIn: 0 },
  /** The players in the game (or waiting for it north of the barrier), with this game's numbers. */
  players: new Map(),
  /** Players with the HUD open: everyone in `players`. */
  riftGuardians: 0,
  /** How many adventurers were inside when the rift opened (Peek). */
  startingPlayers: 0,
  chargedAt: 0,
  /** Ticks since the server started: the clock the fighters' attack timers run on. */
  clock: 0,
  task: null,
  listeners: new Map(),
};

// ------------------------------------------------------------------ in-plugin events

/**
 * Units listen for the game's moments: open, attack, surge, charged, closed (per player), lost,
 * ended (once, won or lost), rifts-closed, portal-open, portal-close, altars, tick, join, leave.
 */
function on(event, handler) {
  if (!game.listeners.has(event)) game.listeners.set(event, []);
  game.listeners.get(event).push(handler);
}

function emit(event, payload) {
  for (const handler of game.listeners.get(event) ?? []) handler(payload);
}

// ------------------------------------------------------------------ queries

function phase() {
  return game.phase;
}

function isRunning() {
  return game.phase === PHASE.PREPARE || game.phase === PHASE.ATTACK || game.phase === PHASE.CHARGED;
}

/** The rift is open to the altars: from the creatures' attack until the Portal Guardians close. */
function altarsOpen() {
  return (game.phase === PHASE.ATTACK || game.phase === PHASE.CHARGED || game.phase === PHASE.CLOSING)
    && game.altars.elemental > 0;
}

function isPlaying(player) {
  return game.players.has(player);
}

function stateOf(player) {
  return game.players.get(player) ?? null;
}

function players() {
  return [...game.players.keys()];
}

function powerPercent() {
  if (game.maxPower <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((game.power * 100) / game.maxPower)));
}

function activeAltars() {
  return { elemental: game.altars.elemental, catalytic: game.altars.catalytic };
}

function portal() {
  return { direction: game.portal.direction, closesIn: game.portal.closesIn };
}

function setRiftGuardians(count) {
  game.riftGuardians = Math.max(0, count);
}

// ------------------------------------------------------------------ power

/** Wiki: 250 stones per player, 200 for each player past the 20th. */
function maxPowerFor(count) {
  const players = Math.max(1, count);
  return 250 * Math.min(players, 20) + 200 * Math.max(0, players - 20);
}

/** A player leaving lowers the maximum; the power can't stand above it. */
function updateMaxPower() {
  game.maxPower = maxPowerFor(game.players.size);
  game.power = Math.min(game.power, game.maxPower);
}

function addPower(amount) {
  if (game.phase !== PHASE.PREPARE && game.phase !== PHASE.ATTACK) return;
  game.power = Math.max(0, Math.min(game.maxPower, game.power + amount));
  if (!game.surged && powerPercent() >= SURGE_PERCENT) surge();
  // Only stones fed complete the charge: a drop in the maximum alone never wins the game.
  if (amount > 0 && game.power >= game.maxPower) charged();
  else if (game.power <= 0 && game.phase === PHASE.ATTACK) lose();
}

function setPower(percent) {
  if (!isRunning()) return;
  addPower(Math.round((game.maxPower * percent) / 100) - game.power);
}

// ------------------------------------------------------------------ energy

/** Wiki: 1,000 of each type and 1,200 in all; reaching the cap ends any more for the game. */
function addEnergy(player, type, amount) {
  const state = stateOf(player);
  if (!state || amount <= 0) return 0;
  const room = Math.min(Shared.MAX_ENERGY_PER_TYPE - state[type], Shared.MAX_ENERGY_TOTAL - state.elemental - state.catalytic);
  const gained = Math.max(0, Math.min(amount, room));
  if (gained <= 0) {
    player.sendMessage("You are fully attuned with runic energy and cannot earn anymore until the rift has been closed.");
    return 0;
  }
  state[type] += gained;
  state.participated = true;
  syncEnergy(player);
  return gained;
}

function syncEnergy(player) {
  const state = stateOf(player);
  Shared.setVarbit(player, Shared.VARBIT.ELEMENTAL_EARNED, state?.elemental ?? 0);
  Shared.setVarbit(player, Shared.VARBIT.CATALYTIC_EARNED, state?.catalytic ?? 0);
}

// ------------------------------------------------------------------ joining and leaving

function freshState() {
  return {
    elemental: 0, catalytic: 0, mined: 0, gameId: 0,
    /** This game's performance: the points each valid contribution adds. */
    contribution: 0,
    /** Set by any valid contribution or energy gain, never by simply standing in the game. */
    participated: false,
    /** The close pays once, even if the event is delivered again. */
    closedPaid: false,
  };
}

/**
 * A valid contribution to the game, from the units that do the work (mining, assembling a
 * guardian, feeding the Great Guardian, charging a barrier, crafting at an altar). Only a
 * running game counts; the lobby, the closing grace and a spectator earn nothing.
 */
function addContribution(player, points) {
  const state = stateOf(player);
  const amount = Math.max(0, Math.trunc(Number(points) || 0));
  if (!state || amount <= 0 || !isRunning()) return false;
  state.contribution += amount;
  state.participated = true;
  return true;
}

/** The pearls a closed game pays: participation first, then performance. */
function pearlsFor(state) {
  if (!state) return 0;
  const performance = Math.max(0, state.contribution)
    + Math.max(0, state.elemental) + Math.max(0, state.catalytic);
  if (!state.participated && performance <= 0) return 0;
  return Math.min(PEARL_MAX_PER_GAME, Math.max(1, Math.floor(performance / PEARL_SCORE_STEP)));
}

function newGameId() {
  return 1 + Math.floor(Math.random() * 0x7ffffffe);
}

/** Wiki: fragments, essence and talismans can't leave a game; pouches give up guardian essence too. */
function removeGameItems(player, items = Shared.GAME_ITEMS) {
  Shared.removeItems(player, items);
  Shared.api().emitCustomEvent("runecrafting:remove-guardian-essence", { player });
}

/** North of the barrier: into the game, or waiting for the next one. */
function join(player) {
  if (game.players.has(player)) return;
  const state = freshState();
  game.players.set(player, state);
  if (isRunning()) state.gameId = newGameId();
  Shared.setVarbit(player, Shared.VARBIT.IS_PLAYING, 1);
  if (state.gameId) {
    Shared.setVarp(player, Shared.VARP.GAME_ID, state.gameId);
    Shared.setVarbit(player, Shared.VARBIT.FINISHED_GAME, 0);
  }
  updateMaxPower();
  openHud(player);
  emit("join", { player });
}

/** Out through the barrier, away from the temple or logging out: the game's items go too. */
function leave(player) {
  if (!game.players.has(player)) return;
  game.players.delete(player);
  Shared.setVarp(player, Shared.VARP.GAME_ID, 0);
  Shared.setVarbit(player, Shared.VARBIT.IS_PLAYING, 0);
  Shared.setVarbit(player, Shared.VARBIT.CATALYTIC_EARNED, 0);
  Shared.setVarbit(player, Shared.VARBIT.ELEMENTAL_EARNED, 0);
  Shared.setVarbit(player, Shared.VARBIT.MINING_COUNT, 0);
  Shared.setVarbit(player, Shared.VARBIT.PORTAL_BOTTOM_VISIBLE, 0);
  Shared.stopAction(player);
  removeGameItems(player);
  closeHud(player);
  updateMaxPower();
  emit("leave", { player });
}

// ------------------------------------------------------------------ HUD

function openHud(player) {
  player.getPacketSender().sendSubInterface(Shared.OVERLAY_HUD_UID, Shared.iface(Shared.INTERFACE.HUD), 1);
  sendHud(player);
}

function closeHud(player) {
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
}

/** The HUD's timer: to the open in the lobby, to the attack, then to the altars' change. */
function hudTimer() {
  if (game.phase === PHASE.LOBBY) return game.timer;
  if (game.phase === PHASE.PREPARE) return TIMING.ATTACK - game.elapsed;
  if (game.phase === PHASE.ATTACK || game.phase === PHASE.CHARGED) return game.altars.changesIn;
  return -1;
}

function sendHud(player) {
  const state = stateOf(player) ?? freshState();
  const closing = game.phase === PHASE.CLOSING;
  const portalOpen = game.portal.direction > 0;
  player.getPacketSender().sendClientScript(Shared.SCRIPT.HUD_UPDATE,
    state.elemental, state.catalytic,
    closing ? 0 : game.power, game.maxPower,
    closing ? -1 : game.portal.direction,
    game.altars.elemental, game.altars.catalytic,
    game.riftGuardians, Shared.RIFT_GUARDIAN_CAP,
    hudTimer(),
    portalOpen ? game.portal.closesIn : -1);
}

function broadcastHud() {
  for (const player of game.players.keys()) sendHud(player);
}

function message(text, recipients = players()) {
  for (const player of recipients) player.sendMessage(typeof text === "function" ? text(player) : text);
}

// ------------------------------------------------------------------ the Great Guardian

function greatGuardian() {
  const id = Shared.npc(Shared.NPC.GREAT_GUARDIAN);
  const { World } = Shared.core();
  for (const npc of World.getNpcs()) {
    if (npc && npc.getId?.() === id && Shared.inTemple(npc.getLocation())) return npc;
  }
  return null;
}

// ------------------------------------------------------------------ the game's moments

function openRift() {
  game.phase = PHASE.PREPARE;
  game.elapsed = 0;
  game.surged = false;
  game.altars = { elemental: 0, catalytic: 0, changesIn: 0 };
  game.portal = { direction: 0, closesIn: 0, opensIn: Shared.random(...TIMING.FIRST_PORTAL) };
  updateMaxPower();
  game.power = Math.floor((game.maxPower * START_POWER_PERCENT) / 100);
  game.startingPlayers = game.players.size;
  for (const [player, state] of game.players) {
    Object.assign(state, freshState(), { gameId: newGameId() });
    removeGameItems(player, Shared.NEW_GAME_ITEMS);
    Shared.setVarp(player, Shared.VARP.GAME_ID, state.gameId);
    Shared.setVarbit(player, Shared.VARBIT.IS_PLAYING, 1);
    Shared.setVarbit(player, Shared.VARBIT.FINISHED_GAME, 0);
    Shared.setVarbit(player, Shared.VARBIT.MINING_COUNT, 0);
    syncEnergy(player);
    openHud(player);
    player.sendMessage("<col=ef1020>The rift becomes active!");
  }
  emit("open", {});
  Shared.later(1, () => message("Creatures from the Abyss will attack in 120 seconds."));
}

function attack() {
  game.phase = PHASE.ATTACK;
  message("<col=ef1020>Creatures from the Abyss begin their attack!</col>");
  rotateAltars();
  emit("attack", {});
}

/** rsprox captures: sound 1465 and a left-right camera shake (5, 15, 10), reset two ticks later. */
function surge() {
  game.surged = true;
  const shaken = players();
  for (const player of shaken) {
    player.sendMessage("<col=ef1020>The rift burns intensely... More creatures from the Abyss are emerging!</col>");
    player.getPacketSender().sendSound(SURGE_SOUND, 1, 0).sendCameraShake(0, 5, 15, 10);
  }
  Shared.later(SURGE_SHAKE_TICKS, () => {
    for (const player of shaken) if (player.isRegistered()) player.getPacketSender().sendCameraReset();
  });
  emit("surge", {});
}

/** Full power: the creatures die, the Great Guardian speaks and closes the rift 32 ticks later. */
function charged() {
  game.phase = PHASE.CHARGED;
  game.chargedAt = game.elapsed;
  closePortal();
  message((player) => Shared.highlight(player, "gre", "The Great Guardian is fully charged."));
  emit("charged", {});
}

function closeRift() {
  game.phase = PHASE.CLOSING;
  game.timer = TIMING.GRACE;
  for (const player of game.players.keys()) {
    emit("closed", { player, state: stateOf(player) });
    Shared.setVarbit(player, Shared.VARBIT.FINISHED_GAME, 1);
    player.getPacketSender().sendJingle(VICTORY_JINGLE, 0);
    player.sendMessage("The Portal Guardians will keep their rifts open for another 30 seconds.");
  }
  emit("ended", { won: true });
  broadcastHud();
}

/**
 * Wiki: the game fails at 0% power. No capture has a loss, so the message is ours; the rift
 * closes as it would after a win, without the rewards.
 */
function lose() {
  game.phase = PHASE.CLOSING;
  game.timer = TIMING.GRACE;
  closePortal();
  message("<col=ef1020>The Great Guardian has been defeated. The rift remains open.</col>");
  for (const player of game.players.keys()) Shared.setVarbit(player, Shared.VARBIT.FINISHED_GAME, 1);
  emit("lost", {});
  emit("ended", { won: false });
  broadcastHud();
}

/** The grace period is over: the altars close and the lobby counts down to the next game. */
function closeAltars() {
  game.phase = PHASE.LOBBY;
  game.timer = TIMING.CLOSE_TO_OPEN - TIMING.GRACE;
  game.altars = { elemental: 0, catalytic: 0, changesIn: 0 };
  message("The Portal Guardians close their rifts.");
  emit("rifts-closed", {});
  emit("altars", activeAltars());
  broadcastHud();
}

// ------------------------------------------------------------------ altars and portals

/** A new elemental and catalytic pair, each different from the last (rsprox captures). */
function rotateAltars() {
  const pick = (count, previous) => {
    let next = Shared.random(1, count);
    while (count > 1 && next === previous) next = Shared.random(1, count);
    return next;
  };
  game.altars = {
    elemental: pick(ELEMENTAL_ALTARS, game.altars.elemental),
    catalytic: pick(CATALYTIC_ALTARS, game.altars.catalytic),
    changesIn: TIMING.ALTAR_ROTATION,
  };
  emit("altars", activeAltars());
}

function openPortal() {
  const directions = Object.values(PORTAL_DIRECTIONS);
  game.portal.direction = directions[Shared.random(0, directions.length - 1)];
  game.portal.closesIn = TIMING.PORTAL_OPEN;
  game.portal.opensIn = Shared.random(...TIMING.NEXT_PORTAL);
  emit("portal-open", { direction: game.portal.direction });
}

function closePortal() {
  if (game.portal.direction === 0) return;
  const direction = game.portal.direction;
  game.portal.direction = 0;
  game.portal.closesIn = 0;
  emit("portal-close", { direction });
}

function tickPortal() {
  if (game.portal.direction > 0) {
    if (--game.portal.closesIn <= 0) closePortal();
  } else if (--game.portal.opensIn <= 0) {
    openPortal();
  }
}

// ------------------------------------------------------------------ the loop

/** The last game's stones and mining count go with the countdown's first line (rsprox captures). */
function clearLastGame() {
  for (const player of game.players.keys()) {
    Shared.removeItems(player, Shared.STONES);
    Shared.setVarbit(player, Shared.VARBIT.MINING_COUNT, 0);
  }
}

/** With nobody inside the barrier the lobby waits at its 30 seconds: no game for an empty temple. */
function tickLobby() {
  if (game.players.size === 0 && game.timer <= EMPTY_LOBBY_HOLD) {
    game.timer = EMPTY_LOBBY_HOLD;
    return;
  }
  const line = COUNTDOWN.get(game.timer);
  if (line) message(line);
  if (game.timer === EMPTY_LOBBY_HOLD) clearLastGame();
  if (--game.timer <= 0) openRift();
}

function tickCharged() {
  const since = game.elapsed - game.chargedAt;
  for (const [at, line] of TIMING.CHARGED_LINES) {
    if (since === at) greatGuardian()?.forceChat(GREAT_GUARDIAN_LINES[line]);
  }
  if (since >= TIMING.CHARGED_TO_CLOSE) closeRift();
}

function tick() {
  game.clock++;
  switch (game.phase) {
    case PHASE.LOBBY:
      tickLobby();
      break;
    case PHASE.PREPARE:
      game.elapsed++;
      tickPortal();
      if (game.elapsed >= TIMING.ATTACK) attack();
      break;
    case PHASE.ATTACK:
      game.elapsed++;
      tickPortal();
      if (--game.altars.changesIn <= 0) rotateAltars();
      break;
    case PHASE.CHARGED:
      game.elapsed++;
      if (game.altars.elemental > 0 && --game.altars.changesIn <= 0) rotateAltars();
      tickCharged();
      break;
    case PHASE.CLOSING:
      if (--game.timer <= 0) closeAltars();
      break;
  }
  emit("tick", { phase: game.phase });
  if (game.clock % Shared.HUD_PERIOD === 0) broadcastHud();
}

/** The loop runs from server start, whether or not anyone is in the temple. */
function start() {
  if (game.task) return;
  updateMaxPower();
  game.task = Shared.repeat(1, tick);
}

// ------------------------------------------------------------------ dev and agent controls

/** Skips the lobby (or the preparation) straight to the next moment. */
function skip() {
  if (game.phase === PHASE.LOBBY) game.timer = 1;
  else if (game.phase === PHASE.PREPARE) game.elapsed = TIMING.ATTACK - 1;
  else if (game.phase === PHASE.CLOSING) game.timer = 1;
  else if (game.phase === PHASE.ATTACK) game.portal.opensIn = Math.min(game.portal.opensIn, 1);
}

/** agent:advance-time: the lobby and the preparation are timers players wait through. */
function advanceTime(request) {
  const ticks = Math.floor((request.ms ?? 0) / 600);
  if (ticks <= 0) return;
  if (game.phase === PHASE.LOBBY || game.phase === PHASE.CLOSING) game.timer = Math.max(1, game.timer - ticks);
  else if (game.phase === PHASE.PREPARE) game.elapsed = Math.min(TIMING.ATTACK - 1, game.elapsed + ticks);
  request.handledBy?.push?.("GuardiansOfTheRift");
}

function describe() {
  return `phase=${game.phase} timer=${game.timer} elapsed=${game.elapsed} power=${game.power}/${game.maxPower}`
    + ` (${powerPercent()}%) altars=${game.altars.elemental}/${game.altars.catalytic} portal=${game.portal.direction}`
    + ` players=${game.players.size}`;
}

module.exports = {
  PHASE, TIMING, PORTAL_DIRECTIONS, PEARL_SCORE_STEP, PEARL_MAX_PER_GAME,
  on, phase, isRunning, altarsOpen, isPlaying, stateOf, players, powerPercent, activeAltars, portal,
  setRiftGuardians, maxPowerFor, addPower, setPower, addEnergy, addContribution, pearlsFor, syncEnergy, join, leave,
  openHud, closeHud, sendHud, message, greatGuardian, startingPlayers: () => game.startingPlayers,
  tick, start, skip, advanceTime, describe, clock: () => game.clock,
  _game: game,
  attach(api) {
    api.onServerStartup(start);
    api.onCustomEvent("agent:advance-time", advanceTime);
  },
};
