// Before Pandemonium a shipwright has no boats for the player (Wiki, Transcript:Shipwright Sam and the other
// shipwrights): Talk-to plays "before-completing-pandemonium", and Buy-boat, Customise-boat and Recover-boat play
// "before-completing-pandemonium-buy-boat-customise-boat-or-recover-boat". Junior Jim's conversations stay Pandemonium's.
const { pandemoniumDone } = require("../crew/Common.Crew");
const { content } = require("../SailingContent.Sailing");

const TALK_VARIANT = "before-completing-pandemonium";
const SERVICE_VARIANT = "before-completing-pandemonium-buy-boat-customise-boat-or-recover-boat";
/** The refusal's own message, for a page that has no refusal variant. */
const NOT_YET = "You need to complete the Pandemonium quest to fully access the Sailing skill.";

/** A dock's shipwright (not Junior Jim, not Seb) still waiting on Pandemonium: the name, else undefined. */
function waitingOnPandemonium(player, npc, definition) {
  const name = (definition ?? npc?.getCurrentDefinition?.(player))?.getName?.() ?? "";
  if (!name.startsWith("Shipwright ") || !content().docks.some((dock) => dock.shipwright === name)) return undefined;
  if (pandemoniumDone(player)) return undefined;
  return name;
}

/** Talk-to's variant before Pandemonium; a page without it keeps its default. */
function selectVariant({ player, npc, definition }) {
  return waitingOnPandemonium(player, npc, definition) ? TALK_VARIANT : null;
}

/**
 * A boat-service option handler that refuses before Pandemonium and runs `service` after it. `getApi` returns the
 * plugin api once registered (the handler is built at module load).
 */
function unlessBeforePandemonium(getApi, service) {
  return (event) => {
    const { player, npc, definition } = event;
    const name = waitingOnPandemonium(player, npc, definition);
    if (!name) return service(event);
    const request = { player, npc, npcId: npc?.getId?.(), variant: { page: name, variant: SERVICE_VARIANT }, exact: true, handled: false };
    getApi().emitCustomEvent("npc-dialogue:start", request);
    if (!request.handled) player.sendMessage(NOT_YET);
    return true;
  };
}

module.exports = { selectVariant, unlessBeforePandemonium, waitingOnPandemonium, TALK_VARIANT, SERVICE_VARIANT, NOT_YET };
