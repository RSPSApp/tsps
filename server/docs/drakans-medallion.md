# Drakan's medallion

`plugins/items/DrakansMedallion.plugin.js` owns the item. Sins of the Father adds Darkmeyer and
The Blood Moon Rises adds Castle Drakan through the `drakan-medallion:destinations` custom event
(`{ player, destinations }`; a destination is `{ label, tile, onTeleport? }`).

## Confirmed

- **Destinations.** Inventory Teleport asks where. The worn amulet lists the destinations as its
  own options, in the rev 241 cache's worn params 451-454: Ver Sinhaza, Darkmeyer, Slepe, Castle
  Drakan. A destination the player has not unlocked does nothing. Wiki:
  https://oldschool.runescape.wiki/w/Drakan%27s_medallion
- **Landings.** Live OSRS lands Ver Sinhaza at 3649,3230 (recordings 396, 403, 1429, 4266, 4288),
  Darkmeyer at 3592,3337 (recordings 396, 411, 1636, 1637) and Slepe at 3166,7711 (recording
  4269). Each is a standard teleport: `teleport_casting` and `human_castteleport` on the click,
  the move on tick 3 with busy varbit 12393 set until it.
- **Access.** Ver Sinhaza has no unlock, so A Taste of Hope's reward works at once. Darkmeyer
  needs Sins of the Father. Slepe is unlocked by using a Slepey tablet on the medallion, which uses
  the tablet up (https://oldschool.runescape.wiki/w/Slepey_tablet). Castle Drakan needs the
  shrine in the castle (The Blood Moon Rises). No destination works past level 20 Wilderness.

## Not done

- The message when the tablet is used (the Wiki says only that the medallion "feels somehow
  different") and Slepey tablet drops from Phosani's Nightmare: no capture of either.
- The rev 241 inventory Teleport is a client submenu (Wiki, 30 June 2026 update); the recordings
  are older and show one inventory option per destination, so the chat-box menu is kept.
