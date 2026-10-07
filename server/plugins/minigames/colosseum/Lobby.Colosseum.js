"use strict";

/**
 * The lobby under the Colosseum: the way down from Civitas illa Fortis and back up, Minimus,
 * the Glory-locked bank chest and the tunnel into the arena.
 *
 * Capture:
 * - The city entrance (50749) fades out and puts you in the lobby two ticks later.
 * - The tunnel (50751) before Minimus's introduction plays his "Oi! Where d'you think you're
 *   going?" line. The introduction sets varbit 9807 and ends on his question menu.
 * - The bank chest without enough Glory plays his "Oi, get yer hands off that!" line and "You
 *   do not have enough Glory to use that.". The Wiki puts the chest at Brawler, 2,000 Glory.
 * - The tunnel's warning box and "Are you sure you wish to enter the Fortis Colosseum?".
 *   Its "don't ask again" answer skips both next time.
 */

const Shared = require("./ColosseumShared");
const Run = require("./ColosseumRun");

const LOBBY_STAIRS_ID = 50750;
const TUNNEL_ID = 50751;
const ENTRY_WARNING = "You are about to enter the Fortis Colosseum. Within, you will face<br>multiple waves of "
  + "<col=b30000>deadly foes</col>. Dying at any point is <col=b30000>not considered a<br><col=b30000>safe death"
  + "</col>. Apart from between waves, there is no exit within the<br>Colosseum, but teleporting out is allowed.";

function hadIntro(player) {
  return player.getAttribute(Shared.ATTR.INTRO) === true;
}

function syncIntro(player) {
  player.getPacketSender().sendVarbit(Shared.VARBIT.INTRO, hadIntro(player) ? 1 : 0);
}

function syncIntroOnLogin({ player }) {
  syncIntro(player);
}

function goDown({ player }) {
  Shared.fadeMove(player, () => player.moveTo(Shared.loc(Shared.LOBBY)));
  return true;
}

function goUp(event) {
  if (event.objectId !== LOBBY_STAIRS_ID) return false;
  Shared.fadeMove(event.player, () => event.player.moveTo(Shared.loc(Shared.CITY)));
  return true;
}

function enterArena(player) {
  if (Run.runOf(player)) return;
  Shared.fadeMove(player, () => Run.start(player));
}

function confirmEntry(player) {
  Shared.options(player, "Are you sure you wish to enter the Fortis Colosseum?",
    "Yes, I understand the risks.", () => enterArena(player),
    "Yes, and don't ask again.", () => {
      player.setAttribute(Shared.ATTR.NO_WARNING, true);
      enterArena(player);
    },
    "No.", () => {});
}

function tunnel(event) {
  if (event.objectId !== TUNNEL_ID) return false;
  const { player } = event;
  if (!hadIntro(player)) {
    Shared.minimusSays(player, "attempting-to-enter-the-arena-before-talking-to-minimus");
    return true;
  }
  if (player.getAttribute(Shared.ATTR.NO_WARNING) === true) {
    enterArena(player);
    return true;
  }
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, ENTRY_WARNING),
    new ActionDialogue(1, { execute: () => confirmEntry(player) }),
  ));
  return true;
}

/** Brawlers and up may bank here; everyone else gets told off (the bank plugin opens it otherwise). */
function bankChest(event) {
  if (event.objectId !== Shared.OBJECT.BANK_CHEST || Shared.gloryOf(event.player) >= Shared.BANK_GLORY) return false;
  Shared.minimusSays(event.player, "attempting-to-use-the-bank-chest-without-enough-glory");
  return true;
}

/** Minimus's first talk is his introduction (and lets you through the tunnel). */
function minimusVariant({ player, npcId }) {
  if (npcId !== Shared.NPC.MINIMUS_LOBBY || hadIntro(player)) return null;
  player.setAttribute(Shared.ATTR.INTRO, true);
  syncIntro(player);
  return "first-time-dialogue";
}

/** The transcript's "[rank]" is the player's Glory title. */
function fillRank(request) {
  if (request.npcId !== Shared.NPC.MINIMUS_LOBBY && request.npcId !== Shared.NPC.MINIMUS_ARENA) return;
  if (typeof request.text === "string" && request.text.includes("[rank]")) {
    request.text = request.text.replaceAll("[rank]", Shared.rankOf(request.player));
  }
}

module.exports = function registerColosseumLobby(api) {
  Shared.bind(api);
  api.persistAttribute(Shared.ATTR.INTRO);
  api.persistAttribute(Shared.ATTR.GLORY);
  api.persistAttribute(Shared.ATTR.NO_WARNING);
  api.onObjectInteraction(Shared.OBJECT.CITY_ENTRANCE, { Enter: goDown });
  api.onObjectInteraction(Shared.OBJECT.LOBBY_STAIRS, { Exit: goUp });
  api.onObjectInteraction(Shared.OBJECT.TUNNEL, { Enter: tunnel });
  api.onObjectInteraction("Bank chest", { Use: bankChest, Collect: bankChest });
  api.onNpcDialogueVariant(minimusVariant);
  api.onCustomEvent("npc-dialogue:line", fillRank);
  api.onPlayerLogin(syncIntroOnLogin);
};

module.exports.tunnel = tunnel;
module.exports.bankChest = bankChest;
module.exports.minimusVariant = minimusVariant;
