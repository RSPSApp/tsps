const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { ShortcutAnim, between, hops, crevice } = require("./builders");

/** Revenant Caves pillars: jump two tiles onto the pillar and two beyond it. */
function revenantPillar({ pos, obj }) {
  const vertical = obj.face === 0;
  const [dx, dy] = vertical ? [0, pos.y > obj.y ? -2 : 2] : [pos.x <= obj.x ? 2 : -2, 0];
  return hops([pos.x + dx, pos.y + dy], [pos.x + dx * 2, pos.y + dy * 2]);
}

module.exports = [
  between({
    object: ObjectIds.STEPPING_STONE_9,
    level: 74,
    ends: [[3201, 3807, 0], [3201, 3810, 0]],
    cross: (from, to, { obj }) => hops([obj.x, obj.y], to),
  }),
  between({
    object: ObjectIds.STEPPING_STONE_8,
    level: 82,
    ends: [[3092, 3878, 0], [3092, 3883, 0]],
    cross: (from, to) => hops([3092, 3880], to),
  }),
  between({
    object: ObjectIds.CREVICE_19,
    level: 46,
    ends: [[3046, 10326, 0], [3048, 10336, 0]],
    end: "You climb your way through the narrow crevice.",
    cross: (from, to) => (to[1] > from[1]
      ? crevice([3046, 10327], [3048, 10335], to)
      : crevice([3048, 10335], [3046, 10327], to)),
  }),
  {
    // Wilderness God Wars Dungeon: shimmy around the jutting wall.
    object: ObjectIds.JUTTING_WALL_4,
    level: 60,
    xp: 0,
    steps: ({ pos }) => [{
      move: pos.y >= 10149 ? [3066, 10147, 3] : [3066, 10149, 3],
      anim: pos.y >= 10149 ? ShortcutAnim.JUTTING_WALL_LEFT : ShortcutAnim.JUTTING_WALL_RIGHT,
      speed: [0, 120],
      ticks: 4,
    }],
  },
  {
    object: ObjectIds.PILLAR,
    level: ({ obj }) => (obj.x === 3220 ? 65 : obj.x === 3241 ? 89 : 75),
    xp: 0,
    route: ({ pos, obj }) => {
      if (obj.face === 0) {
        return [obj.x, obj.y + (pos.y > obj.y ? 2 : -2), obj.z];
      }
      return [obj.x + (pos.x < obj.x ? -2 : 2), obj.y, obj.z];
    },
    steps: revenantPillar,
  },
];
