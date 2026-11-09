// The DT2 postquest scoreboards share one cache transform varbit. Each boss
// still owns its Read handler and records. Wiki: Scoreboard (The Leviathan);
// cache241 dt2_scoreboards: 0 unavailable, 1 normal, 2 awakened option.
const QUEST_KEY = 'desert_treasure_ii';
const SCOREBOARDS_VARBIT = 'dt2_scoreboards';
const NORMAL_SCOREBOARDS = 1;

function refresh(api, player) {
  const request = {player, key: QUEST_KEY, complete: false};
  api.emitCustomEvent('quest:is-complete', request);
  if (request.complete !== true) return;
  const id = api.core.CacheDefinitions.getVarbitId(SCOREBOARDS_VARBIT);
  if (id === null) throw new Error('Missing cache varbit: dt2_scoreboards');
  const sender = player.getPacketSender();
  if (sender.getVarbit(id) < NORMAL_SCOREBOARDS)
    sender.sendVarbit(id, NORMAL_SCOREBOARDS);
}
function onLogin(api, {player}) { refresh(api, player); }
function onQuestCompleted(api, {player, key}) {
  if (key === QUEST_KEY) refresh(api, player);
}

module.exports = {
  name: 'DesertTreasureScoreboards',
  description: 'Unlocks the Desert Treasure II post-quest scoreboards for players who completed the quest, setting the shared scoreboard varbit on login and completion.',
  members: true,
  register(api) {
    api.onPlayerLogin(onLogin.bind(null, api));
    api.onCustomEvent('quest:completed', onQuestCompleted.bind(null, api));
  },
};
