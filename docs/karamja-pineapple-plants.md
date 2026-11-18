# Karamja's pineapple plants

The wild pineapple plants of Karamja (locs `pineapple_plant` 1408, `_four` 1409, `_three` 1410, `_two`
1411, `_one` 1412; each has Pick) are `server/plugins/objects/PineapplePlant.plugin.js`.

Recordings 552, 1102 and local 1000195, 1000359 and 1000412 (revs 227 and 237) show Pick, the tick after
the arrival, giving synth 2581, "You pick a pineapple." (spam), +1 pineapple, and the plant one stage
down (`pineapple_plant` to `_four`). Recording 1102 shows plants climbing back up a stage at a time
(`_two` to `_three` to `_four`).

The last pineapple leaves `pineapple_plant_no_pineapples` (1413), the bare plant placed on these tiles in
recordings 75, 549, 1104, 1710 and 1851 (1851 tick 17595: all five Karamja plants bare). In 1710 a bare
plant at 2760,3157 went straight back to the full one (1413 at tick 6301, 1408 at 6334).

Ours, as nothing times the regrowth:
- a bare plant is full again 100 ticks after its last pick;
- a part-picked one grows back one stage every 100 ticks;
- a full inventory gets Pickable's "Your inventory is too full to hold any more.".

A pick sends "world:picked" { player, itemId, plant } as Pickable's crops do (the league's "Pick a
Pineapple on Karamja"). The Wiki's Pineapple plant page is the Farming fruit tree, not these.
