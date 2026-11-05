const DIARY = "ardougne";
const MITHRIL_PLATEBODY_TASK = "smith-a-mithril-platebody-near-ardougne";
const DRAGON_SQ_SHIELD_TASK = "smith-a-dragon-sq-shield-in-west-ardougne";
const ANVIL_OBJECT_ID = 2097;
const PLANE = 0;
const MITHRIL_PLATEBODY_ANVILS = new Set([
  "2650,3164", "2652,3164", "2652,3166",
  "2613,3078", "2613,3081", "2616,3081",
  "2499,3332", "2501,3330",
]);
const WEST_ARDOUGNE_ANVILS = new Set(["2499,3332", "2501,3330"]);

function isActivePlayer(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0 && !player.isDyingReturn?.();
}

function locationOf(location) {
  if (!location) return null;
  const x = typeof location.getX === "function" ? location.getX() : location.x;
  const y = typeof location.getY === "function" ? location.getY() : location.y;
  const z = typeof location.getZ === "function" ? location.getZ() : location.z;
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) ? { x, y, z } : null;
}

function tileKey(location) {
  return `${location.x},${location.y}`;
}

function atSource(player, sourceLocation) {
  const playerLocation = locationOf(player.getLocation?.());
  if (!playerLocation || playerLocation.z !== PLANE || sourceLocation.z !== PLANE) return false;
  return Math.max(Math.abs(playerLocation.x - sourceLocation.x), Math.abs(playerLocation.y - sourceLocation.y)) <= 1;
}

function hasStartedPlagueCity(player, api) {
  const request = { player, key: "plague_city", started: false };
  api.emitCustomEvent("quest:is-started", request);
  return request.started === true;
}

function smithingSuccess(event, api) {
  const { player, skill, itemId, source, objectId } = event ?? {};
  if (!isActivePlayer(player) || player.getPrivateArea?.() !== null || source !== "anvil" || objectId !== ANVIL_OBJECT_ID) return;

  const sourceLocation = locationOf(event.location);
  if (!sourceLocation || !atSource(player, sourceLocation)) return;
  const tile = tileKey(sourceLocation);
  const core = api.core;
  if (skill !== core.Skill.SMITHING) return;

  if (itemId === core.ItemIdentifiers.MITHRIL_PLATEBODY && MITHRIL_PLATEBODY_ANVILS.has(tile)) {
    api.emitCustomEvent("diary:task", { player, diary: DIARY, task: MITHRIL_PLATEBODY_TASK });
    return;
  }
  if (itemId === core.ItemIdentifiers.DRAGON_SQ_SHIELD && WEST_ARDOUGNE_ANVILS.has(tile)
    && hasStartedPlagueCity(player, api)) {
    api.emitCustomEvent("diary:task", { player, diary: DIARY, task: DRAGON_SQ_SHIELD_TASK });
  }
}

function onSmithingSuccess(api, event) {
  return smithingSuccess(event, api);
}

module.exports = {
  name: "ArdougneSmithingDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Quests", "Smithing"],
  register(api) {
    api.onCustomEvent("smithing:success", onSmithingSuccess.bind(null, api));
  },
  _test: {
    isActivePlayer, locationOf, atSource, hasStartedPlagueCity, smithingSuccess,
    ANVIL_OBJECT_ID, MITHRIL_PLATEBODY_ANVILS, WEST_ARDOUGNE_ANVILS,
    MITHRIL_PLATEBODY_TASK, DRAGON_SQ_SHIELD_TASK,
  },
};
