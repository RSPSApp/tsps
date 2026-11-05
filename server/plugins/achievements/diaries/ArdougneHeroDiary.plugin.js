const DIARY = "ardougne";
const TASK = "pickpocket-a-hero";

function pickpocketed({ player, kind, succeeded, npc } = {}) {
  if (kind !== "pickpocket" || succeeded !== true
    || npc?.getDefinition?.()?.getName?.() !== "Hero"
    || player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0
    || player.isDyingReturn?.() || player.getPrivateArea?.() !== null
    || npc.isRegistered?.() !== true || npc.getHitpoints?.() <= 0
    || npc.getPrivateArea?.() !== null) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

let api;
module.exports = {
  name: "ArdougneHeroDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Thieving"],
  register(registry) {
    api = registry;
    api.onCustomEvent("thieving:done", pickpocketed);
  },
  _test: { pickpocketed, TASK },
};
