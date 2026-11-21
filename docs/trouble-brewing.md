# Trouble Brewing

Code: `server/plugins/minigames/TroubleBrewing.plugin.js` and `server/plugins/minigames/troublebrewing/`.

## Water pumps

Each team's base has a water pump (`brew_water_pump`, loc 15936): blue at 3807,2954, red at
3806,2997. From rsprox captures (recording 1849, Leagues V, ticks 730, 1041, 1050 and 1362):

- Bucket on the pump: the first bucket fills on the tick the player arrives, with
  `human_pickuptable` (832), synth 2609 and the spam message "You fill the bucket.". Each
  further empty bucket fills one per tick with the same animation and sound but no message,
  until none are left. The filled bucket stays in the empty one's slot.
- Bowl on the pump: "That bowl is too small to hold a useful amount of water, try a bucket
  instead." and nothing changes.
- Ours: the other team's pump does nothing (not captured), like the other team stations.
- Ours: the watering hole still fills every bucket at once (not captured).

The stations' item-on-loc hook runs before the name-matched hooks, so Scrambled!'s "Bowl" on
any "Water Pump" handler does not fill a bowl at these pumps.
