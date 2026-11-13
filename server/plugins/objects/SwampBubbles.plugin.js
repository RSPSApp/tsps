"use strict";

/**
 * Swamp bubbles (Suck): fills the player's ogre bellows with swamp gas.
 *
 * Wiki (Swamp bubbles): since the 8 February 2018 update, left-click Suck fills ogre bellows, all
 * of them if the player carries several. rsprox 227/02173: the tick after the click the bellows
 * become filled_ogre_bellow3 (three loads), with "You collect some gas from the swamp." (spam), the
 * bellows animation (human_chompybird_ogrebellows) and graphic (ogre_bellows_use, height 64) and
 * sound 1454, all 30 client cycles late. With no bellows that aren't full already: "You don't have
 * anything in your inventory to store the bubbles' fumes!" at once.
 *
 * Using bellows on the bubbles stays Big Chompy Bird Hunting's and Recipe for Disaster's (their own
 * lines and quest steps).
 * A Suck that fills bellows emits "swamp-bubbles:gas-collected" ({ player, filled }).
 */

const NO_BELLOWS = "You don't have anything in your inventory to store the bubbles' fumes!";
const COLLECTED = "You collect some gas from the swamp.";
const ANIMATION = "human_chompybird_ogrebellows";
const GRAPHIC = "ogre_bellows_use";
const GRAPHIC_HEIGHT = 64;
const SOUND = 1454;
const EFFECT_DELAY = 30;
const FILL_TICKS = 1;
/** Emitted with { player, filled } once Suck fills bellows. */
const GAS_COLLECTED_EVENT = "swamp-bubbles:gas-collected";

let api = null;
let core = null;

const FULL = () => core.CacheDefinitions.getObjId("filled_ogre_bellow3");
/** Bellows that can take more gas: empty, one load, two loads. */
function unfilled() {
  const C = core.CacheDefinitions;
  return [core.ItemIdentifiers.OGRE_BELLOWS, C.getObjId("filled_ogre_bellow1"), C.getObjId("filled_ogre_bellow2")];
}

function bellowsToFill(player) {
  const ids = unfilled();
  return player.getInventory().getItems().some((item) => item && ids.includes(item.getId()));
}

/** Every unfilled pair in the backpack becomes a full one, each in its own slot. */
function fill(player) {
  const inventory = player.getInventory();
  const ids = unfilled();
  let filled = 0;
  inventory.getItems().forEach((item, slot) => {
    if (!item || !ids.includes(item.getId())) return;
    inventory.setItem(slot, new core.Item(FULL(), 1));
    filled++;
  });
  if (filled === 0) {
    player.sendMessage(NO_BELLOWS);
    return;
  }
  inventory.refreshItems();
  const C = core.CacheDefinitions;
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, COLLECTED);
  player.performAnimation(new core.Animation(C.getSeqId(ANIMATION), EFFECT_DELAY));
  player.performGraphic(new core.Graphic(C.getSpotanimId(GRAPHIC), EFFECT_DELAY, GRAPHIC_HEIGHT));
  player.getPacketSender().sendSound(SOUND, 255, EFFECT_DELAY);
  // Quests that count filling the bellows as a step (Recipe for Disaster's Skrach) listen for it.
  api.emitCustomEvent(GAS_COLLECTED_EVENT, { player, filled });
}

function suck({ player }) {
  if (!bellowsToFill(player)) {
    player.sendMessage(NO_BELLOWS);
    return true;
  }
  // Keyed to the player: another action started the same tick (a new walk-to) cancels it.
  const task = new (class extends core.Task {
    constructor() {
      super(FILL_TICKS, player.getIndex(), false);
    }
    execute() {
      this.stop();
      if (player.isRegistered()) fill(player);
    }
  })();
  api.getTaskManager().submit(task);
  return true;
}

function bind(registry) {
  api = registry;
  core = registry.core;
}

module.exports = {
  name: "SwampBubbles",
  description: "Lets players Suck on swamp bubbles to fill their ogre bellows with swamp gas, as in Big Chompy Bird Hunting.",
  members: true,
  register(registry) {
    bind(registry);
    registry.onObjectInteraction("Swamp bubbles", { Suck: suck });
  },
  suck, fill, NO_BELLOWS, COLLECTED, GAS_COLLECTED_EVENT,
};
