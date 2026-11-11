// "Empty" on a filled bucket, pot or jug: the container comes back empty, as rsprox captures show (op6 on
// inventory:items): bucket_water (recordings 268, 2765) and bucket_sand (268, 375, 1693, 3196) play their sound and
// "You empty the contents of the bucket on the floor."; bucket_milk (3179, 1098) and bucket_ectoplasm, the Bucket
// of slime (377), say the same with sound 2401; bucket_compost (3030) says "You empty the bucket of compost." with
// no sound; pot_flour (3181) says "You empty the contents of the pot on the floor." with sound 2584.
// Ours: Jug of water has the option (Wiki) but no capture or Wiki text; it takes the floor line the captured buckets
// and pot share, for a jug, with no sound.
// Potions, vials and plant cure empty in Potions.plugin.js; sacks and baskets in farming/Services.Farming.js.

const BUCKET_FLOOR_MESSAGE = "You empty the contents of the bucket on the floor.";
const BUCKET_WATER_EMPTY_SOUND = 4951;
const BUCKET_SAND_EMPTY_SOUND = 2584;
const BUCKET_MILK_EMPTY_SOUND = 2401; // bucket_milk and bucket_ectoplasm
const POT_FLOUR_EMPTY_SOUND = 2584;

/** Item name -> what Empty leaves and says. */
const EMPTYABLE_CONTAINERS = [
  { name: "Bucket of water", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_WATER_EMPTY_SOUND },
  { name: "Bucket of sand", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_SAND_EMPTY_SOUND },
  { name: "Bucket of milk", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_MILK_EMPTY_SOUND },
  { name: "Bucket of slime", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_MILK_EMPTY_SOUND },
  { name: "Compost", empty: "bucket_empty", message: "You empty the bucket of compost." },
  { name: "Pot of flour", empty: "pot_empty", message: "You empty the contents of the pot on the floor.", sound: POT_FLOUR_EMPTY_SOUND },
  { name: "Jug of water", empty: "jug_empty", message: "You empty the contents of the jug on the floor." },
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
  // The empty container keeps the full one's meta: a preset bucket (PvP presets) stays a preset copy.
  const meta = inventory.getItems()[slot].getMeta?.();
  inventory.setItem(slot, new core.Item(emptyId, 1, meta ? JSON.parse(JSON.stringify(meta)) : undefined)).refreshItems();
  if (container.sound) core.Sounds.sendSound(player, new core.Sound(container.sound, 1, 0, 0));
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, container.message);
  return true;
}

module.exports = {
  name: "EmptyContainers",
  description: "Empty option on filled buckets, pots of flour and jugs of water: leaves the empty container and sends the captured message and sound.",
  register(api) {
    core = api.core;
    for (const { name } of EMPTYABLE_CONTAINERS) api.onItemAction(name, { Empty: emptyContainer });
  },
};
