"use strict";

/**
 * The Sorceress's house shelves (21794, four on each floor), searched for the empty beer glasses
 * sq'irkjuice is brewed into.
 *
 * rsprox captures (recording 3169, four searches at 3319,3137,0): "You search the shelves ..."
 * on the tick the player arrives, then three ticks later the find message with one beer glass
 * in the backpack, every search, no animation. Wiki (Shelves (Sorceress's house)): "taking 4
 * ticks" (the click to the glass) and the messages used here; the recording's second message
 * reads "...and among" with no space, the Wiki's "... and among".
 *
 * Ours: a full backpack gets the usual "You don't have enough inventory space." and no glass;
 * neither source covers it.
 */

const { BEER_GLASS_ID } = require("./Gardens.SorceresssGarden");

const FIND_DELAY_TICKS = 3;
const SEARCH_MESSAGE = "You search the shelves ...";
const FIND_MESSAGE = "... and among the strange paraphernalia, you find an empty beer glass.";
const FULL_MESSAGE = "You don't have enough inventory space.";

let api;
let core;

/** The house shelves (21794, "Shelves" Search); the name is shared with other content's shelves. */
function isHouseShelves(objectId) {
  return objectId === core.ObjectIdentifiers.SHELVES_75;
}

function findGlass(player) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(FULL_MESSAGE);
    return;
  }
  inventory.add(new core.Item(BEER_GLASS_ID, 1));
  player.sendMessage(FIND_MESSAGE);
}

/** Search: the first message now, the glass after the search (a step away cancels it). */
function searchShelves(event) {
  if (!isHouseShelves(event.objectId)) return false;
  const { player } = event;
  player.sendMessage(SEARCH_MESSAGE);
  api.getTaskManager().submit(new (class extends core.Task {
    constructor() {
      super(FIND_DELAY_TICKS, player.getIndex(), false);
    }
    execute() {
      this.stop();
      findGlass(player);
    }
  })());
  return true;
}

module.exports = function registerShelves(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onObjectInteraction("Shelves", { Search: searchShelves });
};

module.exports._test = {
  FIND_DELAY_TICKS,
  SEARCH_MESSAGE,
  FIND_MESSAGE,
  searchShelves,
  setShelvesApi(value) {
    api = value;
    core = value.core ?? core;
  },
};
