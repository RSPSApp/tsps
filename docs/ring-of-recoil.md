# Ring of recoil

The reflect itself is core (`CombatFactory.handleRecoil`: 10% + 1 of each damaging hit, rounded
down, up to 40 damage points counted per player rather than per ring). `RingOfRecoil.plugin.js`
adds the rest of the ring's behaviour from the OSRS Wiki.

Sources, all fetched on 7 November 2026: the
[Ring of recoil](https://oldschool.runescape.wiki/w/Ring_of_recoil) page, its
[transcript](https://oldschool.runescape.wiki/w/Transcript:Ring_of_recoil) and
[Category: Monsters immune to recoil](https://oldschool.runescape.wiki/w/Category:Monsters_immune_to_recoil).
There are no indexed rsprox recordings of these item actions, so none is cited.

## Check (worn)

Prints `You can inflict N more points of damage before a ring will shatter.` with the damage
points left on the player's counter (transcript).

## Break (inventory)

- A ring that has not been used (40 points left) is refused: "The ring is fully charged. There
  would be no point in breaking it."
- A used ring asks `Status: N damage points left.` with `Break the ring.` / `Cancel.`.
  Breaking destroys that ring and resets the counter, so the next ring starts with all 40:
  "The ring shatters. Your next ring of recoil will start afresh from 40 damage points."
- Only the ring itself has it, not a noted ring, and not from the worn slot.

The Wiki lists a glass-break sound for Break; its id is not captured, so none is played.

## Monsters that take no recoil

Category: Monsters immune to recoil lists the monsters the ring (and the ring of suffering's
recoil) cannot damage. `CombatFactory.canReceiveRecoil` now also asks the `combat:recoil-target`
custom event (`{ target, allow }`); the plugin answers `allow = false` for the NPC names in
`plugins/items/data/recoil-immune-npcs.json`. Hespori keeps its own `combat:recoil-immune`
attribute. An immune monster spends none of the wearer's 40 points.

Left out because the Wiki name is shared with monsters that are not immune: the Skeleton
Hellhound and Greater Skeleton Hellhound (only Vet'ion's and Calvar'ion's), Evil Chicken, Ogre
shaman, Bee Swarm, Husk, Parasite and Undead tree.

## Checks

- `tests/ring-of-recoil.test.cjs`: Check text, Break refusal / Cancel / Break, inventory-only and
  un-noted-only, immune names, and a real `canReceiveRecoil` / `handleRecoil` round trip. The new
  cases fail without the plugin and the core hook.
- In game: Check read 39 after a Hill Giant's hit (and 40 on a fresh player); Break on a used ring asked
  `Status: 34 damage points left.`, Cancel kept the ring and counter, Break removed the inventory
  ring and Check read 40. Callisto hit the wearer from 99 to 36 Hitpoints with the counter still at
  40 and the ring still worn.
