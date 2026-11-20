# Alchemical Hydra

Code: `server/plugins/bosses/alchemicalhydra/` (Common, Lair, Combat, Fight, Kills), data in
`server/plugins/bosses/data/alchemical-hydra.json`. This page holds the capture facts the fight
relies on. Behaviour the [Wiki](https://oldschool.runescape.wiki/w/Alchemical_Hydra/Strategies)
states (max hits, damage, poison, the phase thresholds) follows the Wiki. Where a recording
disagrees with a Wiki value, the Wiki is used and the recording is listed as a **recorded
difference**.

The recordings are the user's own rsprox captures 1000143, 1000471, 1000473, 1000480 and 1000497
(revision 227, December 2024, 150+ kills from kill counts 1 to 99, two accounts). They are indexed in
the rsprox index. Ticks below are counts of events across them.

## Reach and movement (issue 6284)

- The Hydra (6x6) stays where it is while the player is within **4 tiles of its footprint**, and
  walks toward them at 5 or more. Measured against the player's tile on the previous tick (NPCs
  move first): it stays on 13,643 of 13,773 ticks at distance 4 and walks on 1,654 of 2,078 at 5.
  Most of the rest are its form changes and the flame special.
- It walks and attacks on the same tick.

## Attacks

- Every 6 ticks, 4 once enraged.
- **Pattern:** three basic attacks a style, then the other style. The count carries over a phase
  change (a phase ending on its first ranged attack opens "R, switch, M, M, special").
  `hydra_stage_N_switch_attack` (9111-9113) plays 3 ticks after the third attack of a style, also
  before a special. A phase's 4th attack is its special, then every 10th (nine basic attacks
  between), seen in 30 runs past the second special. Enraged, the style alternates every attack,
  the first opposite the last. Its poison is thrown with `hydra_stage_4_attack_ranged` and doesn't
  change the style.
- **Projectiles:** serpentine fires 2 a style, electric 2 magic and 1 ranged, flame and enraged 1
  (5,671 attacks). Each projectile is one hit. Flights start at cycle 30 and end at
  **40 + 5 per tile** (Chebyshev) from the Hydra's south-west tile to the target (2,786 flights, no
  exception). The hit shows `floor(end / 30)` ticks after the attack (an 85-cycle flight hits on
  the 2nd tick). The first head's flight starts at height 30, the second's at 35, ending at 16.
- **Heads:** the launch tile depends on how the Hydra faces the target. Magic comes from the head
  45 degrees to its left, ranged from 45 degrees to its right, on the footprint's edge (table
  `projectiles.heads`). A second head launches from the same tile pulled into the inner 4x4.
- **Max hits:** the Wiki infobox, per style. The electric magic is 17 per head (114 recorded
  electric magic hits never pass 17, while its ranged hits reach 31, or 45 empowered). So the
  infobox's electric "35" is its ranged attack and "26x2" its empowered magic.
- **Sounds:** magic 4083, ranged 4120 (on the target, delayed to the landing, range 1); switch 4106.

## Vents

- The three geysers (`hydra_geyser` 8279) erupt together every **8 ticks** of the world's clock
  (3,856 of 3,863 gaps). They keep going between Hydras and stop while nobody is in the chamber.
  `hydra_geyser_off` (8280) follows 5 ticks later. Sound 4078, delay 38, range 10, on each vent.
- **2 ticks after the eruption**, a vent tile **inside** the Hydra's 6x6 footprint counts (934 of
  934 messages; a vent a tile outside it never does):
  - its phase's colour, while shielded: the shield goes, "Roaaaaaaaaaaar!" (sound 4076), and
    "The chemicals neutralise the Alchemical Hydra's defences!". This happens once a phase.
  - any other vent: "The chemicals are absorbed by the Alchemical Hydra, empowering it further!",
    every eruption, the enraged form included.
- While shielded, a player's hit that lands shows "The Alchemical Hydra's defences partially absorb
  your attack!" on the attack's tick.

## Phase changes

- At the threshold the Hydra becomes `hydraboss_pN_transition` with `hydra_stage_N_death`. It
  becomes the next form with `hydra_stage_N+1_spawn` after **2** ticks out of serpentine (142 of
  157 changes; otherwise 3), **1** out of electric (134; otherwise 2), and **2** out of flame (86;
  71 took 3).
- Attacking it meanwhile gives "You cannot attack the Alchemical Hydra as it changes form!".
- Its first attack comes 6 ticks after the spawn sequence, 4 once enraged. "The Alchemical Hydra
  becomes enraged!" shows on the enraged spawn tick.

## Poison (serpentine, enraged)

- Five blobs (`hydraboss_pools_proj` 1644, heights 40 to 31), the first on the player's tile, the
  others on tiles within a few tiles of it. Flights run 30 to **60 + 10 per tile**, each with sound
  4135 (range 5) at its landing, and `hydraboss_pools_splash` delayed to the landing.
- They land 3 ticks later (`hydraboss_pools_landing_<angle>`), and the pool
  (`hydraboss_pools_landed_<angle>`) shows a tick after that.
- The pool is the blob's own tile: players standing next to a fresh pool took nothing on 363 of 376
  ticks. It hurts on each of the 13 ticks after it shows (all 56 recorded ticks stood in), and
  never from the 14th.
- Enraged it throws **one** blob while the flame phase's fire blockers stand (94 of 98) and five
  once they are gone (53 of 55). This is the Wiki's "if fires from the previous phase are still
  present".
- **Recorded difference:** pool ticks hit 2-7 in the recordings; the Wiki's "up to 12" is used.

## Lightning (electric)

- `hydraboss_lightning_caster` (1664) flies 30 to 40 + 5 per tile onto (1367, 10267) every time,
  and shows there at height 255.
