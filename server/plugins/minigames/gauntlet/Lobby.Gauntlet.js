"use strict";

/**
 * The lobby under Prifddinas: the Gauntlet Portal down from the city, the teleport platform back
 * up, Bryn, and the entrance that starts a run.
 *
 * Wiki: nothing can be taken in or out, so the entrance needs an empty inventory and equipment.
 * Bryn turns away anyone who hasn't spoken to him, has a pet out, or has a reward waiting
 * (his lines are from the Wiki's transcript). Enter-corrupted appears once a Gauntlet has been
 * completed (varp 2353, the entrance's multiloc).
 */

const Shared = require("./GauntletShared");
const Run = require("./GauntletRun");
const Rewards = require("./GauntletRewards");
const Scoreboard = require("./GauntletScoreboard");

const CURRENT_PET_ATTRIBUTE = "pets:current";

const ATTR_SPOKEN_TO_BRYN = "gauntlet:spoken-to-bryn";
const BRYN = {
  NOT_SPOKEN: "Don't think you want to be heading down there without knowing what you're getting into! Come and see me, if you really want to go down there.",
  PET: "Don't think you can be taking any plus ones down there with you.",
  REWARD: "There's something in that there chest waiting for you. Don't leave it for too long.",
};

function enter(event) {
  return startRun(event.player, false);
}

function enterCorrupted(event) {
  return startRun(event.player, true);
}

function startRun(player, corrupted) {
  if (Run.runOf(player)) return true;
  if (player.getAttribute(ATTR_SPOKEN_TO_BRYN) !== true) {
    Shared.npcSay(player, Shared.NPC.BRYN, BRYN.NOT_SPOKEN);
    return true;
  }
  if (player.getPacketSender().getVarbit(Shared.VARBIT.REWARD) === 1) {
    Shared.npcSay(player, Shared.NPC.BRYN, BRYN.REWARD);
    return true;
  }
  if (player.getAttribute?.(CURRENT_PET_ATTRIBUTE)) {
    Shared.npcSay(player, Shared.NPC.BRYN, BRYN.PET);
    return true;
  }
  if (!Shared.isEmptyHanded(player)) {
    Shared.statement(player, "You can't take any items into the Gauntlet. Use the deposit box first.");
    return true;
  }
  if (corrupted && !Run.hasCompleted(player)) return true;
  Run.startRun(player, { corrupted });
  return true;
}

/** Down from Prifddinas. */
function enterPortal(event) {
  Shared.fadeMove(event.player, () => event.player.moveTo(Shared.loc(Shared.LOBBY)));
  return true;
}

/** The lobby's platform channels you back up to the city; the maze's ones are exits (Run). */
function channelUp(event) {
  if (event.objectId !== Shared.OBJECT.LOBBY_PLATFORM) return false;
  Shared.fadeMove(event.player, () => event.player.moveTo(Shared.loc(Shared.PRIFDDINAS)));
  return true;
}

const SCOREBOARD = 36060;
// The lobby chest is a multiloc (37341, on varbit 9179): clicks carry its own id.
const REWARD_CHESTS = [37341, 36087, 35988];

function openChest(event) {
  if (!REWARD_CHESTS.includes(event.objectId)) return false;
  Rewards.openChest(event.player);
  return true;
}

function readScoreboard(event) {
  if (event.objectId !== SCOREBOARD) return false;
  Scoreboard.readScoreboard(event.player, Run.statsOf(event.player));
  return true;
}

function sendChestOnLogin({ player }) {
  Rewards.sendChest(player);
}

/** Bryn's first talk explains the place; after it, the entrance lets you in. */
function brynVariant({ player, npcId }) {
  if (npcId !== Shared.NPC.BRYN) return null;
  if (player.getAttribute(ATTR_SPOKEN_TO_BRYN) === true) return null;
  player.setAttribute(ATTR_SPOKEN_TO_BRYN, true);
  return "first-time-talking-to-him";
}

module.exports = function registerGauntletLobby(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR_SPOKEN_TO_BRYN);
  api.onObjectInteraction(Shared.OBJECT.ENTRANCE, { Enter: enter, "Enter-corrupted": enterCorrupted });
  api.onObjectInteraction(Shared.OBJECT.PORTAL, { Enter: enterPortal });
  api.onObjectInteraction(Shared.OBJECT.TELEPORT_PLATFORM, { Channel: channelUp });
  api.onNpcDialogueVariant(brynVariant);
  api.persistAttribute(Rewards.ATTR_REWARD);
  api.onObjectInteraction("Reward Chest", { Open: openChest });
  api.onObjectInteraction("Scoreboard", { Read: readScoreboard });
  api.onPlayerLogin(sendChestOnLogin);
};

module.exports.ATTR_SPOKEN_TO_BRYN = ATTR_SPOKEN_TO_BRYN;
