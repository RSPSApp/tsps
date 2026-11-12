// The client's loot tracker. Content asks for an entry with "loot-tracker:add":
//   { player, source, category, items: [[itemId, amount], ...] }
// `source` is the loot tracker's source (cache enum 4976: 22 "Draynor Rooftop Course", ...), and
// `category` is the third argument live sends with it (5 for the Agility courses, 11 for the
// farming patches). The entry gets the player's next key, and is sent as cache script 7197
// (loottracker_sourceadd: source, key, category, -1), then 7198 per item (loottracker_lootadd:
// source, key, item, amount). A source with nothing found (a lap with no mark) is still added.
//
// rsprox captures (main game, rev 241 and 242: 20261109T090342-d73fc6a, 20261108T062407-ae5c1f1,
// 20261027T185126-57eba26, 20261024T001512-d0ad0dc and more): every rooftop lap sends 7197 with
// category 5 as it ends, and a mark of grace spawned with it 7198 with grace and 1, both under the
// same key. The key counts up by one an entry, whichever source it is for (a boss's contact and
// the next farming harvest take consecutive keys), and carries on from session to session, so it
// is kept with the player.
const NEXT_KEY_ATTRIBUTE = "loot-tracker:next-key";
const SOURCE_ADD_SCRIPT = 7197;
const LOOT_ADD_SCRIPT = 7198;
/** The fourth argument of 7197, always -1 in the captures. */
const SOURCE_ADD_UNUSED = -1;

function addEntry({ player, source, category, items = [] }) {
  if (!player || !Number.isInteger(source) || !Number.isInteger(category)) return;
  const key = player.getAttribute(NEXT_KEY_ATTRIBUTE) ?? 1;
  player.setAttribute(NEXT_KEY_ATTRIBUTE, key + 1);
  const sender = player.getPacketSender();
  sender.sendClientScript(SOURCE_ADD_SCRIPT, source, key, category, SOURCE_ADD_UNUSED);
  for (const [itemId, amount] of items) {
    if (amount > 0) sender.sendClientScript(LOOT_ADD_SCRIPT, source, key, itemId, amount);
  }
}

module.exports = {
  name: "LootTracker",
  register(api) {
    api.persistAttribute(NEXT_KEY_ATTRIBUTE, 1);
    api.onCustomEvent("loot-tracker:add", addEntry);
  },
};
