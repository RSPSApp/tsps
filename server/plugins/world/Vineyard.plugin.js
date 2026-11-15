"use strict";

/**
 * Aldarin's vineyard foreman hands out the grape barrel used to collect four sets of grapes
 * (Wiki: Grape barrel). The transcript and its handout messages are generated data; this plugin
 * only answers the four barrel conditions and gives the item on the two handout steps.
 *
 * The barrel's filling and its full-barrel return are not implemented yet: the grapevines have no
 * Pick handler (docs/picking.md, server/docs/leagues.md). That is a separate activity, not this
 * report's missing barrel.
 */

const FOREMAN_NPC_ID = 13908;
const BARREL_RECEIVED_ATTRIBUTE = "aldarin:vineyard-barrel-received";
/** "The foreman gives you a grape barrel." in the first-time and repeat branches. */
const BARREL_MESSAGE_IDS = new Set(["dH1XFF", "1VyjPI"]);

let core = null;

function hasBarrel(player) {
  return player.getInventory().contains(core.ItemIdentifiers.GRAPE_BARREL);
}

function hasSpace(player) {
  return player.getInventory().getFreeSlots() > 0;
}

function receivedBefore(player) {
  return player.getAttribute(BARREL_RECEIVED_ATTRIBUTE) === true;
}

/** The foreman's four sibling conditions, in the transcript's order. */
function barrelCondition({ player, npcId, stepId }) {
  if (npcId !== FOREMAN_NPC_ID) return null;
  const barrel = hasBarrel(player);
  switch (stepId) {
    case "RmkT70": // "If the player doesn't have a grape barrel:" (first time)
      return !barrel && hasSpace(player) && !receivedBefore(player);
    case "-pHm2N": // "If the player doesn't have a grape barrel but has received one before:"
      return !barrel && hasSpace(player) && receivedBefore(player);
    case "cPUyGi": // "If the player doesn't have a grape barrel and doesn't have inventory space:"
      return !barrel && !hasSpace(player);
    case "RoegjF": // "If the player already has a grape barrel:"
      return barrel;
    default:
      return null;
  }
}

/** The handout steps add the barrel; the transcript's own message still shows. */
function giveBarrel(event) {
  if (event.npcId !== FOREMAN_NPC_ID || event.kind !== "message") return;
  if (!BARREL_MESSAGE_IDS.has(event.stepId)) return;
  const { player } = event;
  if (hasBarrel(player) || !hasSpace(player)) return;
  player.getInventory().adds(core.ItemIdentifiers.GRAPE_BARREL, 1);
  player.setAttribute(BARREL_RECEIVED_ATTRIBUTE, true);
  // The recorded handout opens OBJECTBOX 193 with the barrel and the message, not a bare chat line.
  event.box = { items: [core.ItemIdentifiers.GRAPE_BARREL] };
}

module.exports = {
  name: "Vineyard",
  description: "Aldarin's vineyard foreman hands out the grape barrel.",
  members: true,
  _test: { barrelCondition, giveBarrel, BARREL_RECEIVED_ATTRIBUTE },
  register(pluginApi) {
    core = pluginApi.core;
    pluginApi.persistAttribute(BARREL_RECEIVED_ATTRIBUTE, false);
    pluginApi.onNpcDialogueCondition(barrelCondition);
    pluginApi.onCustomEvent("npc-dialogue:action", giveBarrel);
  },
};
