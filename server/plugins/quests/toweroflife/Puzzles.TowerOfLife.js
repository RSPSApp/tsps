/**
 * Tower of Life's three repair puzzles as the revision 242 capture plays them (TowerOfLife.bin; the
 * facts and ticks are in docs/quests/tower-of-life/README.md, "Machines"). Each opens in its cache
 * interface once its machine is built: tol_pressure_machine (510), tol_pipe_machine (511) and
 * tol_cage_puzzle (509).
 *
 * - Pressure: four balls start at levels 3, 4, 1 and 1. The left lever frees wheel 2 when pulled and
 *   wheel 1 when not; the right lever does the same for wheels 4 and 3. An unplugged ball cannot rise
 *   past its hole's pressure (3, 4, 3, 4) and plugs the hole when it is lowered onto it (1, 2, 2, 3);
 *   a plugged ball rises to 5, and four plugged balls at 5 make the machine work three ticks later.
 * - Pipes: five pieces, moved 8 pixels a press, turned through four rotations. A piece in its solved
 *   rotation (the first of its four green models) locks onto its target from up to 9 pixels away on
 *   both axes, and none goes above y 58. Every press resends all five pieces. The machine works four
 *   ticks after the last lock.
 * - Cage: four sides of three bars, opened on the second side. A bar of the right direction and size
 *   fills the first open slot that takes it on the side shown. The finished cage turns once round,
 *   a side a tick, and is complete five ticks after the last bar.
 */
const PRESSURE_GROUP = 510;
const PIPE_GROUP = 511;
const CAGE_GROUP = 509;
const uid = (group, child) => (group << 16) | child;

const PRESSURE = Object.freeze({
  version: 2,
  start: [3, 4, 1, 1],
  /** Lowering a ball onto this level plugs its hole. */
  plug: [1, 2, 2, 3],
  /** The highest level an unplugged ball reaches. */
  cap: [3, 4, 3, 4],
  /** [lever index, the position that frees the wheel]. */
  lever: [[0, 0], [0, 1], [1, 0], [1, 1]],
  levels: [3351, 3352, 3353, 3355], // tol_pres1..4_level
  plugged: [3347, 3348, 3349, 3350], // tol_pres_solved1..4
  levers: [3356, 3357], // tol_lever1, tol_lever2
  init: 7982, // tol_pres_initpuzzle
  /** valve_N_left / valve_N_right, then lever_1 and lever_2. */
  wheels: new Map([[128, [0, -1]], [129, [0, 1]], [130, [1, -1]], [131, [1, 1]],
    [132, [2, -1]], [133, [2, 1]], [134, [3, -1]], [135, [3, 1]]]),
  leverButtons: new Map([[136, 0], [141, 1]]),
  workingTicks: 3,
});

const PIPE = Object.freeze({
  version: 3,
  step: 8,
  snap: 9,
  /** A press that would take a piece above this is ignored and nothing is resent (capture ticks 2114-2115). */
  minY: 58,
  workingTicks: 4,
  rotationVarbit: 7981, // tol_pipe5_rot, sent for the fifth piece only
  // tol_pipe_piece01..05: the component, its active varbit, the capture's start and solved tiles, its
  // start rotation, the first of its four green (in hand) models, and the grey models seen for rotation 0
  // (and 2, piece 3's start). Ours: rotations 1 and 3 show the grey of 0 and 2.
  pieces: [
    { child: 10, varbit: 3341, start: [356, 58], target: [83, 80], rotation: 0, green: 22531, grey: [22526, 22528] },
    { child: 13, varbit: 3342, start: [327, 171], target: [126, 64], rotation: 0, green: 22539, grey: [22530, 22536] },
    { child: 9, varbit: 3343, start: [402, 153], target: [159, 69], rotation: 2, green: 22547, grey: [22538, 22544] },
    { child: 11, varbit: 3344, start: [323, 229], target: [256, 60], rotation: 0, green: 22555, grey: [22546, 22552] },
    { child: 12, varbit: 3345, start: [449, 64], target: [237, 155], rotation: 0, green: 22562, grey: [22554, 22560], rotationVarbit: true },
  ],
  rotate: 15,
  moves: new Map([[17, [-1, 0]], [19, [1, 0]], [21, [0, -1]], [23, [0, 1]]]),
});

