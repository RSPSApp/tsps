const DIARY = "ardougne";
const TASK = "craft-some-death-runes-from-essence";
const QUEST_KEY = "mournings_end_part_ii";
const ALTAR_SOURCE = "altar";

let api;

function hasCompletedQuest(player) {
  const request = { player, key: QUEST_KEY, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function crafted({ player, source, altarId, runeId, rolls } = {}) {
  if (!player || player.isRegistered?.() !== true || player.getHitpoints?.() <= 0 || player.isDyingReturn?.()) return;
  if (source !== ALTAR_SOURCE || altarId !== api.core.ObjectIdentifiers.ALTAR_56 ||
      runeId !== api.core.ItemIdentifiers.DEATH_RUNE || !Number.isInteger(rolls) || rolls <= 0) return;
  if (!hasCompletedQuest(player)) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

module.exports = {
  name: "ArdougneDeathRunesDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Runecrafting"],
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent("runecrafting:success", crafted);
  },
  _test: { crafted, hasCompletedQuest, TASK, QUEST_KEY, ALTAR_SOURCE },
};
