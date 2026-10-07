const { Anim } = require("../constants");
const { ShortcutAnim, between, jump } = require("./builders");

/** Taverley Dungeon's floor spikes: run up, leap over, and land on the far side. */
function spikeJump(from, to, { obj }, trap, landing) {
  const east = to[0] > from[0];
  const runTo = [obj.x + (east ? -1 : 1), obj.y];
  const steps = [
    { face: [obj.x, obj.y] },
    { move: runTo, anim: Anim.RUN_UP, speed: [0, 60] },
    { anim: Anim.JUMP_HURDLE },
    { wait: 1 },
  ];
  if (trap) {
    steps.push({ hit: [1, 4] }, { msg: "You trigger the trap as you jump over it." }, { objAnim: ShortcutAnim.SPIKE_TRAP });
  }
  steps.push({ move: east ? landing.east : landing.west, speed: [0, 20] });
  return steps;
}

/** Asgarnia shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Taverley Dungeon: the rock up to (and down from) the blue dragon ledge. */
  taverleyDragonRock: ({ ledge, foot, ground }) => ({
    steps: ({ pos, obj }) => (pos.z === 0
      ? [jump([obj.x, obj.y]), { anim: Anim.JUMP_SHORT }, { wait: 1 }, { anim: Anim.LAND }, { tele: ledge }]
      : [{ anim: Anim.LEAP }, { wait: 1 }, { anim: Anim.LAND }, { tele: foot }, { wait: 1 }, jump(ground)]),
  }),

  /** Taverley Dungeon's floor spikes between `ends`; a failed jump springs the trap. */
  taverleySpikes: ({ ends, landing }) => {
    const crossing = between({ ends, cross: (from, to, context) => spikeJump(from, to, context, false, landing) });
    return {
      route: crossing.route,
      steps: crossing.steps,
      fail: {
        steps: (context) => {
          const [from, to] = [[context.pos.x, context.pos.y], context.pos.x < context.obj.x ? ends[1] : ends[0]];
          return spikeJump(from, to, context, true, landing);
        },
      },
    };
  },
};
