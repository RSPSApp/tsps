# Zombie pirates' living lower door

The living lower door in the zombie-pirate hideout (`brain_living_lower_door`, loc 22007)
is a short-lived swinging door. At (3817,2841,0), Open plays synth 62, replaces the doorway
with `inviswall` 38848, and places `brain_living_lower_door_secureopen` (21953) one tile west
at (3816,2841,0), rotation 1. The closed door returns two ticks later, without a close sound.

The public rsprox recording 3032 (revision 231) shows this at ticks 4905-4910 and repeats the
open at ticks 5074-5076. It records the loc swaps, sound and timing. It does not establish the
opener's crossing direction. Ours: the handler uses the shared north/south pass-through movement
while the doorway blocker is present.

`server/tests/brain-living-lower-door.test.cjs` checks the map swap, sound, route ordering and
two-tick restore on the real cache map. The in-game check uses the worktree agent MCP at the
recorded door tile.
