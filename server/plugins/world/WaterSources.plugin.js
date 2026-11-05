/**
 * Filling empty containers at water sources (https://oldschool.runescape.wiki/w/Water_source).
 *
 * Using a Jug, Vial, Bucket, Bowl, Empty cup, Empty fishbowl or a waterskin that isn't full on a
 * fountain, sink, well, pump, tap or water barrel fills one container per tick until none are
 * left (rsprox captures 1692, 1693, 3159, 4288). Every fill plays human_pickuptable and synth
 * 2609 (2615 at a well); only the first sends the message, "You fill the vial from the
 * fountain.", or just "You fill the jug." at a pump. No capture has a waterskin: it is filled
 * the same way.
 *
 * It lives in plugins/world so it loads after the quest and minigame plugins: their own
 * handlers for one particular source (Taste of Hope's dry fountain, The Mess's sink,
 * Fremennik Trials' tap) run first and keep the click when they take it.
 */

const FILL_ANIMATION = 832; // human_pickuptable
const FILL_SOUND = 2609;
const WELL_FILL_SOUND = 2615;

// Loc name (lowercase) -> the words after "You fill the <container>"; null is a pump's bare
// "You fill the jug.".
const WATER_SOURCES = new Map([
  ["fountain", "from the fountain"],
  ["sink", "from the sink"],
  ["gold sink", "from the sink"],
  ["well", "from the well"],
  ["tap", "from the tap"],
  ["water barrel", "from the water barrel"],
  ["water pump", null],
  ["waterpump", null],
  ["pump and drain", null],
  ["pump and tub", null],
]);

let api;
let core;
let FILLED_BY_EMPTY;

function defineContainers({ ItemIdentifiers: Items }) {
  FILLED_BY_EMPTY = new Map([
    [Items.JUG, { filled: Items.JUG_OF_WATER, noun: "jug" }],
    [Items.VIAL, { filled: Items.VIAL_OF_WATER, noun: "vial" }],
    [Items.BUCKET, { filled: Items.BUCKET_OF_WATER, noun: "bucket" }],
    [Items.BOWL, { filled: Items.BOWL_OF_WATER, noun: "bowl" }],
    [Items.EMPTY_CUP, { filled: Items.CUP_OF_WATER, noun: "cup" }],
    [Items.EMPTY_FISHBOWL, { filled: Items.FISHBOWL, noun: "fishbowl" }],
    // A player-owned house's kettle (rsprox captures: "You fill the kettle from the sink.").
    [Items.KETTLE, { filled: Items.FULL_KETTLE, noun: "kettle" }],
    // Wiki: a water source refills a waterskin to four doses, whatever it held.
    ...[Items.WATERSKIN_0_, Items.WATERSKIN_1_, Items.WATERSKIN_2_, Items.WATERSKIN_3_]
      .map((skin) => [skin, { filled: Items.WATERSKIN_4_, noun: "waterskin" }]),
  ]);
}

function sourceName(player, objectId) {
  return core.ObjectDefinition.forPlayer(objectId, player)?.getName()?.toLowerCase() ?? "";
}

/** Swaps the first empty container for a full one; false once none are left. */
function fillOne(player, emptyId, container, sound) {
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId(emptyId);
  if (slot < 0) return false;
  inventory.setItem(slot, new core.Item(container.filled, 1)).refreshItems();
  player.performAnimation(new core.Animation(FILL_ANIMATION));
  player.getPacketSender().sendSoundEffect(sound, 1, 0);
  return true;
}

function fillFromWaterSource(event) {
  const { player, itemId, objectId } = event;
  const container = FILLED_BY_EMPTY.get(itemId);
  if (!container) return;
  const name = sourceName(player, objectId);
  if (!WATER_SOURCES.has(name)) return;
  event.handled = true;

  const sound = name === "well" ? WELL_FILL_SOUND : FILL_SOUND;
  if (!fillOne(player, itemId, container, sound)) return;
  const from = WATER_SOURCES.get(name);
  player.sendMessage(from ? `You fill the ${container.noun} ${from}.` : `You fill the ${container.noun}.`);
  api.emitCustomEvent("water-source:filled", { player, objectId, name, itemId, filledId: container.filled });

  // Keyed to the player's index, so walking or another click cancels the rest (walkToReset).
  const at = player.getLocation().clone();
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player.getIndex()); }
    execute() {
      if (!player.isRegistered() || !player.getLocation().equals(at) ||
          !fillOne(player, itemId, container, sound)) this.stop();
    }
  })());
}

module.exports = {
  name: "WaterSources",
  register(pluginApi) {
    api = pluginApi;
    core = api.core;
    defineContainers(core);
    api.onItemOnObject(fillFromWaterSource, { noted: false });
  },
};
