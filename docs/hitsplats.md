# Hitsplats

How the client places hitsplats on an actor, from the r241 client (`Actor.addHitsplat`,
`HitsplatLayout`) and rsprox captures.

## Wire format

Each hit in the player and NPC hit blocks is four smarts: hitsplat type, amount, delay (client
cycles) and **limit**, how many slots the actor may use for it. r241 has no secondary ("soak")
splat and no `32766`/`32767` placeholders.

Every hit in the rsprox recordings that carry the limit is **8**: 265,432 hits in 142
recordings (revisions 237 and 238; older revisions don't have the field). The server sends 8
(`HITSPLAT_SLOT_LIMIT` in `ClientProtocol.ts`).

## Slots

An actor keeps a list of slots that grows one at a time. A slot keeps its index, and the index
picks its screen offset from `HitsplatLayout` (100 offsets: centre, above, left, right, then a
spiral outwards; `client/game/actor/HitsplatLayout.ts`).

For a new hit with type >= 0 and limit > 0:

- **Limit over 4 (live):** the lowest free slot, adding one while the list is under the limit.
  A target hit once a tick (30 cycles; damage splats show for 50) alternates centre and above.
- **Limit 4 or less:** the slot after the last one still showing, wrapping round.
- **Every slot showing:** the hitsplat definition's replacement mode (cache opcode 12) picks
  one: 0 replaces the one that expires first, 1 the lowest value when the new one is higher.
  With no replacement mode the hit is not shown.
- A delayed hit holds its slot from the moment it arrives, but shows only after its delay.
- A hit with type -1 takes no slot.
