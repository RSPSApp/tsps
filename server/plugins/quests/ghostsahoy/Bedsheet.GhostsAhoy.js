"use strict";

/**
 * The bedsheet disguise (issue #6497). Worn in Port Phasmatys, the bedsheet turns the player into
 * the cache's "Ghost (?)" NPC, which also gives them its chathead in dialogue, and they can't run.
 *
 * - Wiki (Bedsheet): "The actual NPC that players turn into while wearing the bedsheet is named
 *   "Ghost (?)"."; "Players cannot run while wearing a bedsheet."; it "is not wearable in any
 *   other place than Port Phasmatys", with the message "I'll only wear the bedsheet inside Port
 *   Phasmatys."
 * - Cache: the bedsheets have no worn model, so a plain appearance would show no disguise at all.
 *   ahoy_ghost_disguise (3008) is the brown sheet and ahoy_ghost_disguise_green (3009) the
 *   ectoplasm one (its recolour, 27088, is the green bedsheet's).
 * - rsprox captures, 20261112T092603-5ab63b4 ticks 1503-1504: the player runs up to the Wear,
 *   then walks from that tick on, with option_run (varp 173) left on.
 *
 * Ours: a sheet already worn when the player leaves the town (a teleport; the barriers refuse it)
 * stays worn but the disguise drops until they are back, so it never hides gear elsewhere.
 */

const FORM_ATTRIBUTE = "ghosts-ahoy:bedsheet-form";
const WALK_ONLY_SOURCE = "ghosts-ahoy:bedsheet";
const OUTSIDE_MESSAGE = "I'll only wear the bedsheet inside Port Phasmatys.";

const Npc = Object.freeze({
  GHOST_DISGUISE: 3008, // ahoy_ghost_disguise
  GHOST_DISGUISE_GREEN: 3009, // ahoy_ghost_disguise_green
});

/**
 * Port Phasmatys inside its walls. Ours: bounded by the two barriers' lines (the west barrier at
 * 3652,3485 and the temple barrier at 3659,3508), out to the sea east and south.
 */
const TOWN = Object.freeze({ minX: 3653, maxX: 3725, minY: 3450, maxY: 3507, levels: [0, 1, 2, 3] });

let core;
let forms = new Map();

function headItem(player) {
  return player.getEquipment().getItems()[core.Equipment.HEAD_SLOT]?.getId?.() ?? -1;
}

function inTown(location) {
  const x = location.getX();
  const y = location.getY();
  return x >= TOWN.minX && x <= TOWN.maxX && y >= TOWN.minY && y <= TOWN.maxY;
}

/** Brings the player's look and gait in line with what they wear on their head and where. */
function sync({ player }) {
  if (!player?.getEquipment) return;
  const worn = forms.get(headItem(player)) ?? null;
  player.setWalkOnly(WALK_ONLY_SOURCE, worn != null);
  const current = player.getAttribute(FORM_ATTRIBUTE) ?? null;
  const transformation = player.getNpcTransformationId();
  // Another transformation (a ring, a greegree) is its own: the sheet neither replaces nor undoes it.
  if (current == null && transformation >= 0) return;
  if (current != null && transformation !== current) {
    player.setAttribute(FORM_ATTRIBUTE, null);
    return;
  }
  const wanted = worn != null && inTown(player.getLocation()) ? worn : null;
  if (wanted === current) return;
  player.setAttribute(FORM_ATTRIBUTE, wanted);
  player.setNpcTransformationId(wanted ?? -1);
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

/** Wiki (Bedsheet): only worn inside Port Phasmatys. */
function canWear(event) {
  const { player, item } = event;
  if (!forms.has(item?.getId?.())) return;
  if (inTown(player.getLocation())) return;
  event.allow = false;
  player.sendMessage(OUTSIDE_MESSAGE);
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
  canWear,
  TOWN,
  Npc,
  FORM_ATTRIBUTE,
  OUTSIDE_MESSAGE,
};
