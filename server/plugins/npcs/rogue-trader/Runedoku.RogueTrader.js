"use strict";

/**
 * The runedoku (interface 292, roguetrader_sudoku), a sudoku of nine runes that opens a rune casket.
 *
 * rsprox 3170 (rev 232) t344 and t411: the server sends varbits 12161 (puzzle id), 934 (transpose), 12163 (difficulty,
 * 1) and 12162 (the selected rune, 1), then the board in the varps 2980-2990 (roguetrader_temp1-11, zeroed first):
 * 81 cells of 4 bits, row-major, least significant bit first across the varps, 0 for an empty cell and 1-9 for the
 * runes of the interface's row. The client keeps the placed runes to itself: a click on the runes row (292:9, sub k)
 * is answered with varbit 12162 = k, and a click on a cell (292:14, sub = row * 9 + column) sends nothing back. I replayed
 * t411-t477's clicks onto the board of puzzle 8: they end in a valid sudoku. Open (292:10) after the solve said "You
 * hear the locking mechanism click open!" with synth 1227. So the server keeps its own copy of the grid from the clicks
 * and checks it when Open is pressed.
 *
 * The only two boards in any capture are puzzle 6 (transpose 8) and puzzle 8 (transpose 2); they are the pool. Ours:
 * a click on a given cell changes nothing, and Open on a grid that is not a solved sudoku does nothing.
 */

const INTERFACE = "roguetrader_sudoku";
const VARBIT = { puzzle: 12161, transpose: 934, difficulty: 12163, rune: 12162 };
const FIRST_VARP = 2980, VARPS = 11;
const OPEN_SOUND = 1227;
const OPEN_UI_SOUND = 52, MAINMODAL_OPEN_SCRIPT = 2524;
const PUZZLES = [
  { id: 6, transpose: 8, board: "530402090901030070000080050000805100000000000008601000070040000090050804040109035" },
  { id: 8, transpose: 2, board: "007400980084000050590061000600009500002000800008500004000720098010000640029004700" },
];
const SESSION = new WeakMap();

/** The varp values for a board string (81 digits): 4 bits a cell, LSB first, as signed 32-bit ints. */
function pack(board) {
  const values = new Array(VARPS).fill(0);
  for (let cell = 0; cell < 81; cell++) {
    const bit = cell * 4, varp = Math.floor(bit / 32), shift = bit % 32;
    values[varp] |= (Number(board[cell]) & 15) << shift;
  }
  return values.map((value) => value | 0);
}

function solved(grid) {
  const ok = (cells) => [...cells].sort().join("") === "123456789";
  for (let i = 0; i < 9; i++) {
    if (!ok(grid.slice(i * 9, i * 9 + 9))) return false;
    if (!ok(Array.from({ length: 9 }, (_, r) => grid[r * 9 + i]))) return false;
    const row = Math.floor(i / 3) * 3, col = (i % 3) * 3;
    if (!ok(Array.from({ length: 9 }, (_, k) => grid[(row + Math.floor(k / 3)) * 9 + col + (k % 3)]))) return false;
  }
  return true;
}

function attach(api, hooks) {
  const core = () => api.core;

  /** Opens the puzzle for `kind` ("small" or "large"); `hooks.opened(player, kind)` runs when it is solved and Open is pressed. */
  function open(player, kind) {
    const puzzle = PUZZLES[Math.min(PUZZLES.length - 1, Math.floor(Math.random() * PUZZLES.length))];
    const sender = player.getPacketSender();
    sender.sendInterfaceRemoval();
    SESSION.set(player, { kind, grid: puzzle.board.split("").map(Number), given: puzzle.board.split("").map((c) => c !== "0"), rune: 1 });
    sender.sendVarbit(VARBIT.puzzle, puzzle.id);
    sender.sendVarbit(VARBIT.transpose, puzzle.transpose);
    sender.sendVarbit(VARBIT.difficulty, 1);
    sender.sendVarbit(VARBIT.rune, 1);
    for (let i = VARPS - 1; i >= 0; i--) sender.sendConfig(FIRST_VARP + i, 0);
    pack(puzzle.board).forEach((value, i) => sender.sendConfig(FIRST_VARP + i, value));
    const id = core().CacheDefinitions.getInterfaceId(INTERFACE);
    // 3170 t344: synth 52, script 2524 (toplevel_mainmodal_open, -1, -1), then the interface.
    sender.sendSound(OPEN_UI_SOUND, 1, 0);
    sender.sendClientScript(MAINMODAL_OPEN_SCRIPT, -1, -1);
    sender.sendInterface(id);
    sender.sendInterfaceFlagsRange(core().CacheDefinitions.getComponentId(`${INTERFACE}:runes`), 0, 9, 1 << 1);
    sender.sendInterfaceFlagsRange(core().CacheDefinitions.getComponentId(`${INTERFACE}:game_clickzones`), 0, 80, 1 << 1);
  }

  function click(event) {
    const { player } = event;
    const id = core().CacheDefinitions.getInterfaceId(INTERFACE);
    if (event.groupId !== id) return;
    const session = SESSION.get(player);
    if (!session || player.getInterfaceId() !== id) return;
    event.handled = true;
    const child = event.childId, slot = Number(event.slot);
    if (child === (core().CacheDefinitions.getComponentId(`${INTERFACE}:runes`) & 65535)) {
      if (Number.isInteger(slot) && slot >= 1 && slot <= 9) {
        session.rune = slot;
        player.getPacketSender().sendVarbit(VARBIT.rune, slot);
      }
    } else if (child === (core().CacheDefinitions.getComponentId(`${INTERFACE}:game_clickzones`) & 65535)) {
      if (Number.isInteger(slot) && slot >= 0 && slot < 81 && !session.given[slot]) session.grid[slot] = session.rune;
    } else if (child === (core().CacheDefinitions.getComponentId(`${INTERFACE}:btn_opencasket`) & 65535)) {
      if (!solved(session.grid)) return;
      SESSION.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      hooks.opened(player, session.kind);
    }
  }

  const forget = ({ player }) => SESSION.delete(player);
  api.onInterfaceActionClick(click);
  api.onCustomEvent("interface:closed", ({ player, interfaceId }) => {
    if (interfaceId === core().CacheDefinitions.getInterfaceId(INTERFACE)) SESSION.delete(player);
  });
  api.onPlayerLogout(forget);
  api.onPlayerDeath(forget);
  return { open };
}

module.exports = { attach, pack, solved, PUZZLES, OPEN_SOUND };
