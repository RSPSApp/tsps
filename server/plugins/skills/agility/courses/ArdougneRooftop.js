const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { balance, faceLoc } = require("../steps");

/** A jump that lands a tick after take-off, as the Ardougne gaps chain them. */
function hop(destination, jump = Anim.LEAP) {
  return [{ wait: 1 }, { anim: jump, delay: 15 }, { wait: 1 }, { anim: Anim.LAND }, { tele: destination }];
}

module.exports = {
  key: "ardougne",
  name: "Ardougne Rooftop",
  lapXp: 889,
  petBase: 34440, // Giant squirrel base chance (Wiki)
  marks: {
    level: 90,
    tiles: [[2657, 3318, 3]],
  },
  obstacles: [
    {
      object: ObjectIds.WOODEN_BEAMS,
      index: 1,
      level: 90,
      xp: 43,
      steps: (context) => [
        faceLoc(context.obj),
        { wait: 1 },
        { anim: Anim.CLIMB_WALL, delay: 15 },
        { wait: 1 },
        { tele: [2673, 3298, 1] },
        { anim: Anim.CLIMB_WALL },
        { wait: 1 },
        { tele: [2673, 3298, 2] },
        { anim: Anim.CLIMB_WALL },
        { wait: 1 },
        { tele: [2671, 3299, 3] },
        { anim: Anim.LAND },
      ],
    },
    {
      object: ObjectIds.GAP_34,
      index: 2,
      level: 90,
      xp: 65,
      steps: (context) => [
        faceLoc(context.obj),
        ...hop([2667, 3311, 1]),
        ...hop([2665, 3315, 1]),
        ...hop([2665, 3318, 3], Anim.JUMP_SHORT),
      ],
    },
    {
      object: ObjectIds.PLANK_12,
      index: 3,
      level: 90,
      xp: 50,
      render: Anim.BALANCE_WALK,
      steps: balance([2656, 3318]),
    },
    {
      object: ObjectIds.GAP_35,
      index: 4,
      level: 90,
      xp: 21,
      steps: (context) => [faceLoc(context.obj), ...hop([2653, 3314, 3])],
    },
    {
      object: ObjectIds.GAP_36,
      index: 5,
      level: 90,
      xp: 28,
      steps: (context) => [faceLoc(context.obj), ...hop([2651, 3309, 3], Anim.JUMP_ACROSS)],
    },
    {
      object: ObjectIds.STEEP_ROOF,
      index: 6,
      level: 90,
      xp: 57,
      precondition: ({ pos }) => (pos.x === 2654 && pos.y === 3299 ? "You can't go back from here." : null),
      steps: (context) => [
        faceLoc(context.obj),
        { wait: 1 },
        { anim: Anim.LEDGE_TURN },
        { render: Anim.LEDGE_WALK },
        { walk: [[2654, 3299], [2656, 3297]] },
        { render: null },
        { anim: Anim.LEDGE_TURN_BACK },
        { walk: [[2656, 3295]] },
      ],
    },
    {
      object: ObjectIds.GAP_37,
      index: 7,
      level: 90,
      xp: 529,
      steps: (context) => [
        faceLoc(context.obj),
        ...hop([2658, 3298, 1]),
        { wait: 1 },
        { walk: [[2661, 3298]] },
        { move: [2663, 3297], anim: Anim.JUMP, speed: [15, 30], dir: "east" },
        { walk: [[2666, 3297]] },
        { move: [2667, 3297], anim: Anim.JUMP, speed: [15, 30], dir: "east" },
        { anim: Anim.LEAP },
        { wait: 1 },
        { tele: [2668, 3297, 0] },
        { anim: Anim.LAND },
      ],
    },
  ],
};