- 3 ticks later four `hydraboss_lightning_travel` (1665) flights leave it (start 15/45/75/105, end
  30/60/90/120), one to a random tile of each quadrant's 3x3 block (x 1360-1362 or 1371-1373,
  y 10261-10263 or 10272-10274), in a random order.
- Each current then shows `hydraboss_shockwave` (1666, sound 3887, range 3) on its tile once a
  tick, from one tick after its flight, stepping a tile toward the player each tick, for 12 ticks.
- Reaching the player: a hit, "<col=ff0000>The electricity temporarily paralyzes you!</col>", and
  the current is gone. A player who clicked on the hit tick first moved 3 ticks later, every time.
- **Recorded difference:** hits are 8-17; the Wiki's 22 is used.

## Fire (flame)

- The Hydra walks to its spawn tile (1364, 10265), diagonal steps first. A player in the way doesn't
  stop it; one left under it when it arrives is pushed out to a random side (the Wiki: "forced out
  in a random direction"; the side picked is ours). The tick it arrives,
  `invisible_type8_blocking` (26209) covers its footprint, and a tick later "The Alchemical Hydra
  temporarily stuns you." shows (104 of 104). A stunned player first moved 7 or more ticks later.
- `hydra_stage_3_attack_special` plays three times, 3 ticks apart (blockers +3, +6, +9). The
  Hydra faces 15 tiles out (`face_coord`). From the player's diagonal the first breath is turned
  45 degrees clockwise and the second 45 degrees counter-clockwise: a player NW gets north then
  west, NE gets east then north (83 of 83 runs; none recorded from the south).
- Each of those two breaths is a wall **4 wide** (the footprint's inner four columns or rows) and
  **8 long** out of that side, with `hydraboss_fire` (1668) delayed 45 + 5 per tile.
  `hydraboss_fire_travel` (1667, 30 to 45) flies from footprint tile (+1, +4) onto the first row,
  and sound 4099 plays per row (range 15 for the first, 10 after).
- The third breath faces the diagonal itself and starts a tracking fire on the footprint's
  corner-adjacent tile (sound 4133). The fire follows the player for up to 11 ticks, sometimes
  two tiles in one tick (15 cycles apart). It hits on reaching their tile: "The fire scorches you
  leaving a lingering burn...".
- The burn: "You continue to suffer from the burn." at 5, 10, 15 and 20 ticks after the scorch, each
  with a hit of 5, then "The burn clears up." at 25.
- The next attack comes **12 ticks** after the third breath, every time it wasn't cut short by a
  phase change.
- The blockers turn into `invisible_type8_nonblocking` (29733) 56 ticks after they came (30 of 70
  runs). The rest were cut short by the kill or a phase change.
- **Recorded difference:** fire hits are 9-17; the Wiki's 25 is used.

## Death and kill

- At 0 hitpoints the enraged form plays `hydra_stage_4_death` (8257, sound 4080). 3 ticks later it
  becomes `hydraboss_finaldeath` playing `hydra_death` (8258), and it is removed 7 ticks after
  that (152 kills).
- On the removal tick: "Fight duration: ..." (counted from the Hydra's first attack), then "Your
  Alchemical Hydra kill count is: N." (155 of 204 in that order).
- **Recorded difference:** the next Hydra appears 12 ticks after the removal (22 after the death
  sequence starts) in 150 of 155 kills. The Wiki infobox's 43 ticks is used.

## The door

- Through the Alchemical door the player steps one tile, on the door's own row, with sound 4129 and
  then 4102 (delay 60, range 3). While the Hydra lives the door says "The door is jammed.".

## Recorded values kept over the Wiki

These four follow the recordings although the Wiki's Strategies page says otherwise. That was
the user's decision for this alignment (PR #6346); a maintainer should confirm it.

- The fire walls are **4 wide and 8 long**, as every recorded breath is (83 runs). The Wiki says
  "a 5x5 layer of fire".
- The next attack comes **12 ticks** after the tracking fire, as in every run the phase didn't cut
  short. The Wiki says "roughly seven ticks".
- A lightning current lasts **12 ticks**, as in 231 recorded currents. The Wiki says "the
  lightning doesn't despawn".
- The currents start on the 3x3 blocks 5-6 tiles from the room's centre, one a quadrant, as every
  recorded spread does (152). The Wiki says they spawn "in the four corners of the chamber".

## Not reproduced

- Live's chamber is one per player at the real coordinates. Ours is a `PrivateArea` on the shared
  map, so the door's open/close loc swaps aren't sent. The blockers are sent only to the chamber's
  player, and the Hydra is made solid with `NPC.BLOCKS_PLAYERS_FLAG`.
- "The chemical burns you as it cascades over you." (10 recordings, spam, 9-17 damage) doesn't line
  up with any vent or fire tile we can find, so it isn't sent.
- The first head's projectile `progress` is 64 or 0 in the recordings with no pattern found; ours
  sends 64.

## Ours (no source settles them)

- The tracking fire takes two steps a tick when the player is more than 2 tiles off, one
  otherwise. The Wiki says only that it is "faster the further away they are"; the recordings show
  steps 15 or 30+ cycles apart.
- Stepping onto a tile that is on fire scorches the player, the same as the tracking fire.
- The blobs other than the player's land on random distinct tiles of the chamber within 4 tiles of
  the player. Recorded offsets run 1-7, peaking at 3, with no pattern found.
- The fire walls for a player south of the Hydra follow the same rule as the recorded northern
  ones (south-west: west then south; south-east: south then east).
- The first style of a fight is random. The Wiki says "it can start off with either attack style",
  and both are recorded.
