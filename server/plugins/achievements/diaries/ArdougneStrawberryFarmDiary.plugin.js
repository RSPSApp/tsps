const DIARY = "ardougne";
const TASK = "harvest-some-strawberries-from-the-ardougne-farm";
const PATCHES = new Set([8554, 8555]);

function isArdougneStrawberryPatch(patch) {
  return patch?.type === "ALLOTMENT" && PATCHES.has(patch.id)
    && patch.x >= 2662 && patch.x <= 2671
    && patch.y >= 3370 && patch.y <= 3379
    && patch.z === 0;
}

function harvested({ player, crop, patch }) {
  if (crop !== "STRAWBERRY" || !isArdougneStrawberryPatch(patch)
    || player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0
    || player.isDyingReturn?.() || player.getPrivateArea?.() !== null) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

let api;
module.exports = {
  name: "ArdougneStrawberryFarmDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.onCustomEvent("farming:harvested", harvested);
  },
  _test: { isArdougneStrawberryPatch, harvested },
};
