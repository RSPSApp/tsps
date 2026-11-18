"use strict";

/**
 * The boss HUD for the Echo kings only (Leagues, Echo.DagannothKings). Captured
 * (rsprox.net 89, rev 227, a Leagues V Echo fight): interface 303 driven per king through varp
 * 1683 (the npc) and varbits 6099/6100 (current/maximum) with the fade script 2887, opened on
 * Supreme as the player answers Yes, then following the king being fought. Normal kings have no
 * boss HUD: rsprox.net 1856 (rev 227) and 3433 (rev 235), 252 normal king spawns, never set
 * varp 1683 or boss mode (12401). The cache's HUD name for the normal kings (npc param 510)
 * is "Dagannoth Kings (Echo)".
 * Kept current as a king takes damage, hidden on its death or when the player leaves the lair.
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
  // An Echo king's own maximum (1,800, live's 6100 in submission 89), not its definition's.
  const maximum = npc.getMaxHitpoints?.() ?? definition?.getHitpoints?.() ?? 255;
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

/** An Echo king engaging a player picks up its bar; damage keeps it current. Normal kings have none. */
function engaged(npc, player) {
  if (!npc?.__echoKings || !player?.isPlayer?.() || (player.getHitpoints?.() ?? 1) <= 0) return;
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
  for (const player of set) {
    if ((player.getPrivateArea?.() ?? null) !== (npc.getPrivateArea?.() ?? null)) continue;
    set.delete(player);
    try {
      Common.api.emitCustomEvent("boss-hud:hide", { player, fade: true });
    } catch {
      // A logged-out player needs no fade.
    }
  }
  if (!set.size) shown.delete(npc.getId());
}

function attach(api) {
  api.onNpcDeath(died);
}

module.exports = { attach, show, hide, hideForLeaver, engaged, died };
