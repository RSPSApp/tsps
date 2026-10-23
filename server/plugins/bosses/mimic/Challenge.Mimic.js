"use strict";

/**
 * Waking the Mimic (see ../Mimic.plugin.js for behaviour and sources).
 *
 * The casket form (7979, "Challenge") transforms into the attackable Mimic (8633) and
 * attacks the challenger. Only the challenger's own casket answers: anything else
 * named "The Mimic" (the surfaced boss) falls through.
 */

const Shared = require("./Shared.Mimic");
const Lair = require("./Lair.Mimic");

function challenge({ player, npc }) {
  if (!npc || npc.getId?.() !== Shared.ids().CHALLENGE) return false;
  if (!Shared.alive(npc) || !Shared.alive(player)) return false;
  const area = player.getPrivateArea?.() ?? player.getArea?.();
  const session = area ? Lair.sessionOf(area) : null;
  if (!session || session.casket !== npc) return false;
  if (session.owner && session.owner !== player && session.owner !== player.getAsPlayer?.()) return false;
  const { BOSS } = Shared.ids();
  // No rise animation: none is known for this transform (npc-animations.json has no
  // 7979 entry and Near-Reality transforms silently), so the casket just wakes.
  npc.setNpcTransformationId(BOSS);
  session.boss = npc;
  // Retain the entered casket's attempts even if another Mimic is now carried.
  try {
    Shared.ensureRolls(player, session.casketId);
  } catch {
    // Rolls default fresh at open; the fight never depends on them.
  }
  // Walk into melee while attacking from range (ToA Akkha's flag): without it
  // combat resets the movement queue every tick and the boss never moves.
  try {
    npc.setFlag?.("combat:close-in");
  } catch {
    // Walks only if the flag sticks; the swings below still all resolve.
  }
  try {
    npc.getCombat?.().attack?.(player);
  } catch {
    // Attack best-eff: the wake itself is what matters.
  }
  return true;
}

function attach(api) {
  api.onNpcInteraction("The Mimic", { Challenge: challenge });
}

module.exports = { attach, challenge };
