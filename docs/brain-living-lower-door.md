# Zombie pirates' living lower door

The living lower door in the zombie-pirate hideout (`brain_living_lower_door`, loc 22007)
is a short-lived swinging door. At (3817,2841,0), Open plays synth 62, replaces the doorway
with `inviswall` 38848, and places `brain_living_lower_door_secureopen` (21953) one tile west
at (3816,2841,0), rotation 1. The closed door returns two ticks later, without a close sound.

The public rsprox recording 3032 (revision 231) shows this at ticks 4905-4910 and repeats the
open at ticks 5074-5076. The first Open starts from (3816,2844,0), reaches (3816,2841,0) at
4906, faces the door on 4907, then crosses east to (3817,2841,0) as the locs swap and synth 62
plays at 4908. The door returns at 4910. The second Open starts in reach on the east tile
(3817,2841,0) and crosses west to (3816,2841,0) on its input tick, 5074; the door returns at
5076. Thus an approached Open resolves two ticks after arrival, while an in-reach Open resolves
on its input tick. The passage is across the west edge (x=3817), in either direction.

The cache also places loc 22007 at (3817,2847,0), in the same region. Recording 3032 only
establishes behavior at (3817,2841,0); behavior at the second placement is unrecorded and remains
unimplemented until it can be captured.

`server/tests/brain-living-lower-door.test.cjs` sends native object-option packets and advances
`World.process()`. It checks east-west crossings from both sides, the delayed walked approach,
sound timing and the two-tick restore on the real cache map. The in-game check uses the worktree
agent MCP at the recorded door tile.
