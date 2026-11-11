# Items kept on death

How `PlayerDeathTask` (`server/src/main/typescript/elvarg/game/task/impl/PlayerDeath.ts`) decides what a player keeps, and what an upgraded Nightmare staff turns into when it's lost to a player.

## The kept items (Wiki: Items Kept on Death)

- **How many:** 3, or 0 when skulled; Protect Item adds one (a red skull keeps none).
- **Which:** the most valuable items carried, **tradeable and untradeable alike**. An untradeable item among them takes one of the slots. Before, untradeable items were left out of the ranking, so a cheaper tradeable item took the slot: with Protect Item and a skull, a 125k light ballista was kept over a 4.6m volatile Nightmare staff.
- **Ranked by:** each item's Grand Exchange guide price (`item-prices.json`), or its high alchemy value when it has no price (Wiki: "the highest value determined first by effective Grand Exchange value, and then by alchemy value"). A stack is ranked by one item's price, as before. Before, items were ranked by their cache store value, which can run the other way: unskulled with a rune platebody, platelegs and kiteshield (store 54,400-65,000) and ranger boots, a berserker ring and dragon boots (store 200-20,000, but each worth more on the Grand Exchange), a death kept the rune armour.
- **Untradeable items outside the kept ones** go to the player's grave on a PvM death ([gravestones](gravestones.md)). On a PvP death, or with graves turned off, they are still kept, as before, unless they split (below) or break ([broken items](broken-items.md)).
- **Ornamented items** are kept beyond the count on a non-PvP death outside the Wilderness unless the player turns "Death protection from cosmetics" off ([settings](settings.md#death-protection-from-cosmetics-row-386)).
- **Preset items** (from `::presets`, flagged with item metadata) are always lost and never take a kept slot. That's by design: they're free.

## The Items Kept on Death interface (rsprox captures)

Opened from the Worn Equipment tab (`deathkeep`, group 4), it shows what a death would keep, from the same ranking (`PlayerDeathTask.getItemsToKeep`), for the count its skull and Protect Item toggles give.

- **Untradeable items are among the kept ones**: recordings 430 and 1463 list `skillcape_max_worn` and `infernal_defender` in `deathkeep_init`'s kept items. Before, the interface left untradeable items out of its ranking, so it could show a different set from the one a death kept.
- **Guide risk value** is the Grand Exchange value of the lost tradeable items. In recording 430, turning Protect Item on moved a sanfew serum(4) (store value 300) to the kept side and the risk value fell from 108,118 to 89,549: 18,569, over sixty times its store value. Before, the risk was the store value.
- **Bounty Hunter risk skulls** (`RiskSkulls.BountyHunter.js`) price the same lost set the same way, so the skull tier matches what a death in Daimon's Crater would drop. Before, they ranked the kept items by store value item by item, so with ranger boots and rune platebody, platelegs and sq shield the skull priced the boots as lost while a death dropped the shield.

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
