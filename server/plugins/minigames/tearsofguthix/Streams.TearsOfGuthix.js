"use strict";

/**
 * The weeping walls' tear streams (https://oldschool.runescape.wiki/w/Tears_of_Guthix_(minigame)):
 * 9 walls, 3 blue and 3 green streams always flowing. Each stream stays 16 ticks, then moves to
 * a wall that had none; the six move one after another in an order fixed for the world. A stream
 * never lands back on the wall it left, which gives the Wiki's odds (5/9 that one of the other
 * two blue streams refills a spot the first one left).
 *
 * Each wall tile carries the wall (Collect-from), a stream decoration (type 4) and its backing;
 * the decoration is a right- or left-hand variant per tile, as the cache map places it.
 */

const BLUE = "blue";
const GREEN = "green";
const NONE = "none";
const STREAM_TICKS = 16;
// ponytail: the Wiki gives the 16-tick stay and the order, not the gap between moves; six moves
// are spread evenly over the 16 ticks until a capture says otherwise.
const MOVE_OFFSETS = [0, 3, 5, 8, 11, 13];

const DECORATIONS = {
  right: { [BLUE]: 6661, [GREEN]: 6662, [NONE]: 6663 },
  left: { [BLUE]: 6665, [GREEN]: 6666, [NONE]: 6667 },
};

/** The walls as the cache map has them, with the colour each starts with. */
const WALLS = [
  { x: 3257, y: 9520, face: 3, side: "left", start: BLUE },
  { x: 3258, y: 9520, face: 3, side: "right", start: BLUE },
  { x: 3259, y: 9520, face: 3, side: "left", start: BLUE },
  { x: 3261, y: 9518, face: 0, side: "right", start: NONE },
  { x: 3261, y: 9517, face: 0, side: "left", start: NONE },
  { x: 3261, y: 9516, face: 0, side: "right", start: NONE },
  { x: 3257, y: 9514, face: 1, side: "right", start: GREEN },
  { x: 3258, y: 9514, face: 1, side: "left", start: GREEN },
  { x: 3259, y: 9514, face: 1, side: "right", start: GREEN },
];
const WALL_PLANE = 2;

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * A world's streams. `onChange(wallIndex, colour)` redraws a wall; `random` is Math.random
 * outside tests.
 */
function createStreams({ random = Math.random, onChange = () => {} } = {}) {
  const colours = WALLS.map((wall) => wall.start);
  // The world's sequence: which stream moves first, second, ... (GGGBBB, BGBGBG ...).
  const streams = shuffle(
    WALLS.flatMap((wall, index) => (wall.start === NONE ? [] : [{ wall: index }])),
    random,
  ).map((stream, order) => ({ ...stream, offset: MOVE_OFFSETS[order] }));
  let tick = 0;

  function move(stream) {
    const empty = colours.flatMap((colour, index) => (colour === NONE ? [index] : []));
    const to = empty[Math.floor(random() * empty.length)];
    const colour = colours[stream.wall];
    colours[stream.wall] = NONE;
    colours[to] = colour;
    onChange(stream.wall, NONE);
    onChange(to, colour);
    stream.wall = to;
  }

  return {
    tick() {
      tick++;
      for (const stream of streams) {
        if ((tick - stream.offset) % STREAM_TICKS === 0) move(stream);
      }
    },
    colourAt: (index) => colours[index],
    sequence: () => streams.map((stream) => colours[stream.wall]),
  };
}

function wallAt(x, y) {
  return WALLS.findIndex((wall) => wall.x === x && wall.y === y);
}

/** Starts the world's streams and redraws the walls as they move. */
function startStreams(core) {
  const { GameObject, Location, LocModelType, ObjectManager, Task, TaskManager } = core;
  const redraw = (index, colour) => {
    const wall = WALLS[index];
    const decoration = new GameObject(
      DECORATIONS[wall.side][colour],
      new Location(wall.x, wall.y, WALL_PLANE),
      LocModelType.WALL_DECORATION_INSIDE,
      wall.face,
      null,
    );
    ObjectManager.register(decoration, true);
  };
  const streams = createStreams({ onChange: redraw });
  TaskManager.submit(new (class extends Task {
    constructor() { super(1); }
    execute() { streams.tick(); }
  })());
  return streams;
}

module.exports = { BLUE, GREEN, NONE, STREAM_TICKS, WALLS, wallAt, createStreams, startStreams };
