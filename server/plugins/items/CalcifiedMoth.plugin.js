/**
 * Calcified moth (https://oldschool.runescape.wiki/w/Calcified_moth): Crush is a single-use teleport to Cam Torum.
 *
 * Wiki:
 * - it needs Perilous Moons "up through killing the Sulphur Nagua to receive permission to enter the city", the
 *   quest's city-open stage (PerilousMoons.Quest.js, stage 5), the same check as the surface entrance;
 * - it can't be used beyond level 20 Wilderness;
 * - "You crush the moth, releasing the energy inside..." is sent on the crush;
 * - the destination is Cam Torum, 1439, 9550, plane 1.
 * The moth is used up when the teleport starts; arriving lets the quest count the city as entered
 * ("cam-torum:arrived"), as walking in through the surface entrance does.
 *
 * Ours: no capture shows a crush, and the cache names no sequence or spotanim for it (the Wiki's GIF shows the
 * player rising and dissolving in cyan sparks), so it plays the standard teleport, which lands on the third tick.
 * Ours: the refusal line before the city opens; the Wiki gives none.
 */
const QUEST_KEY = "perilous_moons";
/** PerilousMoons.Quest.js STAGE_CITY_OPEN: the Sulphur Nagua is dealt with and the city is open. */
const CITY_OPEN_STAGE = 5;
const WILDERNESS_LEVEL = 20;
const DESTINATION = [1439, 9550, 1];
const CRUSH_MESSAGE = "You crush the moth, releasing the energy inside...";
// Ours: no source gives this line.
const LOCKED_MESSAGE = "You need to have been granted access to Cam Torum to use this.";
const ARRIVED_EVENT = "cam-torum:arrived";

let api = null;

function questStage(player) {
  const request = { player, key: QUEST_KEY, stage: null };
  api.emitCustomEvent("quest:get-stage", request);
  return Number(request.stage) || 0;
}

function crush(event) {
  const { player, itemId } = event;
  const { Location, TeleportHandler, TeleportType } = api.core;
  if (!player.getInventory().contains(itemId)) return false;
  if (questStage(player) < CITY_OPEN_STAGE) {
    player.getPacketSender().sendMessage(LOCKED_MESSAGE);
    return true;
  }
  const destination = new Location(...DESTINATION);
  if (!TeleportHandler.checkReqs(player, destination, WILDERNESS_LEVEL)) return true;
  TeleportHandler.confirm(player, destination, () => {
    if (!player.getInventory().contains(itemId)) return;
    player.getInventory().deleteNumber(itemId, 1);
    player.getPacketSender().sendMessage(CRUSH_MESSAGE);
    TeleportHandler.teleport(player, destination, TeleportType.NORMAL, false,
      () => api.emitCustomEvent(ARRIVED_EVENT, { player }));
  }, WILDERNESS_LEVEL, { item: itemId });
  return true;
}

function describeTeleports({ list }) {
  list.push({ path: ["Items", "Calcified moth"], key: "cam-torum", name: "Cam Torum", tile: [...DESTINATION] });
}

module.exports = {
  name: "CalcifiedMoth",
  description: "Crushing a calcified moth teleports to Cam Torum once Perilous Moons has opened the city.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onItemAction("Calcified moth", { Crush: crush });
    api.onCustomEvent("adminpanel:teleport-destinations", describeTeleports);
  },
  _test: { crush, DESTINATION, CRUSH_MESSAGE, LOCKED_MESSAGE, CITY_OPEN_STAGE },
};
