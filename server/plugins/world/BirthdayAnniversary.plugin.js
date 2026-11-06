"use strict";

// Birthday & anniversary events: the 25th Anniversary event ("25 Years, 25 Mementos"),
// OSRS's 13th birthday (Wiki: 18 February - 4 March 2026). The window is
// plugins/world/data/events.json "anniversary-2026"; ::forceevent runs it off-calendar.
const Data = require("./seasonal/Data.BirthdayAnniversary");
const Progress = require("./seasonal/Progress.BirthdayAnniversary");
const Scene = require("./seasonal/Scene.BirthdayAnniversary");
const Actors = require("./seasonal/Actors.BirthdayAnniversary");
const Dialogue = require("./seasonal/Dialogue.BirthdayAnniversary");
const Interactions = require("./seasonal/Interactions.BirthdayAnniversary");
const Rewards = require("./seasonal/Rewards.BirthdayAnniversary");
const Sync = require("./seasonal/Sync.BirthdayAnniversary");

function closeEvent(api) {
  Dialogue.activate({ key: Data.EVENT_KEY, active: false });
  Dialogue.cancelAll(api);
  Sync.setActive(false);
  for (const player of api.core.World.getPlayers()) if (player?.isRegistered()) Rewards.settle(api, { player });
  // Nobody may stand in the Realm while its squares go back to the blank native map.
  for (const player of api.core.World.getPlayers()) if (player?.isRegistered() && Scene.inRealm(player.getLocation())) Interactions.leaveRealm(api, { player });
  Actors.close(api);
  const result = Scene.close(api);
  if (!result.handled) console.error("[BirthdayAnniversaryEvents] 25th Anniversary scene: " + result.error);
  Sync.all(api);
}
function calendar(api, event) {
  if (event.key !== Data.EVENT_KEY) return;
  if (!event.active) { closeEvent(api); return; }
  const scene = Scene.open(api);
  const actors = scene.handled ? Actors.open(api) : scene;
  if (!actors.handled) {
    console.error("[BirthdayAnniversaryEvents] 25th Anniversary event did not open: " + actors.error);
    closeEvent(api);
    return;
  }
  Dialogue.activate(event);
  Sync.setActive(true);
  Sync.all(api);
}
function shutdown(api) { calendar(api, { key: Data.EVENT_KEY, active: false }); }
function login(api, { player }) {
  Rewards.importClaim(api, { player });
  if (!Scene.active()) Rewards.settle(api, { player });
  if (!Scene.active() && Scene.inRealm(player.getLocation())) Interactions.leaveRealm(api, { player });
  Sync.safeRefresh(api, { player });
}
function logout(api, { player }) {
  Dialogue.clear({ player });
  Actors.dismiss(api, player, false);
}
function regionLoaded(api, event) {
  const result = Scene.replay(api, event);
  if (!result.handled) api.log("25th Anniversary scene: " + result.error);
}
module.exports = {
  name: "BirthdayAnniversaryEvents",
  register(api) {
    api.persistAttribute(Progress.PROGRESS_ATTRIBUTE, null);
    api.persistAttribute(Progress.COMPLETE_ATTRIBUTE, false);
    api.persistAttribute(Progress.REWARDED_ATTRIBUTE, false);
    api.onCustomEvent("events:active", calendar.bind(null, api));
    api.onServerShutdown(shutdown.bind(null, api));
    api.onRegionLoaded(regionLoaded.bind(null, api));
    api.onPlayerLogin(login.bind(null, api));
    api.onPlayerLogout(logout.bind(null, api));
    api.onPlayerDisconnect(logout.bind(null, api));
    api.onCustomEvent("birthday-2026:changed", Sync.safeRefresh.bind(null, api));
    api.onCustomEvent("birthday-2026:strayed", Interactions.strayed.bind(null, api));
    api.onCustomEvent("birthday-2026:arrived", Interactions.arrived.bind(null, api));
    api.onCustomEvent("birthday-2026:reward", Rewards.grant.bind(null, api));
    api.onCustomEvent("birthday-2026:reward-space", Rewards.space.bind(null, api));
    api.onCanSpawnNpc(Actors.vetoNative.bind(null, api));
    api.onBeforeNpcInteraction(Interactions.interact.bind(null, api));
    api.onItemOnNpc(Interactions.itemOnNpc.bind(null, api));
    api.onItemOnObject(Interactions.itemOnObject.bind(null, api));
    api.onSpellOnNpc(Interactions.spellOnNpc.bind(null, api));
    api.onCustomEvent("ladders:climb", Interactions.climb.bind(null, api));
    api.onObjectInteraction("Portal", { Exit: Interactions.exitPortal.bind(null, api) });
    api.onObjectInteraction("Birthday cake", { Take: Interactions.takeCake.bind(null, api) });
    api.onCustomEvent("food:area", Interactions.cakeArea.bind(null, api));
    api.onNpcDialogueCondition(Dialogue.condition.bind(null, api));
    api.onCustomEvent("npc-dialogue:line", Dialogue.line.bind(null, api));
    api.onCustomEvent("npc-dialogue:choice", Dialogue.choice.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", Dialogue.action.bind(null, api));
  },
};
