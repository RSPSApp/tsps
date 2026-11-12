"use strict";

/**
 * Fishing Trawler (https://oldschool.runescape.wiki/w/Fishing_Trawler), from
 * plugins/minigames/data/fishing-trawler.json: the trawler docked at Port Khazard, the trip at
 * sea with its leaks, net and Kraken, the wreck, and the catch in the dock's net. Each lives in
 * ./fishingtrawler/.
 */

const { attachLobby } = require("./fishingtrawler/Lobby.FishingTrawler");
const { attachSea } = require("./fishingtrawler/Sea.FishingTrawler");
const { attachActions } = require("./fishingtrawler/Actions.FishingTrawler");
const { attachRewards } = require("./fishingtrawler/Rewards.FishingTrawler");
const { attachMurphy } = require("./fishingtrawler/Murphy.FishingTrawler");

module.exports = {
  name: "FishingTrawler",
  description: "Adds Fishing Trawler: the boat from Port Khazard, leaks, net and Kraken at sea, the wreck and the catch in the dock's net.",
  members: true,
  register(api) {
    attachSea(api);
    attachLobby(api);
    attachActions(api);
    attachRewards(api);
    attachMurphy(api);
  },
};
