/**
 * Sticking the torn page back together (slug2_ressembling_torn_paper 460 with its controls 462),
 * as live plays it (RSProx capture TheSlugMenace, rev 242.1, ticks 3188-3316):
 *
 * - Glue on a fragment opens 460 as the main modal and 462 beside it, with piece 1 selected and all
 *   three shown, and select1-3 (462:13-15) given op 1 on subs 0-4. The pieces start at
 *   x/y/rotation/flip (20, 36, 3, 1), (-130, -108, 1, 2) and (-5, 39, 4, 2) (varps 876-887).
 * - Every selected piece follows the controls: rotate (462:3) turns 1 -> 2 -> 3 -> 4 -> 1, flip
 *   (462:8) swaps 1 and 2, up/right/left/down (462:4-7) move 5 (y down, x up, x down, y up), with
 *   sounds paper_turn (1413) and paper_move (1412). A select button's sub 2 toggles that piece's
 *   selection (slug2_pieceN_select), sub 0 whether it shows (slug2_pieceN_show).
 * - The page is whole when every piece is the right way round (rotation 1, flip 1) and pieces 2
 *   and 3 sit where Quest Helper's solved state puts them beside piece 1 (the same x; y one less
 *   and two more). Live took piece 2 at +1 (37 against 36) and piece 3 five to the left with y +3,
 *   but not ten to the left, so a piece within 5 of its place counts (Ours: the capture only
 *   bounds it between 5 and 10).
 * - Solved: varp 875 and slug2_fixed_page go to 1, the glue becomes Page 3 in its own slot and the
 *   fragments go, jingle 87 ("complete schematics") after song 147, and the torn pieces hide for the
 *   whole page and its congratulations layer (460:12-19). The window stays open; further clicks do
 *   nothing.
 *
 * The positions are kept (a saved attribute) so a closed puzzle reopens where it was left (Ours).
 */
const DISPLAY = 460;
const CONTROLS = 462;
const COMPLETE_VARP = 875;
const STATE_ATTRIBUTE = "the-slug-menace:fragment-puzzle";
const PIECES = [
  { x: 876, y: 877, flip: 878, rotate: 879, selected: 12155, shown: 12156 },
  { x: 880, y: 881, flip: 882, rotate: 883, selected: 12157, shown: 12158 },
  { x: 884, y: 885, flip: 886, rotate: 887, selected: 12159, shown: 12160 },
];
const START = [
  { x: 20, y: 36, rotate: 3, flip: 1 },
  { x: -130, y: -108, rotate: 1, flip: 2 },
  { x: -5, y: 39, rotate: 4, flip: 2 },
];
/** Pieces 2 and 3 against piece 1 when solved (Quest Helper's PuzzleStep: 40/33, 40/32, 40/35). */
const SOLVED_OFFSETS = [null, { x: 0, y: -1 }, { x: 0, y: 2 }];
const TOLERANCE = 5;
const STEP = 5;
const BUTTON = { ROTATE: 3, UP: 4, RIGHT: 5, LEFT: 6, DOWN: 7, FLIP: 8 };
const SELECT_CHILDREN = [13, 14, 15];
const SUB_SELECT = 2;
const SUB_SHOW = 0;
const SOUND_TURN = 1413;
const SOUND_MOVE = 1412;
const SILENCE_SONG = 147;
const SOLVED_JINGLE = 87;
const SOLVED_HIDE = [13, 14, 15, 16, 17, 18];
const SOLVED_SHOW = [19, 12];
const MODAL_BACKGROUND_SCRIPT = 917;
const MODAL_BACKGROUND = [5726529, 50];
const OP1 = 1 << 1;
const SIDE_MODAL = (161 << 16) | 74;

const uid = (group, child) => (group << 16) | child;
const BUTTON_UIDS = [
  ...Object.values(BUTTON).map((child) => uid(CONTROLS, child)),
  ...SELECT_CHILDREN.map((child) => uid(CONTROLS, child)),
];

