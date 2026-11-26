"use strict";

/**
 * The cauldron in Aldarin (loc cauldron_generic_drink, 1384,2916). Drink-from only gets the
 * player's line, a tick after the arrival, with the chatneu1 head (rsprox recording 4182 ticks 131
 * and 17847, both attempts the same): "As nice as that looks, I think I'll give it a miss for now."
 * Nothing is drunk, taken or changed.
 *
 * Witch's Potion's cauldron (loc 2024) has the same name and option; this answers only its own
 * loc, so that one stays the quest's.
 */
const LOC = "cauldron_generic_drink";
const LINE = "As nice as that looks, I think I'll give it a miss for now.";
const LINE_TICKS = 1;
/** The head's animation (4182 tick 132). */
const HEAD = "chatneu1";

let api = null;

function drinkFrom({ player, object }) {
  const { core } = api;
  if (object?.getId?.() !== core.CacheDefinitions.getLocId(LOC)) return false;
  if (object.getLocation) player.setPositionToFace(object.getLocation());
  const from = player.getLocation().clone();
  core.TaskManager.submit(new core.CountdownTask(player, LINE_TICKS, () => {
    if (player.isRegistered() && player.getLocation().equals(from)) say(player);
  }));
  return true;
}

function say(player) {
  const { DialogueChainBuilder, PlayerDialogue, EndDialogue } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new PlayerDialogue(0, LINE, api.core.CacheDefinitions.getSeqId(HEAD)))
    .add(new EndDialogue(1)));
}

module.exports = {
  name: "AldarinCauldron",
  description: "Answers Drink-from on the Aldarin cauldron with the player's recorded line.",
  members: true,
  _test: { drinkFrom, LINE, LOC },
  register(pluginApi) {
    api = pluginApi;
    api.onObjectInteraction("Cauldron", { "Drink-from": drinkFrom });
  },
};
