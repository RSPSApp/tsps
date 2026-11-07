"use strict";
const { GAMES } = require("./Games.GamesRoom");
const Rules = require("./Rules.GamesRoom");
const RuneSquares = require("./Interface.RuneSquares.GamesRoom");

// Revision 241: interface_inv_update_big and cc_object_swapper. The latter changes a
// dynamic child's item without clearing its operations, including empty squares.
const INVENTORY_UPDATE_SCRIPT = 151;
const OBJECT_SWAPPER_SCRIPT = 719;
const TEXT_SWAPPER_SCRIPT = 599;
const OUTLINE_SWAPPER_SCRIPT = 6002;
const RUNEVERSI_GRID_SCRIPT = 3423;
// worldswitcher_wipe_favourite: only clears the target onOp/onMouseRepeat.
// Suppressing IF_BUTTON transmission alone leaves native radio scripts active.
const CLEAR_LOCAL_OPTION_SCRIPT = 893;
const PIECES = ["fire", "water", "earth", "air", "mind", "body", "nature", "chaos", "law", "cosmic", "blood", "soul"];
const MOVE_SECONDS = [15, 30, 60, 120];
const RESULT_TEXT = {
  "no-legal-moves": "No legal moves remain.",
  "forty-moves": "Forty moves without a capture or promotion.",
  "four-in-row": "Four pieces in a row!",
  "board-full": "The board is full.",
};
let cache;
const timers = new WeakMap();

function required(value, name) {
  if (value == null) throw new Error(`Games Room cache entry missing: ${name}`);
  return value;
}
function configure(core) { cache = core.CacheDefinitions; RuneSquares.configure(core); }
function component(name) { return required(cache.getComponentId(name), name); }
function interfaceId(name) { return required(cache.getInterfaceId(name), name); }
function gameName(game) {
  const name = typeof game === "number" ? Object.keys(GAMES).find(name => GAMES[name].id === game) : game;
  if (!Object.hasOwn(GAMES, name)) throw new RangeError("Unknown board game");
  return name;
}
function group(game) { return interfaceId(`boardgames_${gameName(game)}`); }
function optionsGroup(game) { return interfaceId(`boardgames_${gameName(game)}_options`); }
function varbit(player, name, value) {
  player.getPacketSender().sendVarbit(required(cache.getVarbitId(`boardgames_${name}`), name), value);
}
function text(player, name, value) { player.getPacketSender().sendString(String(value), component(name)); }
function hidden(player, name, value) { player.getPacketSender().sendInterfaceDisplayState(component(name), value); }
function nameOf(player) { return player.getDisplayName(); }

function showSelection(player, selectedGame = 0, ranks = {}) {
  varbit(player, "game", GAMES[gameName(selectedGame)].id);
  player.getPacketSender().sendInterface(interfaceId("boardgames_challenge"));
  // Pinned reference boardgames_challenge labels these as mine vs opponent.
  for (const game of Object.keys(GAMES)) {
    const pair = ranks[game];
    if (Array.isArray(pair) && pair.length === 2) {
      text(player, `boardgames_challenge:${game}_rank`, `${pair[0]} vs ${pair[1]}`);
    }
  }
  // These games are outside this plugin's supported slice. Keep the native
  // controls visible but disabled and explicitly label their rank unavailable.
  for (const name of ["draughts", "runelink", "runesquares", "runeversi"].filter(name => !Object.hasOwn(GAMES, name))) {
    player.getPacketSender().sendInterfaceFlagsRange(component(`boardgames_challenge:${name}`), -1, -1, 0);
    text(player, `boardgames_challenge:${name}_rank`, "Unavailable");
  }
}

