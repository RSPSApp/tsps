const DIARY = "ardougne";
const TASK = "catch-a-manta-ray-in-the-fishing-trawler-and-coo";
const STAGE_EVENT = "ardougne-elite:task-stage";
const QUERY_EVENT = "ardougne-elite:task-stage-query";
const CLEAR_EVENT = "ardougne-elite:task-stage-clear";

// Conservative plane-0 town bounds around the cache-mapped range and fire locations.
const PORT_KHAZARD = Object.freeze({ minX: 2632, maxX: 2687, minY: 3156, maxY: 3170, plane: 0 });

let api;

function active(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && !player.isDyingReturn?.() && !player.getPrivateArea?.();
}

function inPortKhazard(location) {
  if (!location || location.getZ?.() !== PORT_KHAZARD.plane) return false;
  const x = location.getX?.();
  const y = location.getY?.();
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= PORT_KHAZARD.minX && x <= PORT_KHAZARD.maxX
    && y >= PORT_KHAZARD.minY && y <= PORT_KHAZARD.maxY;
}

function clearStage(player) {
  api.emitCustomEvent(CLEAR_EVENT, { player, task: TASK });
}

function caughtManta({ player, fish } = {}) {
  if (!player) return;
  // Each award replaces the stored net reward, so a prior manta snapshot cannot carry forward.
  clearStage(player);
  const mantaId = api.core.CacheDefinitions.getObjId("raw_mantaray");
  if (!active(player) || !Array.isArray(fish)
    || !fish.some((item) => item?.itemId === mantaId && item.amount > 0)) return;
  api.emitCustomEvent(STAGE_EVENT, { player, task: TASK, stage: "caught" });
}

function cookedManta({ player, rawId, itemId, amount, location } = {}) {
  if (!player) return;
  const request = { player, task: TASK, result: null };
  api.emitCustomEvent(QUERY_EVENT, request);
  if (request.result?.stage !== "caught") return;

  const mantaId = api.core.CacheDefinitions.getObjId("raw_mantaray");
  const cookedId = api.core.CacheDefinitions.getObjId("mantaray");
  if (!active(player) || rawId !== mantaId || itemId !== cookedId || !(amount > 0) || !inPortKhazard(location)) return;

  // Progress.completeTask emits its accepted event synchronously, which clears this stage.
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

function register(apiRegistry) {
  api = apiRegistry;
  api.onCustomEvent("fishing-trawler:catch-awarded", caughtManta);
  api.onCustomEvent("cooking:success", cookedManta);
}

module.exports = {
  name: "ArdougneEliteMantaDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "FishingTrawler", "Cooking", "ArdougneEliteTaskProgress"],
  register,
  _test: { TASK, PORT_KHAZARD, active, inPortKhazard, caughtManta, cookedManta },
};
