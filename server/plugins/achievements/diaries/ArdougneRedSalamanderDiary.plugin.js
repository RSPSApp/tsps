const DIARY = "ardougne";
const TASK = "catch-a-red-salamander";
const RED_SALAMANDER_METHOD = "red";

let api;

function caught({ player, method, npcId } = {}) {
  if (!player || player.isRegistered?.() !== true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.()) return;
  if (method !== RED_SALAMANDER_METHOD || npcId !== api.core.NpcIdentifiers.RED_SALAMANDER) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

module.exports = {
  name: "ArdougneRedSalamanderDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Hunter"],
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent("hunter:success", caught);
  },
  _test: { caught, TASK, RED_SALAMANDER_METHOD },
};
