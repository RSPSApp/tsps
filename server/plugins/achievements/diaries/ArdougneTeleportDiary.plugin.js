const DIARY = "ardougne";
const TASK = "cast-the-ardougne-teleport-spell";
const SPELL_NAME = "ardougne teleport";
const LANDING = { x: 2661, y: 3302, radius: 2, z: 0 };

function isArdougneLanding(player) {
  const location = player?.getLocation?.();
  if (!location) return false;
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === LANDING.z
    && Math.abs(x - LANDING.x) <= LANDING.radius
    && Math.abs(y - LANDING.y) <= LANDING.radius;
}

module.exports = {
  name: "ArdougneTeleportDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    api.onCustomEvent("spell:teleport-arrival", (event) => {
      const { player } = event;
      if (event.name?.trim().toLowerCase() !== SPELL_NAME
        || player?.isRegistered?.() !== true
        || player.getHitpoints?.() <= 0
        || player.isDyingReturn?.()
        || !isArdougneLanding(player)) return;

      const quest = { player, key: "plague_city", complete: null };
      api.emitCustomEvent("quest:is-complete", quest);
      if (quest.complete === true) {
        api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
      }
    });
  },
  _test: { isArdougneLanding },
};
