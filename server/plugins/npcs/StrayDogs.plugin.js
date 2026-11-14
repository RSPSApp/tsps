// OSRS Wiki: Stray dog, Molossus. Only public Shoo-away dogs, never A Ruff Situation actors.
const followers = new WeakMap();
const PET_SOUND = 652;
const SHOO_SOUND = 911;
/** RSProx 237/1098 tick 10200: the synth that plays as a Chiribaya takes the bones. */
const FEED_SOUND = 2393;
// shortcut: Wiki specifies a temporary follow but no duration; calibrate 100 ticks from a live capture.
const FOLLOW_TICKS = 100;

/**
 * The public dogs by name. Stray dog and Molossus lines are their Wiki transcripts'. Varlamore's
 * dogs pet as RSProx 237/1098 shows for Molossus, Xolo and Chiribaya: human_pickupfloor on arrival,
 * the dog's "Woof!" and sound 652 two ticks later. Xolo, Chiribaya and Techichi have no transcript;
 * they take Molossus' cat-ears line (Ours for Chiribaya and Techichi), and Techichi, never
 * captured being petted, the others' captured pet.
 *
 * Every dog feeds as RSProx 237/1098 tick 10200 (a Chiribaya) and 227/1723 ticks 11458-11459
 * (a Varrock stray dog) show bones given: on arrival the player plays human_pickupfloor and the
 * dog says "Woof woof!"; a tick later the bones leave the slot, both lines arrive as one message
 * joined by <br> (then the stray dog's diary task) and synth 2393 plays.
 *
 * A dog fed emits "stray-dogs:fed" { player, npc, itemId, food: "bones" | "meat" } on that tick: the
 * league's "Feed a dog some bones" completes there, as RSProx 237/1098 tick 10208 shows (right after
 * the joined message).
 */
const FEED_SEQ = "human_pickupfloor";
const FED_EVENT = "stray-dogs:fed";
const VARLAMORE = { ears: "The dog doesn't approve of your ears.", petSeq: "human_pickupfloor", woofTicks: 2 };
const DOGS = {
  "Stray dog": { ears: "He doesn't approve of your ears.", diary: true },
  Molossus: VARLAMORE,
  Xolo: VARLAMORE,
  Chiribaya: VARLAMORE,
  Techichi: VARLAMORE,
};

function publicDog(definition) {
  const dog = DOGS[definition.getName()];
  return dog && definition.getActions().includes("Shoo-away") ? dog : null;
}

function stopFollowing(npc) {
  followers.get(npc)?.stop();
  followers.delete(npc);
  npc.setFollowing(null);
  npc.setMobileInteraction(null);
  npc.getMovementQueue().reset();
}

function follow(core, player, npc) {
  stopFollowing(npc);
  npc.setFollowing(player);
  let remaining = FOLLOW_TICKS;
  const task = new (class extends core.Task {
    constructor() { super(1, npc); }
    execute() {
      const tile = player.getLocation();
      if (--remaining <= 0 || !npc.isRegistered() || !player.isRegistered() || player.getHitpoints() <= 0 ||
          player.getPrivateArea() !== npc.getPrivateArea() || !npc.getLocation().isWithinDistance(tile, 15)) {
        stopFollowing(npc);
        return;
      }
      const indoors = core.RegionManager.getRegion(tile.getX(), tile.getY())?.isUnderRoof(tile.getX(), tile.getY(), tile.getZ());
      npc.setFollowing(indoors ? null : player);
      if (indoors) npc.getMovementQueue().reset();
    }
  })();
  followers.set(npc, task);
  core.TaskManager.submit(task);
}

function flee(core, player, npc) {
  stopFollowing(npc);
  const tile = npc.getLocation();
  const from = player.getLocation();
  const dx = Math.sign(tile.getX() - from.getX()) || 1;
  const dy = Math.sign(tile.getY() - from.getY());
  npc.getMovementQueue().addSteps(new core.Location(tile.getX() + dx * 3, tile.getY() + dy * 3, tile.getZ()));
}

