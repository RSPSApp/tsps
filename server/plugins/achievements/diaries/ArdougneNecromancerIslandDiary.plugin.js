const DIARY = "ardougne";
const TASK = "visit-the-island-east-of-the-necromancer-s-tower";
const FAIRY_RING_CODE = "AIR";
const ISLAND = { x: 2700, y: 3247, z: 0 };

function isIsland(location) {
  return location?.getX?.() === ISLAND.x && location?.getY?.() === ISLAND.y &&
    location?.getZ?.() === ISLAND.z;
}

function arrivedAtIsland({ player, from, fromInstance, to, source, code } = {}) {
  if (
    source !== "fairy-ring" || code !== FAIRY_RING_CODE || !player ||
    player.isRegistered?.() !== true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.() ||
    fromInstance || player.getPrivateArea?.()
  ) return false;

  const current = player.getLocation?.();
  if (!isIsland(to) || !isIsland(current)) return false;
  if (
    current.getX() !== to.getX() || current.getY() !== to.getY() || current.getZ() !== to.getZ() ||
    !from || (from.getX() === to.getX() && from.getY() === to.getY() && from.getZ() === to.getZ())
  ) return false;
  return true;
}

module.exports = {
  name: "ArdougneNecromancerIslandDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    api.onCustomEvent("teleport:landed", (event) => {
      if (arrivedAtIsland(event)) {
        api.emitCustomEvent("diary:task", { player: event.player, diary: DIARY, task: TASK });
      }
    });
  },
  _test: { arrivedAtIsland, isIsland, ISLAND, FAIRY_RING_CODE, TASK },
};
