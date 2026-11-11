"use strict";

// Sliding puzzle boxes (Wiki "Puzzle box"). The client draws interface trail_slidepuzzle from
// inventory trail_puzzleinv and varp if1 (the image), predicts each slide and plays its sounds.
// The server owns the board: slots 0-24 row-major, an empty slot is the blank, and only a
// piece next to the blank may move. Solved is piece i in slot i with the blank last.
const Runtime = require("./Runtime.TreasureTrails");
const Dialogue = require("./Dialogue.TreasureTrails");
// Live captures (rsprox.net) of puzzle and light boxes.
const SOLVED = "Well done, hand this back!";
const ALREADY_SOLVED = "You've already solved this challenge! Go hand it back.";
const { TIERS } = require("./Tiers.TreasureTrails");
const SIZE = 5;
const CELLS = SIZE * SIZE;
const OPENED_EVENT = "sliding-puzzle:opened";
const BLANK = -1;
// Wiki "Treasure Trails/Guide/Puzzle boxes": a box starts 101 random slides from solved,
// which also keeps every board solvable.
const SCRAMBLE_SLIDES = 101;
// Cache enum: puzzle image (varp if1) -> enum of piece index -> piece obj.
const PIECES_BY_IMAGE_ENUM = 1864;
let api;
let core;
let boards = new WeakMap();
/** Who has a box (not another puzzle) on the interface. */
let shown = new WeakSet();

function solvedBoard() {
  return [...Array(CELLS - 1).keys(), BLANK];
}

function isSolved(board) {
  return board.every((piece, slot) => piece === (slot === CELLS - 1 ? BLANK : slot));
}

function neighbours(slot) {
  const x = slot % SIZE, y = Math.floor(slot / SIZE);
  return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
    .filter(([nx, ny]) => nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE).map(([nx, ny]) => ny * SIZE + nx);
}

/** Moves the piece in `slot` into the blank if they are neighbours. */
function slide(board, slot) {
  const blank = board.indexOf(BLANK);
  if (!neighbours(blank).includes(slot)) return false;
  board[blank] = board[slot];
  board[slot] = BLANK;
  return true;
}

function scramble(random = Math.random) {
  const board = solvedBoard();
  for (let i = 0; i < SCRAMBLE_SLIDES; i++) {
    const options = neighbours(board.indexOf(BLANK));
    slide(board, options[Math.floor(random() * options.length)]);
  }
  return isSolved(board) ? scramble(random) : board;
}

function pieces(image) {
  const byIndex = core.CacheDefinitions.getEnumValues(core.CacheDefinitions.getEnumValues(PIECES_BY_IMAGE_ENUM).get(image));
  return Array.from({ length: CELLS - 1 }, (_, index) => byIndex.get(index));
}

function boxTrail(player, slot = null) {
  for (const trail of Runtime.trails(player)) {
    const boxSlot = Runtime.puzzleSlot(player, trail);
    if (boxSlot < 0 || slot != null && boxSlot !== slot) continue;
    const item = player.getInventory().getItems()[boxSlot];
    return { ...trail, item, slot: boxSlot, state: item.getMetaValue(Runtime.metaKey(trail.tier)) };
  }
  return null;
}

function sameBox(session, trail) {
  return session?.token === trail.state.token && session.completed === trail.state.completed && session.row === trail.state.row;
}

/** Reopening a box keeps its board; a later step in the same trail gets a new one. */
function boardFor(player, trail) {
  const session = boards.get(player);
  if (sameBox(session, trail)) return session.board;
  const board = trail.state.solved ? solvedBoard() : scramble();
  boards.set(player, { token: trail.state.token, completed: trail.state.completed, row: trail.state.row, board });
  return board;
}

function sendBoard(player, image, board) {
  const ids = pieces(image);
  player.getPacketSender().sendInventory(core.CacheDefinitions.getInventoryId("trail_puzzleinv"), CELLS,
    board.map(piece => piece === BLANK ? null : { id: ids[piece], amount: 1 }));
}

function open(event) {
  const { player } = event;
  const trail = boxTrail(player, event.slot);
  if (!trail) return false;
  if (trail.state.solved) { Dialogue.mesbox(player, ALREADY_SOLVED); return true; }
  // The interface is shared with other puzzles (Monkey Madness I's reinitialisation panel): drop their claim on it.
  api.emitCustomEvent(OPENED_EVENT, { player, source: "box" });
  shown.add(player);
  const sender = player.getPacketSender();
  sender.sendConfig(core.CacheDefinitions.getVarpId("if1"), trail.state.image);
  sendBoard(player, trail.state.image, boardFor(player, trail));
  sender.sendInterface(core.CacheDefinitions.getInterfaceId("trail_slidepuzzle"));
  sender.sendInterfaceFlagsRange(core.CacheDefinitions.getComponentId("trail_slidepuzzle:pieces"), 0, CELLS - 1, 1 << 1);
  return true;
}

function click({ player, slot }) {
  if (!shown.has(player)) return;
  const trail = boxTrail(player);
  const session = boards.get(player);
  if (!trail || !sameBox(session, trail) || !Number.isInteger(slot)) return;
  if (!trail.state.solved && slide(session.board, slot) && isSolved(session.board)) {
    trail.item.setMetaValue(Runtime.metaKey(trail.tier), { ...trail.state, solved: true });
    player.getInventory().refreshItems();
    Dialogue.mesbox(player, SOLVED);
  }
  // Always resend, so a refused move snaps the client's prediction back.
  sendBoard(player, trail.state.image, session.board);
}

function leave({ player }) {
  boards.delete(player);
  shown.delete(player);
}

module.exports = function attachPuzzles(pluginApi) {
  api = pluginApi;
  core = api.core;
  boards = new WeakMap();
  shown = new WeakSet();
  for (const tier of TIERS.filter(entry => entry.puzzleImages)) api.onItemAction(`Puzzle box (${tier.name})`, { Open: open });
  api.onInterfaceActionButton(core.CacheDefinitions.getComponentId("trail_slidepuzzle:pieces"), click);
  api.onCustomEvent(OPENED_EVENT, ({ player, source }) => { if (source !== "box") shown.delete(player); });
  api.onPlayerLogout(leave);
  api.onPlayerDisconnect(leave);
};

Object.assign(module.exports, { SOLVED, ALREADY_SOLVED, CELLS, BLANK, SCRAMBLE_SLIDES, solvedBoard, isSolved, neighbours, slide, scramble, pieces, open, click, boards: () => boards });