function showOptions(player, game, settings, { recipient = false } = {}) {
  varbit(player, "piece", settings.piece);
  varbit(player, "timepermove", MOVE_SECONDS.indexOf(settings.seconds));
  varbit(player, "rankedgame", settings.ranked ? 1 : 0);
  player.getPacketSender().sendInterface(optionsGroup(game));
  const prefix = `boardgames_${gameName(game)}_options`, sender = player.getPacketSender();
  // Rev241 cache bytes encode y=63 for these controls, overlapping row y=62.
  // The decoder reads the signed short correctly. Historical options show all
  // twelve pieces in four rows. Continue this cache's existing 21/62/103 row
  // stride to 144; this is a presentation repair, not a captured OSRS position.
  for (const [rune, x] of [["airrune", 0], ["chaosrune", 64], ["soulrune", 128]]) {
    sender.sendInterfacePosition(component(`${prefix}:${rune}`), x, 144);
  }
  for (const control of ["15seconds", "30seconds", "1minute", "2minutes", "ranked"]) {
    sender.sendInterfaceFlagsRange(component(`${prefix}:${control}`), -1, -1, recipient ? 0 : 1 << 1);
    if (recipient) sender.sendInterfaceScript(CLEAR_LOCAL_OPTION_SCRIPT, [component(`${prefix}:${control}`)]);
  }
  // The native button text is dynamic child 9, created by boardgames_button_init.
  sender.sendInterfaceScript(TEXT_SWAPPER_SCRIPT,
    [component(`${prefix}:challenge`), 9, recipient ? "Accept" : "Challenge"]);
  const info = GAMES[gameName(game)];
  text(player, `${prefix}:${info.optionTimeLabel}`, recipient ? "Time (fixed):" : "Time per move:");
  text(player, `${prefix}:${info.optionRankLabel}`, recipient ? "Ranked (fixed)" : "Ranked");
}

function pieceId(game, selection, king) {
  const rune = PIECES[selection - 1];
  if (!rune) throw new Error("Invalid Games Room piece selection");
  const name = gameName(game) === "runelink" ? `boardgames_runelink_${rune}rune`
    : king ? `boardgames_draughts_${rune}rune_king` : `boardgames_${rune}rune`;
  return required(cache.getObjId(name), name);
}

function drawBoard(player, match, readOnly = false) {
  const info = GAMES[gameName(match.game)];
  const isDraughts = match.game === "draughts";
  const board = match.state.board;
  const boardUid = component(`boardgames_${gameName(match.game)}:boardinv`);
  const sender = player.getPacketSender();
  const inventory = required(cache.getInventoryId("boardgames_boardinv"), "boardgames_boardinv");
  const placeholder = pieceId(match.game, match.settings.pieces[0], false);
  // Use the one-shot builder rather than interface_inv_init (149): its transmit
  // listener could restore placeholders after the object swaps. Board state is
  // owned by the match; this display inventory never touches carried items.
  // Runeversi uses static square controls below these graphics. Starting its
  // display slots empty makes proc154 clear their ops/onOp; object swaps only
  // set models. Even occupied graphics must pass clicks through (their native
  // 36px bounds overlap adjacent 32px squares). Draughts needs its slot ops.
  // Edge games must create empty native slots as empty: swapping a placeholder
  // object to -1 later leaves its inventory Examine target above the line controls.
  const slots = match.game === "runeversi" ? [] : Array.from({ length: board.length }, (_, slot) => {
    if (match.game !== "runesquares") return { slot, itemId: placeholder, quantity: 1 };
    const value = board[slot];
    return { slot, itemId: value ? pieceId(match.game, match.settings.pieces[value > 0 ? 0 : 1], false) : -1,
      quantity: value ? 1 : 0 };
  });
  sender.sendInterfaceScript(INVENTORY_UPDATE_SCRIPT,
    [boardUid, inventory, info.width, info.height, 0, -1,
      info.squareInput && !readOnly ? "Select square" : "", "", "", "", "", "", "", "", ""],
    undefined, undefined, { [inventory]: { capacity: board.length, slots } });
  sender.sendInterfaceFlagsRange(boardUid, 0, board.length - 1, info.squareInput && !readOnly ? 1 << 1 : 0);
  if (match.game !== "runesquares") {
    for (let slot = 0; slot < board.length; slot++) {
      const value = board[slot];
      const item = value ? pieceId(match.game, match.settings.pieces[value > 0 ? 0 : 1], Math.abs(value) === 2) : -1;
      sender.sendInterfaceScript(OBJECT_SWAPPER_SCRIPT, [boardUid, slot, item, value ? 1 : 0]);
    }
  }
  if (match.game === "runeversi") {
    // Script 3423 consumes the real inventory, rather than the temporary
    // placeholders used by the one-shot builder, to set Play piece labels.
    const actualSlots = board.flatMap((value, slot) => value ? [{ slot,
      itemId: pieceId(match.game, match.settings.pieces[value > 0 ? 0 : 1], false), quantity: 1 }] : []);
    sender.sendInterfaceScript(RUNEVERSI_GRID_SCRIPT, [], undefined, undefined,
      { [inventory]: { capacity: board.length, slots: actualSlots } });
    const legal = new Set(Rules.legalMoves(match.state).map(move => move.to));
    const active = !readOnly && match.players[match.state.turn] === player && !match.finished;
    for (let to = 0; to < 64; to++) sender.sendInterfaceFlagsRange(
      component(`boardgames_runeversi:square_${to}`), -1, -1, active && legal.has(to) ? 2 : 0);
  }
  const selected = match.selected?.get(player);
  if (!readOnly && isDraughts && Number.isInteger(selected) && selected >= 0 && selected < board.length) {
    sender.sendInterfaceScript(OUTLINE_SWAPPER_SCRIPT, [boardUid, selected, 2]);
  }
}

