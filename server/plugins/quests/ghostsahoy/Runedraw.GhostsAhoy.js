"use strict";

/**
 * Runedraw, Robin's game at the Port Phasmatys inn (interface ahoy_runedraw, 9), as the user's
 * revision 242 capture plays it (20261112T092603-5ab63b4, ticks 1233-1410; facts in
 * docs/quests/ghosts-ahoy/README.md):
 *
 * - The board opens with all twenty slots and four texts empty and both buttons shown.
 * - One bag of ten runes for both players: air 1 ... nature 9, and the death rune.
 * - The player draws (or holds); Robin draws 2-4 ticks later (5 after a hold) and never holds.
 * - Hold shows only while the player is ahead. The texts are "Thinking...", "Your turn",
 *   "HELD", "You win!" and "You lose!", with the game messages "You've won the game of
 *   Runedraw!" / "You've lost the game of Runedraw.".
 * - The board stays open after the result until the player closes it; Robin's reply then
 *   plays (`handlers.closed`).
 *
 * Ours: closing the board before the result counts as a loss (the Wiki says quitting does),
 * and the bag is shuffled evenly; four games of six ended with Robin drawing death.
 */

const INTERFACE = "ahoy_runedraw";
const COMPONENT = Object.freeze({
  DRAW: "ahoy_runedraw:runedraw_btn_draw",
  HOLD: "ahoy_runedraw:runedraw_btn_hold",
  SCORE_PLAYER: "ahoy_runedraw:runedraw_score_l",
  STATUS_PLAYER: "ahoy_runedraw:runedraw_totalscore_l",
  SCORE_ROBIN: "ahoy_runedraw:runedraw_score_r",
  STATUS_ROBIN: "ahoy_runedraw:runedraw_totalscore_r",
  LAYER_DRAW: "ahoy_runedraw:runedraw_layer_draw",
  LAYER_HOLD: "ahoy_runedraw:runedraw_layer_hold",
});
const SLOTS = 10;
/** runedraw_slot_1..10 are the player's, 11..20 Robin's. */
const slotName = (index) => `ahoy_runedraw:runedraw_slot_${index + 1}`;
/** if_setobject's count for a drawn rune (the capture's zoom). */
const RUNE_ZOOM = 80;
/** toplevel_mainmodal_open [-1, -1], sent before the board (tick 1233). */
const MAINMODAL_OPEN_SCRIPT = 2524;
const ROBIN_DELAY = Object.freeze({ min: 2, max: 4 });
const ROBIN_DELAY_AFTER_HOLD = 5;

const TEXT = Object.freeze({
  THINKING: "Thinking...",
  YOUR_TURN: "Your turn",
  HELD: "HELD",
  WIN: "You win!",
  LOSE: "You lose!",
});
const WON_MESSAGE = "You've won the game of Runedraw!";
const LOST_MESSAGE = "You've lost the game of Runedraw.";

const RESULT = Object.freeze({ WON: "won", LOST: "lost" });

/** Players at the board: { bag, mine, robins, held, over, result, handlers }. */
const games = new Map();

let api;
let core;
let runes;
/** Overridable draw order, for tests. */
let shuffle = (items) => {
  const bag = [...items];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
};
let robinDelay = () => ROBIN_DELAY.min + Math.floor(Math.random() * (ROBIN_DELAY.max - ROBIN_DELAY.min + 1));

/** The bag: nine scoring runes and the death rune, by item id. */
function bagContents() {
  if (runes) return runes;
  const I = core.ItemIdentifiers;
  runes = [
    { id: I.AIR_RUNE, value: 1 },
    { id: I.MIND_RUNE, value: 2 },
    { id: I.WATER_RUNE, value: 3 },
    { id: I.EARTH_RUNE, value: 4 },
    { id: I.FIRE_RUNE, value: 5 },
    { id: I.BODY_RUNE, value: 6 },
    { id: I.COSMIC_RUNE, value: 7 },
    { id: I.CHAOS_RUNE, value: 8 },
    { id: I.NATURE_RUNE, value: 9 },
    { id: I.DEATH_RUNE, value: 0, death: true },
  ];
  return runes;
}

const uid = (name) => core.CacheDefinitions.getComponentId(name);
const total = (drawn) => drawn.reduce((sum, rune) => sum + rune.value, 0);

function sendText(player, name, text) {
  const id = uid(name);
  player.getFrameUpdater?.()?.clear?.(id);
  player.getPacketSender().sendString(text, id);
}

function hide(player, name, hidden) {
  player.getPacketSender().sendInterfaceDisplayState(uid(name), hidden);
}

/**
 * Opens a new game. `handlers.finished(result)` runs as the game is decided, and
 * `handlers.closed(result)` once the board is closed.
 */
