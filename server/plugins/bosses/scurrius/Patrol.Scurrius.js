/** Recorded sewer scenery. RSProx 227/83 ticks 14874–14876 and 20885–20925,
 * and 234/3275 ticks 21602–21612 and 25800–25834. */
const CONTROLLER = 7224; // rat_boss_giant_rat_patrol_control
const RAT = 7225; // rat_boss_giant_rat_patrol
const SPAWN_INTERVAL = 50;
const END_DELAY = 3;
const ROUTE = [
  [3234, 9864], [3235, 9865], [3236, 9865], [3237, 9865],
  [3238, 9866], [3239, 9867], [3240, 9868], [3241, 9869],
  [3242, 9869], [3243, 9869], [3244, 9869], [3245, 9869], [3246, 9869], [3247, 9869],
  [3248, 9869], [3249, 9869], [3250, 9869], [3251, 9869], [3252, 9869], [3253, 9869],
  [3254, 9870], [3255, 9871], [3256, 9872], [3257, 9872], [3258, 9872], [3259, 9872],
  [3260, 9871], [3261, 9870], [3262, 9870], [3263, 9870], [3264, 9870], [3265, 9870],
  [3266, 9870], [3267, 9870], [3268, 9870], [3269, 9870], [3270, 9870], [3271, 9870],
  [3272, 9870], [3273, 9870], [3274, 9870], [3275, 9870], [3276, 9870], [3277, 9870],
  [3278, 9870], [3279, 9870], [3280, 9870], [3281, 9869], [3281, 9868],
];

function spawn(api, id, x, y, direction) {
  const npc = api.spawnNpc({ id, x, y, z: 0, wanderRadius: 0, face: direction.getId() });
  npc?.setScriptedMovement(true);
  npc?.setUntargetable(true);
  return npc;
}

function start(api) {
  const { Direction, Location, Task, TaskManager } = api.core;
  spawn(api, CONTROLLER, 3267, 9869, Direction.SOUTH);
  const positions = ROUTE.map(([x, y]) => new Location(x, y, 0));
  const end = positions.length - 1;
  const rats = new Map();
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, "scurrius:rat-patrol", false); }

    execute() {
      if (tick % SPAWN_INTERVAL === 0) {
        const rat = spawn(api, RAT, ...ROUTE[0], Direction.NORTH);
        if (rat) {
          // The recording shows it walking through the player at (3275, 9870).
          rat.setFlag("movement:walk-through-entities", true);
          rats.set(rat, tick);
        }
      }
      for (const [rat, startTick] of rats) {
        const age = tick - startTick;
        if (age === end + END_DELAY) {
          api.removeNpc(rat);
          rats.delete(rat);
        } else if (age > 0 && age <= end) {
          // The spawn turn has passed, even if no client was near enough to place the NPC yet.
          if (age === 1) rat.setNeedsPlacement(false);
          rat.setMovementSteps(1);
          // A checkpoint keeps this NPC in the engine's active movement set while offscreen.
          rat.getMovementQueue().addCheckpoint(positions[age]);
        }
      }
      tick++;
    }
  })());
}

function attach(api) {
  api.onServerStartup(start.bind(null, api));
}

module.exports = { attach, _test: { ROUTE } };
