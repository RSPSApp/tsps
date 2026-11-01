# Looting bag

`server/plugins/items/LootingBag.plugin.js`. The destroy prompt is the shared one in
`server/plugins/interface/DestroyItem.plugin.js`.

**Sources:**
- **rsprox captures:** recordings 448, 449, 452, 454, 456, 457, 461 and 464 (rev 233), 821 (rev 234),
  and 1541 and 1545 (rev 224);
- **the OSRS Wiki:** [Looting bag](https://oldschool.runescape.wiki/w/Looting_bag);
- **this cache:** scripts 495 (`wilderness_lootingbag_setup`), 497 (draws the items and their ops),
  1235 (`wilderness_lootingbag_setprices`) and 3744 (the bank view's ops); components
  `wilderness_lootingbag:items`/`:total` (81:5, 81:6) and `bankside:lootingbag_items`/`_bankall`/
  `_dismiss` (15:11, 15:6, 15:8); inv `looting_bag` (516).

## Where items go in and come out
- **In:** only in the Wilderness and the Ferox Enclave (Wiki), and only tradeable items. The bag is
  never stored in itself.
- **Out:** at a bank, by destroying the bag, or by dying (Wiki: "contents can't be recovered outside a
  bank"). Check has no withdraw ops.
- **Capacity:** 28 slots. Stackable items stack as they do in the inventory; every other item takes a
  slot of its own (Wiki, and the captured per-slot prices in 1545 show one karambwan per slot).
  Bags saved before this change can hold an unstackable item as one stack; it still reads and banks.

| Refusal (captured) | Message |
|---|---|
| Outside the Wilderness (using an item on the bag; **ours:** Deposit says it too) | "You can't put items in the looting bag unless you're in the Wilderness." |
| Untradeable item | "Only tradeable items can be put in the bag." |
| The bag itself | "You may be surprised to learn that bagception is not permitted." |
| No room | "The bag's too full." |

## Open and Close (captured)
The bag swaps between its closed and open ids, with "You open your looting bag, ready to fill it." and
"You close your looting bag.". While it is open, tradeable items picked up in the Wilderness go into
it. When there is no room the item goes to the inventory, with the spam line "You don't have space in
your looting bag for that.".

## Check and Deposit (captured)
Both open `wilderness_lootingbag` in the side panel. The server sends the bag as inv 516, then:

| | Check | Deposit |
|---|---|---|
| `if_setevents` on `:items` 0-27 | OP10 (Examine) | OP1-OP4, OP9 |
| script 495 | `["Looting bag", 0]` | `["Add to bag", 1]` |
| Shows | the bag | the inventory |
| `:total` | "Value: 65,216 coins" | "Bag value: 526 coins" |
| Empty total | "Value: -" | "Bag value: -" |

Script 497 names the deposit ops Store-1, Store-5, Store-All and Store-X. The prices are each item's
guide price (Wiki: a price check of the Grand Exchange value), sent per slot with script 1235. After
each store the total and the prices are sent again. In revision 241, script 1235 takes the inventory
as an int and all 28 prices as longs, including the empty-slot `-1` values. Sending the prices as
ints aborts the client script before the following setup script can draw the items.

## Using an item on the bag (captured)
With the default setting the bag asks "How many do you want to deposit?" (`chatbox_multi_init`). The
choices depend on how many of the item are carried:

| Carried | Choices |
|---|---|
| 2 | One, Both |
| 3 | One, Two, All |
| 4 | One, All, X |
| more than 5 | One, Five, All, X |

Counts 2, 3 and 4 are from recording 1545; the four-choice menu also appears in 454 and 821 for larger
stacks. **Ours:** exactly 5 carried uses the four-choice menu (not captured), and a single item goes
in without a menu. The X prompt's text is not captured; ours is "Enter amount:", the bank's.

## Settings (captured)
"Select an option" with two lines, each naming the opposite of the current choice:

| Line | Picked | Message |
|---|---|---|
| "Store everything when using items on the bag." | stores without the menu | "When using items on the bag, you will immediately store as many of that item as possible in the bag." |
| "Ask how many items to store when using items on the bag." | back to the menu | "When using items on the bag, you will be asked how many of that item you wish to store in the bag." |
| "Don't put supplies into the looting bag." | picked-up food and potions go to the inventory | "Food and potions will not go into an open looting bag when picked up." |
| "Put supplies into the looting bag." | they go into the open bag again | "Food and potions will automatically go into an open looting bag when picked up." |

The defaults are asking and putting supplies in (the first menu in 1545). They are saved as
`looting-bag:store-everything` and `looting-bag:skip-supplies`.

## In the bank (captured)
The bank's inventory panel op1 on the bag sets `bank_viewcontainer` to 1 and
`bank_viewcontainer_obj` to the bag (rev 233), and shows the bag's items with Deposit-1, Deposit-5,
Deposit-10, Deposit-X and Deposit-All (script 3744; op1 follows the bank's quantity buttons). Deposit-X
asks "Enter amount:". "Deposit loot" banks everything and "Dismiss" goes back to the inventory.

## Destroy (captured, Wiki)
Destroy asks first, through the shared destroy prompt: "Are you sure you want to destroy the bag?",
then "If you destroy it, the contents will be lost." or, for an empty bag, "The bag is empty. Are you
sure you want to destroy it?". Once confirmed in the Wilderness, the contents drop to the floor for
anyone to see, except un-noted food, potions and vials of water, which are destroyed; noted items drop
(Wiki). Anywhere else, including the Ferox Enclave, everything is lost.

**Not done:** in recording 456 the server refused a destroy with "This doesn't seem like a good place
to destroy a looting bag.". The recording doesn't show what made the spot unsuitable.

## Death (Wiki)
Killed by a player, the bag is lost and the killer gets everything in it except food and potions.
