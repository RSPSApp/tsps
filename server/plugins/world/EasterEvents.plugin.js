"use strict";

// 2026 Easter event, "The brave chocolate egg" (Wiki 2026 Easter event): find the
// Easter Bunny's runaway chocolate egg Archibald around Varrock. The scheduler's
// "easter-2026" window opens and closes it; docs/easter-2026-event.md has the sources.
const Progress = require("./seasonal/Progress.EasterEvents");
const Scene = require("./seasonal/Scene.EasterEvents");
const Hunt = require("./seasonal/Hunt.EasterEvents");
const Lock = require("./seasonal/Lock.EasterEvents");
const Church = require("./seasonal/Church.EasterEvents");
const Rewards = require("./seasonal/Rewards.EasterEvents");
const EVENT_KEY = "easter-2026";

function calendar(api, event) {
  if (event.key !== EVENT_KEY) return;
  if (!event.active) { Hunt.activate(false); Hunt.cancelAll(api); Church.clearAll(api); }
  const result = event.active ? Scene.open(api) : Scene.close(api);
  if (result.handled && event.active) Hunt.activate(true);
  if (!result.handled) { Hunt.activate(false); Hunt.cancelAll(api); api.log("Easter 2026 scene: " + result.error); }
  syncAll(api);
}
function shutdown(api) { calendar(api, { key: EVENT_KEY, active: false }); }
function regionLoaded(api, event) {
  const result = Scene.replay(api, event);
  if (!result.handled) api.log("Easter 2026 scene: " + result.error);
}
function sync(api, { player }) { if (player?.isRegistered?.()) Progress.sync(api, player, Hunt.isActive()); }
function syncAll(api) { for (const player of api.core.World.getPlayers()) if (player) sync(api, { player }); }
function npcInteraction(api, event) {
  Hunt.talkToBunny(api, event);
  if (!event.handled) Hunt.catchArchibald(api, event);
}
function loc(api, symbol) {
  const id = api.core.CacheDefinitions.getLocId(symbol);
  if (id === null) throw new Error("Missing 2026 Easter scenery " + symbol);
  return id;
}
function eggBox(api, event) {
  const symbol = api.core.CacheDefinitions.getObjNames().get(event.itemId);
  Hunt.openEggBox(api, symbol, event);
}
function clearPlayer(api, event) { Hunt.clear(event); Church.clear(api, event); Rewards.clear(event); }

module.exports = {
  name: "EasterEvents",
  register(api) {
    Lock.init(api);
    api.persistAttribute(Progress.PROGRESS_ATTRIBUTE, 0);
    api.onCustomEvent("events:active", calendar.bind(null, api));
    api.onServerShutdown(shutdown.bind(null, api));
    api.onRegionLoaded(regionLoaded.bind(null, api));
    api.onPlayerLogin(Rewards.importClaim.bind(null, api));
    api.onPlayerLogin(sync.bind(null, api));
    api.onCustomEvent("easter-events:changed", sync.bind(null, api));
    api.onCustomEvent("easter-events:church-fall", Church.fall.bind(null, api));
    api.onCustomEvent("league:content-rows", Lock.contribute);
    api.onBeforeNpcInteraction(npcInteraction.bind(null, api));
    api.onObjectFirstClick(loc(api, "easter26_first_clue"), Hunt.searchTable.bind(null, api));
    api.onObjectFirstClick(loc(api, Progress.HUNT_SCENERY[1]), Hunt.searchScenery.bind(null, api, 1));
    api.onObjectFirstClick(loc(api, Progress.HUNT_SCENERY[2]), Hunt.searchScenery.bind(null, api, 2));
    api.onObjectFirstClick(loc(api, Progress.HUNT_SCENERY[3]), Hunt.searchScenery.bind(null, api, 3));
    api.onObjectFirstClick(loc(api, Progress.HUNT_SCENERY[4]), Hunt.searchScenery.bind(null, api, 4));
    api.onObjectFirstClick(loc(api, Progress.HUNT_SCENERY[5]), Hunt.searchScenery.bind(null, api, 5));
    api.onObjectFirstClick(loc(api, Progress.HUNT_SCENERY[6]), Hunt.searchScenery.bind(null, api, 6));
    api.onObjectFirstClick(loc(api, Progress.HUNT_SCENERY[7]), Hunt.searchScenery.bind(null, api, 7));
    api.onItemAction("Scribbled notes", { Read: Hunt.readNotes.bind(null, api) });
    api.onItemAction("Egg box", { Open: eggBox.bind(null, api) });
    api.onNpcDialogueCondition(Hunt.condition.bind(null, api));
    api.onCustomEvent("npc-dialogue:choice", Hunt.choice.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", Hunt.message.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", Hunt.action.bind(null, api));
    api.onCustomEvent("npc-dialogue:line", Hunt.line.bind(null, api));
    api.onCustomEvent("item:discarded", Hunt.dropOrDestroy.bind(null, api));
    api.onInterfaceActionClick(Rewards.closeScroll.bind(null, api));
    api.onPlayerLogout(clearPlayer.bind(null, api));
    api.onPlayerDisconnect(clearPlayer.bind(null, api));
  },
};
