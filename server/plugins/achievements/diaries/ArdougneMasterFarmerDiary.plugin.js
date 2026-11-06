const DIARY = "ardougne";
const TASK = "pickpocket-the-master-farmer-north-of-ardougne";
const MASTER_FARMER_ID = 5730;
const SPAWN = { x: 2636, y: 3364, z: 0 };
const WANDER_RADIUS = 3;

function isNorthernArdougneFarmer(npc) {
  if (npc?.getId?.() !== MASTER_FARMER_ID) return false;
  const location = npc.getLocation?.();
  return location?.getZ?.() === SPAWN.z
    && Math.abs(location.getX() - SPAWN.x) <= WANDER_RADIUS
    && Math.abs(location.getY() - SPAWN.y) <= WANDER_RADIUS;
}

function pickpocketed({ player, kind, succeeded, npc }) {
  if (kind !== "pickpocket" || succeeded !== true || !isNorthernArdougneFarmer(npc)
    || player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0
    || player.isDyingReturn?.() || player.getPrivateArea?.() !== null
    || npc.isRegistered?.() !== true || npc.getHitpoints?.() <= 0
    || npc.getPrivateArea?.() !== null) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

let api;
module.exports = {
  name: "ArdougneMasterFarmerDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Thieving"],
  register(registry) {
    api = registry;
    api.onCustomEvent("thieving:done", pickpocketed);
  },
  _test: { isNorthernArdougneFarmer, pickpocketed },
};
