"use strict";

const Shared = require("./Shared.ValeTotems");
const State = require("./State.ValeTotems");
const sites = new Map();
const shown = new WeakMap();
let archive;

function start() {
  archive = Shared.core().CacheDefinitions.getSpriteId("headicons_et");
  if (archive == null) throw new Error("ValeTotems: missing durability head icons");
  for (const { site, x, y } of Shared.DATA.sites) {
    const npc = Shared.api().spawnNpc({ id: Shared.npc("ent_totems_site_icon"), x, y, z: 0, wanderRadius: 0 });
    if (npc) sites.set(npc, site);
  }
}

/**
 * RSProx234/03276: slot0 uses headicons_et frame durability-1, and clears on collapse.
 * Native customization dies with local NPC removal. Re-send from saved varps on entry,
 * after NPC info registered the invisible site actor, rather than persisting an override.
 */
function frameOf(player, site) {
  const totem = State.totem(player, site);
  return totem.carved && totem.decay > 0 ? totem.decay - 1 : -1;
}

/** Send the leaf if it differs from what this player was last sent; record what is now shown. */
function show(player, npc, site, shownNow) {
  const frame = frameOf(player, site);
  const signature = `${npc.getIndex()}:${frame}`;
  if (shownNow.get(npc) !== signature) {
    player.getPacketSender().sendNpcHeadIconSpecific(npc, 0, frame < 0 ? -1 : archive, frame);
  }
  shownNow.set(npc, signature);
}

function sync({ player, npcs }) {
  if (player.isPlayerBot?.() === true) return;
  const previous = shown.get(player);
  const current = new Map();
  for (const npc of npcs) {
    const site = sites.get(npc);
    if (site == null) continue;
    if (previous?.has(npc)) current.set(npc, previous.get(npc));
    show(player, npc, site, current);
  }
  shown.set(player, current);
}

/**
 * Visit and collapse change a leaf during the tick, before the flush takes the queued effects,
 * so queue the change now (RSProx234/03276 sends the decay varbit and the leaf in the same
 * tick). Only sites this player was already sent are touched; a site that is out of view, or
 * not yet synced, is left to sync(), which sends it on entry. Carve stays on sync(): it arrives
 * one tick after its varbit.
 */
function refresh(player) {
  const current = shown.get(player);
  if (current == null) return;
  for (const npc of player.getLocalNpcs()) {
    const site = sites.get(npc);
    if (site != null && current.has(npc)) show(player, npc, site, current);
  }
}

function leave({ player }) {
  shown.delete(player);
}

function attach(api) {
  api.onServerStartup(start);
  api.onCustomEvent("network:npc-sync", sync);
  api.onPlayerLogout(leave);
}

module.exports = { attach, refresh };
