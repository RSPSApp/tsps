/**
 * Ring of visibility and ring of shadows: wearing one lets the player see into the shadow realm
 * (https://oldschool.runescape.wiki/w/Ring_of_visibility, .../Ring_of_shadows).
 *
 * The cache draws what only the ring shows through varbit `shadow_realm_visibility`
 * (dt2_tertiary bits 30-31): Curse of the Empty Lord's sixteen mysterious ghosts, Desert
 * Treasure's shadow ladder, the shadow scouts and a few more are multinpcs/multilocs on it.
 * Live captures (rsprox 226/01694, 226/01702, 232/03219, 236/03929): putting the ring of visibility
 * on sets it to 1, the ring of shadows to 2, and taking either off sets it to 0. The uncharged ring
 * of shadows is in the cache's own list of rings that show Viggora, so it counts as the ring of
 * shadows here; no capture shows its value.
 */
const VISIBILITY_VARBIT = "shadow_realm_visibility";
let core;

function visibility(player) {
  const { Equipment, ItemIdentifiers: I } = core;
  const ring = Number(player.getEquipment().get(Equipment.RING_SLOT)?.getId?.());
  if (ring === I.RING_OF_VISIBILITY) return 1;
  if (ring === I.RING_OF_SHADOWS || ring === I.RING_OF_SHADOWS_UNCHARGED_) return 2;
  return 0;
}

/** Sends the varbit when it changes; the server's own copy resolves the ghosts' Talk-To. */
function sync({ player }) {
  const id = core.CacheDefinitions.getVarbitId(VISIBILITY_VARBIT);
  if (id == null) return;
  const sender = player.getPacketSender();
  const value = visibility(player);
  if (sender.getVarbit(id) !== value) sender.sendVarbit(id, value);
}

module.exports = {
  name: "RingOfVisibility",
  members: true,
  _test: { visibility, sync },
  register(api) {
    core = api.core;
    api.onCustomEvent("equipment:changed", sync);
    api.onCustomEvent("player:bootstrap-complete", sync);
  },
};
