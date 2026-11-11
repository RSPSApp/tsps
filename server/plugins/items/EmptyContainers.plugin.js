// "Empty" on a filled bucket, pot, jug, bowl or plant cure vial: the container comes back empty in its slot, as
// rsprox captures show (op6 on inventory:items, spam line, tick 0):
// - "You empty the contents of the bucket on the floor.": bucket_water (recordings 268, 2765) and bucket_sand (268,
//   375, 1693, 3196) with their own sounds; bucket_milk (3179, 1098) and bucket_ectoplasm, the Bucket of slime (377),
//   with sound 2401.
// - "You empty the contents of the pot/jug/bowl/vial on the floor.": pot_flour (3181) with sound 2584; jug_water,
//   bowl_water and plant_cure (20261111T230428, ticks 12, 168, 17) with sound 2401.
// - "You empty the bucket of compost/supercompost/ultracompost.", no sound: bucket_compost (3030), bucket_supercompost
//   and bucket_ultracompost (20261111T230428, ticks 172, 175).
// - Pot of cornflour (chickenquest_pot_cornflour) asks first: chatmenu "Are you sure you want to empty that pot?"
//   Yes|No. No closes it; Yes closes it, sends "You empty the contents of the pot on the floor." as a game message
//   with no sound, and the empty pot goes to the first free slot (20261111T230428, ticks 156-164).
// Potions and other vials empty in Potions.plugin.js; sacks and baskets in farming/Services.Farming.js.

const BUCKET_FLOOR_MESSAGE = "You empty the contents of the bucket on the floor.";
const POT_FLOOR_MESSAGE = "You empty the contents of the pot on the floor.";
const BUCKET_WATER_EMPTY_SOUND = 4951;
const BUCKET_SAND_EMPTY_SOUND = 2584;
const LIQUID_EMPTY_SOUND = 2401; // synth "liquid": milk, slime, jug, bowl and vial
const POT_FLOUR_EMPTY_SOUND = 2584;
const CORNFLOUR_CONFIRM_TITLE = "Are you sure you want to empty that pot?";

/** Item name -> what Empty leaves and says. */
const EMPTYABLE_CONTAINERS = [
  { name: "Bucket of water", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_WATER_EMPTY_SOUND },
  { name: "Bucket of sand", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: BUCKET_SAND_EMPTY_SOUND },
  { name: "Bucket of milk", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: LIQUID_EMPTY_SOUND },
  { name: "Bucket of slime", empty: "bucket_empty", message: BUCKET_FLOOR_MESSAGE, sound: LIQUID_EMPTY_SOUND },
  { name: "Compost", empty: "bucket_empty", message: "You empty the bucket of compost." },
  { name: "Supercompost", empty: "bucket_empty", message: "You empty the bucket of supercompost." },
  { name: "Ultracompost", empty: "bucket_empty", message: "You empty the bucket of ultracompost." },
  { name: "Pot of flour", empty: "pot_empty", message: POT_FLOOR_MESSAGE, sound: POT_FLOUR_EMPTY_SOUND },
  { name: "Jug of water", empty: "jug_empty", message: "You empty the contents of the jug on the floor.", sound: LIQUID_EMPTY_SOUND },
  { name: "Bowl of water", empty: "bowl_empty", message: "You empty the contents of the bowl on the floor.", sound: LIQUID_EMPTY_SOUND },
  { name: "Plant cure", empty: "vial_empty", message: "You empty the contents of the vial on the floor.", sound: LIQUID_EMPTY_SOUND },
];
const CONTAINERS_BY_NAME = new Map(EMPTYABLE_CONTAINERS.map((container) => [container.name, container]));

let api;
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

/** Pot of cornflour: Yes|No first; Yes takes the pot and puts an empty one in the first free slot. */
function emptyCornflour(event) {
  const { player, itemId } = event;
  api.sendMultiChatboxPrompt(player, CORNFLOUR_CONFIRM_TITLE, "Yes", () => confirmEmptyCornflour(player, itemId), "No", () => {});
  return true;
}

function confirmEmptyCornflour(player, itemId) {
  const inventory = player.getInventory();
  const potId = core.CacheDefinitions.getObjId("pot_empty");
  if (potId == null || potId < 0 || inventory.getAmount(itemId) <= 0) return;
  inventory.deleteNumber(itemId, 1);
  inventory.addItem(new core.Item(potId, 1));
  player.sendMessage(POT_FLOOR_MESSAGE);
}

module.exports = {
  name: "EmptyContainers",
  description: "Empty option on filled buckets, pots, jugs, bowls and plant cure: leaves the empty container and sends the captured message and sound.",
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    for (const { name } of EMPTYABLE_CONTAINERS) pluginApi.onItemAction(name, { Empty: emptyContainer });
    pluginApi.onItemAction("Pot of cornflour", { Empty: emptyCornflour });
  },
};
