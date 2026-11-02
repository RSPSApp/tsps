// "Empty" on a filled bucket: the bucket comes back empty, as rsprox captures show (op6 on
// inventory:items): bucket_water (recordings 268, 2765) and bucket_sand (268, 375, 1693, 3196)
// play their sound and "You empty the contents of the bucket on the floor."; bucket_compost
// (3030) says "You empty the bucket of compost." with no sound. Jugs and bowls have the option
// too (Wiki) but no capture or Wiki text for their message, so they aren't handled yet.
// Potions and vials empty in Potions.plugin.js.

const BUCKET_FLOOR_MESSAGE = "You empty the contents of the bucket on the floor.";
const BUCKET_WATER_EMPTY_SOUND = 4951;
const BUCKET_SAND_EMPTY_SOUND = 2584;

/** Item name -> what Empty leaves and says. */
const EMPTYABLE_CONTAINERS = [
  { name: "Bucket of water", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_WATER_EMPTY_SOUND },
  { name: "Bucket of sand", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_SAND_EMPTY_SOUND },
  { name: "Compost", empty: "bucket_empty", message: "You empty the bucket of compost." },
];
const CONTAINERS_BY_NAME = new Map(EMPTYABLE_CONTAINERS.map((container) => [container.name, container]));

let core;

function emptyContainer(event) {
  const { player, itemId, slot } = event;
  const name = core.CacheDefinitions.getItem(itemId)?.name;
  const container = CONTAINERS_BY_NAME.get(name);
  const emptyId = container ? core.CacheDefinitions.getObjId(container.empty) : -1;
  const inventory = player.getInventory();
  if (emptyId == null || emptyId < 0 || inventory.getItems()[slot]?.getId() !== itemId) return false;
  inventory.setItem(slot, new core.Item(emptyId, 1)).refreshItems();
  if (container.sound) core.Sounds.sendSound(player, new core.Sound(container.sound, 1, 0, 0));
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, container.message);
  return true;
}

module.exports = {
  name: "EmptyContainers",
  register(api) {
    core = api.core;
    for (const { name } of EMPTYABLE_CONTAINERS) api.onItemAction(name, { Empty: emptyContainer });
  },
};
