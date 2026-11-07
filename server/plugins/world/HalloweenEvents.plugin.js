"use strict";

// 2025 Halloween event: the Spook-a-thon Decoration Contest (Wiki 2025 Halloween
// event). Runs only while EventScheduler announces the "halloween-2025" window.
// Sources and remaining gaps: server/docs/halloween-2025-source.md.
const Progress = require("./seasonal/Progress.HalloweenEvents");
const Scene = require("./seasonal/Scene.HalloweenEvents");
const Dialogue = require("./seasonal/Dialogue.HalloweenEvents");
const Items = require("./seasonal/Items.HalloweenEvents");
const Rewards = require("./seasonal/Rewards.HalloweenEvents");
const Cutscene = require("./seasonal/Cutscene.HalloweenEvents");
const Cows = require("./seasonal/Cows.HalloweenEvents");
const Sync = require("./seasonal/Sync.HalloweenEvents");

function calendar(api, event) {
  if (event.key !== Progress.BUNDLE) return;
  if (!event.active) {
    Cutscene.cancelAll(api);
    Dialogue.activate(event);
    Dialogue.cancelAll(api);
    const closed = Scene.close(api);
    if (!closed.handled) api.log("Halloween scene: " + closed.error);
  } else {
    const opened = Scene.open(api);
    if (opened.handled) Dialogue.activate(event);
    else api.log("Halloween scene: " + opened.error);
  }
  Sync.all(api);
}
function shutdown(api) { calendar(api, { key: Progress.BUNDLE, active: false }); }
function regionLoaded(api, event) {
  const result = Scene.replay(api, event);
  if (!result.handled) api.log("Halloween scene: " + result.error);
}
function interact(api, event) {
  if (Scene.isEventChair(api, event.npc) && event.clickType === 1) {
    event.handled = true;
    if (Dialogue.active() && event.player.isRegistered() && !event.player.busy()) Items.pickUpChair(api, Dialogue, event.player);
    return;
  }
  Dialogue.interact(api, event);
}
function logout(api, event) {
  Dialogue.clear(event);
  Cutscene.finish(api, event);
  Items.logout(api, event);
}

module.exports = {
  name: "HalloweenEvents",
  register(api) {
    api.persistAttribute(Progress.PROGRESS_ATTRIBUTE, Progress.initial());
    api.onCustomEvent("events:active", calendar.bind(null, api));
    api.onServerShutdown(shutdown.bind(null, api));
    api.onRegionLoaded(regionLoaded.bind(null, api));
    api.onPlayerLogin(Rewards.importClaim.bind(null, api));
    api.onPlayerLogin(Sync.refresh.bind(null, api));
    api.onCustomEvent("halloween-2025:changed", Sync.refresh.bind(null, api));
    api.onCustomEvent("halloween-2025:cutscene-start", Cutscene.start.bind(null, api));
    api.onCustomEvent("halloween-2025:cutscene-end", Cutscene.finish.bind(null, api));
    api.onBeforeNpcInteraction(interact.bind(null, api));
    api.onNpcDialogueCondition(Dialogue.condition.bind(null, api));
    api.onCustomEvent("npc-dialogue:line", Dialogue.line.bind(null, api));
    api.onCustomEvent("npc-dialogue:choice", Dialogue.choice.bind(null, api));
    api.onCustomEvent("npc-dialogue:action", Dialogue.action.bind(null, api));
    api.onCustomEvent("player:emote", Cows.emote.bind(null, api, Dialogue));
    api.onItemAction("Spooky chair", { Drop: Items.dropChair.bind(null, api, Dialogue), Spin: Items.spinChair.bind(null, api, Dialogue) });
    api.onInterfaceActionClick(Rewards.close.bind(null, api));
    api.onPlayerLogout(logout.bind(null, api));
    api.onPlayerDisconnect(logout.bind(null, api));
  },
};
