const { NpcIdentifiers } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");

const TRAINING_SKELETON_ID = NpcIdentifiers.SKELETON_13; // 82
const TRAINING_X = 3109;
const TRAINING_Y_PRIMARY = 3518;
const TRAINING_Y_FALLBACK = 3517;

function isTrainingSkeletonAtTarget(npc) {
  if (!npc || npc.getId?.() !== TRAINING_SKELETON_ID) {
    return false;
  }
  const location = npc.getLocation?.();
  const spawn = npc.getSpawnPosition?.();
  const points = [location, spawn].filter(Boolean);
  return points.some(
    (point) =>
      point.getX?.() === TRAINING_X &&
      (point.getY?.() === TRAINING_Y_PRIMARY || point.getY?.() === TRAINING_Y_FALLBACK)
  );
}

let World;

module.exports = {
  name: "TrainingSkeleton",
  description: "Respawns the Edgeville training skeleton at its post as soon as it dies, rather than after the normal delay.",
  register(api) {
    World = api.getWorld();
    api.onNpcDeath(({ npc }) => {
      if (!isTrainingSkeletonAtTarget(npc)) {
        return;
      }
      npc.__skipDefaultRespawn = true;
      World.getAddNPCQueue().push(new NPC(TRAINING_SKELETON_ID, npc.getSpawnPosition().clone()));
    });
  },
};
