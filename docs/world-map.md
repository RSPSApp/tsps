# World map

The world map is interface 595, opened as an overlay from the minimap's world map orb (`orbs:worldmap`, 160:55). The client draws the map itself; the server tells it where the player is through clientscript `worldmap_transmitdata` (1749), whose first argument is the player's coordinate (the other two are null, sent as -1).

## The player's position

Facts from a live OSRS capture (rsprox) of a player opening the map and running around Lumbridge with it open:

- **On opening**, the server runs 1749 with the player's coordinate, then opens 595 (`if_opensub` on `toplevel_pre_eoc:floater`, 164:18) and sets the events on `worldmap:toggles` (595:21, slots 0-4, OP1).
- **While the map is open**, the server runs 1749 again **every 3 ticks**, counted from the tick the map opened on, **only if the position changed** since the last time it was sent. Opening at tick 15787, the player started running at 15790: nothing was sent at 15790, then 15793, 15796 and 15799 each sent a new position.
- **The position sent** is the player's tile at the start of that tick, one step behind where the same tick's player update moves them.
- **On closing** (`if_closesub` of 595), the updates stop.

## Aboard a boat

From a second capture of a player opening the map, boarding a boat, and sailing with the map open. A player aboard stands on the boat's deck, in an instance region, so their own tile would put the marker nowhere on the map:
- **The position sent** is the boat's own tile, its world entity's coordinate (`0_48_46_3_43` for a boat at that tile; the player's deck tile was `1_60_100_36_52`). This applies both when opening the map aboard and in the updates.
- **The same 3-tick rule** holds, counted from when the map opened, and it carries over boarding. A map opened on land at 19961 sent the player's tile at 19964, then the boat's tile at 19967, after boarding.
- **Unlike on land,** the tile sent is the boat's new tile from that same tick. At 20001 the boat moved from `14_54` to `16_55`, and `16_55` was sent.

## Implementation

- `PacketSender.toggleWorldMap` opens and closes the map. Opening sends the position from `worldMapLocation()` (the player's tile, or the boat's `Boat.worldTile()` aboard) through `sendWorldMapPosition`, which remembers the last position sent (`getWorldMapPosition`).
- `server/plugins/interface/WorldMapPosition.plugin.js` sends the updates. On each player tick it counts the ticks since the map opened, and every 3 ticks it sends the position if it differs from the last one sent:
  - **On land:** the start-of-tick position.
  - **Aboard:** boats move after the players, so the player is queued and a `BoatManager.onAfterTick` listener sends the boat's tile once it has moved.
- `server/tests/world-map-position.test.cjs` replays both captures' ticks and checks the same sends.
