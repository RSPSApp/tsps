const DIARY = "ardougne";
const TASK = "collect-some-nightshade-from-the-skavid-caves";
const CAVE_NIGHTSHADE_ID = 2398;
const SPAWNS = [
  [2528, 9415],
  [2530, 9462],
];
const PLANE = 0;
const SOURCES = new Set(["pickup", "telegrab"]);

function isNightshadeSpawn(groundItem) {
  if (groundItem?.isStaticSpawn?.() !== true || groundItem.getPrivateArea?.() !== null) return false;
  const item = groundItem.getItem?.();
  const location = groundItem.getPosition?.();
  if (item?.getId?.() !== CAVE_NIGHTSHADE_ID || location?.getZ?.() !== PLANE) return false;
  const x = location.getX?.();
  const y = location.getY?.();
  return SPAWNS.some(([spawnX, spawnY]) => x === spawnX && y === spawnY);
}

function taken(event, api) {
  const { player, groundItem, source, itemId, amount } = event ?? {};
  if (!player || player.isRegistered?.() !== true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.()
    || player.getPrivateArea?.() !== null || !SOURCES.has(source) || itemId !== CAVE_NIGHTSHADE_ID
    || amount <= 0 || !isNightshadeSpawn(groundItem)) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

module.exports = {
  name: "ArdougneNightshadeDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(api) {
    api.onCustomEvent("ground-items:taken", (event) => taken(event, api));
  },
  _test: { isNightshadeSpawn, taken, SPAWNS, TASK, CAVE_NIGHTSHADE_ID },
};
