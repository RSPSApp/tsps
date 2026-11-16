/**
 * The Doomsayer in Lumbridge (Wiki: Doomsayer): he explains his warning screens and turns them
 * back on, through his Toggle warnings list (cws_doomsayer, 583).
 *
 * As rsprox 20261115T211134 shows him (ticks 5091-5225):
 * - Talk-to, the first time: "Dooooom!", "Where?", what the doom is and who he is; doomsayer_intro
 *   is set, then he explains the warning signs and asks "I'd like to get rid of some of your
 *   warning signs." / "Thanks, I'll remember that if I see any warning signs.".
 * - Talk-to after that: "Dooooom!", then "I'd like to get rid of some of your warning signs." /
 *   "I'd better be off.".
 * - Getting rid of signs: "Oh... Very well.", then the list opens (toplevel_mainmodal_open 2524).
 * - In the list, each row's Toggle flips its warning between on (6) and off (7) with a game
 *   message; a warning not yet shown often enough (0-5) cannot be toggled. Rows map to warnings
 *   through enum 688 (warning -> row component), as script 165 draws them (the doomsayerRow of
 *   data/warning-screens.json).
 * The first-time "Thanks" answer is not in the capture: its reply is the Wiki transcript's.
 */
const Shared = require("./Shared.WarningScreens");

const DOOMSAYER_HEAD = 119; // the multi-npc the capture's chathead shows (6773/6774 by varbit)
const SPEAKER = "Doomsayer";
const LIST_INTERFACE = 583; // cws_doomsayer
const SCRIPT_MAINMODAL_OPEN = 2524; // toplevel_mainmodal_open
const INTRO_VARBIT = 16791; // doomsayer_intro
const INTRO_ATTRIBUTE = "doomsayer:intro-heard";

const RID_OF_SIGNS = "I'd like to get rid of some of your warning signs.";
const THANKS = "Thanks, I'll remember that if I see any warning signs.";
const BE_OFF = "I'd better be off.";

/** Chathead animations as captured. */
const ANIM = { doom: 596, talk: 589, explain: 590, sad: 575, neutral: 588, happy: 567 };

let core;
let pluginApi;
function npcLine(index, text, anim) {
  return new core.NpcDialogue(index, DOOMSAYER_HEAD, text, SPEAKER, anim);
}

function playerLine(index, text, anim) {
  return new core.PlayerDialogue(index, text, anim);
}

function then(index, execute) {
  return new core.ActionDialogue(index, { execute });
}

function introHeard(player) {
  return player.getAttribute(INTRO_ATTRIBUTE) === true;
}

function hearIntro(player) {
  player.setAttribute(INTRO_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(INTRO_VARBIT, 1);
}

function openList(player) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(LIST_INTERFACE);
}

function getRidOfSigns(player) {
  const { DialogueChainBuilder } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    playerLine(0, RID_OF_SIGNS, ANIM.neutral),
    npcLine(1, "Oh... Very well.", ANIM.sad),
    then(2, () => openList(player)),
  ));
}

function thanks(player) {
  const { DialogueChainBuilder, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    playerLine(0, THANKS, ANIM.neutral),
    npcLine(1, "You're welcome!", ANIM.happy),
    new EndDialogue(2),
  ));
}

function beOff(player) {
  const { DialogueChainBuilder, EndDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    playerLine(0, BE_OFF, ANIM.happy),
    new EndDialogue(1),
  ));
}

function choose(player, second, onSecond) {
  pluginApi.sendMultiChatboxPrompt(player, "Select an option",
    RID_OF_SIGNS, () => getRidOfSigns(player),
    second, () => onSecond(player));
}

function talkTo({ player }) {
  const { DialogueChainBuilder } = core;
  const chain = new DialogueChainBuilder();
  if (introHeard(player)) {
    chain.add(npcLine(0, "Dooooom!", ANIM.doom), then(1, () => choose(player, BE_OFF, beOff)));
  } else {
    chain.add(
      npcLine(0, "Dooooom!", ANIM.doom),
      playerLine(1, "Where?", ANIM.doom),
      npcLine(2, "All around us! I can feel it in the air, hear it on the wind, smell it... also in the air!", ANIM.talk),
      playerLine(3, "Is there anything we can do about this doom?", ANIM.doom),
      npcLine(4, "There is nothing you need to do my friend, for I am the Doomsayer! I roam the world sensing danger.", ANIM.talk),
      then(5, () => {
        hearIntro(player);
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
          npcLine(0, "If I find a dangerous area, then I put up warning signs that will tell you what is so dangerous about that area.", ANIM.explain),
          then(1, () => choose(player, THANKS, thanks)),
        ));
      }),
    );
  }
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function toggleWarnings({ player }) {
  openList(player);
  return true;
}

/** A row's Toggle in the list (583:42-65). */
function listClick(event) {
  const buttonId = Number(event.buttonId ?? 0);
  if ((event.groupId ?? (buttonId >>> 16)) !== LIST_INTERFACE) return;
  const entry = Shared.byDoomsayerRow(event.childId ?? (buttonId & 0xffff));
  if (!entry) return;
  event.handled = true;
  const { player } = event;
  const warning = entry.warning;
  const shown = Shared.state(player, warning);
  if (shown < Shared.SHOWN_ENOUGH) {
    player.sendMessage(Shared.CANNOT_TOGGLE_MESSAGE);
    return;
  }
  const turningOn = shown === Shared.OFF;
  Shared.setState(player, warning, turningOn ? Shared.SHOWN_ENOUGH : Shared.OFF);
  player.sendMessage(turningOn ? Shared.TOGGLED_ON_MESSAGE : Shared.TOGGLED_OFF_MESSAGE);
}

function syncIntro({ player }) {
  if (introHeard(player)) player.getPacketSender().sendVarbit(INTRO_VARBIT, 1);
}

function setApi(api) {
  pluginApi = api;
  core = api.core;
}

module.exports = function attach(api) {
  setApi(api);
  api.persistAttribute(INTRO_ATTRIBUTE, false);
  api.onNpcInteraction(SPEAKER, { "Talk-to": talkTo, "Toggle-warnings": toggleWarnings });
  api.onInterfaceActionClick(listClick);
  api.onPlayerLogin(syncIntro);
};
module.exports.talkTo = talkTo;
module.exports.toggleWarnings = toggleWarnings;
module.exports.listClick = listClick;
