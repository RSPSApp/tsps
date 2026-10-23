# Broken items and Perdu

Untradeable combat items (fire capes, defenders, Void, Fighter torso and others) break when they're lost on a PvP death. Perdu repairs them, and locks the strongest ones so they aren't lost in deep Wilderness. The plugin is `server/plugins/items/BrokenItems.plugin.js`, with its parts in `brokenitems/` and its data in `items/data/broken-items.json`.

## When an item breaks (Wiki: Items Kept on Death, (broken), (l))

- **PvM deaths:** nothing breaks, in or out of the Wilderness. The item goes to the grave like any other untradeable ([gravestones](gravestones.md)).
- **PvP deaths:** a death in the Wilderness (or a PvP zone) where the killer is a player.
- **Protected items** (the 3 or 4 a death keeps) never break.
- **Up to level 20 Wilderness:** an unprotected breakable item stays in the victim's inventory as its `(broken)` form, and the killer gets its repair cost in coins.
- **Above level 20:**
  - Items Perdu can lock (infernal capes, Void, Fighter torso, ancient sceptres, Dizana's max cape) are lost unless locked. The killer still gets the repair cost.
  - Locked `(l)` items become `(l) (mangled)`, and the killer gets 500,000 coins.
  - Items Perdu can't lock break, as they do below level 20.
- **Locks from before the Trouver rework:** a fire cape (l) and other `(l)` items Perdu no longer locks break into the plain `(broken)` form.

Before this, every kept item with a broken form came back broken after **any** death, PvM included, and the killer got nothing.

## Which items, and the costs

`broken-items.json` lists each item by name, with its repair cost from the Wiki's (broken) table. The plugin finds every form in the cache by name:

| Form | Name |
| --- | --- |
| The item | `Fire cape` |
| Broken | `Fire cape (broken)` |
| Locked | `Infernal cape (l)` |
| Locked, broken | `Infernal cape (l) (broken)` |
| Locked, mangled | `Infernal cape (l) (mangled)` |

- **Ancient sceptres:** they cost 200,000 plus the Grand Exchange price of an ancient staff to repair (Wiki).
- **Rune pouches and Dizana's quivers** follow their own death rules, kept in their own plugins. Perdu still locks them, and repairs the quivers. A repaired Dizana's quiver comes back uncharged, as before.

## Perdu (Wiki: Transcript:Perdu; rsprox captures, rev 224-232)

Every interaction is using an item on him.

- **Broken or mangled item:** a menu, "What would you like to do?":
  - "Repair that item: N coins."
  - "Repair all items: N coins.", shown when more than one item needs repairing.
  - "Cancel."

  He takes coins from the inventory first, then from the bank: "You can pay me with cash you're carrying, or I can take payments from your bank". A mangled item costs 500,000 and repairs into its locked form.
- **An item he can lock, without a Trouver parchment:**
  - "...but I'll need a Trouver parchment."
  - A parchment box about the merchant in Ferox Enclave.
  - "Bring the parchment here, then show me the item again."
- **With a parchment:**
  - "...It'll cost you 500,000 coins and a Trouver parchment."
  - Then "Select an option": "Lock item (*name*)", "Lock all available items" (when several can be locked) and "Cancel".
  - Locking takes the parchment and the coins and swaps the item, with no message.
- **A locked item:**
  - "I've locked that item to you ... returning your parchment and 475,000 coins."
  - Then "*name*: Unlock it?", Yes or No.
  - Yes swaps it back and gives the parchment and 475,000 coins, with the box "Perdu unlocks your item and returns the parchment and some money."
- **A breakable item he can't lock:** "You don't need me to lock that item, it won't vanish if you die in deep Wilderness."
- **The parchment, coins or anything else:** the Wiki's lines for each.

The "About items that break..." talk option stays as the dialogue transcript has it: "For a fee, yes. Just show me the broken item." Before, nothing handled an item used on Perdu, so a broken item could never be repaired. `DizanasQuiver`'s own Perdu "Repair" option never fired, because Perdu's only options are Talk-to and Trade.

### Not captured

- **A repair at Perdu:** the menu follows the captured format of Bob's repairs.
- **The messages for too few coins or inventory space:** ours.
- **When "Lock all available items" is shown:** the rev 232 capture shows it with one lockable item carried, while the Wiki lists it only for ornamented items.

The lock captures predate the Trouver rework of 17 June 2026, so the lockable items follow the Wiki's (l) list instead.

## Not covered

- **Ornamented items:** Void and Fighter torso `(or)`, Dragon defender `(t)`. Their ornament kits go to the killer.
- **Decorative armour:** the Castle Wars gold pieces share one name across many ids, so they can't be paired by name.
- **The 30-second rule:** a player hit by another player who leaves the Wilderness and dies within 30 seconds still has a PvP death.
- **Chris and the PvP world armour stands**, which also repair.
