/**
 * The Champions' Guild door in Varrock (https://oldschool.runescape.wiki/w/Champions%27_Guild):
 * coming in needs 32 Quest Points; the Guildmaster turns the rest away with his Wiki transcript.
 * Leaving is never stopped. Doors.plugin.js opens the door itself.
 */
const { QUEST_POINTS_ATTRIBUTE } = require("../quests/QuestRuntime");

const REQUIRED_QUEST_POINTS = 32;
const REFUSAL_VARIANT = "standard-dialogue-entering-the-champions-guild";
/** The guild is south of the door; the door's own tile is outside. */
const INSIDE_TO_Y = 3362;

let api;
let core;

const worthy = (player) => (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= REQUIRED_QUEST_POINTS;

function guardDoor(request) {
  if (request.handled || request.objectId !== core.ObjectIdentifiers.DOOR_45) return;
  const { player } = request;
  // Wiki: entering or leaving the guild both count for the diary task.
  if (player.getLocation().getY() <= INSIDE_TO_Y || worthy(player)) {
    api.emitCustomEvent("diary:task", { player, diary: "varrock", task: "enter-the-champions-guild" });
    return;
  }
  request.handled = true;
  api.emitCustomEvent("npc-dialogue:start", { player, npcId: core.NpcIdentifiers.GUILDMASTER, variant: REFUSAL_VARIANT, handled: false });
}

function answerDoorCondition({ npcId, player, text }) {
  if (npcId !== core.NpcIdentifiers.GUILDMASTER) return null;
  const value = String(text).toLowerCase();
  if (value.includes("does not have at least 32 quest points")) return !worthy(player);
  if (value.includes("has at least 32 quest points")) return worthy(player);
  return null;
}

module.exports = {
  name: "ChampionsGuild",
  _test: { guardDoor, answerDoorCondition },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onCustomEvent("door:toggle", guardDoor);
    api.onNpcDialogueCondition(answerDoorCondition);
  },
};
