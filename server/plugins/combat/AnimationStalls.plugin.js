/**
 * Animation stall exceptions (https://oldschool.runescape.wiki/w/Animation_stall).
 *
 * Core measures how long a swing animation stays on screen from the seq config. Every measured
 * swing starts as a partial stall: the client may withhold the actor's steps while it plays,
 * but the server keeps walking the true tile and the client rubber-bands when it ends.
 *
 * This plugin is only the layer for a *live-verified full stall* the seq config cannot express
 * (movement, input and incoming hits held). The Wiki's own list is explicitly not exhaustive,
 * but it also does not distinguish full from partial stalls, so a row needs evidence beyond the
 * list. Rows live in data/animation-stalls.json, keyed by animation id or by wielded weapon id;
 * there are no current rows.
 *
 * Not `members: true`: this tunes a mechanic rather than adding content, and any members row is
 * unreachable on a free-to-play world anyway.
 */
const STALLS = require("./data/animation-stalls.json");

let core = null;

/** The row that governs this swing: the animation's own, else the wielded weapon's. */
function stallRow(event) {
  const byAnimation = STALLS.animations[event.animationId];
  if (byAnimation) return byAnimation;
  const weaponId = event.player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId?.();
  return STALLS.weapons[weaponId] ?? null;
}

function applyStallDefinition(event) {
  const row = stallRow(event);
  if (row === null) return;
  if (row.kind) event.kind = row.kind;
  if (Number.isInteger(row.ticks)) event.ticks = row.ticks;
  if (typeof row.holdsHits === "boolean") event.holdsHits = row.holdsHits;
}

module.exports = {
  name: "AnimationStalls",
  register(api) {
    core = api.core;
    api.onAnimationStall(applyStallDefinition);
  },
};
