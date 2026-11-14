/**
 * Between a Rock...: assembling the schematics (the user's rsprox capture BetweenARock.bin, rev 242.1,
 * ticks 2697-2809; plugins/quests/data/between-a-rock.json "puzzle").
 *
 * Assemble on any of the four parts opens dwarf_rock_schematics (113), the base drawing with
 * three movable pieces, and its control panel dwarf_rock_schematics_control (114) in the side
 * modal. Varps if1-if3 say which pieces are selected (piece 1 to start), if4-if6 which are shown.
 * The arrows move every selected piece 5 pixels and rotate steps their drawing a quarter turn;
 * each press resends every piece's place and drawing, as live does. With every piece the right
 * way up and on (or within a few pixels of) its place, the pieces snap together, the borders
 * hide, the congratulations layer shows, the jingle plays, varbit dwarfrock_schematics_solved is
 * set and the four parts become the assembled schematic in the first part's slot. The pieces
 * start where the capture's did each time the puzzle opens.
 */
const DATA = require("../data/between-a-rock.json").puzzle;

const GROUP = "dwarf_rock_schematics";
const CONTROL = "dwarf_rock_schematics_control";
const SELECT_VARPS = [261, 262, 263]; // if1-if3
const SHOW_VARPS = [264, 265, 266]; // if4-if6
const BUSY_VARBIT = 12393;
const SIDE_MODAL = "toplevel_osrs_stretch:sidemodal";
/** Synth sounds paper_move and paper_turn, as the capture names them (the cache has no synth gamevals here). */
const MOVE_SOUND = 1412;
const TURN_SOUND = 1413;

let api;
let ctx;
let ids;
/** Players with the puzzle open -> their pieces. */
const open = new WeakMap();

function resolveIds() {
  if (ids) return ids;
  const { CacheDefinitions } = api.core;
  const component = (name) => {
    const id = CacheDefinitions.getComponentId(name);
    if (!Number.isInteger(id)) throw new Error(`[BetweenARock] unknown component ${name}`);
    return id;
  };
  const seq = (name) => {
    const id = CacheDefinitions.getSeqId(name);
    if (!Number.isInteger(id)) throw new Error(`[BetweenARock] unknown seq ${name}`);
    return id;
  };
  ids = {
    group: component(`${GROUP}:dwarf_rock_schematic1`) >>> 16,
    control: component(`${CONTROL}:dr_move_up`) >>> 16,
    side: component(SIDE_MODAL),
    shown: [1, 2, 3].map((n) => component(`${GROUP}:dwarf_rock_schematic${n}`)),
    piece: [1, 2, 3].map((n) => component(`${GROUP}:dwarf_rock_schematic_${n}`)),
    borderLayer: [1, 2, 3].map((n) => component(`${GROUP}:dwarf_rock_border${n}`)),
    border: [1, 2, 3].map((n) => component(`${GROUP}:dwarf_rock_border_${n}`)),
    congrat: component(`${GROUP}:dwarf_rock_congrat_layer`),
    rotations: [1, 2, 3].map((n) => [1, 2, 3, 4].map((r) => seq(`dwarf_rock_schematic${n}_rot${r}`))),
    buttons: {
      up: component(`${CONTROL}:dr_move_up`),
      right: component(`${CONTROL}:dr_move_right`),
      left: component(`${CONTROL}:dr_move_left`),
      down: component(`${CONTROL}:dr_move_down`),
      rotate: component(`${CONTROL}:dr_rotate_button`),
      select: [1, 2, 3].map((n) => component(`${CONTROL}:dr_select${n}`)),
      hide: [1, 2, 3].map((n) => component(`${CONTROL}:dr_hide${n}`)),
    },
  };
  return ids;
}

function sender(player) {
  return player.getPacketSender();
}

function sendPieces(player, state) {
  const out = sender(player);
  const { piece, border, rotations } = resolveIds();
  state.pieces.forEach(({ x, y }, index) => {
    out.sendInterfacePosition(piece[index], x, y);
  });
  state.pieces.forEach(({ x, y }, index) => {
    out.sendInterfacePosition(border[index], x, y);
  });
  state.pieces.forEach(({ rotation }, index) => {
    const anim = rotations[index][rotation - 1];
    out.sendInterfaceAnimation(piece[index], anim);
    out.sendInterfaceAnimation(border[index], anim);
  });
}

/** Assemble: the puzzle, with all four parts carried. */
function openPuzzle(player) {
  const parts = ctx.schematicParts;
  if (!parts.every((itemId) => ctx.hasItem(player, itemId))) return false;
  const found = resolveIds();
  const state = {
    pieces: DATA.start.map(({ x, y, rotation }) => ({ x, y, rotation })),
    selected: [true, false, false],
    shown: [true, true, true],
    solved: false,
  };
  open.set(player, state);
  const out = sender(player);
  state.selected.forEach((value, index) => out.sendConfig(SELECT_VARPS[index], value ? 1 : 0));
  state.shown.forEach((value, index) => out.sendConfig(SHOW_VARPS[index], value ? 1 : 0));
  out.sendVarbit(BUSY_VARBIT, 1);
  out.sendInterface(found.group);
  out.sendSubInterface(found.side, found.control, 0);
  state.shown.forEach((value, index) => out.sendInterfaceDisplayState(found.shown[index], !value));
  state.selected.forEach((value, index) => out.sendInterfaceDisplayState(found.borderLayer[index], !value));
  sendPieces(player, state);
  return true;
}

