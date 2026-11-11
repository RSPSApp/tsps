"use strict";

/**
 * Waydar's reinitialisation puzzle in the Underground Military Glider Hangar (Wiki "Monkey Madness I",
 * "Waydar's puzzle": a 5x5 sliding puzzle like a Treasure Trails puzzle box). It is the same interface
 * (trail_slidepuzzle, cache group 306). Its CS2 690 (called by 688 on load and on each inventory or varp
 * change) picks what to draw from varp if1 (261): 7 draws inventory 221 (reinitialisation_inv), 8 the greyed
 * 222, 10 inventory 960, anything else (a puzzle box's image) inventory 140. So opening the panel's puzzle
 * sets if1 to 7, and a box's open sets its own image. The pieces are the objs reinitialisation_01..24 (RuneLite's Puzzle Solver
 * reads the same inventory). The server owns the board: slots 0-24 row-major, piece i belongs in slot i
 * with the blank last, and only a piece next to the blank may move.
 *
 * Not recorded: no rsprox capture of the puzzle was found, so the scramble (a puzzle box's 101 random
 * slides from solved) and the closing of the interface on the last slide are this plugin's own.
 */
const { solvedBoard, isSolved, slide, scramble, CELLS, BLANK } = require("../../treasuretrails/trails/Puzzle.TreasureTrails");

const OPENED_EVENT = "sliding-puzzle:opened";

module.exports = function createReinitialisationPuzzle(api, { onSolved, isActive }) {
  const { CacheDefinitions } = api.core;
  const INVENTORY = CacheDefinitions.getInventoryId("reinitialisation_inv");
  const INTERFACE = CacheDefinitions.getInterfaceId("trail_slidepuzzle");
  const BOX_INVENTORY = CacheDefinitions.getInventoryId("trail_puzzleinv");
  const IF1_VARP = CacheDefinitions.getVarpId("if1");
  const PIECES_COMPONENT = CacheDefinitions.getComponentId("trail_slidepuzzle:pieces");
  const PIECE_IDS = Array.from({ length: CELLS - 1 }, (_, index) =>
    CacheDefinitions.getObjId(`reinitialisation_${String(index + 1).padStart(2, "0")}`));
  if (INVENTORY == null || INTERFACE == null || PIECES_COMPONENT == null || BOX_INVENTORY == null || IF1_VARP == null || PIECE_IDS.some((id) => id == null)) {
    throw new Error("Missing the reinitialisation puzzle's cache ids");
  }
  /** if1 value that makes CS2 690 draw inventory 221. */
  const ACTIVE_IF1 = 7;
  /** The board of the puzzle a player has open or left half done. */
  let boards = new WeakMap();
  /** Who has the puzzle (not a puzzle box) on the shared interface. */
  let open = new WeakSet();

  function sendBoard(player, board) {
    player.getPacketSender().sendInventory(INVENTORY, CELLS,
      board.map((piece) => piece === BLANK ? null : { id: PIECE_IDS[piece], amount: 1 }));
  }

  function operate(player) {
    let board = boards.get(player);
    if (!board) boards.set(player, board = scramble());
    api.emitCustomEvent(OPENED_EVENT, { player, source: "reinitialisation" });
    open.add(player);
    // A puzzle box left its own inventory on the client; the Puzzle Solver plugin reads that one first.
    player.getPacketSender().sendInventoryStopTransmit(BOX_INVENTORY);
    player.getPacketSender().sendConfig(IF1_VARP, ACTIVE_IF1);
    sendBoard(player, board);
    player.getPacketSender().sendInterface(INTERFACE);
    player.getPacketSender().sendInterfaceFlagsRange(PIECES_COMPONENT, 0, CELLS - 1, 1 << 1);
  }

  function click({ player, slot }) {
    const board = boards.get(player);
    if (!board || !open.has(player) || !Number.isInteger(slot)) return;
    // Reinitialised another way (Glough's fee) while the puzzle stayed open: nothing left to solve.
    if (!isActive(player)) return leave({ player });
    const moved = slide(board, slot);
    // Always resend, so a refused move snaps the client's prediction back.
    sendBoard(player, board);
    if (!moved || !isSolved(board)) return;
    boards.delete(player);
    open.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    onSolved(player);
  }

  function leave({ player }) {
    boards.delete(player);
    open.delete(player);
  }

  function otherPuzzleOpened({ player, source }) {
    if (source !== "reinitialisation") open.delete(player);
  }

  api.onInterfaceActionButton(PIECES_COMPONENT, click);
  api.onCustomEvent(OPENED_EVENT, otherPuzzleOpened);
  api.onPlayerLogout(leave);
  api.onPlayerDisconnect(leave);
  return { operate, solvedBoard };
};
