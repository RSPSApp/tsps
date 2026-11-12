# Run energy

Drain and recovery follow the Wiki's Energy page
(<https://oldschool.runescape.wiki/w/Energy>): drain `floor(60 + 67 * clamp(weight, 0, 64) / 64) * (1 - agility / 300)`
units per running tick, recovery `floor(agility / 10) + 15` units per tick that was not spent
running, 10,000 units = 100%. The formulas live in `MovementQueue.runEnergyDrainUnits` /
`runEnergyRestoreUnits`.

## Which ticks drain

Only a tick in which the player moved two tiles is a run tick. With Run on, a tick that moves
one tile (an adjacent click, or the last odd tile of a path) is a walk: it costs no energy and
the tick still regenerates energy, matching the Wiki's note that walking to an adjacent tile
does not drain energy even with Run on.

Live evidence (rsprox captures, revisions 223-239): with the run varp on, 41,751 of 41,889
ticks that moved two tiles lowered the energy shown, while 4,867 of 6,357 ticks that moved one
tile raised it (the other 1,490 one-tile ticks lowered it; their cause was not investigated).
Tick-to-tick position comes from the camera target and energy from
`update_runenergy`.

Regression: `server/tests/run-energy.test.cjs` ("a run tick that moves one tile is a walk").
