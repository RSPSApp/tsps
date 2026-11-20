"use strict";

/**
 * Ver Sinhaza's residents on Talk-to: which transcript variant each one plays. The generic
 * NpcDialogues picker takes a page's first "standard" variant, which here is the wrong one: the
 * citizens' is Meiyerditch's (an "unavailable" marker, so Talk-to said "That conversation isn't
 * available right now."), and the inner gate guard got the outside guard's lines.
 *
 * Transcripts (npc-dialogues.json, Wiki):
 * - Meiyerditch citizen (tob_citizen_1-4): "Theatre of Blood", "after The Blood Moon Rises,
 *   Theatre of Blood" and "If the player is wearing vyre noble clothing".
 * - Vyrelord/Vyrelady (tob_noble_1-4): "If the player is not disguised" and "If the player is
 *   disguised, or if the player has completed The Blood Moon Rises".
 * - Vampyre Juvenile: tob_door_guard outside Ver Sinhaza, tob_door_guard_inner inside.
 *
 * rsprox captures: the citizens' Theatre lines (local 1000270-1000318, rev 227), the inner
 * guard's "Can I go through here?" (409, 4266), both Vyrelord variants (409 and locals).
 *
 * Ours: the Wiki names no pieces for "disguised"; here it is a vyre noble piece in each of the
 * body, legs and feet slots (Vyre noble clothing: "a full set of three"). The citizens use the
 * same check, and the clothing line wins over the after-quest one (the Wiki gives no order).
 */

const QUEST_KEY = "the_blood_moon_rises";
const VYRE_NOBLE = /^vyre noble /i;
const UNSCENTED = /\(unscented\)/i;

const CITIZEN = {
  standard: "standard-dialogue-theatre-of-blood",
  afterQuest: "standard-dialogue-after-the-blood-moon-rises-theatre-of-blood",
  disguised: "if-the-player-is-wearing-vyre-noble-clothing",
};
const NOBLE = {
  standard: "standard-dialogue-if-the-player-is-not-disguised",
  disguised: "standard-dialogue-if-the-player-is-disguised-or-if-the-player-has-completed-the-blood-moon-rises",
};
const GUARD = {
  outside: "standard-dialogue-outside-ver-sinhaza",
  inside: "standard-dialogue-inside-ver-sinhaza",
};

/** Resident gamevals by kind; resolved to cache ids once the cache is up. */
const RESIDENTS = {
  citizen: ["tob_citizen_1", "tob_citizen_2", "tob_citizen_3", "tob_citizen_4"],
  noble: ["tob_noble_1", "tob_noble_2", "tob_noble_3", "tob_noble_4"],
  outsideGuard: ["tob_door_guard"],
  insideGuard: ["tob_door_guard_inner"],
};

let api;
let kindById;

function kindOf(npcId) {
  if (!kindById) {
    const cache = api.core.CacheDefinitions;
    kindById = new Map();
    for (const [kind, gamevals] of Object.entries(RESIDENTS)) {
      for (const gameval of gamevals) kindById.set(cache.getNpcId(gameval), kind);
    }
  }
  return kindById.get(npcId);
}

function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function isVyreNoble(item) {
  const id = item?.getId?.() ?? -1;
  if (id < 0) return false;
  const name = api.core.ItemDefinition.forId(id)?.getName?.() ?? "";
  return VYRE_NOBLE.test(name) && !UNSCENTED.test(name);
}

/** A vyre noble piece in the body, legs and feet slots (Ours: see the header). */
function isDisguised(player) {
  const { Equipment } = api.core;
  const equipment = player.getEquipment?.();
  if (!equipment) return false;
  return [Equipment.BODY_SLOT, Equipment.LEG_SLOT, Equipment.FEET_SLOT]
    .every((slot) => isVyreNoble(equipment.get(slot)));
}

function residentVariant({ player, npc, npcId }) {
  // The citizens are multinpcs: the click resolves to their transform, the base id is the npc's.
  const kind = kindOf(npc?.getId?.() ?? npcId) ?? kindOf(npcId);
  if (!kind || !player) return undefined;
  switch (kind) {
    case "citizen":
      if (isDisguised(player)) return CITIZEN.disguised;
      return questComplete(player) ? CITIZEN.afterQuest : CITIZEN.standard;
    case "noble":
      return isDisguised(player) || questComplete(player) ? NOBLE.disguised : NOBLE.standard;
    case "outsideGuard":
      return GUARD.outside;
    case "insideGuard":
      return GUARD.inside;
    default:
      return undefined;
  }
}

module.exports = function registerTheatreResidents(pluginApi) {
  api = pluginApi;
  api.onNpcDialogueVariant(residentVariant);
};

Object.assign(module.exports, { residentVariant, isDisguised, RESIDENTS });