const CAGE = Object.freeze({
  version: 2,
  startSide: 1,
  sides: [5, 10, 15, 20], // rotation1..4
  // Each side's slots: [component, direction, size, model].
  slots: [
    [[7, "h", 2, 22469], [8, "h", 2, 22472], [9, "v", 2, 22475]],
    [[12, "v", 2, 22480], [13, "h", 3, 22483], [14, "h", 2, 22486]],
    [[17, "v", 2, 22491], [18, "v", 4, 22494], [19, "h", 2, 22497]],
    [[22, "h", 4, 22502], [23, "v", 2, 22505], [24, "v", 3, 22508]],
  ],
  horizontalPipes: 37, horizontalBar: 38, verticalPipes: 39, verticalBar: 40, size: 56,
  // tol_cage_horiz_bar / tol_cage_vert_bar models: size 1 and then every second model.
  barModel: { h: 22446, v: 22459 },
  maxSize: 4, // Ours: no capture of a size-5 press
  buttons: { left: 26, right: 29, confirm: 32, horizontal: 41, vertical: 44, minus: 49, plus: 52 },
  fixSound: 3420,
  completeTicks: 5,
});

const PRESSURE_ATTRIBUTE = "tower-of-life:pressure-puzzle";
const PIPE_ATTRIBUTE = "tower-of-life:pipe-puzzle";
const CAGE_ATTRIBUTE = "tower-of-life:cage-puzzle";
const BUTTONS = [
  ...[...PRESSURE.wheels.keys(), ...PRESSURE.leverButtons.keys()].map((child) => uid(PRESSURE_GROUP, child)),
  ...[...PIPE.pieces.map((piece) => piece.child), PIPE.rotate, ...PIPE.moves.keys()].map((child) => uid(PIPE_GROUP, child)),
  ...Object.values(CAGE.buttons).map((child) => uid(CAGE_GROUP, child)),
];

