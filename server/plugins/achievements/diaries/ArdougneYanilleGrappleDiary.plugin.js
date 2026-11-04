const DIARY = "ardougne";
const TASK = "grapple-over-yanille-s-south-wall";
const OBJECT_IDS = new Set([17047, 17049, 17050]);
const CROSSINGS = [
  { object: [2556, 3074, 0], start: [2556, 3075, 0], landing: [2556, 3074, 1] },
  { object: [2556, 3073, 0], start: [2556, 3072, 0], landing: [2556, 3073, 1] },
];

function qualifies({ player, objectId, location, method, start }) {
  const current = player?.getLocation?.();
  return method === "grapple" && OBJECT_IDS.has(objectId) && CROSSINGS.some(({ object, start: from, landing }) =>
    location?.x === object[0] && location?.y === object[1] && location?.z === object[2] &&
    start?.x === from[0] && start?.y === from[1] && start?.z === from[2] &&
    current?.getX?.() === landing[0] && current?.getY?.() === landing[1] && current?.getZ?.() === landing[2]) &&
    player.isRegistered?.() === true && player.getHitpoints?.() > 0 && !player.isDyingReturn?.() &&
    !player.getPrivateArea?.();
}

module.exports = {
  name: "ArdougneYanilleGrappleDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Agility"],
  register(api) {
    api.onCustomEvent("agility:yanille-grapple", (event) => {
      if (qualifies(event)) api.emitCustomEvent("diary:task", { player: event.player, diary: DIARY, task: TASK });
    });
  },
  _test: { qualifies },
};
