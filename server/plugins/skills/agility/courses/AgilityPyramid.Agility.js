const { ObjectIds, ItemIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Item } = require("../../../../src/main/typescript/elvarg/game/model/Item");
const { Skill } = require("../../../../src/main/typescript/elvarg/game/model/Skill");
const { Anim } = require("../Constants.Agility");

/**
 * Agility Pyramid. The obstacles' sounds, messages and ticks follow rsprox captures 2932 (rev 230,
 * main game) and 1757 (Leagues V, rev 227); XP is the Wiki's.
 */
/** agility_pyramid_top: 1 while the golden pyramid has been taken this lap. */
const PYRAMID_TOP_VARBIT = 1556;
/**
 * agility_pyramid_level: the floor the player is on, 0 to 5 (the top two are the separate map
 * square). On floors 1 and 3 it swaps the static pyramid block for the moving one (locs 10872 and
 * 10873). Set on every floor change; the stairs and the doorway are captured, falls follow them.
 */
const PYRAMID_LEVEL_VARBIT = 1550;
const LOW_WALL_SOUND = 2453;
const LEDGE_SOUND = 2451;
const WALL_GAP_SOUND = 2450;
const PLANK_SOUND = 2470;
const JUMP_SOUND = 2465;
const TOP_CLIMB_SOUND = 2454;
const STONE_BLOCK_SOUND = 1396;
const STONE_BLOCK_LANDING_SOUND = 2455;
/** agilityarena_dive_player: the dive over a stone block. */
const STONE_BLOCK_DIVE = 1115;
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

function onTopSquare(y) {
  return y >= 4686 && y <= 4709;
}

function lowerTile(x, y, z) {
  if (z === 2 && onTopSquare(y)) {
    return [x + 320, y - 1856, 3];
  }
  return [x, y, z - 1];
}

/** The floor `tile` is on, for agility_pyramid_level. */
function pyramidLevel([, y, z]) {
  return onTopSquare(y) ? z + 2 : z;
}

function levelStep(tile) {
  return { varbit: [PYRAMID_LEVEL_VARBIT, pyramidLevel(tile)] };
}

/** Vector `quarterTurns` clockwise from the object's facing. */
function turned(face, quarterTurns) {
  return ROTATION_VECTORS[(face + quarterTurns) % 4];
}

/**
 * Straight over the object from the player: along y when they stand within its columns, else
 * along x. A 2x2 gap taken from a corner column goes over it, not along it (rsprox 1757: 3357,2846
 * to 3357,2849 over the gap at 3356,2847).
 */