function catEars(core, player, npc, dog) {
  const head = player.getEquipment().get(core.Equipment.HEAD_SLOT).getId();
  if (![core.ItemIdentifiers.CAT_EARS, core.ItemIdentifiers.HELL_CAT_EARS].includes(head)) return false;
  npc.forceChat("Bark!");
  player.sendMessage(dog.ears);
  flee(core, player, npc);
  return true;
}

function woof(player, npc) {
  npc.forceChat("Woof!");
  player.getPacketSender().sendSoundEffect(PET_SOUND, 1, 0);
}

function later(core, npc, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, npc, false); }
    execute() {
      this.stop();
      action();
    }
  })());
}

function pet(core, { player, npc, definition }) {
  const dog = publicDog(definition);
  if (!dog) return false;
  if (catEars(core, player, npc, dog)) return;
  player.forceChat("Who's a good doggy!");
  if (dog.petSeq) player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(dog.petSeq)));
  if (dog.woofTicks) later(core, npc, dog.woofTicks, () => { if (npc.isRegistered() && player.isRegistered()) woof(player, npc); });
  else woof(player, npc);
  follow(core, player, npc);
}

function shoo(core, { player, npc, definition }) {
  const dog = publicDog(definition);
  if (!dog) return false;
  if (catEars(core, player, npc, dog)) return;
  player.forceChat("Thbbbbt!");
  npc.forceChat("Whine!");
  player.getPacketSender().sendSoundEffect(SHOO_SOUND, 1, 0);
  flee(core, player, npc);
}

function feed(api, event) {
  const { player, target: npc, definition, item, itemId, slot } = event;
  const dog = publicDog(definition);
  if (!dog) return;
  event.handled = true;
  const core = api.core;
  if (catEars(core, player, npc, dog)) return;
  const I = core.ItemIdentifiers;
  if ([I.SHAIKAHAN_BONES, I.MARINATED_J_BONES, I.MARINATED_J_BONES_2].includes(itemId)) {
    player.sendMessage("That's disgusting - you can't give it to the poor dog!");
    return;
  }
  const bones = /\bbones$/i.test(item.getDefinition().getName());
  const meat = [I.RAW_BEEF, I.RAW_RAT_MEAT, I.RAW_BEAR_MEAT, I.RAW_CHICKEN, I.COOKED_MEAT].includes(itemId);
  if (item.getDefinition().isNoted() || (!bones && !meat)) {
    npc.forceChat("Grrrr!");
    player.sendMessage("The dog doesn't seem interested in that.");
    return;
  }
  const lines = bones ? ["You give the dog some nice bones.", "It happily gnaws on them."]
    : ["You give the dog a nice piece of meat.", "It gobbles it up."];
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(FEED_SEQ)));
  npc.forceChat("Woof woof!");
  later(core, npc, 1, () => {
    // Ours: the food is only taken if it is still in the slot it was used from.
    if (!player.isRegistered() || !npc.isRegistered() || player.getInventory().forSlot(slot)?.getId() !== itemId) return;
    player.getInventory().deleteAtSlot(slot);
    player.sendMessage(lines.join("<br>"));
    player.getPacketSender().sendSoundEffect(FEED_SOUND, 1, 0);
    follow(core, player, npc);
    if (dog.diary && itemId === I.BONES) api.emitCustomEvent("diary:task", { player, diary: "varrock", task: "give-a-dog-a-bone" });
    api.emitCustomEvent(FED_EVENT, { player, npc, itemId, food: bones ? "bones" : "meat" });
  });
}

function dogActions(core) {
  return { Pet: pet.bind(null, core), "Shoo-away": shoo.bind(null, core) };
}

module.exports = {
  name: "StrayDogs",
  description: "Petting, shooing and feeding for stray dogs and Varlamore's Molossus, Xolo, Chiribaya and Techichi, with Wiki transcripts and captured animations.",
  register(api) {
    const actions = dogActions(api.core);
    for (const name of Object.keys(DOGS)) api.onNpcInteraction(name, actions);
    api.onItemOnNpc(feed.bind(null, api));
  },
};