function refreshMatch(player, match) {
  const prefix = `boardgames_${gameName(match.game)}`;
  const sender = player.getPacketSender();
  text(player, `${prefix}:p1_name`, nameOf(match.players[0]));
  text(player, `${prefix}:p2_name`, nameOf(match.players[1]));
  sender.sendInterfaceModel(component(`${prefix}:p1_rune`), pieceId(match.game, match.settings.pieces[0], false), 600);
  sender.sendInterfaceModel(component(`${prefix}:p2_rune`), pieceId(match.game, match.settings.pieces[1], false), 600);
  text(player, `${prefix}:turn_name`, nameOf(match.players[match.state.turn]));
  text(player, `${prefix}:status1`, match.drawOffer ? "A draw has been offered." : `${match.settings.seconds} seconds per move`);
  text(player, `${prefix}:status2`, match.drawOffer ? "Offer draw to accept." :
    match.game === "runeversi" ? (match.state.passed != null ?
      (match.players[match.state.passed] === player ? "You have no legal move." : "Opponent has no legal move.") :
      `${match.state.board.filter(p => p > 0).length} vs ${match.state.board.filter(p => p < 0).length}`) : "");
  const previous = timers.get(player);
  if (previous?.match !== match || previous.deadline !== match.deadline) {
    // Native cache animation supplies the sand countdown; selection redraws must
    // not restart it. A new deadline denotes the next move (or jump).
    const seq = required(cache.getSeqId(`sandtimer_${match.settings.seconds}secs`), "sandtimer");
    sender.sendInterfaceAnimation(component(`${prefix}:sandtimer`), seq);
    timers.set(player, { match, deadline: match.deadline });
  }
  drawBoard(player, match);
  if (match.game === "runesquares") RuneSquares.refresh(player, match);
}

function showMatch(player, match) {
  const prefix = `boardgames_${gameName(match.game)}`;
  varbit(player, "ingame", 1);
  player.getPacketSender().sendInterface(group(match.game));
  hidden(player, `${prefix}:close`, true);
  hidden(player, `${prefix}:resign`, false);
  hidden(player, `${prefix}:offer_draw`, false);
  hidden(player, `${prefix}:turn`, false);
  hidden(player, `${prefix}:turn_name`, false);
  hidden(player, `${prefix}:winner`, true);
  if (cache.getComponentId(`${prefix}:runeflash`) != null) hidden(player, `${prefix}:runeflash`, true);
  if (match.game === "runeversi") varbit(player, "viewing", 0);
  if (gameName(match.game) === "runelink") {
    for (let column = 0; column < 7; column++) player.getPacketSender()
      .sendInterfaceFlagsRange(component(`${prefix}:column${column}`), -1, -1, 2);
  }
  refreshMatch(player, match);
}