module.exports = function createPagePuzzle(api, { canSolve, onSolved }) {
  const open = new Set();
  const solvedOpen = new Set();

  function state(player) {
    const value = player.getAttribute(STATE_ATTRIBUTE);
    const ok = value && Array.isArray(value.pieces) && value.pieces.length === PIECES.length
      && value.pieces.every((piece) => ["x", "y", "rotate", "flip"].every((key) => Number.isInteger(piece[key])));
    return ok ? value : null;
  }

  function sendPiece(sender, index, piece) {
    const vars = PIECES[index];
    sender.sendConfig(vars.x, piece.x).sendConfig(vars.y, piece.y)
      .sendConfig(vars.rotate, piece.rotate).sendConfig(vars.flip, piece.flip);
  }

  function openPuzzle(player) {
    let current = state(player);
    if (!current) {
      current = { pieces: START.map((piece) => ({ ...piece })) };
      player.setAttribute(STATE_ATTRIBUTE, current);
    }
    const sender = player.getPacketSender();
    PIECES.forEach((vars, index) => {
      sender.sendVarbit(vars.selected, index === 0 ? 1 : 0);
      sender.sendVarbit(vars.shown, 1);
    });
    current.pieces.forEach((piece, index) => sendPiece(sender, index, piece));
    sender.sendClientScript?.(MODAL_BACKGROUND_SCRIPT, ...MODAL_BACKGROUND);
    // The page as the main modal and its controls in the side-modal slot (toplevel 164:71 in the
    // capture; 161:74 here, as Party Chest's offer panel).
    sender.sendInterface(DISPLAY);
    sender.sendSubInterface(SIDE_MODAL, CONTROLS, 3);
    for (const child of SELECT_CHILDREN) sender.sendInterfaceFlagsRange?.(uid(CONTROLS, child), 0, 4, OP1);
    open.add(player);
    solvedOpen.delete(player);
  }

  function solved(pieces) {
    const [anchor] = pieces;
    return pieces.every((piece) => piece.rotate === 1 && piece.flip === 1)
      && pieces.slice(1).every((piece, index) => {
        const offset = SOLVED_OFFSETS[index + 1];
        return Math.abs(piece.x - (anchor.x + offset.x)) <= TOLERANCE
          && Math.abs(piece.y - (anchor.y + offset.y)) <= TOLERANCE;
      });
  }

  function finish(player) {
    if (!onSolved(player)) return;
    solvedOpen.add(player);
    const sender = player.getPacketSender();
    sender.sendConfig(COMPLETE_VARP, 1);
    sender.sendSong?.(SILENCE_SONG);
    sender.sendJingle(SOLVED_JINGLE, 0);
    for (const child of SOLVED_HIDE) sender.sendInterfaceDisplayState(uid(DISPLAY, child), true);
    for (const child of SOLVED_SHOW) sender.sendInterfaceDisplayState(uid(DISPLAY, child), false);
  }

  function click(event) {
    const { player, buttonId } = event;
    if (!player || !open.has(player) || player.getInterfaceId?.() !== DISPLAY) return;
    event.handled = true;
    if (solvedOpen.has(player) || !canSolve(player)) return;
    const current = state(player);
    if (!current) return;
    const sender = player.getPacketSender();
    const child = buttonId & 0xffff;
    const select = SELECT_CHILDREN.indexOf(child);
    if (select >= 0) {
      const vars = PIECES[select];
      const sub = Number(event.slot);
      if (sub === SUB_SELECT) sender.sendVarbit(vars.selected, sender.getVarbit(vars.selected) === 1 ? 0 : 1);
      else if (sub === SUB_SHOW) sender.sendVarbit(vars.shown, sender.getVarbit(vars.shown) === 1 ? 0 : 1);
      return;
    }
    let changed = false;
    current.pieces.forEach((piece, index) => {
      if (sender.getVarbit(PIECES[index].selected) !== 1) return;
      if (child === BUTTON.ROTATE) piece.rotate = piece.rotate >= 4 ? 1 : piece.rotate + 1;
      else if (child === BUTTON.FLIP) piece.flip = piece.flip === 1 ? 2 : 1;
      else if (child === BUTTON.UP) piece.y -= STEP;
      else if (child === BUTTON.DOWN) piece.y += STEP;
      else if (child === BUTTON.RIGHT) piece.x += STEP;
      else if (child === BUTTON.LEFT) piece.x -= STEP;
      else return;
      sendPiece(sender, index, piece);
      changed = true;
    });
    if (!changed) return;
    player.setAttribute(STATE_ATTRIBUTE, current);
    const turned = child === BUTTON.ROTATE || child === BUTTON.FLIP;
    sender.sendSound(turned ? SOUND_TURN : SOUND_MOVE, 1, 0);
    if (solved(current.pieces)) finish(player);
  }

  function closed({ player, interfaceId }) {
    if (interfaceId !== DISPLAY && interfaceId !== CONTROLS) return;
    open.delete(player);
    solvedOpen.delete(player);
  }

  function forget({ player }) {
    open.delete(player);
    solvedOpen.delete(player);
  }

  /** Login: the saved positions go back to the client (the puzzle's varps are not saved by the client). */
  function resend(player) {
    const current = state(player);
    if (current) current.pieces.forEach((piece, index) => sendPiece(player.getPacketSender(), index, piece));
  }

  return { openPuzzle, click, closed, forget, resend, solved, BUTTON_UIDS, STATE_ATTRIBUTE, START, COMPLETE_VARP };
};