function open(player, handlers = {}) {
  const sender = player.getPacketSender();
  games.set(player, { bag: shuffle(bagContents()), mine: [], robins: [], held: false, over: false, result: null, handlers, turn: 0 });
  for (let index = 0; index < SLOTS * 2; index++) sender.sendItemOnInterfaces(uid(slotName(index)), -1, 0);
  for (const name of [COMPONENT.SCORE_PLAYER, COMPONENT.SCORE_ROBIN, COMPONENT.STATUS_PLAYER, COMPONENT.STATUS_ROBIN]) {
    sendText(player, name, "");
  }
  hide(player, COMPONENT.LAYER_DRAW, false);
  hide(player, COMPONENT.LAYER_HOLD, false);
  sender.sendInterfaceScript(MAINMODAL_OPEN_SCRIPT, [-1, -1]);
  sender.sendInterface(core.CacheDefinitions.getInterfaceId(INTERFACE));
}

function playersTurn(game) {
  return !game.over && !game.held && game.mine.length === game.robins.length;
}

function finish(player, game, result) {
  game.over = true;
  game.result = result;
  hide(player, COMPONENT.LAYER_DRAW, true);
  hide(player, COMPONENT.LAYER_HOLD, true);
  sendText(player, COMPONENT.STATUS_PLAYER, result === RESULT.WON ? TEXT.WIN : TEXT.LOSE);
  sendText(player, COMPONENT.STATUS_ROBIN, "");
  player.sendMessage(result === RESULT.WON ? WON_MESSAGE : LOST_MESSAGE);
  game.handlers.finished?.(result);
}

function place(player, index, rune) {
  player.getPacketSender().sendItemOnInterfaces(uid(slotName(index)), rune.id, RUNE_ZOOM);
}

function draw({ player }) {
  const game = games.get(player);
  if (!game || !playersTurn(game) || game.bag.length === 0) return;
  const rune = game.bag.shift();
  place(player, game.mine.length, rune);
  game.mine.push(rune);
  if (rune.death) {
    finish(player, game, RESULT.LOST);
    return;
  }
  sendText(player, COMPONENT.SCORE_PLAYER, String(total(game.mine)));
  hide(player, COMPONENT.LAYER_DRAW, true);
  hide(player, COMPONENT.LAYER_HOLD, true);
  sendText(player, COMPONENT.STATUS_ROBIN, TEXT.THINKING);
  sendText(player, COMPONENT.STATUS_PLAYER, "");
  robinLater(player, game, robinDelay());
}

function hold({ player }) {
  const game = games.get(player);
  if (!game || !playersTurn(game) || total(game.mine) <= total(game.robins)) return;
  game.held = true;
  hide(player, COMPONENT.LAYER_DRAW, true);
  hide(player, COMPONENT.LAYER_HOLD, true);
  sendText(player, COMPONENT.STATUS_ROBIN, TEXT.THINKING);
  sendText(player, COMPONENT.STATUS_PLAYER, TEXT.HELD);
  robinLater(player, game, ROBIN_DELAY_AFTER_HOLD);
}

function robinLater(player, game, ticks) {
  const turn = ++game.turn;
  core.TaskManager.submit(new core.CountdownTask(player, ticks, () => {
    if (games.get(player) !== game || game.over || game.turn !== turn) return;
    robinDraws(player, game);
  }));
}

/** Robin's draw: after a hold he draws until he passes the player's total or draws death. */
function robinDraws(player, game) {
  const rune = game.bag.shift();
  if (!rune) return;
  place(player, SLOTS + game.robins.length, rune);
  game.robins.push(rune);
  if (rune.death) {
    finish(player, game, RESULT.WON);
    return;
  }
  const robin = total(game.robins);
  const mine = total(game.mine);
  sendText(player, COMPONENT.SCORE_ROBIN, String(robin));
  if (game.held) {
    if (robin > mine) {
      finish(player, game, RESULT.LOST);
      return;
    }
    robinLater(player, game, robinDelay());
    return;
  }
  hide(player, COMPONENT.LAYER_DRAW, false);
  hide(player, COMPONENT.LAYER_HOLD, !(mine > robin));
  sendText(player, COMPONENT.STATUS_ROBIN, "");
  sendText(player, COMPONENT.STATUS_PLAYER, TEXT.YOUR_TURN);
}

/** The board closed: the result (a game left unfinished is lost) goes to Robin's reply. */
function closed({ player, interfaceId }) {
  const game = games.get(player);
  if (!game || interfaceId !== core.CacheDefinitions.getInterfaceId(INTERFACE)) return;
  games.delete(player);
  if (!game.over) {
    game.over = true;
    game.result = RESULT.LOST;
    game.handlers.finished?.(RESULT.LOST);
  }
  game.handlers.closed?.(game.result);
}

function leave({ player }) {
  games.delete(player);
}

function attach(registry) {
  api = registry;
  core = registry.core;
  api.onInterfaceActionButton(uid(COMPONENT.DRAW), draw);
  api.onInterfaceActionButton(uid(COMPONENT.HOLD), hold);
  api.onCustomEvent("interface:closed", closed);
  api.onPlayerLogout(leave);
}

module.exports = {
  attach,
  open,
  RESULT,
  TEXT,
  WON_MESSAGE,
  LOST_MESSAGE,
  _test: {
    games,
    setShuffle(fn) { shuffle = fn; },
    setRobinDelay(fn) { robinDelay = fn; },
    bagContents,
  },
};
