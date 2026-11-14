/**
 * Generic scenery Search (Wiki: Haystack, Hay bale, Crate, Box). Haystacks and hay bales
 * can hide a needle: 10% needle, else 2% pricked for 1 Hitpoint (Mod Ash, cited by the
 * Wiki). Plain crates and boxes find nothing. Only the needle line is quoted by the Wiki;
 * the "nothing" line follows its Goblin Village crate text, and the pricked line is ours.
 * Only objects whose cache options include Search reach these handlers.
 *
 * The Icyene Graveyard's mud mound (rsprox 231/00392 ticks 7883, 8087): without a spade, the
 * mesbox "You need a spade to do that."; with one, human_dig and synth 1470, then the journal
 * page and the ancient armour into the inventory under an objectbox_double with both. The
 * Journal page reads in ReadingBooks. Ours: the mound gives the pair on every search, and needs
 * two free slots (the haystack's full-inventory line); no capture shows either case.
 *
 * Loaded after Quests so a quest's own crate or box search claims its objects first.
 */
const NEEDLE_CHANCE = 0.1;
const PRICK_CHANCE = 0.02;

const DIG_SOUND = 1470;
const MUD_MOUND_FIND = "You find an old journal page and some ancient armour<br>in the mud. You take them both.";
const MUD_MOUND_NO_SPADE = "You need a spade to do that.";

let core;

function searchedNothing(event) {
  const name = String(event.definition?.getName?.() ?? "").toLowerCase();
  event.player.sendMessage(`You search the ${name}, but find nothing of interest.`);
}

function searchHay(event) {
  const { player } = event;
  const roll = Math.random();
  if (roll < NEEDLE_CHANCE) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() < 1) return void player.sendMessage("You don't have enough inventory space.");
    inventory.adds(core.ItemIdentifiers.NEEDLE, 1);
    player.sendMessage("Wow! A needle! Now what are the chances of finding that?");
    return;
  }
  if (roll < NEEDLE_CHANCE + PRICK_CHANCE) {
    player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(1, core.HitMask.RED)]);
    player.sendMessage("You prick your finger on a needle.");
    return;
  }
  searchedNothing(event);
}

function mesbox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function searchMudMound({ player }) {
  const { ItemIdentifiers, DialogueChainBuilder, DoubleItemStatementDialogue } = core;
  const inventory = player.getInventory();
  if (!inventory.contains(ItemIdentifiers.SPADE)) return void mesbox(player, MUD_MOUND_NO_SPADE);
  if (inventory.getFreeSlots() < 2) return void player.sendMessage("You don't have enough inventory space.");
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_dig")));
  player.getPacketSender().sendSound(DIG_SOUND, 1, 0);
  inventory.adds(ItemIdentifiers.JOURNAL_PAGE, 1);
  inventory.adds(ItemIdentifiers.ANCIENT_ARMOUR, 1);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new DoubleItemStatementDialogue(0, ItemIdentifiers.JOURNAL_PAGE, ItemIdentifiers.ANCIENT_ARMOUR, MUD_MOUND_FIND)));
}

module.exports = {
  name: "ScenerySearch",
  description: "Searching haystacks and hay bales, which can hide a needle or prick you, plain crates and boxes, which hold nothing, and the Icyene Graveyard's mud mound, dug with a spade.",
  dependsOn: ["Quests"],
  register(api) {
    core = api.core;
    api.onObjectInteraction("Haystack", { Search: searchHay });
    api.onObjectInteraction("Hay bale", { Search: searchHay });
    api.onObjectInteraction("Hay bales", { Search: searchHay });
    api.onObjectInteraction("Crate", { Search: searchedNothing });
    api.onObjectInteraction("Crates", { Search: searchedNothing });
    api.onObjectInteraction("Box", { Search: searchedNothing });
    api.onObjectInteraction("Boxes", { Search: searchedNothing });
    api.onObjectInteraction("Mud mound", { Search: searchMudMound });
  },
};
