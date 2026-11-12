"use strict";

/**
 * Murphy on the trawler at sea (Wiki transcript: "standard dialogue when at sea"): "I've had
 * enough, take me back." -> "I insist Murphy, take me back." makes him turn the ship sharply
 * and it is wrecked ("Save yourself! We're going down!"). That is the crew's way to bail out,
 * so the sea copy of Murphy answers with it while a trip is under way, and its wreck action
 * sinks the trawler for everyone aboard, exactly as the water reaching the top does.
 */

const Shared = require("./Shared.FishingTrawler");
const Sea = require("./Sea.FishingTrawler");

const PAGE = "Murphy";
const AT_SEA_VARIANT = "standard-dialogue-when-at-sea";
/** "(The fishing trawler is wrecked at sea.)" in that variant. */
const WRECK_ACTION_ID = "nqzBKN";

function seaMurphyId() {
  return Shared.core().NpcIdentifiers.MURPHY_2; // 5608, spawned on the trawler copy
}

function aboard(player) {
  const voyage = Sea.sea.voyage;
  return !!voyage && !voyage.ended && voyage.crewList().includes(player)
    && Shared.inBounds(Shared.DATA.boat.bounds, player.getLocation());
}

function selectVariant({ npcId, player }) {
  if (npcId !== seaMurphyId() || !aboard(player)) return null;
  return { page: PAGE, variant: AT_SEA_VARIANT };
}

function wreck(event) {
  if (event.stepId !== WRECK_ACTION_ID || event.npcId !== seaMurphyId() || !aboard(event.player)) return;
  // The sea loop moves the whole crew into the wreck next tick, with the usual sinking messages.
  Sea.sea.voyage.end("sunk");
}

function attachMurphy(api) {
  Shared.bind(api);
  api.onNpcDialogueVariant(selectVariant);
  api.onCustomEvent("npc-dialogue:action", wreck);
}

module.exports = { attachMurphy, selectVariant, wreck };