function solvedNow(state) {
  return state.pieces.every((piece, index) => piece.rotation === 1
    && Math.abs(piece.x - DATA.solved[index].x) <= DATA.tolerance
    && Math.abs(piece.y - DATA.solved[index].y) <= DATA.tolerance);
}

function solve(player, state) {
  const found = resolveIds();
  const out = sender(player);
  state.solved = true;
  state.pieces = DATA.solved.map(({ x, y }) => ({ x, y, rotation: 1 }));
  for (const varp of [...SELECT_VARPS, ...SHOW_VARPS]) out.sendConfig(varp, 0);
  ctx.assembleSchematics(player);
  out.sendJingle(DATA.jingle);
  sendPieces(player, state);
  found.shown.forEach((uid) => out.sendInterfaceDisplayState(uid, false));
  found.borderLayer.forEach((uid) => out.sendInterfaceDisplayState(uid, true));
  out.sendInterfaceDisplayState(found.congrat, false);
}

function move(player, state, dx, dy, sound) {
  if (!state.selected.some(Boolean)) return;
  state.pieces.forEach((piece, index) => {
    if (!state.selected[index]) return;
    piece.x += dx * DATA.step;
    piece.y += dy * DATA.step;
  });
  // The capture's right presses made no sound (ticks 2703, 2756-2769, 2787-2791).
  if (sound) sender(player).sendSound(MOVE_SOUND, 0, 0);
  sendPieces(player, state);
}

function rotate(player, state) {
  if (!state.selected.some(Boolean)) return;
  state.pieces.forEach((piece, index) => {
    if (state.selected[index]) piece.rotation = piece.rotation % 4 + 1;
  });
  sender(player).sendSound(TURN_SOUND, 0, 0);
  sendPieces(player, state);
}

function select(player, state, index) {
  const found = resolveIds();
  const out = sender(player);
  state.selected[index] = !state.selected[index];
  out.sendConfig(SELECT_VARPS[index], state.selected[index] ? 1 : 0);
  if (state.selected[index]) {
    // Selecting a piece also shows it (tick 2705).
    state.shown[index] = true;
    out.sendInterfaceDisplayState(found.shown[index], false);
  }
  out.sendInterfaceDisplayState(found.borderLayer[index], !state.selected[index]);
}

function toggleShown(player, state, index) {
  const found = resolveIds();
  state.shown[index] = !state.shown[index];
  sender(player).sendConfig(SHOW_VARPS[index], state.shown[index] ? 1 : 0);
  sender(player).sendInterfaceDisplayState(found.shown[index], !state.shown[index]);
}

function pressButton(event) {
  const { player, buttonId } = event;
  const state = open.get(player);
  if (!state) return false;
  event.handled = true;
  if (state.solved) return;
  const { buttons } = resolveIds();
  if (buttonId === buttons.up) move(player, state, 0, -1, true);
  else if (buttonId === buttons.down) move(player, state, 0, 1, true);
  else if (buttonId === buttons.left) move(player, state, -1, 0, true);
  else if (buttonId === buttons.right) move(player, state, 1, 0, false);
  else if (buttonId === buttons.rotate) rotate(player, state);
  else if (buttons.select.includes(buttonId)) select(player, state, buttons.select.indexOf(buttonId));
  else if (buttons.hide.includes(buttonId)) toggleShown(player, state, buttons.hide.indexOf(buttonId));
  if (!state.solved && solvedNow(state)) {
    // The parts must still all be carried (the panel covers the inventory, but a drop could slip in).
    if (!ctx.schematicParts.every((itemId) => ctx.hasItem(player, itemId))) {
      sender(player).sendInterfaceRemoval();
      return;
    }
    solve(player, state);
  }
}

function closed({ player, interfaceId }) {
  if (!open.has(player)) return;
  const found = resolveIds();
  if (interfaceId !== found.group && interfaceId !== found.control) return;
  open.delete(player);
  sender(player).closeSubInterface(found.side);
  sender(player).sendVarbit(BUSY_VARBIT, 0);
}

function controlButtons() {
  const { buttons } = resolveIds();
  return [buttons.up, buttons.right, buttons.left, buttons.down, buttons.rotate, ...buttons.select, ...buttons.hide];
}

function attach(pluginApi, context) {
  api = pluginApi;
  ctx = context;
  api.onInterfaceActionButton(controlButtons(), pressButton);
  api.onCustomEvent("interface:closed", closed);
}

module.exports = { attach, openPuzzle, pressButton, isOpen: (player) => open.has(player), state: (player) => open.get(player), resolveIds };
