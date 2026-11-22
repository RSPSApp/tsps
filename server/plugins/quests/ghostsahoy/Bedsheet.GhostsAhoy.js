"use strict";

/**
 * The bedsheet disguise (issue #6497). Worn, the bedsheet turns the player into the cache's
 * "Ghost (?)" NPC, which also gives them its chathead in dialogue, and they can't run.
 *
 * - Wiki (Bedsheet): "The actual NPC that players turn into while wearing the bedsheet is named
 *   "Ghost (?)"." and "Players cannot run while wearing a bedsheet."
 * - Cache: the bedsheets have no worn model, so a plain appearance would show no disguise at all.
 *   ahoy_ghost_disguise (3008) is the brown sheet and ahoy_ghost_disguise_green (3009) the
 *   ectoplasm one (its recolour, 27088, is the green bedsheet's).
 * - rsprox captures, 20261112T092603-5ab63b4 ticks 1503-1504: the player runs up to the Wear,
 *   then walks from that tick on, with option_run (varp 173) left on.
 */

const FORM_ATTRIBUTE = "ghosts-ahoy:bedsheet-form";
const WALK_ONLY_SOURCE = "ghosts-ahoy:bedsheet";

const Npc = Object.freeze({
  GHOST_DISGUISE: 3008, // ahoy_ghost_disguise
  GHOST_DISGUISE_GREEN: 3009, // ahoy_ghost_disguise_green
});

let core;
let forms = new Map();

function headItem(player) {
  return player.getEquipment().getItems()[core.Equipment.HEAD_SLOT]?.getId?.() ?? -1;
}

/** Brings the player's look and gait in line with what they wear on their head. */
function sync({ player }) {
  if (!player?.getEquipment) return;
  const wanted = forms.get(headItem(player)) ?? null;
  const current = player.getAttribute(FORM_ATTRIBUTE) ?? null;
  player.setWalkOnly(WALK_ONLY_SOURCE, wanted != null);
  if (wanted === current) return;
  player.setAttribute(FORM_ATTRIBUTE, wanted);
  // Only undo a transformation this sheet made; another (a ring, a greegree) is its own.
  if (wanted == null && player.getNpcTransformationId() !== current) return;
  player.setNpcTransformationId(wanted ?? -1);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

function attach(registry, shared) {
  core = registry.core;
  forms = new Map([
    [shared.ids.BEDSHEET, Npc.GHOST_DISGUISE],
    [shared.ids.GREEN_BEDSHEET, Npc.GHOST_DISGUISE_GREEN],
  ]);
}

module.exports = {
  attach,
  // Wired in GhostsAhoy.Quest.js's register list.
  sync,
  Npc,
  FORM_ATTRIBUTE,
};
