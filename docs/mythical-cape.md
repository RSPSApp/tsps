# Mythical cape

The Mythical cape (bought in the Myths' Guild, worn only after Dragon Slayer II) has a
**Teleport** option in the inventory and, when worn, in the equipment tab. Both take the player
to the Myths' Guild with no charges and no daily limit
([Wiki](https://oldschool.runescape.wiki/w/Mythical_cape)). The Wiki gives no Wilderness,
cooldown or message rules for it.

Implemented in `server/plugins/items/MythicalCape.plugin.js` and hooked by item name.

## Confirmed against live OSRS

- Recording 1437 (rev 224): the inventory Teleport plays the standard teleport cast
  (`human_castteleport`, `teleport_casting` graphic) and lands on (2458, 2850, 0) three ticks
  later. The cape stays in the inventory and no chat message is sent.
- The 241 cache gives item 22114 the inventory option `Teleport` (third option) and worn
  option 451 `Teleport`. The mounted cape in the player-owned house uses the same tile
  (`Mounted.Construction.js`).
- The teleport goes through the shared teleport checks (Wilderness level 20 limit); these are not from a capture.

## Not done

- The Mythical max cape (24855) also lists `Teleport` in the cache, but neither the Wiki
  nor any recording gives its destination, so it is left alone.
- Worn Teleport is covered by the same hook as the inventory option (`PluginManager`
  resolves worn option 451); it was not clicked in game because wearing the cape needs Dragon
  Slayer II.
