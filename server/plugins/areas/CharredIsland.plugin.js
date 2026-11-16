/**
 * Charred Island's dark hole down to the Charred Dungeon (Wiki: Dark hole (Charred Island),
 * Charred Dungeon). The hole needs a rope tied to it once: varbit
 * dragon_island_dungeon_entrance_roped shows the hole with its rope (sailing_islands_dragon_island_
 * dungeon_entrance_roped) and is kept per player, sent again at login. Once roped, Climb-down goes
 * down to the dungeon and its Rope's Climb-up back, climbed as Ladders climbs (as Lumbridge Swamp's
 * dark hole does). The hole (3x3 at 2636,2415) and the rope (2x2 at 2683,8875) are the cache's;
 * the landings are the walkable tiles beside them, 2683,8877 below and 2637,2414 above. These locs
 * are Sailing's (sailing_*), which loc-teleports leaves to their own plugins.
 *
 * From the Wiki transcript: Climb-down without the rope tied and no rope carried shows the box
 * "There is a sheer drop below the hole. You'll need a rope to get down there."; with a rope it asks
 * "Attach a rope to the top of the hole?", and Yes. uses the rope and shows it in a box, "You tie
 * the rope to the top of the hole and throw it down." Not captured: the tie plays
 * human_pickupfloor and sound 1774, as Lumbridge Swamp's dark hole does with the same lines
 * (rsprox 227/00075, plugins/areas/Misthalin.plugin.js), and a rope used on the hole asks the same.
 *
 * The dungeon's Old chest (Wiki: Old chest, Charred key, Zamorakian paint; gerardus_charred_chest_closed
 * at 2692,8870): the charred key used on it breaks in the lock and the chest opens, "The charred key
 * breaks off in the lock, but the chest opens! Inside is a large cache of paint. You take some."
 * (transcript, with the key and the paint in the box), giving Zamorakian paint (a collection log
 * item). From then on the chest is unlocked for that player and gives paint without end (Wiki: "in
 * unlimited amounts"). Ours: one paint each time, Open's lines (the transcript has none), and the
 * chest isn't shown open (it is a plain loc, not a per-player multiloc).
 */
const ROPED_ATTRIBUTE = "charred-island:dark-hole-roped";
const HOLE = "sailing_islands_dragon_island_dungeon_entrance_multiloc";
const DUNGEON_ROPE = "sailing_islands_dragon_island_dungeon_exit";
const ROPED_VARBIT = "dragon_island_dungeon_entrance_roped";
const DUNGEON_LANDING = [2683, 8877, 0];
const ISLAND_LANDING = [2637, 2414, 0];
const TIE_ANIMATION = "human_pickupfloor";
const TIE_SOUND = 1774;
const NEEDS_ROPE = "There is a sheer drop below the hole. You'll need a rope to get down there.";
const QUESTION = "Attach a rope to the top of the hole?";
const TIED = "You tie the rope to the top of the hole and throw it down.";
const CHEST_UNLOCKED_ATTRIBUTE = "charred-island:old-chest-unlocked";
const OLD_CHEST = "gerardus_charred_chest_closed";
const KEY = "sailing_gerardus_unquiet_trinket"; // Charred key
const PAINT = "sailing_paint_zamorakian"; // Zamorakian paint
const KEY_BREAKS = "The charred key breaks off in the lock, but the chest opens! Inside is a large cache of paint. You take some.";
const TAKE_PAINT = "You take some paint from the chest.";
const LOCKED = "The chest is locked.";
const NO_SPACE = "You don't have enough inventory space.";

let api;
let core;

const cache = () => core.CacheDefinitions;
const isHole = (objectId) => objectId === cache().getLocId(HOLE);
const roped = (player) => player.getAttribute(ROPED_ATTRIBUTE) === true;
const rope = () => core.ItemIdentifiers.ROPE;

function box(player, dialogue) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(dialogue).add(new core.EndDialogue(1)));
}

function tie(player) {
  if (roped(player) || !player.getInventory().contains(rope())) return;
  player.getInventory().delete(rope(), 1);
  player.setAttribute(ROPED_ATTRIBUTE, true);
  player.getPacketSender().sendVarbit(cache().getVarbitId(ROPED_VARBIT), 1);
  player.performAnimation(new core.Animation(cache().getSeqId(TIE_ANIMATION)));
  player.getPacketSender().sendSound(TIE_SOUND, 1, 0);
  box(player, new core.ItemStatementDialogue(0, rope(), TIED));
}

