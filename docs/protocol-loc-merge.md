# Legacy player/object merge packet

`LOC_MERGE` (TSPS opcode 138, 18-byte payload) exposes the legacy OSRS
player/loc merge contract through `Player.mergeObject(object, start, end, bounds)`.
It sends to the player and recipients whose player-sync view contains that player.
It does not change collision, remove the server object, or save attachment state.

The payload is big-endian: loc id, absolute x/z (unsigned shorts), level and
packed shape/rotation (bytes), player index, start/end (unsigned shorts), then
minX/minZ/maxX/maxZ (signed bytes). Delays are 20ms client cycles. Reversed
bounds are valid and remain unchanged on the wire. The native gateway translates
to rsprot's revision-241 `LocMerge` using ordinary zone/deck routing.

## Revision boundary

The active revision-241 native client consumes this packet without applying a
model attachment or changing scenery. The browser therefore explicitly consumes
it without a rendering or world-state mutation. It does not emulate an older
client's model-attachment implementation.

This was checked against the bootstrap-locked injected-client 1.13.3 artifact,
SHA-256 `f4ba0a5c9f1e0fd57d201d2e9f8fc8b2a7a77d755d296c665a37c1c026b40019`.
Its initializer selects revision 241. Native opcode 43 has length 14 and dispatches
to the `ec.df` branch selected by `jv.ab`: the ten decoded fields are discarded,
with no player lookup, model construction, scene removal or state assignment.
The first revision to stop applying the historical effect was not established.

## Captured consumer

RSProx **231/00714, ticks 260–261** shows the underwater obstacle at
`3760,10277,1`: facing on the preceding tick, `human_swim_cavewall`, exact
movement `0..60`, and a merge with shape 10, rotation 3, start 0, end 60,
minX 1, maxX -1 and both z offsets 0. The existing two-way agility step now
sends this packet on the exact-movement tick. Reversing the x bounds describes
the same normalized area when travelling back.

The [Underwater Agility and Thieving Wiki page](https://oldschool.runescape.wiki/w/Underwater_Agility_and_Thieving#Obstacles)
states that crossing these obstacles awards 4.5 Agility XP and cannot fail.
The selected consumer follows that XP value over the recording's absent XP
update. No changes are claimed for the activity's other obstacles or rewards.

The [pinned revision-241 loc definitions](https://github.com/Joshua-F/osrs-dumps/blob/6e5033af6215963581a51b348f452320ff18f0f6/config/dump.loc)
and active cache identify `fossil_underwater_cave_obstacle1` as 30962 with
`Navigate` as its first option. Local captures establish the timing, rather
than inferred animation lengths or another server implementation.

This implements one protocol slice of #590. It does not claim historical
revision-231 visual parity or completion of that umbrella issue.
