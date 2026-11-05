const DIARY = "ardougne";
const TASK = "pick-some-torstol-from-the-patch-north-of-ardoug";
const PATCH_ID = 8152;

function harvested({ player, crop, patch }) {
  if (crop !== "TORSTOL" || patch?.type !== "HERB" || patch.id !== PATCH_ID
    || patch.x !== 2670 || patch.y !== 3374 || patch.z !== 0
    || player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0
    || player.isDyingReturn?.() || player.getPrivateArea?.() !== null) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

let api;
module.exports = {
  name: "ArdougneTorstolDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.onCustomEvent("farming:harvested", harvested);
  },
  _test: { harvested },
};
