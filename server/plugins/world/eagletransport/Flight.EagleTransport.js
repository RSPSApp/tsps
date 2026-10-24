/**
 * The flights (Wiki: Eagle_transport_system): a rope lassoed round a giant eagle's neck - its
 * Quick-travel option, or a rope used on it. The network is a hub: the three eagles in the Eagles'
 * Peak eyrie fly out to the desert (Uzer), jungle (Feldip) and polar (Rellekka) eyries, and the
 * eagles there only fly back to the Peak. Eagles' Peak must be complete, and a rope carried; the
 * rope is kept.
 *
 * The far eyries' own eagles (1491-1493) are multinpcs the cache shows only at an eaglepeak_quest
 * value the Eagles' Peak plugin never sends, so a player who has done the quest gets their own
 * Quick-travel eagles there (owner-only, the Peak's ids) while they are in the eyrie.
 */
const Common = require("./Common.EagleTransport");

/** player -> the owned eagles shown in the eyrie they are in. */
const ownedEagles = new Map();

/** Where this eagle flies to: the Peak from a far eyrie, its eyrie from the Peak. Null if neither. */
function destination(npc) {
  const { ids, data } = Common;
  const spawned = npc.getId?.();
  if (npc.__eagleHome || Object.values(data.eyries).some((eyrie) => ids.npcs[eyrie.eagle] === spawned)) return data.peak.arrive;
  if (!Common.inBox(npc.getLocation(), data.peak.box)) return null;
  const outbound = Object.values(data.eyries).find((eyrie) => ids.npcs[eyrie.peakEagle] === spawned);
  return outbound ? outbound.arrive : null;
}

function fly(player, npc) {
  const to = destination(npc);
  if (!to) return false;
  if (player.__eagleTravelling) return true;
  if (!Common.questComplete(player)) {
    Common.box(player, Common.message("questIncomplete"));
    return true;
  }
  if (!player.getInventory().contains(Common.ids.objs.rope)) {
    player.sendMessage(Common.message("noRope"));
    return true;
  }
  player.setPositionToFace?.(npc.getLocation());
  player.performAnimation(new Common.core.Animation(Common.ids.seqs.lasso));
  player.sendMessage(Common.message("lasso"));
  Common.travel(player, to, Common.data.flightTicks);
  return true;
}

function quickTravel({ player, npc }) {
  return fly(player, npc);
}

function ropeOnEagle(event) {
  if (event.itemId !== Common.ids.objs.rope || !event.target) return;
  if (destination(event.target)) {
    event.handled = true;
    fly(event.player, event.target);
  }
}

// --- The far eyries' eagles for a player who has done the quest

function removeEagles(player) {
  for (const npc of ownedEagles.get(player) ?? []) Common.api.removeNpc(npc);
  ownedEagles.delete(player);
}

function showEagles(player, key) {
  removeEagles(player);
  if (!Common.questComplete(player)) return;
  const eyrie = Common.data.eyries[key];
  const id = Common.ids.npcs[eyrie.peakEagle];
  const [, , , , z] = eyrie.box;
  const npcs = [];
  for (const [x, y] of eyrie.eagles) {
    const npc = Common.api.spawnNpc({ id, x, y, z: z ?? 0, wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc) continue;
    npc.__skipDefaultRespawn = true;
    npc.__eagleHome = key;
    npcs.push(npc);
  }
  ownedEagles.set(player, npcs);
}

const zoneOf = ([minX, maxX, minY, maxY, z]) => ({ minX, maxX, minY, maxY, levels: [z ?? 0] });

function attach(api) {
  for (const name of ["Desert eagle", "Jungle eagle", "Polar eagle"]) api.onNpcInteraction(name, { "Quick-travel": quickTravel });
  api.onItemOnNpc(ropeOnEagle);
  for (const [key, eyrie] of Object.entries(Common.data.eyries)) {
    const zone = zoneOf(eyrie.box);
    api.onZoneEnter(zone, ({ player }) => showEagles(player, key));
    api.onZoneExit(zone, ({ player }) => removeEagles(player));
  }
  api.onPlayerLogout(({ player }) => removeEagles(player));
}

module.exports = { attach, destination, fly, ropeOnEagle, showEagles, removeEagles, ownedEagles };
