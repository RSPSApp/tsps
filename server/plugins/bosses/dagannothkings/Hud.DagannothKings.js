"use strict";

/**
 * The boss HUD for the kings (see ../DagannothKings.plugin.js for behaviour and
 * sources). Captured (submission 89): interface 303 driven per king through varp 1683
 * (the npc) and varbits 6099/6100 (current/maximum) with the fade script 2887.
 * Shown for a king fighting a player, kept current as it takes damage, hidden on its
 * death or when the player leaves the lair.
 */
const Common = require("./Common.DagannothKings");

/** npcId -> players currently shown that king's bar. */
const shown = new Map();

function forKing(npcId) {
  let set = shown.get(npcId);
  if (!set) {
    set = new Set();
    shown.set(npcId, set);
  }
  return set;
}

function values(player, npc) {
  const definition = npc.getCurrentDefinition?.() ?? npc.getDefinition?.();
  const maximum = definition?.getHitpoints?.() ?? 255;
  return { player, npcId: npc.getId(), current: Math.max(0, npc.getHitpoints()), maximum };
}

function show(player, npc) {
  const set = forKing(npc.getId());
  const first = !set.has(player);
  set.add(player);
  if (first) Common.api.emitCustomEvent("boss-hud:show", values(player, npc));
  else Common.api.emitCustomEvent("boss-hud:update", values(player, npc));
}

function hide(player, npcId) {
  if (!forKing(npcId).delete(player)) return;
  Common.api.emitCustomEvent("boss-hud:hide", { player, fade: true });
}

/** A king engaging a player picks up its bar; damage keeps it current. */
function engaged(npc, player) {
  if (!player?.isPlayer?.() || (player.getHitpoints?.() ?? 1) <= 0) return;
  show(player, npc);
}

/** Leaving the lair drops every shown bar at once. */
function hideForLeaver(player) {
  for (const [npcId, set] of [...shown]) {
    if (set.delete(player)) {
      Common.api.emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
    }
    if (set.size === 0) shown.delete(npcId);
  }
}

function died({ npc }) {
  if (!npc || !Common.isKing(npc)) return;
  const set = shown.get(npc.getId());
  if (!set) return;
  shown.delete(npc.getId());
  for (const player of set) {
    try {
      Common.api.emitCustomEvent("boss-hud:hide", { player, fade: true });
    } catch {
      // A logged-out player needs no fade.
    }
  }
}

function attach(api) {
  api.onNpcDeath(died);
}

module.exports = { attach, show, hide, hideForLeaver, engaged, died };
