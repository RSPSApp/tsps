"use strict";

/**
 * The five pickaxe barrels in the Ruins of Camdozaal (OSRS Wiki: Barrel (Ruins of Camdozaal)).
 *
 * rsprox 2026-11-17 (rev 242.1, barrel at 2961,5807): Take-pickaxe plays the reach
 * animation (832) and opens an item box with the bronze pickaxe, "You take a pickaxe
 * from the barrel.", logged to chat. Wiki: a bronze pickaxe "only when no pickaxe is
 * in your inventory", otherwise "You already have a pickaxe. Best leave these ones
 * here in case someone else needs one."; the barrels never run out.
 */
const S = require("./Shared.Camdozaal");

const BARREL = "camdozaal_pickaxe_barrel";
const REACH_SEQ = 832;
const TAKEN = "You take a pickaxe from the barrel.";
const ALREADY_HAVE = "You already have a pickaxe. Best leave these ones here in case someone else needs one.";
/** Not captured: the wording when the inventory is full. */
const NO_SPACE = "You don't have enough inventory space.";

/** Any pickaxe Mining knows, carried in the inventory (the Wiki's condition). */
function carriesPickaxe(player) {
  return player.getInventory().getItems().some(item => {
    if (!item || item.getId() < 0) return false;
    const request = { player, itemId: item.getId(), pickaxe: null };
    S.pluginApi().emitCustomEvent("mining:pickaxe", request);
    return request.pickaxe != null;
  });
}

function takePickaxe({ player, objectId }) {
  const core = S.core();
  if (objectId !== core.CacheDefinitions.getLocId(BARREL)) return false;
  if (carriesPickaxe(player)) return player.sendMessage(ALREADY_HAVE);
  if (player.getInventory().getFreeSlots() < 1) return player.sendMessage(NO_SPACE);
  const pickaxe = core.ItemIdentifiers.BRONZE_PICKAXE;
  player.performAnimation(new core.Animation(REACH_SEQ));
  player.getInventory().adds(pickaxe, 1);
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, pickaxe, TAKEN))
    .add(new core.EndDialogue(1)));
}

module.exports = function attach(api) {
  api.onObjectInteraction("Barrel", { "Take-pickaxe": takePickaxe });
};