function toward({ obj, pos }) {
  const width = obj.sizeX ?? 1;
  const length = obj.sizeY ?? 1;
  if (pos.x >= obj.x && pos.x < obj.x + width) {
    return [0, pos.y < obj.y ? 1 : -1];
  }
  if (pos.y >= obj.y && pos.y < obj.y + length) {
    return [pos.x < obj.x ? 1 : -1, 0];
  }
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

/**
 * Ledge and wall-gap crossings: edge along the wall; a slip drops a floor. On, five tiles a tick
 * from the tick after, and off (with the XP) the tick after the last (rsprox 2932).
 */
function edgeCrossing({ startAnim, slideAnim, finishAnim, fallAnim, sound, start, end, xp, damage }) {
  const walkDirection = ({ obj }) => turned(obj.face, 1);
  return {
    level: 30,
    xp,
    route: edgeStart,
    start,
    end,
    steps: (context) => {
      const [dx, dy] = walkDirection(context);
      const { x, y } = context.pos;
      return [
        { face: [x + dx * 5, y + dy * 5] },
        { anim: startAnim },
        sound,
        { wait: 1 },
        { render: slideAnim },
        { walk: [[x + dx * 5, y + dy * 5]] },
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
        const below = lowerTile(slipX + fx * 2, slipY + fy * 2, z);
        return [
          { face: [x + dx * 5, y + dy * 5] },
          { anim: startAnim },
          sound,
          { wait: 1 },
          { render: slideAnim },
          { walk: [[slipX, slipY]] },
          { render: null },
          { anim: fallAnim },
          { wait: 1 },
          { move: below, speed: [0, 30] },
          levelStep(below),
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
    // The line and the creak on the plank's first tile, the XP the tick after the last (rsprox 2932).
    start: { spam: "You walk carefully across the slippery plank..." },
    steps: (context) => {
      const [dx, dy] = walkDirection(context);
      const { x, y } = context.pos;
      return [
        { sound: PLANK_SOUND, loops: 3 },
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
        const below = [slipX + fx * 2, slipY + fy * 2, z - 1];
        return [
          { sound: PLANK_SOUND, loops: 3 },
          { walk: [[slipX, slipY]] },
          { render: null },
          { anim: Anim.BALANCE_FALL },
          { wait: 1 },
          { move: below, speed: [0, 30] },
          levelStep(below),
          { hit: 10 },
        ];
      },
    },
  };
}

const JUMP_START = [{ wait: 1 }, { msg: { spam: "You jump the gap..." } }, { sound: JUMP_SOUND, delay: 20 }];

function jumpGap() {
  return {
    object: ObjectIds.GAP_17,
    index: 5,
    level: 30,
    xp: 22,
    // The jump the tick after arriving, three tiles, landing three ticks later (rsprox 2932, 1757).
    steps: (context) => {
      const [dx, dy] = toward(context);
      const { x, y } = context.pos;
      return [
        ...JUMP_START,
        { move: [x + dx * 3, y + dy * 3], anim: Anim.PYRAMID_JUMP, delay: 20, speed: [53, 85], ticks: 3 },
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
        const below = lowerTile(x + dx + fx * 2, y + dy + fy * 2, z);
        return [
          ...JUMP_START,
          { anim: Anim.PYRAMID_JUMP_FALL },
          { move: [x + dx, y + dy], speed: [0, 30] },
          { wait: 5 },
          { anim: -1 },
          { tele: below },
          levelStep(below),
          { hit: 8 },
        ];
      },
    },
  };
}

function takePyramidTop({ player, core, api }) {
  // Climbing up is the Desert diary's medium task (rsprox 1757).
  api.emitCustomEvent("diary:task", { player, diary: "desert", task: "climb-to-the-summit-of-the-agility-pyramid" });
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
  // In an item box, the top beside the line (rsprox 1757).
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, ItemIds.PYRAMID_TOP, "You find a golden pyramid!")));
}

/**
 * On the course above the ground: the pyramid's floors 1-3, or the separate map square that holds the top two floors
 * and the doorway (the stairs' landings and the doorway, rsprox 2932 and 1757, with a margin).
 */
function onPyramid(location) {
  const x = location?.getX?.(), y = location?.getY?.(), z = location?.getZ?.();
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x >= 3038 && x <= 3052 && y >= 4690 && y <= 4705) return true;
  return z >= 1 && x >= 3350 && x <= 3380 && y >= 2826 && y <= 2856;
}

/**
 * The top stays taken until the player is off the pyramid. The doorway clears agility_pyramid_top in
 * rsprox_transcripts/227/01757.txt (Leagues V), the one recording of it, which shows the take and the doorway but no
 * relog and no other way off. So it is inferred that a relog on the course keeps it (the attribute is saved, Agility.
 * plugin, and the varbit sent again at login), and that any other way off (a teleport, a death or fall, the stairs
 * down) clears it as the doorway does, or the top could never be taken again.
 */
function syncPyramidTop({ player }) {
  if (player.getAttribute(PYRAMID_TOP_ATTRIBUTE) !== true) return;
  if (!onPyramid(player.getLocation?.())) return clearPyramidTop(player);
  player.getPacketSender().sendVarbit(PYRAMID_TOP_VARBIT, 1);
}

/** Off the pyramid with the top taken, by any way but the doorway: it can be taken again (see syncPyramidTop). */
function clearPyramidTop(player) {
  if (player.getAttribute(PYRAMID_TOP_ATTRIBUTE) !== true || onPyramid(player.getLocation?.())) return;
  player.setAttribute(PYRAMID_TOP_ATTRIBUTE, false);
  player.getPacketSender().sendVarbit(PYRAMID_TOP_VARBIT, 0);
}