/** `ctx`: { sendVarbit(player, id, value), working(player, machine) } — `working` finishes a machine. */
function createPuzzles(api, ctx) {
  const { CountdownTask, TaskManager } = api.core;
  const open = new WeakMap();
  const timers = new WeakMap();

  api.persistAttribute(PRESSURE_ATTRIBUTE, null);
  api.persistAttribute(PIPE_ATTRIBUTE, null);
  api.persistAttribute(CAGE_ATTRIBUTE, null);

  function later(player, ticks, callback) {
    let key = timers.get(player);
    if (!key) timers.set(player, key = {});
    TaskManager.submit(new CountdownTask(key, ticks, () => {
      if (player.isRegistered?.() === false) return;
      callback();
    }));
  }

  function read(player, key, version) {
    const state = player.getAttribute(key);
    return state && typeof state === "object" && state.version === version ? state : null;
  }

  const save = (player, key, state) => player.setAttribute(key, state);
  const varbit = (player, id, value) => ctx.sendVarbit(player, id, value);

  // ------------------------------------------------------------------ pressure machine

  function pressureState(player, create) {
    let state = read(player, PRESSURE_ATTRIBUTE, PRESSURE.version);
    if (!state && create) {
      state = { version: PRESSURE.version, levels: [...PRESSURE.start], plugged: [false, false, false, false], levers: [0, 0] };
      save(player, PRESSURE_ATTRIBUTE, state);
    }
    return state;
  }

  function sendPressure(player, state) {
    if (!state) return;
    state.levels.forEach((level, i) => varbit(player, PRESSURE.levels[i], level));
    state.plugged.forEach((plugged, i) => varbit(player, PRESSURE.plugged[i], plugged ? 1 : 0));
    state.levers.forEach((lever, i) => varbit(player, PRESSURE.levers[i], lever));
    varbit(player, PRESSURE.init, 1);
  }

  const pressureSolved = (state) => state.levels.every((level, i) => state.plugged[i] && level === 5);

  function pressureWheel(player, state, ball, delta) {
    const pipe = `Pipe ${ball + 1}`;
    const [lever, freed] = PRESSURE.lever[ball];
    if (state.levers[lever] !== freed) {
      player.sendMessage(`${pipe}: The wheel won't budge. A lever will release it.`);
      return;
    }
    const level = state.levels[ball];
    if (delta < 0) {
      if (level <= 1) {
        player.sendMessage(`${pipe}: You can't lower the pressure any further.`);
        return;
      }
      state.levels[ball] = level - 1;
      if (!state.plugged[ball] && state.levels[ball] === PRESSURE.plug[ball]) {
        state.plugged[ball] = true;
        player.sendMessage(`${pipe}: The leak is blocked!`);
      }
    } else {
      if (!state.plugged[ball] && level >= PRESSURE.cap[ball]) {
        player.sendMessage(`${pipe}: There isn't enough pressure because of the hole!`);
        return;
      }
      if (level >= 5) return; // Ours: no capture of a press past a full pipe
      state.levels[ball] = level + 1;
    }
    save(player, PRESSURE_ATTRIBUTE, state);
    sendPressure(player, state);
    if (pressureSolved(state)) finish(player, "pressure", PRESSURE.workingTicks);
  }

  function pressureButton(player, child) {
    const state = pressureState(player, false);
    if (!state || state.done) return;
    const lever = PRESSURE.leverButtons.get(child);
    if (lever !== undefined) {
      state.levers[lever] ^= 1;
      save(player, PRESSURE_ATTRIBUTE, state);
      sendPressure(player, state);
      return;
    }
    const wheel = PRESSURE.wheels.get(child);
    if (wheel) pressureWheel(player, state, wheel[0], wheel[1]);
  }

  // ------------------------------------------------------------------ pipe machine

  function pipeState(player, create) {
    let state = read(player, PIPE_ATTRIBUTE, PIPE.version);
    if (!state && create) {
      state = {
        version: PIPE.version,
        active: null,
        pieces: PIPE.pieces.map(({ start: [x, y], rotation }) => ({ x, y, rotation, placed: false })),
      };
      save(player, PIPE_ATTRIBUTE, state);
    }
    return state;
  }

  function pipeModel(index, piece, inHand) {
    const def = PIPE.pieces[index];
    return inHand ? def.green + piece.rotation : def.grey[(piece.rotation >> 1) & 1];
  }

  function sendPipes(player, state) {
    if (!state) return;
    const sender = player.getPacketSender();
    state.pieces.forEach((piece, i) => sender.sendInterfacePosition(uid(PIPE_GROUP, PIPE.pieces[i].child), piece.x, piece.y));
    state.pieces.forEach((piece, i) => sender.sendInterfaceRawModel(uid(PIPE_GROUP, PIPE.pieces[i].child), pipeModel(i, piece, state.active === i)));
  }

  function setActive(player, state, index) {
    if (state.active !== null) varbit(player, PIPE.pieces[state.active].varbit, 0);
    state.active = index;
    if (index !== null) varbit(player, PIPE.pieces[index].varbit, 1);
  }

  function pipeButton(player, child) {
    const state = pipeState(player, false);
    if (!state || state.done) return;
    const selected = PIPE.pieces.findIndex((piece) => piece.child === child);
    if (selected >= 0) {
      if (state.pieces[selected].placed) {
        player.sendMessage("You've already solved that piece!");
        return;
      }
      setActive(player, state, selected);
      save(player, PIPE_ATTRIBUTE, state);
      sendPipes(player, state);
      return;
    }
    if (state.active === null) {
      player.sendMessage("Please select a piece of pipe first.");
      return;
    }
    const index = state.active;
    const piece = state.pieces[index];
    const def = PIPE.pieces[index];
    if (child === PIPE.rotate) {
      piece.rotation = (piece.rotation + 1) % 4;
      if (def.rotationVarbit) varbit(player, PIPE.rotationVarbit, piece.rotation);
    } else {
      const move = PIPE.moves.get(child);
      if (!move) return;
      if (piece.y + move[1] * PIPE.step < PIPE.minY) return;
      piece.x += move[0] * PIPE.step;
      piece.y += move[1] * PIPE.step;
      const [tx, ty] = def.target;
      if (piece.rotation === 0 && Math.abs(piece.x - tx) <= PIPE.snap && Math.abs(piece.y - ty) <= PIPE.snap) {
        piece.x = tx;
        piece.y = ty;
        piece.placed = true;
        setActive(player, state, null);
      }
    }
    save(player, PIPE_ATTRIBUTE, state);
    sendPipes(player, state);
    if (state.pieces.every((entry) => entry.placed)) finish(player, "pipe", PIPE.workingTicks);
  }

  // ------------------------------------------------------------------ cage

  function cageState(player, create) {
    let state = read(player, CAGE_ATTRIBUTE, CAGE.version);
    if (!state && create) {
      state = { version: CAGE.version, side: CAGE.startSide, direction: null, size: 1, solved: CAGE.slots.map((side) => side.map(() => false)) };
      save(player, CAGE_ATTRIBUTE, state);
    }
    return state;
  }

  function hideBars(player) {
    const sender = player.getPacketSender();
    sender.sendInterfaceDisplayState(uid(CAGE_GROUP, CAGE.horizontalPipes), true);
    sender.sendInterfaceDisplayState(uid(CAGE_GROUP, CAGE.verticalPipes), true);
  }

  function showSide(player, from, to) {
    const sender = player.getPacketSender();
    if (from !== null && from !== to) sender.sendInterfaceDisplayState(uid(CAGE_GROUP, CAGE.sides[from]), true);
    sender.sendInterfaceDisplayState(uid(CAGE_GROUP, CAGE.sides[to]), false);
  }

  function sendBar(player, state) {
    const sender = player.getPacketSender();
    sender.sendString(String(state.size), uid(CAGE_GROUP, CAGE.size));
    const bar = state.direction === "h" ? CAGE.horizontalBar : CAGE.verticalBar;
    sender.sendInterfaceRawModel(uid(CAGE_GROUP, bar), CAGE.barModel[state.direction] + 2 * (state.size - 1));
  }

  function renderCage(player, state) {
    const sender = player.getPacketSender();
    CAGE.sides.forEach((child, side) => sender.sendInterfaceDisplayState(uid(CAGE_GROUP, child), side !== state.side));
    state.solved.forEach((side, s) => side.forEach((solved, b) => {
      if (solved) sender.sendInterfaceRawModel(uid(CAGE_GROUP, CAGE.slots[s][b][0]), CAGE.slots[s][b][3]);
    }));
    hideBars(player);
  }

  function chooseDirection(player, state, direction) {
    const sender = player.getPacketSender();
    if (state.direction === direction) {
      // Pressing the shown bar's button again takes the bar away.
      state.direction = null;
      state.size = 1;
      sender.sendString("1", uid(CAGE_GROUP, CAGE.size));
      hideBars(player);
      return;
    }
    state.direction = direction;
    state.size = 1;
    sendBar(player, state);
    sender.sendInterfaceDisplayState(uid(CAGE_GROUP, CAGE.horizontalPipes), direction !== "h");
    sender.sendInterfaceDisplayState(uid(CAGE_GROUP, CAGE.verticalPipes), direction !== "v");
  }

  function confirmBar(player, state) {
    if (!state.direction) return; // Ours: no capture of placing with no bar shown
    const slots = CAGE.slots[state.side];
    const fit = slots.findIndex(([, direction, size], b) => !state.solved[state.side][b] && direction === state.direction && size === state.size);
    const sender = player.getPacketSender();
    if (fit < 0) {
      player.sendMessage("That's not going to work.");
    } else {
      state.solved[state.side][fit] = true;
      player.sendMessage("You fix the part of the cage!");
      sender.sendInterfaceRawModel(uid(CAGE_GROUP, slots[fit][0]), slots[fit][3]);
      sender.sendSound(CAGE.fixSound, 1, 0);
    }
    state.direction = null;
    state.size = 1;
    hideBars(player);
    sender.sendString("1", uid(CAGE_GROUP, CAGE.size));
    if (fit >= 0 && state.solved.every((side) => side.every(Boolean))) {
      player.sendMessage("It's complete!");
      state.done = true;
      // The finished cage turns once round, a side a tick, before it is complete.
      for (let turn = 1; turn < CAGE.completeTicks; turn++) {
        later(player, turn, () => {
          if (open.get(player) !== "cage") return;
          const from = state.side;
          state.side = (state.side + 3) % 4;
          showSide(player, from, state.side);
        });
      }
      finish(player, "cage", CAGE.completeTicks);
    }
  }

  function cageButton(player, child) {
    const state = cageState(player, false);
    if (!state || state.done) return;
    const { buttons } = CAGE;
    if (child === buttons.left || child === buttons.right) {
      const from = state.side;
      state.side = (state.side + (child === buttons.right ? 1 : 3)) % 4;
      showSide(player, from, state.side);
    } else if (child === buttons.horizontal) {
      chooseDirection(player, state, "h");
    } else if (child === buttons.vertical) {
      chooseDirection(player, state, "v");
    } else if (child === buttons.minus) {
      if (!state.direction) return;
      if (state.size <= 1) {
        player.sendMessage("You can't make bars smaller than that.");
        return;
      }
      state.size -= 1;
      sendBar(player, state);
    } else if (child === buttons.plus) {
      if (!state.direction || state.size >= CAGE.maxSize) return;
      state.size += 1;
      sendBar(player, state);
    } else if (child === buttons.confirm) {
      confirmBar(player, state);
    }
    save(player, CAGE_ATTRIBUTE, state);
  }

  // ------------------------------------------------------------------ shared

  /** The machine works `ticks` after its last move (and its puzzle closes then), unless the player left it. */
  function finish(player, machine, ticks) {
    const key = machine === "pressure" ? PRESSURE_ATTRIBUTE : machine === "pipe" ? PIPE_ATTRIBUTE : CAGE_ATTRIBUTE;
    const state = player.getAttribute(key);
    if (state) {
      state.done = true;
      save(player, key, state);
    }
    later(player, ticks, () => ctx.working(player, machine));
  }

  function openPuzzle(player, machine) {
    const sender = player.getPacketSender();
    if (machine === "pressure") {
      sendPressure(player, pressureState(player, true));
      sender.sendInterface(PRESSURE_GROUP);
    } else if (machine === "pipe") {
      sender.sendInterface(PIPE_GROUP);
      sendPipes(player, pipeState(player, true));
    } else {
      sender.sendInterface(CAGE_GROUP);
      renderCage(player, cageState(player, true));
    }
    open.set(player, machine);
  }

  /** A puzzle whose last move landed works even when the player shut it during the wait. */
  function finished(player, machine) {
    const key = machine === "pressure" ? PRESSURE_ATTRIBUTE : machine === "pipe" ? PIPE_ATTRIBUTE : CAGE_ATTRIBUTE;
    return player.getAttribute(key)?.done === true;
  }

  function handleButton(event) {
    const group = event.buttonId >> 16;
    const machine = group === PRESSURE_GROUP ? "pressure" : group === PIPE_GROUP ? "pipe" : group === CAGE_GROUP ? "cage" : null;
    if (!machine || open.get(event.player) !== machine) return;
    event.handled = true;
    const child = event.buttonId & 0xffff;
    if (machine === "pressure") pressureButton(event.player, child);
    else if (machine === "pipe") pipeButton(event.player, child);
    else cageButton(event.player, child);
  }

  function handleClosed(event) {
    if ([PRESSURE_GROUP, PIPE_GROUP, CAGE_GROUP].includes(event.interfaceId)) open.delete(event.player);
  }

  function isOpen(player, machine) {
    return open.get(player) === machine;
  }

  function close(player) {
    if (open.has(player)) player.getPacketSender().sendInterfaceRemoval();
    open.delete(player);
  }

  /** The pressure varbits the client draws the machine from, as at login. */
  function restore(player) {
    open.delete(player);
    const pressure = pressureState(player, false);
    if (pressure) sendPressure(player, pressure);
  }

  /** At completion live clears the pressure puzzle's varbits (capture tick 3442). */
  function reset(player) {
    PRESSURE.levels.forEach((id) => varbit(player, id, 0));
    PRESSURE.plugged.forEach((id) => varbit(player, id, 0));
    PRESSURE.levers.forEach((id) => varbit(player, id, 0));
    player.setAttribute(PRESSURE_ATTRIBUTE, null);
    player.setAttribute(PIPE_ATTRIBUTE, null);
    player.setAttribute(CAGE_ATTRIBUTE, null);
  }

  return { BUTTONS, openPuzzle, handleButton, handleClosed, isOpen, close, finished, restore, reset };
}

module.exports = { createPuzzles, PRESSURE, PIPE, CAGE, PRESSURE_ATTRIBUTE, PIPE_ATTRIBUTE, CAGE_ATTRIBUTE };
