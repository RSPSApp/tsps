/**
 * The Desert Treasure II ancient rings refuse to be worn until the player has killed the boss
 * whose vestige they are made from (https://oldschool.runescape.wiki/w/Ultor_ring,
 * .../Bellator_ring, .../Magus_ring, .../Venator_ring): Ultor from Vardorvis, Bellator from the
 * Whisperer, Magus from Duke Sucellus and Venator from the Leviathan. A player without the kill
 * keeps the ring in their inventory and gets one message. Full Desert Treasure II completion is
 * not needed. See docs/ancient-rings.md.
 */
const SLIPS_OFF_MESSAGE = "The ring slips off your finger. The power within it seems unfamiliar.";

let pluginApi;
let monsterByRing = null;

/** Ring item id -> the Combat Achievements monster whose kill unlocks it. */
function requirements() {
  if (monsterByRing) return monsterByRing;
  const { ItemIdentifiers: I } = pluginApi.core;
  monsterByRing = new Map([
    [I.ULTOR_RING, "Vardorvis"],
    [I.BELLATOR_RING, "Whisperer, The"],
    [I.MAGUS_RING, "Duke Sucellus"],
    [I.VENATOR_RING, "Leviathan, The"],
  ]);
  return monsterByRing;
}

function killedBoss(player, monster) {
  const request = { player, monster, total: 0 };
  pluginApi.emitCustomEvent("combat-achievements:count", request);
  return Number(request.total) > 0;
}

function canWearRing(event) {
  const monster = requirements().get(event.item.getId());
  if (!monster || event.player.isPlayerBot?.()) return;
  if (killedBoss(event.player, monster)) return;
  event.allow = false;
  event.player.sendMessage(SLIPS_OFF_MESSAGE);
}

module.exports = {
  name: "AncientRings",
  members: true,
  _test: { canWearRing, requirements },
  register(api) {
    pluginApi = api;
    api.onCanEquip(canWearRing);
  },
};