/** Out through the doorway: the top can be taken again, and the player is back on the ground. */
function leavePyramid(player) {
  player.setAttribute(PYRAMID_TOP_ATTRIBUTE, false);
  player.getPacketSender().sendVarbit(PYRAMID_TOP_VARBIT, 0);
  player.getPacketSender().sendVarbit(PYRAMID_LEVEL_VARBIT, 0);
}

function completionXp(player) {
  const level = player.getSkillManager().getMaxLevel(Skill.AGILITY);
  return Math.min(COMPLETION_MAX_XP, COMPLETION_BASE_XP + level * COMPLETION_XP_PER_LEVEL);
}

/**
 * Where each staircase up puts the player, whichever side it was climbed from (rsprox 2932, 1757:
 * every flight, from two different tiles at the bottom).
 */
const STAIRS_UP_LANDINGS = new Map([
  ["3354,2831,0", [3355, 2833, 1]],
  ["3356,2833,1", [3356, 2835, 2]],
  ["3358,2835,2", [3358, 2837, 3]],
  ["3360,2837,3", [3041, 4695, 2]],
  ["3042,4695,2", [3043, 4697, 3]],
]);

/**
 * Stairs: up or down a floor at once. Up from the ground starts a lap (rsprox 2932, 1757). No
 * climb down was captured; it keeps three tiles south of the player.
 */
function stairs(object, delta) {
  return {
    object,
    level: 30,
    xp: 0,
    startsLap: ({ pos }) => delta > 0 && pos.z === 0,
    steps: ({ obj, pos }) => {
      const tile = delta > 0
        ? STAIRS_UP_LANDINGS.get(`${obj.x},${obj.y},${obj.z}`) ?? higherTile(pos.x, pos.y + 3, pos.z)
        : lowerTile(pos.x, pos.y - 3, pos.z);
      return [{ tele: tile }, levelStep(tile)];
    },
  };
}

const ledge = edgeCrossing({
  startAnim: Anim.LEDGE_TURN,
  slideAnim: Anim.LEDGE_WALK,
  finishAnim: Anim.LEDGE_TURN_BACK,
  fallAnim: Anim.PYRAMID_LEDGE_FALL,
  sound: { sound: LEDGE_SOUND, loops: 5 },
  start: { spam: "You put your foot on the ledge and try to edge across..." },
  end: { spam: "You skillfully edge across the gap." },
  xp: 52,
  damage: 10,
});

// The wall gap's hand-holds say nothing (rsprox 2932, 1757).
const wallGap = edgeCrossing({
  startAnim: Anim.PYRAMID_GAP_START,
  slideAnim: Anim.PYRAMID_GAP_SLIDE,
  finishAnim: Anim.PYRAMID_GAP_FINISH,
  fallAnim: Anim.PYRAMID_GAP_FALL,
  sound: { sound: WALL_GAP_SOUND },
  xp: 56.4,
  damage: 8,
});

const plank = plankCrossing();

/**
 * Stone blocks: stepping onto one rolls it (its agility_pyramid_tilt_N varbit, which turns the
 * block loc on the floor below) and throws the player two tiles on, over the invisible wall
 * across its middle. `block` is that loc's south-west tile and rotation, `fall` where a failure
 * drops the player on the floor below.
 *
 * Captured (rsprox 2932, 1757; all five blocks, never failed): the tick after arriving on the
 * block's near row, the varbit goes to 1, sounds 1396 and 2455 (25 cycles in), and an exact move
 * of 10-30 cycles with the dive; the next tick the varbit is 0 again and the 12 XP is paid.
 * Failing (Wiki: Stone block, Agility Pyramid): down a floor for 6 damage, and always so, for 1,
 * from the far row; neither was captured, so the fall's animation and tile are guesses.
 */
