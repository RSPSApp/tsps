# Items kept on death

How `PlayerDeathTask` (`server/src/main/typescript/elvarg/game/task/impl/PlayerDeath.ts`) decides what a player keeps, and what an upgraded Nightmare staff turns into when it's lost to a player.

## The kept items (Wiki: Items Kept on Death)

- **How many:** 3, or 0 when skulled; Protect Item adds one (a red skull keeps none).
- **Which:** the most valuable items carried, **tradeable and untradeable alike**. An untradeable item among them takes one of the slots. Before, untradeable items were left out of the ranking, so a cheaper tradeable item took the slot: with Protect Item and a skull, a 125k light ballista was kept over a 4.6m volatile Nightmare staff.
- **Ranked by:** each item's Grand Exchange guide price (`item-prices.json`), or its high alchemy value when it has no price (Wiki: "the highest value determined first by effective Grand Exchange value, and then by alchemy value"). A stack is ranked by one item's price, as before. Before, items were ranked by their cache store value, which can run the other way: unskulled with a rune platebody, platelegs and kiteshield (store 54,400-65,000) and ranger boots, a berserker ring and dragon boots (store 200-20,000, but each worth more on the Grand Exchange), a death kept the rune armour.
- **Untradeable items outside the kept ones** go to the player's grave on a PvM death ([gravestones](gravestones.md)). On a PvP death, or with graves turned off, they are still kept, as before, unless they split (below), break ([broken items](broken-items.md)), are never kept (below, on any unsafe death), or are quest rewards that become coins for the killer: barrows gloves and the barrelchest anchor (Quest rewards that become coins, below).
- **Ornamented items** are kept beyond the count on a non-PvP death outside the Wilderness unless the player turns "Death protection from cosmetics" off ([settings](settings.md#death-protection-from-cosmetics-row-386)).
- **Preset items** (from `::presets`, flagged with item metadata) are always lost and never take a kept slot. That's by design: they're free.

## Never kept on death (Wiki: Items Kept on Death, "Items that are never kept")

These items are destroyed on any unsafe death, PvP or PvM: they take no kept slot (even as the most valuable item, or with Protect Item), are not dropped for a killer, go to no grave and are not given back. The Wiki gives a PvP-only qualifier for the rune and bolt pouches alone.

- **Rune pouch and divine rune pouch** (`runepouch/Death.RunePouch.js`), on a PvP death only: the runes inside still drop for the killer ([rune pouch](rune-pouch.md)).
- **The rest** (`NeverKeptOnDeath.plugin.js`, names in `plugins/items/data/never-kept-on-death.json`): the clue box, the Chronicle, League trophies, the degraded amulet of the damned, and the items with no ground state: the Flamtaer bag, Lunar equipment and staff, the Ring of Charos, Steel gauntlets and their enchanted forms, and the magic butterfly net. Items with a death rule of their own (looting bag, jar generator, salamanders) keep it. A noted clue box is a tradeable stack and is not one of them. The Items Kept on Death screen marks these items deleted (368), through `items:never-kept-on-death` { item, neverKept }.
- **Not covered:** a rune pouch can still take a kept slot on a PvP death. "Most untradeable event rewards" and ancient artefacts, which the Wiki also lists, are not named.

## Quest rewards that become coins (Wiki: Items Kept on Death, Barrows gloves, Barrelchest anchor)

Untradeable quest rewards with combat stats that are bought from an NPC turn into coins for the killer on a PvP death, unless they are among the kept items. The item is lost, and the coins drop for the killer as the rest of the loot does (an Ironman killer's go to the victim). A preset copy gives no coins.

- **Items** (`QuestRewardDeathCoins.plugin.js`, ids and amounts in `plugins/items/data/quest-reward-death-coins.json`): barrows gloves, 78,000 coins; the barrelchest anchor, 230,000 coins. They are matched by id: the broken barrelchest anchor and a second barrows gloves item share the names but give no coins.
- **PvM deaths** leave them to the grave, as any other untradeable.
- **Not covered:** the Wiki names no other items or amounts for this rule. It also says metal gloves become a cash drop, without an amount, so they are left as they were.

## The Items Kept on Death interface (rsprox captures)

Opened from the Worn Equipment tab (`deathkeep`, group 4), it shows what a death would keep, from the same ranking (`PlayerDeathTask.getItemsToKeep`), for the count its skull and Protect Item toggles give.

- **Untradeable items are among the kept ones**: recordings 430 and 1463 list `skillcape_max_worn` and `infernal_defender` in `deathkeep_init`'s kept items. Before, the interface left untradeable items out of its ranking, so it could show a different set from the one a death kept.
- **Guide risk value** adds up every item the death does not keep: lost, sent to the gravestone or deleted, untradeables included. Coins and platinum tokens count at face value; other items at their Grand Exchange price, else their alchemy value (`PlayerDeathTask.keepValue`). Perdu repair costs are not counted. In recording 430, turning Protect Item on moved a sanfew serum(4) (store value 300) to the kept side and the risk value fell from 108,118 to 89,549: 18,569, over sixty times its store value. In recording 1463, 305,509,624 lost coins sit in a 305,832,958 risk, and in recording 435 keeping the untradeable Barrows gloves as the fourth item lowers it by 74,400. Ours: live prices some untradeables by its own value (those gloves at 74,400, here their 60,000 alchemy value).
- **Item markers** (`diango_hols_sack`, inventory 468, one object per listed item; clientscript 974 sorts the items by them): 323 kept; 367 to the gravestone, with a count of the item's grave fee plus one (1, 1,001, 10,001 or 100,001, per the [gravestone](gravestones.md) fee bands); 1991 lost to the killer, or dropped where the player dies; 7531 to the grave as coins; any other object deleted. Recordings 430, 780 and 4266 mark every unkept item 367 on a PvM preview, with 100,001 on the 10m+ items in 780 and 4266, and 1991 only once the PvP toggle is on (430). The Wilderness toggle doesn't change the markers (430). The looting bag is marked 368, deleted: the Wiki says it "disappears completely". Before, every unkept item was 1991, so a PvM preview listed it as lost to a killer and showed no grave fee.
- **Not covered:** the "as coins" (7531) and "deleted" sections for anything but the looting bag (Wilderness supplies, never-kept items on a PvP death): no recording shows them. The Rusty coin has no death rule on the server or the Wiki, so it goes to the grave like other untradeables.
- **Bounty Hunter risk skulls** (`RiskSkulls.BountyHunter.js`) price the lost tradeables the same way (untradeables and coins left out), so the skull tier matches what a death in Daimon's Crater would drop. Before, they ranked the kept items by store value item by item, so with ranger boots and rune platebody, platelegs and sq shield the skull priced the boots as lost while a death dropped the shield.

## Upgraded Nightmare staffs (Wiki)

The harmonised, volatile and eldritch Nightmare staffs are untradeable. When one is lost on death in the Wilderness, the killer gets the Nightmare staff and the orb.

- **Data:** `deathComponents` on the item in `item-gameplay.json`: `[24422, <orb>]` for each staff (orbs 24511, 24514, 24517). Other items with tradeable components can use the same field.
- **When:** the death's killer is a player (`Combat.getKiller`), the victim is in the Wilderness (`Wilderness.isIn`), and the staff isn't one of the kept items. The components then go through the normal drop, so they land on the floor for the killer, or in a loot key.
- **Never for preset items:** they're deleted first, so a killer can't get a free staff and orb from spawned gear.
- **Everywhere else** (PvM deaths, minigames that handle their own deaths) the staff is kept as before.

## Special attack graphics (cache)

There are no captures of either staff, so these come from the cache's names:

| Special | Caster | Target |
| --- | --- | --- |
| Immolate (volatile) | `nightmare_staff_special` (8532), `nightmare_staff_volatile_cast_spotanim` (1760) | `nightmare_staff_volatile_hit_spotanim` (1759) |
| Invocate (eldritch) | 8532, `nightmare_staff_eldritch_cast_spotanim` (1762) | `nightmare_staff_eldritch_hit_spotanim` (1761) |

- A miss shows the usual magic splash (85) instead of the hit graphic.
- **Immolate's animation never showed before:** ending the special reset combat with the reset animation on the same tick, which cancelled `nightmare_staff_special`. It now resets without it.
- Immolate has no projectile (Wiki).
- **Inferred:** the Wiki gives Invocate its own attack animation; `nightmare_staff_special` is the only special attack animation the cache has for these staffs. Before, Invocate had no animation or graphics, and Immolate no graphics.

## Not covered

- **Stacks:** neither the Wiki page nor the captures show whether a stack of a valuable item fills one kept slot or is counted item by item, so a stack is still kept or lost whole.
- **Dismantle and attaching orbs** (the Wiki's "reverted to its tradeable components at any time").
