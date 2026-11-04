const DIARY = "ardougne";
const TASK = "enter-the-unicorn-pen-in-ardougne-zoo-using-fair";
const FAIRY_RING_CODE = "BIS";
const PLANE = 0;
const PEN = { minX: 2626, maxX: 2640, minY: 3258, maxY: 3275 };

function isPenLocation(location) {
  if (!location || location.getZ() !== PLANE) return false;
  return location.getX() >= PEN.minX && location.getX() <= PEN.maxX &&
    location.getY() >= PEN.minY && location.getY() <= PEN.maxY;
}

function arrivedAtUnicornPen({ player, from, fromInstance, to, source, code }) {
  if (
    source !== "fairy-ring" || code !== FAIRY_RING_CODE || !player ||
    player.isRegistered?.() !== true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.() ||
    fromInstance || player.getPrivateArea?.()
  ) return false;

  const current = player.getLocation?.();
  if (!isPenLocation(to) || !isPenLocation(current)) return false;
  if (
    current.getX() !== to.getX() || current.getY() !== to.getY() || current.getZ() !== to.getZ() ||
    !from || (from.getX() === to.getX() && from.getY() === to.getY() && from.getZ() === to.getZ())
  ) return false;
  return true;
}

module.exports = {
  name: "ArdougneUnicornPenFairyRingDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    api.onCustomEvent("teleport:landed", (event) => {
      if (arrivedAtUnicornPen(event)) {
        api.emitCustomEvent("diary:task", { player: event.player, diary: DIARY, task: TASK });
      }
    });
  },
  _test: { arrivedAtUnicornPen, isPenLocation, PEN, FAIRY_RING_CODE },
};