function askToTie(player) {
  api.sendMultiChatboxPrompt(player, QUESTION, "Yes.", () => tie(player), "No.", () => {});
}

const at = ([x, y, z]) => new core.Location(x, y, z);

/** Climb-down: with the rope tied, down to the dungeon; before it, the rope or the sheer drop. */
function climbDown({ player, objectId }) {
  if (!isHole(objectId)) return false;
  if (roped(player)) api.emitCustomEvent("ladders:climbDown", { player, destination: at(DUNGEON_LANDING) });
  else if (player.getInventory().contains(rope())) askToTie(player);
  else box(player, new core.StatementDialogue(0, NEEDS_ROPE));
  return true;
}

/** Ladders' "does anyone own this?" for the dungeon's rope: back up beside the hole. */
function claimDungeonRope(request) {
  if (request.handled || request.objectId !== cache().getLocId(DUNGEON_ROPE)) return;
  request.handled = true;
  api.emitCustomEvent("ladders:climbUp", { player: request.player, destination: at(ISLAND_LANDING) });
}

function useRope({ player, objectId }) {
  if (!isHole(objectId) || roped(player)) return false;
  askToTie(player);
  return true;
}

const isOldChest = (objectId) => objectId === cache().getLocId(OLD_CHEST);
const unlocked = (player) => player.getAttribute(CHEST_UNLOCKED_ATTRIBUTE) === true;

/** One Zamorakian paint into the inventory, counted for the collection log; false with no room. */
function takePaint(player) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return false;
  }
  const paint = cache().getObjId(PAINT);
  inventory.add(new core.Item(paint, 1));
  api.emitCustomEvent("collection-log:obtain", { player, itemId: paint, amount: 1 });
  return true;
}

/** The charred key on the Old chest: it breaks in the lock, the chest opens for good, and paint. */
function useKey({ player, objectId }) {
  if (!isOldChest(objectId)) return false;
  if (unlocked(player)) return openChest({ player, objectId });
  if (player.getInventory().getFreeSlots() < 1) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  const key = cache().getObjId(KEY);
  player.getInventory().delete(key, 1);
  player.setAttribute(CHEST_UNLOCKED_ATTRIBUTE, true);
  takePaint(player);
  box(player, new core.DoubleItemStatementDialogue(0, key, cache().getObjId(PAINT), KEY_BREAKS));
  return true;
}

/** Open: paint once unlocked; before that the chest won't open. */
function openChest({ player, objectId }) {
  if (!isOldChest(objectId)) return false;
  if (!unlocked(player)) player.sendMessage(LOCKED);
  else if (takePaint(player)) player.sendMessage(TAKE_PAINT);
  return true;
}

/** "charred-island:old-chest-unlocked" { player, unlocked }: whether the charred key has been used (Gerardus asks). */
function answerChestUnlocked(request) {
  request.unlocked = unlocked(request.player);
}

function login({ player }) {
  if (roped(player)) player.getPacketSender().sendVarbit(cache().getVarbitId(ROPED_VARBIT), 1);
}

module.exports = {
  name: "CharredIsland",
  description: "Charred Island's dark hole down to the Charred Dungeon (a rope tied once), and the dungeon's Old chest of Zamorakian paint, unlocked with the charred key.",
  members: true,
  _test: { ROPED_ATTRIBUTE, NEEDS_ROPE, QUESTION, TIED, DUNGEON_LANDING, ISLAND_LANDING, CHEST_UNLOCKED_ATTRIBUTE, KEY_BREAKS, TAKE_PAINT, LOCKED, NO_SPACE },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(ROPED_ATTRIBUTE, false);
    api.persistAttribute(CHEST_UNLOCKED_ATTRIBUTE, false);
    api.onObjectInteraction("Old chest", { Open: openChest });
    api.onItemOnObject("Charred key", "Old chest", useKey, { noted: false });
    api.onCustomEvent("charred-island:old-chest-unlocked", answerChestUnlocked);
    api.onObjectInteraction("Dark hole", { "Climb-down": climbDown });
    api.onCustomEvent("ladders:climb", claimDungeonRope);
    api.onItemOnObject("Rope", "Dark hole", useRope, { noted: false });
    api.onPlayerLogin(login);
  },
};