function showResult(player, match) {
  const prefix = `boardgames_${gameName(match.game)}`;
  const result = match.state.result;
  timers.delete(player);
  varbit(player, "ingame", 0);
  hidden(player, `${prefix}:resign`, true);
  hidden(player, `${prefix}:offer_draw`, true);
  hidden(player, `${prefix}:close`, false);
  hidden(player, `${prefix}:turn`, true);
  hidden(player, `${prefix}:turn_name`, true);
  hidden(player, `${prefix}:winner`, false);
  text(player, `${prefix}:winner`, result.winner == null ? "The game is a draw." : `${nameOf(match.players[result.winner])} wins!`);
  text(player, `${prefix}:status1`, RESULT_TEXT[result.reason] ?? result.reason);
  text(player, `${prefix}:status2`, match.game === "runeversi"
    ? `${match.state.board.filter(p => p > 0).length} vs ${match.state.board.filter(p => p < 0).length}` : "");
  player.getPacketSender().sendInterfaceAnimation(component(`${prefix}:sandtimer`),
    required(cache.getSeqId("sandtimer_off"), "sandtimer_off"));
  player.getPacketSender().sendInterfaceFlagsRange(component(`${prefix}:boardinv`), 0, match.state.board.length - 1, 0);
  if (match.game === "runesquares") RuneSquares.refresh(player, match);
  if (gameName(match.game) === "runelink") {
    for (let column = 0; column < 7; column++) player.getPacketSender()
      .sendInterfaceFlagsRange(component(`${prefix}:column${column}`), -1, -1, 0);
  }
  if (match.game === "runeversi") {
    for (let to = 0; to < 64; to++) player.getPacketSender()
      .sendInterfaceFlagsRange(component(`boardgames_runeversi:square_${to}`), -1, -1, 0);
  }
}

// Rev241 has no dedicated viewer group. Reuse its native board and Close,
// retaining the historical read-only view's absence of player/turn controls.
// Current OSRS viewer timing/layout has no local capture; no auto-close timer
// or spectator permissions are inferred from the historical implementation.
function refreshSpectator(player, match) {
  const prefix = `boardgames_${gameName(match.game)}`;
  const sender = player.getPacketSender();
  for (let side = 0; side < 2; side++) {
    text(player, `${prefix}:p${side + 1}_name`, nameOf(match.players[side]));
    sender.sendInterfaceModel(component(`${prefix}:p${side + 1}_rune`), pieceId(match.game, match.settings.pieces[side], false), 600);
  }
  drawBoard(player, match, true);
  if (match.finished) showResult(player, match);
  else {
    text(player, `${prefix}:status1`, "");
    text(player, `${prefix}:status2`, "");
  }
}
function showSpectator(player, match) {
  const prefix = `boardgames_${gameName(match.game)}`;
  varbit(player, "ingame", 0);
  // boardgames_runeversi_update_grid skips its Play piece labels while viewing.
  if (match.game === "runeversi") varbit(player, "viewing", 1);
  player.getPacketSender().sendInterface(group(match.game));
  for (const name of ["resign", "offer_draw", "turn", "turn_name", "sandtimer", "winner", "runeflash"]) {
    if (cache.getComponentId(`${prefix}:${name}`) != null) hidden(player, `${prefix}:${name}`, true);
  }
  hidden(player, `${prefix}:close`, false);
  if (gameName(match.game) === "runelink") {
    for (let column = 0; column < 7; column++) player.getPacketSender()
      .sendInterfaceFlagsRange(component(`${prefix}:column${column}`), -1, -1, 0);
  }
  refreshSpectator(player, match);
}

module.exports = { configure, component, group, optionsGroup, showSelection, showOptions, showMatch, refreshMatch, showResult, showSpectator, refreshSpectator };
