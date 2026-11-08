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
  const byBoss = [
    ["Vardorvis", ["ULTOR_RING", "ULTOR_RING_2", "ULTOR_RING_3", "ULTOR_RING_4", "ULTOR_RING_5", "ULTOR_RING_6"]],
    ["Whisperer, The", ["BELLATOR_RING", "BELLATOR_RING_2", "BELLATOR_RING_3", "BELLATOR_RING_4"]],
    ["Duke Sucellus", ["MAGUS_RING", "MAGUS_RING_2", "MAGUS_RING_3", "MAGUS_RING_4", "MAGUS_RING_5", "MAGUS_RING_6"]],
    ["Leviathan, The", ["VENATOR_RING", "VENATOR_RING_2", "VENATOR_RING_3", "VENATOR_RING_4"]],
  ];
  monsterByRing = new Map();
  for (const [monster, names] of byBoss) {
    for (const name of names) if (I[name] !== undefined) monsterByRing.set(I[name], monster);
  }
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
  description: "Stops the Ultor, Bellator, Magus and Venator rings being worn until the player has killed the matching Desert Treasure II boss.",
  members: true,
  _test: { canWearRing, requirements },
  register(api) {
    pluginApi = api;
    api.onCanEquip(canWearRing);
  },
};
