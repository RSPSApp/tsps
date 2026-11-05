const DIARY = "ardougne";
const TASK = "teleport-to-the-watchtower";
const SPELL_NAME = "watchtower teleport";
const LANDING = { x: 2549, y: 3112, z: 2, radius: 2 };
let pluginApi;

function isWatchtowerLanding(player) {
  const location = player?.getLocation?.();
  return location?.getZ() === LANDING.z
    && Math.abs(location.getX() - LANDING.x) <= LANDING.radius
    && Math.abs(location.getY() - LANDING.y) <= LANDING.radius;
}

function recordArrival(event) {
  const { player } = event;
  if (event.name?.trim().toLowerCase() !== SPELL_NAME
    || player?.isRegistered?.() !== true
    || player.getHitpoints?.() <= 0
    || player.isDyingReturn?.()
    || !isWatchtowerLanding(player)) return;

  const quest = { player, key: "watchtower", complete: null };
  pluginApi.emitCustomEvent("quest:is-complete", quest);
  if (quest.complete === true) {
    pluginApi.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
  }
}

module.exports = {
  name: "ArdougneWatchtowerDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    pluginApi = api;
    api.onCustomEvent("spell:teleport-arrival", recordArrival);
  },
  _test: { isWatchtowerLanding },
};
