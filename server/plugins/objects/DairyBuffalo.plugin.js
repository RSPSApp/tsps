"use strict";

/**
 * Varlamore's Dairy Buffalo (a scenery loc at Ortus Farm and Kastori; Wiki: Dairy Buffalo): Milk
 * fills an empty bucket with milk. RSProx 237/1098: clicked at tick 14560, arrived 14569, and at 14571,
 * two ticks after the arrival, all on one tick: the player plays milk_buffalo, synth 372 plays, "You milk the buffalo." (spam) and the
 * empty bucket becomes a bucket of milk. Emits `dairy-buffalo:milked` { player } on that tick (the
 * league's "Milk a Buffalo" completes there).
 *
 * Ours: with no empty bucket, the dairy cow's captured line (no buffalo recording shows one).
 */
const MILK_TICKS = 2;
const MILK_SOUND = 372;
const MILKED = "You milk the buffalo.";
const NO_BUCKET = "You'll need an empty bucket to collect the milk.";
const NAME = "<col=ffff00>Dairy Buffalo</col>";

let api = null;
const milking = new WeakMap();

function milk({ player }) {
  const { core } = api;
  const I = core.ItemIdentifiers;
  if (!player.getInventory().contains(I.BUCKET)) {
    player.sendMessage(NO_BUCKET);
    return true;
  }
  const token = {};
  milking.set(player, token);
  const from = player.getLocation().clone();
  core.TaskManager.submit(new core.CountdownTask(player, MILK_TICKS, () => {
    if (milking.get(player) !== token) return;
    milking.delete(player);
    const inventory = player.getInventory();
    if (!player.isRegistered() || !player.getLocation().equals(from) || !inventory.contains(I.BUCKET)) return;
    inventory.delete(I.BUCKET, 1);
    inventory.adds(I.BUCKET_OF_MILK, 1);
    player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("milk_buffalo")));
    player.getPacketSender().sendSoundEffect(MILK_SOUND, 1, 0);
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MILKED);
    api.emitCustomEvent("dairy-buffalo:milked", { player });
  }));
  return true;
}

module.exports = {
  name: "DairyBuffalo",
  description: "Lets players milk Varlamore's Dairy Buffalo into an empty bucket, as captured.",
  members: true,
  _test: { milk, MILKED, NO_BUCKET, MILK_TICKS },
  register(pluginApi) {
    api = pluginApi;
    api.onObjectInteraction(NAME, { Milk: milk });
  },
};
