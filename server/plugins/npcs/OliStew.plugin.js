"use strict";

/**
 * Stew used on Oli, the Civitas illa Fortis street urchin (Wiki: Oli, trivia). As RSProx 237/1098
 * tick 15381 shows, on the arrival: the stew leaves the inventory and an item box shows it with "You
 * give the stew to Oli and he gets it down in a flash." (the league's "Give Oli some Stew" completes
 * on that tick: `oli:fed-stew` { player, npc }). Then, continued line by line:
 *   Oli: "Thanks! That sure is tasty!" (chathap1)
 *   Player: "Do you want some... more?" (chatquiz1; the player plays emote_think)
 *   Oli: "No, I'm not greedy!" (chatang1)
 */
const OLI = 13318;
const BOX = "You give the stew to Oli and he gets it down in a flash.";
const LINES = [
  { npc: "Thanks! That sure is tasty!", head: 567 },
  { player: "Do you want some... more?", head: 554, emote: "emote_think" },
  { npc: "No, I'm not greedy!", head: 614 },
];

let api = null;

function giveStew(event) {
  const { player, target: npc, itemId, slot } = event;
  const { core } = api;
  if (itemId !== core.ItemIdentifiers.STEW || npc?.getId?.() !== OLI) return;
  event.handled = true;
  const inventory = player.getInventory();
  if (Number.isInteger(slot) && inventory.getItems()[slot]?.getId() === itemId) inventory.deleteAtSlot(slot, 1);
  else if (inventory.contains(itemId)) inventory.delete(itemId, 1);
  else return;
  api.emitCustomEvent("oli:fed-stew", { player, npc });
  const { DialogueChainBuilder, ItemStatementDialogue, NpcDialogue, PlayerDialogue, ActionDialogue, EndDialogue } = core;
  const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, BOX));
  let index = 1;
  for (const line of LINES) {
    if (line.emote) {
      chain.add(new ActionDialogue(index++, { execute: () => {
        player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(line.emote)));
        player.getDialogueManager().advance();
      } }));
    }
    chain.add(line.npc ? new NpcDialogue(index++, OLI, line.npc, "Oli", line.head) : new PlayerDialogue(index++, line.player, line.head));
  }
  chain.add(new EndDialogue(index));
  player.getDialogueManager().startDialogues(chain);
}

module.exports = {
  name: "OliStew",
  description: "Lets players give Oli in Civitas illa Fortis a bowl of stew, with his recorded reply.",
  members: true,
  _test: { giveStew, BOX, LINES, OLI },
  register(pluginApi) {
    api = pluginApi;
    api.onItemOnNpc(giveStew);
  },
};
