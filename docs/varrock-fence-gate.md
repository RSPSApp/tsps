# Varrock fence gate by the quetzal platform

The two-leaf fence gate east of Varrock (`vm_fencegate_l` 24560 at 3296,3428 and
`vm_fencegate_r` 24561 at 3296,3429, both rotation 0) lets the player through and
shuts behind them. It never stays open.

From rsprox captures 232/3228 (ticks 561-568, 642-644 and 931-937), 232/3227
(tick 4504) and 232/3231 (tick 288):

- The gate opens the tick after the player reaches the doorway, from either side (on the click
  tick if they are already standing there).
- Opening adds `vm_fencing_invisible_wall` (24562) on both gate tiles, rotation 0, and
  swings the leaves west: 24561 at 3295,3429 and 24560 at 3294,3429, rotation 1.
- The player walks across on the next tick, to 3295 going west or 3296 going east.
- The closed leaves are back two ticks after the gate opened.
- No synth is sent for the gate. The only sound in those windows is the patrol
  wheelbarrow's area sound 3670.

The gate is a `PASS_THROUGH_GATES` entry in `server/plugins/objects/Doors.plugin.js`,
with `silent: true` for the missing sound. It is tested in
`server/tests/varrock-fence-gate.test.cjs`.
