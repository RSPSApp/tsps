const { ObjectIds, ItemIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Item } = require("../../../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const { Anim } = require("../constants");

/** RuneLite: AGILITY_PYRAMID_TOP - 1 while the golden pyramid has been taken this lap. */
const PYRAMID_TOP_VARBIT = 1556;
const PYRAMID_TOP_ATTRIBUTE = "agility.pyramid.top";
const COMPLETION_BASE_XP = 300;
const COMPLETION_XP_PER_LEVEL = 8;
const COMPLETION_MAX_XP = 1000;

/** Object rotation (0 west, 1 north, 2 east, 3 south) as a tile vector. */
const ROTATION_VECTORS = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/** The pyramid's top floor lives in a separate map square; these swap between them. */
function higherTile(x, y, z) {
  return z === 3 ? [x - 320, y + 1856, 2] : [x, y, z + 1];
}

function lowerTile(x, y, z) {
  if (z === 2 && y >= 4686 && y <= 4709) {
    return [x + 320, y - 1856, 3];
  }
  return [x, y, z - 1];
}

/** Vector `quarterTurns` clockwise from the object's facing. */
function turned(face, quarterTurns) {
  return ROTATION_VECTORS[(face + quarterTurns) % 4];
}

function toward({ obj, pos }) {
  const dx = Math.sign(obj.x - pos.x);
  const dy = Math.sign(obj.y - pos.y);
  return Math.abs(obj.x - pos.x) >= Math.abs(obj.y - pos.y) ? [dx || 1, 0] : [0, dy || 1];
}

/** Where ledge and gap crossings begin, relative to the object and its rotation. */
function edgeStart({ obj }) {
  switch (obj.face) {
    case 0: return [obj.x + 1, obj.y - 1, obj.z];
    case 3: return [obj.x + 2, obj.y + 1, obj.z];
    case 1: return [obj.x - 1, obj.y, obj.z];
    default: return [obj.x, obj.y + 2, obj.z];
  }
}

/** Ledge and wall-gap crossings: edge along the wall; a slip drops a floor. */
function edgeCrossing({ startAnim, slideAnim, finishAnim, fallAnim, xp, damage, successTicks = 1 }) {
  const walkDirection = ({ obj }) => turned(obj.face, 1);
  return {
    level: 30,
    xp,
    route: edgeStart,
    start: "You put your foot on the ledge and try to edge across...",
    end: "You skillfully edge across the gap.",
    steps: (context) => {
      const [dx, dy] = walkDirection(context);
      const { x, y } = context.pos;
      return [
        { face: [x + dx * 5, y + dy * 5] },
        { anim: startAnim, delay: 10 },
        { wait: 1 },
        { anim: -1 },
        { render: slideAnim },
        { walk: [[x + dx * 5, y + dy * 5]] },
        { wait: successTicks },
        { render: null },
        { anim: finishAnim },
      ];
    },
    fail: {
      baseChance: 75,
      neverFailLevel: 70,
      xp: 0,
      end: "You slip and fall to the level below.",
      steps: (context) => {
        const [dx, dy] = walkDirection(context);
        const [fx, fy] = ROTATION_VECTORS[context.obj.face];
        const { x, y, z } = context.pos;
        const slipX = x + dx * 2;
        const slipY = y + dy * 2;
        return [
          { face: [x + dx * 5, y + dy * 5] },
          { anim: startAnim, delay: 10 },
          { wait: 1 },
          { anim: -1 },
          { render: slideAnim },
          { walk: [[slipX, slipY]] },
          { render: null },
          { anim: fallAnim },
          { wait: 1 },
          { move: lowerTile(slipX + fx * 2, slipY + fy * 2, z), speed: [0, 30] },
          { hit: damage },
        ];
      },
    },
  };
}

function plankCrossing() {
  const walkDirection = ({ obj }) => turned(obj.face, 2);
  return {
    level: 30,
    xp: 56.4,
    route: ({ obj }) => [obj.x, obj.y, obj.z],
    render: Anim.BALANCE_WALK,
    start: "You walk carefully across the slippery plank...",
    steps: (context) => {
      const [dx, dy] = walkDirection(context);
      const { x, y } = context.pos;
      return [
        { anim: Anim.BALANCE_STAND, delay: 10 },
        { wait: 1 },
        { walk: [[x + dx * 5, y + dy * 5]] },
      ];
    },
    fail: {
      baseChance: 75,
      neverFailLevel: 70,
      xp: 0,
      render: Anim.BALANCE_WALK,
      steps: (context) => {
        const [dx, dy] = walkDirection(context);
        const [fx, fy] = turned(context.obj.face, 1);
        const { x, y, z } = context.pos;
        const slipX = x + dx * 2;
        const slipY = y + dy * 2;
        return [
          { anim: Anim.BALANCE_STAND, delay: 10 },
          { wait: 1 },
          { walk: [[slipX, slipY]] },
          { render: null },
          { anim: Anim.BALANCE_FALL },
          { wait: 1 },
          { move: [slipX + fx * 2, slipY + fy * 2, z - 1], speed: [0, 30] },
          { hit: 10 },
        ];
      },
    },
  };
}

function jumpGap() {
  return {
    object: ObjectIds.GAP_17,
    index: 5,
    level: 30,
    xp: 22,
    start: "You jump the gap...",
    steps: (context) => {
      const [dx, dy] = toward(context);
      const { x, y } = context.pos;
      return [
        { move: [x + dx * 3, y + dy * 3], anim: Anim.PYRAMID_JUMP, speed: [0, 30] },
      ];
    },
    fail: {
      baseChance: 75,
      neverFailLevel: 75,
      xp: 0,
      end: "... and miss your footing.",
      steps: (context) => {
        const [dx, dy] = toward(context);
        const [fx, fy] = ROTATION_VECTORS[context.obj.face];
        const { x, y, z } = context.pos;
        return [
          { anim: Anim.PYRAMID_JUMP_FALL },
          { move: [x + dx, y + dy], speed: [0, 30] },
          { wait: 5 },
          { anim: -1 },
          { tele: lowerTile(x + dx + fx * 2, y + dy + fy * 2, z) },
          { hit: 8 },
        ];
      },
    },
  };
}

function takePyramidTop(player) {
  if (player.getAttribute(PYRAMID_TOP_ATTRIBUTE) === true) {
    player.sendMessage("You find nothing on top of the pyramid.");
    return;
  }
  if (player.getInventory().isFull()) {
    player.sendMessage("You don't have enough inventory space to pick up this item.");
    return;
  }
  player.getInventory().addItem(new Item(ItemIds.PYRAMID_TOP, 1));
  player.setAttribute(PYRAMID_TOP_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(PYRAMID_TOP_VARBIT, 1);
  player.sendMessage("You find a golden pyramid!");
}

function resetPyramidTop(player) {
  player.setAttribute(PYRAMID_TOP_ATTRIBUTE, false);
  player.getPacketSender().sendVarbit(PYRAMID_TOP_VARBIT, 0);
}

function completionXp(player) {
  const level = player.getSkillManager().getMaxLevel(Skill.AGILITY);
  return Math.min(COMPLETION_MAX_XP, COMPLETION_BASE_XP + level * COMPLETION_XP_PER_LEVEL);
}

function stairs(object, delta) {
  return {
    object,
    level: 30,
    xp: 0,
    steps: ({ pos }) => [
      { tele: delta > 0 ? higherTile(pos.x, pos.y + 3, pos.z) : lowerTile(pos.x, pos.y - 3, pos.z) },
    ],
  };
}

const ledge = edgeCrossing({
  startAnim: Anim.LEDGE_TURN,
  slideAnim: Anim.LEDGE_WALK,
  finishAnim: Anim.LEDGE_TURN_BACK,
  fallAnim: Anim.PYRAMID_LEDGE_FALL,
  xp: 52,
  damage: 10,
});

const wallGap = edgeCrossing({
  startAnim: Anim.PYRAMID_GAP_START,
  slideAnim: Anim.PYRAMID_GAP_SLIDE,
  finishAnim: Anim.PYRAMID_GAP_FINISH,
  fallAnim: Anim.PYRAMID_GAP_FALL,
  xp: 56.4,
  damage: 8,
});

const plank = plankCrossing();

module.exports = {
  key: "pyramid",
  name: "Agility Pyramid",
  lapXp: 0,
  petBase: 9901, // Giant squirrel base chance (Wiki)
  obstacles: [
    stairs(ObjectIds.STAIRS_50, 1),
    stairs(ObjectIds.STAIRS_51, -1),
    {
      object: ObjectIds.LOW_WALL_3,
      index: 1,
      level: 30,
      xp: 8,
      start: "You climb the low wall...",
      end: "... and make it over.",
      steps: (context) => {
        const [dx, dy] = toward(context);
        const { x, y } = context.pos;
        return [
          { move: [x + dx * 2, y + dy * 2], anim: Anim.CLIMB_LOW_WALL_PYRAMID, delay: 15, speed: [0, 60], ticks: 2 },
        ];
      },
    },
    ...[ObjectIds.LEDGE_8, ObjectIds.LEDGE_9, ObjectIds.LEDGE_11].map((object) => ({ ...ledge, object, index: 2 })),
    ...[ObjectIds.PLANK_10, ObjectIds.PLANK_11].map((object) => ({ ...plank, object, index: 3 })),
    ...[ObjectIds.GAP_18, ObjectIds.GAP_22, ObjectIds.GAP_24].map((object) => ({ ...wallGap, object, index: 4 })),
    jumpGap(),
    {
      object: ObjectIds.CLIMBING_ROCKS_2,
      index: 6,
      level: 30,
      xp: 0,
      steps: [{ anim: Anim.CLIMB_ROCKS_DOWN }, { wait: 2 }, { run: ({ player }) => takePyramidTop(player) }],
    },
    ...[ObjectIds.DOORWAY_15, ObjectIds.DOORWAY_16].map((object) => ({
      object,
      index: 7,
      level: 30,
      xp: completionXp,
      end: "You climb down the steep passage. It leads to the base of the pyramid.",
      steps: [{ tele: [3364, 2830, 0] }],
      onSuccess: resetPyramidTop,
    })),
  ],
};
