const DIARY = "ardougne";
const TASK = "catch-any-fish-on-the-fishing-platform";
const QUEST_KEY = "sea_slug";
const SPOTS = [
  [2789, 3273],
  [2790, 3273],
  [2794, 3283],
  [2795, 3279],
];
const PLANE = 0;

function isPlatformLocation(location) {
  if (!location || location.getZ?.() !== PLANE) return false;
  const x = location.getX?.();
  const y = location.getY?.();
  return SPOTS.some(([spotX, spotY]) => Math.abs(x - spotX) <= 2 && Math.abs(y - spotY) <= 2);
}

function qualifies(event, api) {
  const { player } = event ?? {};
  const platformFish = [
    api.core.ItemIdentifiers.RAW_SHRIMPS,
    api.core.ItemIdentifiers.RAW_ANCHOVIES,
    api.core.ItemIdentifiers.RAW_SARDINE,
    api.core.ItemIdentifiers.RAW_HERRING,
  ];
  if (
    event?.skill !== api.core.Skill.FISHING ||
    !platformFish.includes(event.itemId) ||
    event.source === "fishing-trawler" ||
    !player || player.isRegistered?.() !== true || player.getHitpoints?.() <= 0 ||
    player.isDyingReturn?.() || player.getPrivateArea?.() ||
    !isPlatformLocation(player.getLocation?.())
  ) return false;

  const quest = { player, key: QUEST_KEY, started: null };
  api.emitCustomEvent("quest:is-started", quest);
  return quest.started === true;
}

module.exports = {
  name: "ArdougneFishingPlatformDiary",
  members: true,
  dependsOn: ["AchievementDiaries", "Quests", "Fishing"],
  register(api) {
    api.onCustomEvent("fishing:success", (event) => {
      if (qualifies(event, api)) api.emitCustomEvent("diary:task", { player: event.player, diary: DIARY, task: TASK });
    });
  },
  _test: { qualifies, isPlatformLocation, SPOTS, TASK },
};
