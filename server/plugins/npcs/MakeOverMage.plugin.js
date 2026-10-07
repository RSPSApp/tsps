const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { EndDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");

const MAKEOVER_INTERFACE_ID = 679;
const MAIN_MODAL_TARGET_UID = (161 << 16) | 16;
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
const MAKEOVER_COMMANDS = ["mm", "makeover", "makeovermage"];
const MAKEOVER_HINT = "If you ever want to change your appearance again, type ::mm ingame";


function startMakeoverDialogue(player, npcId) {
  const dialogue = new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, "Hello! I can change your appearance. Choose Makeover when you're ready."),
    new EndDialogue(1),
  );
  player.getDialogueManager().startDialogues(dialogue);
}

function openMakeoverInterface(player) {
  if (!player || typeof player.getPacketSender !== "function") {
    return false;
  }
  player.getPacketSender().sendInterfaceRemoval();
  player.setInterfaceId?.(MAKEOVER_INTERFACE_ID);
  player.getAppearance?.().setCanChangeAppearance?.(true);
  player.getPacketSender().sendSubInterface(MAIN_MODAL_TARGET_UID, MAKEOVER_INTERFACE_ID, 0);
  return true;
}

function canOpenMakeover(player, combatFactory) {
  return !player.busy?.() &&
    !combatFactory.inCombat(player) &&
    !player.getDialogueManager?.()?.isActive?.() &&
    !player.getPacketSender?.().hasInterruptibleInterface?.();
}

function talkToMakeoverMage({ player, npcId }) {
  startMakeoverDialogue(player, npcId);
}

function openMakeover({ player }) {
  return openMakeoverInterface(player);
}

module.exports = {
  name: "MakeOverMage",
  register(api) {
    const CombatFactory = api.getCombatFactory();
    const firstLoginMakeovers = new WeakSet();

    api.onPlayerLogin(({ player, isNewAccount }) => {
      if (!isNewAccount || player.isPlayerBot?.() === true) {
        return;
      }
      firstLoginMakeovers.add(player);
    });

    api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, ({ player }) => {
      if (!firstLoginMakeovers.delete(player)) {
        return false;
      }
      // WelcomeScreen restores the gameframe first; mount the modal after that root swap.
      queueMicrotask(() => {
        if (openMakeoverInterface(player)) {
          player.sendMessage(MAKEOVER_HINT);
        }
      });
      return true;
    });

    api.onPlayerDisconnect(({ player }) => firstLoginMakeovers.delete(player));
    api.onPlayerLogout(({ player }) => firstLoginMakeovers.delete(player));

    for (const command of MAKEOVER_COMMANDS) {
      api.registerCommand(command, ({ player }) => {
        if (!canOpenMakeover(player, CombatFactory)) {
          player.sendMessage("You cannot change your appearance right now.");
          return true;
        }
        return openMakeoverInterface(player);
      }, undefined, "Change your appearance");
    }

    api.onNpcInteraction("Makeover Mage", {
      "Talk-to": talkToMakeoverMage,
      Makeover: openMakeover,
    });

    api.log("registered", {
      interfaceId: MAKEOVER_INTERFACE_ID,
    });
  },
};
