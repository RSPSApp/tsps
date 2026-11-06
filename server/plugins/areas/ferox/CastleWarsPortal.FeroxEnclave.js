/**
 * The Castle Wars portal just outside The Old Nite pub (Wiki: Castle Wars portal; OSRS Wiki,
 * Ferox Enclave; docs/ferox-enclave.md):
 *
 * - "Enter" warns that there is no return portal to Ferox Enclave from Castle Wars, and on "Yes."
 *   teleports a tick later to the Castle Wars lobby. Free-to-play worlds can come back through
 *   the lobby's double doors; the return destination, prompt text and timing are our choices.
 */
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const Ferox = require("./Common.FeroxEnclave");

/** The lobby spot the ring of dueling's Castle Wars teleport uses (Teleports.Jewellery.js). */
const LOBBY = new Location(2440, 3090, 0);
// The Wiki names the warning only; the wording is ours.
const WARNING = "There is no return portal to Ferox Enclave from Castle Wars.";

// The return location and the question's wording/timing are TSPS choices, not captures.
const RETURN = require('./FreeForAll.FeroxEnclave').RETURN;

function returnToFerox(player, origin) {
  if (!player.getLocation().equals(origin) || Ferox.core.WorldDefinition.isMembersWorld()) return;
  Ferox.later(player, 1, () => {
    if (player.getLocation().equals(origin) && !Ferox.core.WorldDefinition.isMembersWorld()) player.moveTo(RETURN.clone());
  });
}

function useLobbyDoor(request) {
  if (request.handled || Ferox.core.WorldDefinition.isMembersWorld()) return;
  const { LARGE_DOOR_98, LARGE_DOOR_99 } = Ferox.core.ObjectIdentifiers;
  if (request.objectId !== LARGE_DOOR_98 && request.objectId !== LARGE_DOOR_99) return;
  const location = request.object.getLocation();
  if (location.getZ() !== 0 || location.getX() < 2430 || location.getX() > 2450
      || location.getY() < 3080 || location.getY() > 3100) return;
  request.handled = true;
  const origin = request.player.getLocation().clone();
  Ferox.api.sendMultiChatboxPrompt(request.player, 'Return to the Ferox Enclave?',
    'Yes.', player => returnToFerox(player, origin), 'No.', () => {});
}

function teleport(player) {
  Ferox.later(player, 1, () => {
    player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 0);
    player.moveTo(LOBBY.clone());
  });
}

function enter({ player }) {
  const sender = player.getPacketSender();
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Ferox.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, WARNING),
    new ActionDialogue(1, {
      execute: () => {
        sender.sendVarbit(Ferox.BUSY_VARBIT, 1);
        Ferox.api.sendMultiChatboxPrompt(player, "Enter the Castle Wars portal?",
          "Yes.", teleport,
          "No.", () => sender.sendVarbit(Ferox.BUSY_VARBIT, 0));
      },
    }),
  ));
}

module.exports = function attachCastleWarsPortal(api) {
  api.onObjectInteraction("Castle Wars portal", { Enter: enter });
  api.onCustomEvent("door:toggle", useLobbyDoor);
};

Object.assign(module.exports, { enter, teleport, LOBBY, WARNING });
