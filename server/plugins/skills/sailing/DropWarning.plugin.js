"use strict";

// All Settings "Drop item warnings on boats" (465, varbit 18143; the row is ticked while it is 0,
// which warns): an item dropped
// on a boat's deck asks first, as live does, because whatever is left there once the player leaves
// the boat may be gone. The message box, then "Select an option" with put it down, put it down and
// never ask again (sets 18143), put it down and don't ask again until logout (varbit 19114), or
// keep it. Every item asks, whatever its worth.
const SETTING = 465;
const DONT_ASK_VARBIT = 18143;
const SESSION_VARBIT = 19114;
/** Not saved: "don't ask again this session" lasts until logout. */
const SESSION_ATTRIBUTE = "sailing:drop-warning-off";
/** This warning's name in "item:drop-warning"'s `answered`. */
const WARNING = "boat";

const TEXT = "Are you sure you want to put that down? If you leave the boat, you may not be able to retrieve it.";
const TEXT_BOX = "Are you sure you want to put that down? If you leave the boat, you<br>may not be able to retrieve it.";
const TITLE = "Select an option";
const OPTIONS = ["Put it down.", "Put it down, and don't ask again.", "Put it down, and don't ask again this session.", "Don't drop it."];

let api = null;

function asks(player) {
  return !!api.core.BoatManager.getBoatAboard(player)
    && (Number(player.getPacketSender().getVarbit(DONT_ASK_VARBIT)) || 0) === 0
    && player.getAttribute(SESSION_ATTRIBUTE) !== true;
}

/** "item:drop-warning": asks unless another warning is already asking or this one was answered. */
function dropWarning(request) {
  const { player } = request ?? {};
  if (!player || request.warned || request.answered?.includes(WARNING) || !asks(player)) return;
  request.warned = true;
  const { DialogueChainBuilder, StatementDialogue, OptionDialogue, ChatType } = api.core;
  const sender = player.getPacketSender();
  const owner = {};
  sender.sendTypedMessage(ChatType.MESBOX, TEXT);
  const chain = new DialogueChainBuilder()
    .add(new StatementDialogue(0, TEXT_BOX))
    .add(new OptionDialogue(1, {
      executeOption: (option) => {
        sender.closeChatboxFor(owner);
        const choice = Number(option);
        if (choice === 2) api.emitCustomEvent("settings:set", { player, settingId: SETTING, value: 1 });
        if (choice === 3) {
          player.setAttribute(SESSION_ATTRIBUTE, true);
          sender.sendVarbit(SESSION_VARBIT, 1);
        }
        if (choice >= 1 && choice <= 3) request.proceed(WARNING);
      },
    }, ...OPTIONS).setTitle(TITLE));
  player.getDialogueManager().startDialogues(chain, owner);
}

module.exports = {
  name: "SailingDropWarning",
  description: "Asks before an item is dropped on a boat's deck, unless its All Settings row (465) says not to.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    api.onCustomEvent("item:drop-warning", dropWarning);
  },
  _test: { dropWarning, setApi: (pluginApi) => { api = pluginApi; }, TEXT, TEXT_BOX, TITLE, OPTIONS, DONT_ASK_VARBIT, SESSION_VARBIT },
};
