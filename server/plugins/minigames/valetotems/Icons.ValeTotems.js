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
function sync({ player, npcs }) {
  if (player.isPlayerBot?.() === true) return;
  const previous = shown.get(player);
  const current = new Map();
  for (const npc of npcs) {
    const site = sites.get(npc);
    if (site == null) continue;
    const totem = State.totem(player, site);
    const frame = totem.carved && totem.decay > 0 ? totem.decay - 1 : -1;
    const signature = `${npc.getIndex()}:${frame}`;
    current.set(npc, signature);
    if (previous?.get(npc) === signature) continue;
    player.getPacketSender().sendNpcHeadIconSpecific(npc, 0, frame < 0 ? -1 : archive, frame);
  }
  shown.set(player, current);
}

function leave({ player }) {
  shown.delete(player);
}

function attach(api) {
  api.onServerStartup(start);
  api.onCustomEvent("network:npc-sync", sync);
  api.onPlayerLogout(leave);
}

module.exports = { attach };
