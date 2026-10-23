# Items kept on death

How `PlayerDeathTask` (`server/src/main/typescript/elvarg/game/task/impl/PlayerDeath.ts`) decides what a player keeps, and what an upgraded Nightmare staff turns into when it's lost to a player.

## The kept items (Wiki: Items Kept on Death)

- **How many:** 3, or 0 when skulled; Protect Item adds one (a red skull keeps none).
- **Which:** the most valuable items carried, **tradeable and untradeable alike**. An untradeable item among them takes one of the slots. Before, untradeable items were left out of the ranking, so a cheaper tradeable item took the slot: with Protect Item and a skull, a 125k light ballista was kept over a 4.6m volatile Nightmare staff.
- **Untradeable items outside the kept ones** go to the player's grave on a PvM death ([gravestones](gravestones.md)). On a PvP death, or with graves turned off, they are still kept, as before, unless they split (below) or break ([broken items](broken-items.md)).
- **Preset items** (from `::presets`, flagged with item metadata) are always lost and never take a kept slot. That's by design: they're free.

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

- **Dismantle and attaching orbs** (the Wiki's "reverted to its tradeable components at any time").
