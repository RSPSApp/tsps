const DIARY = "ardougne";
const TASK = "pick-some-poison-ivy-berries-from-the-patch-sout";
const PATCH = { id: 7580, type: "BUSH", x: 2617, y: 3225, z: 0 };

function isArdougnePoisonIvyPatch(patch) {
  return patch?.id === PATCH.id && patch.type === PATCH.type
    && patch.x === PATCH.x && patch.y === PATCH.y && patch.z === PATCH.z;
}

function harvested({ player, crop, patch }) {
  if (crop !== "POISON_IVY" || !isArdougnePoisonIvyPatch(patch)
    || player?.isRegistered?.() !== true || player.getHitpoints?.() <= 0
    || player.isDyingReturn?.() || player.getPrivateArea?.() !== null) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

let api;
module.exports = {
  name: "ArdougnePoisonIvyDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.onCustomEvent("farming:harvested", harvested);
  },
  _test: { isArdougnePoisonIvyPatch, harvested },
};
