/**
 * The flights (Wiki: Eagle_transport_system): a rope lassoed round a giant eagle's neck - its
 * Quick-travel option, or a rope used on it. The network is a hub: the three eagles in the Eagles'
 * Peak eyrie fly out to the desert (Uzer), jungle (Feldip) and polar (Rellekka) eyries, and the
 * eagles there only fly back to the Peak. Eagles' Peak must be complete, and a rope carried; the
 * rope is kept.
 *
 * The far eyries' own eagles (1491-1493) are multinpcs the cache shows at eaglepeak_quest 40, which
 * the Eagles' Peak plugin sends on completion, so their spawns are the Quick-travel eagles there.
 * Without a rope the eagle refuses first, as live does at stage 20 (Eagles' Peak capture t1972).
 */
const Common = require("./Common.EagleTransport");

/** Where this eagle flies to: the Peak from a far eyrie, its eyrie from the Peak. Null if neither. */
function destination(npc) {
  const { ids, data } = Common;
  const spawned = npc.getId?.();
  if (npc.__eagleHome || Object.values(data.eyries).some((eyrie) => ids.npcs[eyrie.eagle] === spawned)) return data.peak.arrive;
  if (!Common.inBox(npc.getLocation(), data.peak.box)) return null;
  const outbound = Object.values(data.eyries).find((eyrie) => ids.npcs[eyrie.peakEagle] === spawned);
  return outbound ? outbound.arrive : null;
}

/** The eyrie a flight reaches: "peak" for a far eyrie's eagle, else its own key. */
function destinationEyrie(npc) {
  if (npc.__eagleHome) return "peak";
  const spawned = npc.getId?.();
  if (Object.values(Common.data.eyries).some((eyrie) => Common.ids.npcs[eyrie.eagle] === spawned)) return "peak";
  if (!Common.inBox(npc.getLocation(), Common.data.peak.box)) return null;
  const outbound = Object.entries(Common.data.eyries)
    .find(([, eyrie]) => Common.ids.npcs[eyrie.peakEagle] === spawned);
  return outbound ? outbound[0] : null;
}

function fly(player, npc) {
  const to = destination(npc);
  if (!to) return false;
  if (player.__eagleTravelling) return true;
  if (!player.getInventory().contains(Common.ids.objs.rope)) {
    player.sendMessage(Common.message("noRope"));
    return true;
  }
  if (!Common.questComplete(player)) {
    Common.box(player, Common.message("questIncomplete"));
    return true;
  }
  const eyrie = destinationEyrie(npc);
  player.setPositionToFace?.(npc.getLocation());
  player.performAnimation(new Common.core.Animation(Common.ids.seqs.lasso));
  player.sendMessage(Common.message("lasso"));
  const desert = Common.data.eyries.desert.arrive;
  const toDesert = to[0] === desert[0] && to[1] === desert[1] && to[2] === desert[2];
  Common.travel(player, to, Common.data.flightTicks, () => {
    Common.api.emitCustomEvent("eagle-transport:arrived", { player, eyrie, to });
    if (toDesert) Common.api.emitCustomEvent("diary:task", { player, diary: "desert", task: "travel-to-the-desert-via-eagle" });
  });
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

function attach(api) {
  for (const name of ["Desert eagle", "Jungle eagle", "Polar eagle"]) api.onNpcInteraction(name, { "Quick-travel": quickTravel });
  api.onItemOnNpc(ropeOnEagle);
}

module.exports = { attach, destination, fly, ropeOnEagle };
