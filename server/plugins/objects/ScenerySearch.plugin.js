/**
 * Generic scenery Search (Wiki: Haystack, Hay bale, Crate, Box). Haystacks and hay bales
 * can hide a needle: 10% needle, else 2% pricked for 1 Hitpoint (Mod Ash, cited by the
 * Wiki). Plain crates and boxes find nothing. Only the needle line is quoted by the Wiki;
 * the "nothing" line follows its Goblin Village crate text, and the pricked line is ours.
 * Only objects whose cache options include Search reach these handlers.
 *
 * Loaded after Quests so a quest's own crate or box search claims its objects first.
 */
const NEEDLE_CHANCE = 0.1;
const PRICK_CHANCE = 0.02;

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

module.exports = {
  name: "ScenerySearch",
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
  },
};