function stoneBlocks({ varbit, block: [bx, by, bz, face], fall }) {
  const [dx, dy] = ROTATION_VECTORS[face];
  const z = bz + 1;
  const tiles = [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]];
  const depth = ([x, y]) => (x - bx) * dx + (y - by) * dy;
  const near = Math.min(...tiles.map(depth));
  const row = (d) => tiles.filter((tile) => depth(tile) === d).map(([x, y]) => [x, y, z]);
  const falls = (damage) => [
    { varbit: [varbit, 1] },
    { sound: STONE_BLOCK_SOUND },
    { anim: Anim.FREE_FALL },
    { wait: 1 },
    { tele: fall },
    levelStep(fall),
    { varbit: [varbit, 0] },
    { hit: damage },
  ];
  const onward = {
    tiles: row(near),
    face,
    level: 30,
    xp: 12,
    steps: ({ pos }) => [
      { varbit: [varbit, 1] },
      { sound: STONE_BLOCK_SOUND },
      { sound: STONE_BLOCK_LANDING_SOUND, delay: 25 },
      { move: [pos.x + dx * 2, pos.y + dy * 2], anim: STONE_BLOCK_DIVE, speed: [10, 30], ticks: 1 },
      { varbit: [varbit, 0] },
    ],
    fail: { baseChance: 75, neverFailLevel: 70, xp: 0, steps: falls(6) },
  };
  const backward = { tiles: row(near + 1), face, level: 30, xp: 0, steps: falls(1) };
  return [onward, backward];
}

module.exports = {
  PYRAMID_TOP_ATTRIBUTE, syncPyramidTop, clearPyramidTop, takePyramidTop, leavePyramid,
  key: "pyramid",
  name: "Agility Pyramid",
  helper: 6, // the Agility helper's course (enum 3507: "Agility Pyramid")
  lootSource: 17, // the loot tracker's source (enum 4976)
  lapXp: 0,
  // Each floor has its own mix of the obstacles; the lap runs from the stairs to the doorway.
  anyOrder: true,
  petBase: 9901, // Giant squirrel base chance (Wiki)
  obstacles: [
    stairs(ObjectIds.STAIRS_50, 1),
    stairs(ObjectIds.STAIRS_51, -1),
    // agility_pyramid_tilt_1-5 and the blocks' locs (10877-10881), in lap order.
    ...stoneBlocks({ varbit: 1551, block: [3354, 2841, 0, 1], fall: [3353, 2842, 0] }),
    ...stoneBlocks({ varbit: 1553, block: [3374, 2835, 0, 3], fall: [3376, 2835, 0] }),
    ...stoneBlocks({ varbit: 1552, block: [3368, 2849, 1, 2], fall: [3368, 2851, 1] }),
    ...stoneBlocks({ varbit: 1554, block: [3048, 4699, 1, 3], fall: [3370, 2843, 3] }),
    ...stoneBlocks({ varbit: 1555, block: [3044, 4699, 2, 2], fall: [3044, 4701, 2] }),
    {
      object: ObjectIds.LOW_WALL_3,
      index: 1,
      // The lap starts on the stairs; a low wall is on every floor.
      startsLap: false,
      level: 30,
      xp: 8,
      end: { spam: "... and make it over." },
      // Over the wall the tick after arriving, two tiles in 100 cycles, the XP three ticks later (rsprox 2932).
      steps: (context) => {
        const [dx, dy] = toward(context);
        const { x, y } = context.pos;
        return [
          { wait: 1 },
          { msg: { spam: "You climb the low wall..." } },
          { sound: LOW_WALL_SOUND, delay: 30 },
          { move: [x + dx * 2, y + dy * 2], anim: Anim.CLIMB_LOW_WALL_PYRAMID, delay: 30, speed: [30, 100], ticks: 3 },
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
      steps: [{ anim: Anim.CLIMB_ROCKS_DOWN }, { sound: TOP_CLIMB_SOUND, loops: 4 }, { wait: 1 }, { run: takePyramidTop }],
    },
    ...[ObjectIds.DOORWAY_15, ObjectIds.DOORWAY_16].map((object) => ({
      object,
      index: 7,
      level: 30,
      xp: completionXp,
      end: { mesbox: "You climb down the steep passage. It leads to the base of the pyramid." },
      steps: [{ tele: [3364, 2830, 0] }],
      onSuccess: leavePyramid,
    })),
  ],
};
