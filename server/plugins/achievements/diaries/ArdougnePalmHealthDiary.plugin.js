const DIARY = "ardougne";
const TASK = "check-the-health-of-a-palm-tree-near-tree-gnome";
const PATCH = { id: 7963, type: "FRUIT_TREE", x: 2489, y: 3179, z: 0 };

function isArdougnePalmPatch(patch) {
  return patch?.id === PATCH.id && patch.type === PATCH.type
    && patch.x === PATCH.x && patch.y === PATCH.y && patch.z === PATCH.z;
}

function checkedHealth({ player, crop, type, patch }) {
  if (crop !== "PALM" || type !== "FRUIT_TREE" || !isArdougnePalmPatch(patch)
    || player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0
    || player.isDyingReturn?.() || player.getPrivateArea?.() !== null) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

let api;
module.exports = {
  name: "ArdougnePalmHealthDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.onCustomEvent("farming:check-health", checkedHealth);
  },
  _test: { isArdougnePalmPatch, checkedHealth },
};
