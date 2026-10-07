/**
 * Spirit tree network (https://oldschool.runescape.wiki/w/Spirit_tree).
 *
 * The permanent trees are listed in data/definitions/spirit-trees.json. Using
 * the network needs Tree Gnome Village completed, and travelling from the
 * Gnome Stronghold tree additionally needs The Grand Tree (it can still be a
 * destination without it). A destination whose quest is not registered in this
 * server is offered rather than hard-blocked, matching how unimplemented
 * quests are treated elsewhere.
 *
 * Player-grown trees are handled by the Farming patch interaction.
 */
const fs = require("fs");
const path = require("path");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const QuestRuntime = require("../quests/QuestRuntime");

const NETWORK_QUEST = "Tree Gnome Village";
const STRONGHOLD_QUEST = "The Grand Tree";
const STRONGHOLD_TILE = new Location(2460, 3446, 0);
const STRONGHOLD_TOLERANCE = 4;

let core = null;
let pluginApi = null;
let destinations = [];

function loadDestinations() {
  const file = path.join(core.GameConstants.DEFINITIONS_DIRECTORY, "spirit-trees.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return (data.destinations ?? []).map((entry) => ({
    name: String(entry.name),
    destination: new Location(entry.x, entry.y, entry.z ?? 0),
    requires: entry.requires ?? null,
  }));
}

function questComplete(player, name) {
  if (!name) {
    return true;
  }
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.name === name);
  return quest ? quest.isComplete(player) : true;
}

function atStronghold(object) {
  const location = object?.getLocation?.();
  return location?.getX?.() != null &&
    Math.abs(location.getX() - STRONGHOLD_TILE.getX()) <= STRONGHOLD_TOLERANCE &&
    Math.abs(location.getY() - STRONGHOLD_TILE.getY()) <= STRONGHOLD_TOLERANCE;
}

function canUseNetwork(player, object) {
  if (!questComplete(player, NETWORK_QUEST)) {
    player.sendMessage("You need to have completed Tree Gnome Village to use the spirit tree network.");
    return false;
  }
  if (atStronghold(object) && !questComplete(player, STRONGHOLD_QUEST)) {
    player.sendMessage("You need to have completed The Grand Tree to travel from this tree.");
    return false;
  }
  return true;
}

function travel(player, entry) {
  if (!questComplete(player, entry.requires)) {
    player.sendMessage(`You need to have completed ${entry.requires} to travel there.`);
    return;
  }
  if (!core.TeleportHandler.checkReqs(player, entry.destination)) {
    return;
  }
  core.TeleportHandler.teleport(player, entry.destination, core.TeleportType.NORMAL, false);
}

function openNetwork(event) {
  const { player, object } = event;
  if (!player || !canUseNetwork(player, object)) {
    return;
  }
  pluginApi.sendMultiChatboxPrompt(
    player,
    "Where would you like to travel to?",
    ...destinations.flatMap((entry) => [entry.name, () => travel(player, entry)])
  );
}

module.exports = {
  name: "SpiritTrees",
  members: true,
  _test: { loadDestinations: () => loadDestinations(), canUseNetwork, travel, atStronghold, questComplete, openNetwork },
  register(api) {
    core = api.core;
    pluginApi = api;
    destinations = loadDestinations();
    api.onObjectInteraction("Spirit Tree", { Travel: openNetwork });
    api.log("registered", { destinations: destinations.length });
  },
};
