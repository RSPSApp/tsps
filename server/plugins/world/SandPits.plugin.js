/** Bucket filling: rsprox captures 3196 (Dorgesh-Kaan) and 4283 (Entrana). */
const FILL_ANIMATION = 895; // cache sequence human_fillbucket_sandpit
const FILL_SOUND = 2584;
const FILL_INTERVAL = 2;

function fillBucket(api, player, slot, objectId, location) {
  const { Item, ItemIdentifiers, Animation } = api.core;
  const inventory = player.getInventory();
  const bucket = inventory.getItems()[slot];
  if (bucket?.getId() !== ItemIdentifiers.BUCKET) return false;
  inventory.setItem(slot, new Item(ItemIdentifiers.BUCKET_OF_SAND, 1, bucket.getMeta())).refreshItems();
  player.performAnimation(new Animation(FILL_ANIMATION));
  player.getPacketSender().sendSoundEffect(FILL_SOUND, 1, 0);
  player.sendMessage("You fill the bucket with sand.");
  api.emitCustomEvent("sand-pit:filled", { player, objectId, location });
  return true;
}

function fillFromSandPit(api, event) {
  const { player, objectId, location, itemSlot } = event;
  const { Task, TaskManager, ItemIdentifiers, ObjectDefinition } = api.core;
  // A Sailing charting landmark shares the name; it is a separate interaction.
  if (ObjectDefinition.forPlayer(objectId, player)?.getInteractions()?.includes("Chart")) return false;
  if (player.getInventory().getItems()[itemSlot]?.getId() !== ItemIdentifiers.BUCKET) return false;
  const at = player.getLocation().clone();
  // Index-keyed tasks are cancelled by normal walking, new interactions and logout.
  TaskManager.submit(new (class FillSandTask extends Task {
    constructor() {
      super(1, player.getIndex());
      this.slot = itemSlot;
    }
    execute() {
      if (!player.isRegistered() || !player.getLocation().equals(at) ||
          !fillBucket(api, player, this.slot, objectId, location)) {
        this.stop();
        return;
      }
      this.slot = player.getInventory().getSlotForItemId(ItemIdentifiers.BUCKET);
      if (this.slot < 0) this.stop();
      this.setDelay(FILL_INTERVAL);
    }
  })());
  return true;
}

module.exports = {
  name: "SandPits",
  description: "Using an empty bucket on a sandpit fills all empty buckets, one every two ticks.",
  members: true,
  register(api) {
    api.onItemOnObject("Bucket", "Sand pit", fillFromSandPit.bind(null, api), { noted: false });
    api.onItemOnObject("Bucket", "Sandpit", fillFromSandPit.bind(null, api), { noted: false });
  },
};
