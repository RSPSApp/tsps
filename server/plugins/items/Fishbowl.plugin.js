/**
 * Fishbowls (https://oldschool.runescape.wiki/w/Fishbowl, /w/Fishbowl_(water), /w/Fishbowl_(pet)).
 *
 * A fishbowl of water (6668) takes one seaweed to become a fishbowl with seaweed (6669), the item
 * the Kandarin diary "Fish-in" aquarium task needs. Both have an "Empty" option (cache iop3)
 * that gives back the empty fishbowl (6667). Filling an empty bowl is plugins/world/WaterSources.
 * The Wiki and the rsprox captures give no message, sound or animation for either step, so none
 * is sent, and the Wiki does not say what becomes of the seaweed when its bowl is emptied: it is
 * lost, as the water is.
 *
 * A pet fish in its bowl (bluefish 6670, greenfish 6671, spinefish 6672) has the cache options
 * Talk-At, Play-With and Feed. The lines are the Wiki's (Transcript:Fishbowl (pet)); the
 * animations are the cache's own per-fish sequences (human_talk_to_pet_fish_<fish>,
 * human_play_with_pet_fish_<fish>, human_feed_pet_fish_<fish>), whose right hand holds that
 * fish's bowl. The feed sequence's left hand holds fish food (272), the food the Wiki says pet fish
 * eat. No rsprox capture has any of the three options (index: only bank and inventory mentions).
 */

let core;

const BOWL_NAME = "Fishbowl";
const SEAWEED_NAME = "Seaweed";

/** Wiki (Transcript:Fishbowl (pet), "Standard dialogue"). */
const TALK_LINE = "Good fish. Just keep swimming...swimming...swimming...";
const TALK_STATEMENT = "The fish swims. It is clearly an obedient fish.";
/** Wiki (Transcript:Fishbowl (pet), "Playing with the fishbowl"). */
const PLAY_LINE = "Jump! Come on fishy, jump!";
const PLAY_STATEMENT = "The fish bumps into the side of the fishbowl. Then it swims some more.";
const PLAY_FOLLOW_UP = "Good fish...";
/** Wiki (Fishbowl (pet), trivia): any item used on the bowl. */
const USE_ON_MESSAGE = "Your fish looks at you strangely. You get the feeling this will not work.";
/** Ours: no source gives Feed's messages, nor says whether the food is used up. */
const FEED_MESSAGE = "You feed your fish.";
const NO_FOOD_MESSAGE = "You don't have any fish food.";

function ids() {
  const { ItemIdentifiers: Items } = core;
  return {
    empty: Items.EMPTY_FISHBOWL,
    water: Items.FISHBOWL,
    seaweedBowl: Items.FISHBOWL_2,
    seaweed: Items.SEAWEED,
    fishFood: Items.FISH_FOOD,
  };
}

/** Each pet fish bowl and the suffix of its cache sequences. */
function petFish(itemId) {
  const { ItemIdentifiers: Items } = core;
  if (itemId === Items.FISHBOWL_3) return "blue";
  if (itemId === Items.FISHBOWL_4) return "green";
  if (itemId === Items.FISHBOWL_5) return "spine";
  return null;
}

/** Seaweed on a fishbowl of water: one seaweed into the bowl. */
function seaweedOnBowl(event) {
  const { player, usedItemId, usedItemSlot, usedWithItemId, usedWithItemSlot } = event;
  const id = ids();
  let bowlSlot;
  let weedSlot;
  if (usedItemId === id.seaweed && usedWithItemId === id.water) {
    weedSlot = usedItemSlot;
    bowlSlot = usedWithItemSlot;
  } else if (usedItemId === id.water && usedWithItemId === id.seaweed) {
    bowlSlot = usedItemSlot;
    weedSlot = usedWithItemSlot;
  } else {
    return false;
  }
  const inventory = player.getInventory();
  inventory.setItem(weedSlot, new core.Item(-1, 0));
  inventory.setItem(bowlSlot, new core.Item(id.seaweedBowl, 1)).refreshItems();
  return true;
}

/** "Empty" on a fishbowl of water or of water and seaweed: the empty bowl is left. */
function empty(event) {
  const { player, itemId, slot } = event;
  const id = ids();
  if (itemId !== id.water && itemId !== id.seaweedBowl) return false;
  player.getInventory().setItem(slot, new core.Item(id.empty, 1)).refreshItems();
  return true;
}

function animate(player, action, fish) {
  const sequence = core.CacheDefinitions.getSeqId(`human_${action}_pet_fish_${fish}`);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
}

/** "Talk-At": the player's line and the fish's reply, with the talking animation. */
function talkAt(event) {
  const { player, itemId } = event;
  const fish = petFish(itemId);
  if (!fish) return false;
  const { DialogueChainBuilder, PlayerDialogue, StatementDialogue, EndDialogue } = core;
  animate(player, "talk_to", fish);
  const chain = new DialogueChainBuilder();
  chain.add(new PlayerDialogue(0, TALK_LINE));
  chain.add(new StatementDialogue(1, TALK_STATEMENT));
  chain.add(new EndDialogue(2));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

/** "Play-With": the player jiggles the bowl; the fish bumps the glass and swims on. */
function playWith(event) {
  const { player, itemId } = event;
  const fish = petFish(itemId);
  if (!fish) return false;
  const { DialogueChainBuilder, PlayerDialogue, StatementDialogue, EndDialogue } = core;
  animate(player, "play_with", fish);
  const chain = new DialogueChainBuilder();
  chain.add(new PlayerDialogue(0, PLAY_LINE));
  chain.add(new StatementDialogue(1, PLAY_STATEMENT));
  chain.add(new PlayerDialogue(2, PLAY_FOLLOW_UP));
  chain.add(new EndDialogue(3));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

/**
 * "Feed": fish food sprinkled into the bowl, with the feeding animation (which shows fish food in
 * the player's other hand). Ours: one fish food is used up per feed, and both messages.
 */
function feed(event) {
  const { player, itemId } = event;
  const fish = petFish(itemId);
  if (!fish) return false;
  const inventory = player.getInventory();
  const { fishFood } = ids();
  if (inventory.getAmount(fishFood) <= 0) {
    player.sendMessage(NO_FOOD_MESSAGE);
    return true;
  }
  inventory.deleteNumber(fishFood, 1);
  animate(player, "feed", fish);
  player.sendMessage(FEED_MESSAGE);
  return true;
}

/** Any item used on a pet fish's bowl. The bowl used on another item keeps the default reply. */
function itemOnPetFish(event) {
  if (event.handled || !petFish(event.usedWithItemId)) return;
  event.player.sendMessage(USE_ON_MESSAGE);
  event.handled = true;
}

module.exports = {
  name: "Fishbowl",
  description: "Fishbowls: seaweed on a bowl of water, Empty, and a pet fish's Talk-At, Play-With and Feed.",
  members: true,
  register(api) {
    core = api.core;
    api.onItemOnItem(SEAWEED_NAME, BOWL_NAME, seaweedOnBowl, { noted: false });
    api.onItemOnItem(itemOnPetFish);
    api.onItemAction(BOWL_NAME, { Empty: empty, "Talk-At": talkAt, "Play-With": playWith, Feed: feed });
  },
  _test: {
    seaweedOnBowl, empty, talkAt, playWith, feed, itemOnPetFish,
    TALK_LINE, TALK_STATEMENT, PLAY_LINE, PLAY_STATEMENT, PLAY_FOLLOW_UP, USE_ON_MESSAGE,
    FEED_MESSAGE, NO_FOOD_MESSAGE,
  },
};
