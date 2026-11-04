# Mithril seeds

The `MithrilSeeds` item plugin handles the `Plant` action. It consumes one seed, places the
cache's `Flowers` object at the player's tile, then opens the one-time `Pick the flowers` /
`Leave the flowers` choice for that player. The flowers remain for 499 ticks when left. Their
reward is selected when picked from the OSRS Wiki's 1,001-part table. Planting has no animation;
picking plays sequence 827.

Planting moves one tile west, east, south, then north, choosing the first clipped step that is
available. The movement queue permits that single step through a spell freeze, while retaining
collision checks and other movement locks, matching the [Mithril seeds Wiki page](https://oldschool.runescape.wiki/w/Mithril_seeds).
The flower object remains visible in the world, but its `Pick` interaction is consumed; only the
planter can claim it through the dialogue shown on planting.

Planting rejects scenery visible on the destination tile, including loaded cache map locs in
normal-map private encounters, template locs in templated instances, and the player's own
private-area scenery. Runtime objects in a different private area at the same coordinates do
not block the attempt.

RSProx captures 446 and 1604 confirm the Plant message, flower object id 2986, the Pick/Leave
dialogue, sequence 827 on Pick, the orange-flower reward id 2470 in one observed pick, and flower
removal about 499 ticks after planting. Capture 468 also shows the Plant/Pick flow. The captures
do not show a planting animation. Account details and raw capture logs are intentionally omitted.
