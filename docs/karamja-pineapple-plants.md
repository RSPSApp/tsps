# Karamja's pineapple plants

The wild pineapple plants of Karamja (locs `pineapple_plant` 1408, `_four` 1409, `_three` 1410, `_two`
1411, `_one` 1412; each has Pick) are `server/plugins/objects/PineapplePlant.plugin.js`.

Recordings 552, 1102 and local 1000195, 1000359 and 1000412 (revs 227 and 237) show Pick, the tick after
the arrival, giving synth 2581, "You pick a pineapple." (spam), +1 pineapple, and the plant one stage
down (`pineapple_plant` to `_four`). Recording 1102 shows plants climbing back up a stage at a time
(`_two` to `_three` to `_four`).

Ours, as no recording picks the last stage or times the regrowth:
- the one-pineapple plant, picked, goes until it regrows;
- each picked plant grows back one stage every 100 ticks, to the full plant;
- a full inventory gets Pickable's "Your inventory is too full to hold any more.".

A pick sends "world:picked" { player, itemId, plant } as Pickable's crops do (the league's "Pick a
Pineapple on Karamja"). The Wiki's Pineapple plant page is the Farming fruit tree, not these.
