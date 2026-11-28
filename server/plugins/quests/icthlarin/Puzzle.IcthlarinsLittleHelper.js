/**
 * Icthlarin's Little Helper: the western door's tile puzzle (interface 147 `icthalarins_tile_game`), as the
 * capture plays it (local 1002310, opened at t1217 and t2282; docs/quests/ictlharins-little-helper).
 *
 * - 25 tiles (components 4-28, ics_1..ics_25), each a varbit (ics_tile1..25, 420-444) with 1 = turned to its
 *   back. `ics_tilechecker` (445) is the same 25 bits as one value. Pressing a tile turns it and the eight
 *   round it (fewer at the edge), in live's order: itself, north, north-east, east, south-east, south,
 *   south-west, west, north-west. Each turn plays ics_tile_turn_f2b (2001) or _b2f (2002) on its component,
 *   after a -1 to restart it, with one tile_move synth per press.
 * - Opening (and Reset puzzle, component 29) clears the board and presses five tiles at random; the counter
 *   (component 30) plays ics_tilecounter4 then 4_3, 3_2, 2_1, 1_0, 1_0 for those presses and ends on 4. The
 *   player's presses play 4_3 .. 1_0 again, with ics_little_tilecount (409) counting them (the fifth wraps
 *   it, as the scramble's fifth does). Wiki (Icthlarin's Little Helper): no limit on presses.
 * - All tiles gold (every bit clear) is solved: the counter's 1_0, the "tile win" jingle (192), the interface
 *   closes 2 ticks later with the unlock synth, and the caller's `onSolved` runs.
 */
const GROUP = 147;
const FIRST_TILE_COMPONENT = 4;
const RESET_COMPONENT = 29;
const COUNTER_COMPONENT = 30;
const ANIM = Object.freeze({ FRONT_TO_BACK: 2001, BACK_TO_FRONT: 2002, COUNTER: 2003, COUNTER_STEPS: [2004, 2005, 2006, 2007] });
const TILE_WIN_JINGLE = 192;
const SCRAMBLE_PRESSES = 5;
const SIZE = 5;
/** Live's order of a press's turns: centre, N, NE, E, SE, S, SW, W, NW (tile 1 is the top left). */
const NEIGHBOURS = [[0, 0], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** The tiles a press turns, as 0-based indices, in live's order. */
function turnsFor(index) {
  const col = index % SIZE, row = Math.floor(index / SIZE);
  const out = [];
  for (const [dx, dy] of NEIGHBOURS) {
    const c = col + dx, r = row + dy;
    if (c >= 0 && c < SIZE && r >= 0 && r < SIZE) out.push(r * SIZE + c);
  }
  return out;
}

function createPuzzle(api, state, common, { VARBIT, FIRST_TILE_VARBIT }) {
  const { Misc } = api.core;
  const open = new WeakMap();

  const tileVarbit = (index) => FIRST_TILE_VARBIT + index;
  const component = (index) => (GROUP << 16) | (FIRST_TILE_COMPONENT + index);
  const counterUid = (GROUP << 16) | COUNTER_COMPONENT;

  function animate(player, uid, anim) {
    const sender = player.getPacketSender();
    sender.sendInterfaceAnimation(uid, -1);
    sender.sendInterfaceAnimation(uid, anim);
  }

  /** Turns the tiles of one press: the varbits now, and their animations (`anims`) for later or now. */
  function press(player, game, index, anims) {
    for (const tile of turnsFor(index)) {
      game.board ^= 1 << tile;
      const back = (game.board >> tile) & 1;
      state.set(player, tileVarbit(tile), back);
      state.set(player, VARBIT.TILE_CHECKER, game.board);
      anims.push(() => animate(player, component(tile), back ? ANIM.FRONT_TO_BACK : ANIM.BACK_TO_FRONT));
    }
    game.presses = (game.presses + 1) % SCRAMBLE_PRESSES;
    state.set(player, VARBIT.TILE_COUNT, game.presses);
  }

  function counterStep(presses) {
    return ANIM.COUNTER_STEPS[Math.min(Math.max(presses, 1), 4) - 1];
  }

  /** Clears the board, presses five tiles at random, then replays it with the counter (t1217). */
  function scramble(player, game) {
    const sender = player.getPacketSender();
    const replay = [];
    const picked = [];
    while (picked.length < SCRAMBLE_PRESSES) {
      const index = Misc.getRandom(SIZE * SIZE - 1);
      if (!picked.includes(index)) picked.push(index);
    }
    clearBoard(player, game);
    for (const index of picked) {
      const anims = [];
      press(player, game, index, anims);
      replay.push(anims);
    }
    game.presses = 0;
    state.set(player, VARBIT.TILE_COUNT, 0);
    common.sfx(player, "tile_reset");
    animate(player, counterUid, ANIM.COUNTER);
    for (let i = 0; i < SIZE * SIZE; i++) sender.sendInterfaceAnimation(component(i), -1);
    replay.forEach((anims, i) => {
      common.sfx(player, "tile_move");
      for (const anim of anims) anim();
      animate(player, counterUid, counterStep(i + 1));
    });
    animate(player, counterUid, ANIM.COUNTER);
  }

  function clearBoard(player, game) {
    for (let i = 0; i < SIZE * SIZE; i++) if ((game.board >> i) & 1) state.set(player, tileVarbit(i), 0);
    game.board = 0;
    state.set(player, VARBIT.TILE_CHECKER, 0);
  }

  /** Opens the puzzle; `onSolved(player)` runs once it is solved. */
  function start(player, onSolved) {
    const game = { board: Number(state.get(player, VARBIT.TILE_CHECKER)) || 0, presses: 0, onSolved, solved: false };
    open.set(player, game);
    scramble(player, game);
    player.getPacketSender().sendInterface(GROUP);
  }

  function tileClicked({ player, buttonId }) {
    const game = open.get(player);
    const index = (buttonId & 0xffff) - FIRST_TILE_COMPONENT;
    if (!game || game.solved || index < 0 || index >= SIZE * SIZE) return false;
    const anims = [];
    press(player, game, index, anims);
    common.sfx(player, "tile_move");
    for (const anim of anims) anim();
    animate(player, counterUid, counterStep(game.presses || SCRAMBLE_PRESSES - 1));
    if (game.board === 0) solved(player, game);
    return true;
  }

  function resetClicked({ player }) {
    const game = open.get(player);
    if (!game || game.solved) return false;
    scramble(player, game);
    return true;
  }

  /** The jingle at once, the close and unlock 2 ticks later (t1227-t1229), then the caller's step. */
  function solved(player, game) {
    game.solved = true;
    player.getPacketSender().sendJingle(TILE_WIN_JINGLE);
    common.later(player, 2, () => {
      if (open.get(player) !== game) return;
      open.delete(player);
      player.getPacketSender().sendInterfaceRemoval();
      common.sfx(player, "unlock");
      game.onSolved?.(player);
    });
  }

  /** Closing the interface any other way drops the game (a walk, a logout). */
  function closed(player) {
    const game = open.get(player);
    if (game && !game.solved) open.delete(player);
  }

  const tileButtons = Array.from({ length: SIZE * SIZE }, (_, i) => component(i));

  return { start, tileClicked, resetClicked, closed, tileButtons, resetButton: (GROUP << 16) | RESET_COMPONENT, isOpen: (p) => open.has(p) };
}

module.exports = { createPuzzle, _test: { turnsFor, GROUP } };
