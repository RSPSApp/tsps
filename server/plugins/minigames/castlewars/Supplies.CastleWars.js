"use strict";

/**
 * Castle Wars supply tables: Take-from gives one, Take-5 five, with a short cooldown between grabs.
 */

const TAKE_COOLDOWN_TICKS = 2;
const TAKE_FIVE_CLICK = 2;

let core;
let data;
let game;

function takeSupply(event) {
  const { player, object, clickType } = event;
  const supply = data.SUPPLY_TABLES[object.getId()];
  if (!supply || !game.inGameBounds(object.getLocation())) {
    return;
  }
  event.handled = true;
  const { CASTLEWARS_TAKE_ITEM } = core.TimerKey;
  if (player.getTimers().has(CASTLEWARS_TAKE_ITEM)) {
    return;
  }
  const [itemId, message] = supply;
  player.performAnimation(data.TAKE_SUPPLY_ANIM);
  player.getInventory().adds(itemId, clickType === TAKE_FIVE_CLICK ? 5 : 1);
  player.sendMessage(message);
  player.getTimers().extendOrRegister(CASTLEWARS_TAKE_ITEM, TAKE_COOLDOWN_TICKS);
}

module.exports = function attachCastleWarsSupplies(api, castleWars) {
  game = castleWars;
  core = api.core;
  data = castleWars.data;
  api.onObjectInteraction(takeSupply);
};
