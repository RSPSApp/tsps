---
quest: Tears of Guthix
key: tears_of_guthix
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Tears of Guthix

No natural playthrough recorded yet. The quest was aligned with two complete rev 242 recordings
of it (below) and checked step by step over the agent MCP, with `::tele` between the steps, so
that check is not a run.

## Findings

Newest first. One line each, linked to its issue or PR when there is one.

- **fixed** Live parity from the two recordings: Juna's first meeting, the story box, the start on
  the camera pan, the drifting multinpc light creatures, the approach and lockstep carry, the
  timed mining, the chisel animation and sound, the rock climbs and the scroll's bowl. See below.
- **open** Not recorded: what Juna says to a player without the requirements, a second player
  attracting a creature that is already carrying someone, and Attract after the quest. Ours for
  each is in `TearsOfGuthix.Quest.js`.

## Live captures

Two rev 242 rsprox recordings each play the whole quest, from the first jump into the chasm to
the completion scroll: **local 1001964** (ticks 19326-19683) and **local 1002071** (ticks
5669-5889). Neither goes on to the first visit to the weeping wall. Ticks below are 1001964's
unless marked; 1002071 agrees except where noted.

### Juna

- The first Talk-to has no opening menu: "Tell me... a story..." (19369), then the player's "A
  story?" and her four introduction lines. When the last one ("Then you can drink of the power of
  balance ...") is continued past, varbit 452 `tog_juna_stories` goes 0 -> 1 with the "Okay... /
  What are the Tears of Guthix? / Not now" menu (19407; 1002071 5719). Every recorded post-quest
  login sends 452 as 1 or 2.
- "Okay..." then "Start the Tears of Guthix quest?" (Yes. / No.). "Yes." opens a statement box,
  "You tell Juna some stories of your adventures." (messagebox 229, with its continue; 19414), then
  the random story (19420). 1002071's story (Desert Treasure) has Juna's own reply after it.
- The quest starts after "But first you will need to make a bowl in which to collect the tears.":
  varbit 451 `tog_juna_bowl` 0 -> 1, "You've started a new quest: Tears of Guthix" and
  `cam_moveto` 3232,9507 height 700, rates 5/3, absolute height, all on the tick of "There is a cave
  on the south side ..." (19454; 1002071 5741). The camera resets when the conversation closes
  after "Mine some stone ..." (19473).
- With the bowl: "Before you can collect ...", "I have a bowl.", "I will keep your bowl ...",
  "Now... tell me another story ...", then completion on the same tick as the continue (19677):
  451 1 -> 2, the bowl leaves the inventory, 1,000 Crafting XP, and the scroll shows `tog_bowl`
  with "1 Quest Point", "1,000 Crafting XP", "Access to the Tears of Guthix".

### Light creatures

- Nine `tog_light_creature` (401) in the chasm. It is the multinpc of varbit 451:
  `tog_light_creature_noop` (5434, no options) before the quest and `tog_light_creature_op` (5435,
  Attract) from stage 1. They drift over the clipped pool, inside x 3211-3237, y 9505-9529, a
  tile a tick. Of 1,001 consecutive recorded steps, 76% kept their heading, 13% turned 45 degrees,
  4% turned 90, 5% turned 135 and 3% turned back. The drift in `Chasm.TearsOfGuthix.js` is a random
  walk fitted to those counts (ours).
- The lit lantern on a creature (19492; 1002071 5774) sends "The light creature is attracted to
  your beam and comes towards you...". The creature comes a tile a tick onto the player's tile,
  diagonally until in line, then straight (3228,9522 to 3231,9527 from the next tick; 1002071 from
  the same tick). The player floats up two ticks after it arrives (19499).
- The float: `tog_player_float_up` (2046) with a still exact move (50 cycles, facing south). The
  creature telejumps south-west of the player, plays `light_creature_grow`, becomes
  `tog_light_creature_transition` (13429) with synth 1799, and the next tick
  `tog_light_creature_carrying` (5784). From the fourth tick both move a tile a tick, the creature
  a tile south-west of the player: four tiles straight south, then diagonally until in line with
  the landing, then straight on, to 3224,9504 (19525). The player floats down (2047) and the
  creature shrinks (`light_creature_shrink`, synth 1792) two ticks after the last step, 28 ticks
  after the float-up (30 from 3231,9529 in 1002071). The tick after, the player can move again
  and the creature is the plain creature, two tiles north-east, drifting north.

### The shelf and the rocks

- Magical rocks (`tog_blue_stone_rocks1`, 6669): a tick after the last step, "You swing your pick
  at the rock." with the pickaxe's animation; five ticks later the stone (`tog_stone`), "You manage
  to mine some stone." and the animation stops (19605; 1002071 5812). No Mining XP.
- The chisel on the stone: "You make a stone bowl." with `human_opalcutting` (890) and synth
  chisel (2586) on the same tick (19618).
- The rocks move the player at once to the tile beyond them, with an exact move from the tile
  they left (100 cycles, facing west) and `climbing_loop` (2454, 5 loops). Going east (down) it is
  `tog_climb_slope_down` (2050), two ticks after the last step (19353 -> 19355 on 6673, 19637 ->
  19639 on 6672). Going west up 6673 it is `tog_climb_slope_up` (2049), one tick after (19482 ->
  19483). 6672 only goes down: from its east side the player turns to it and gets "You could climb
  down here, but it is too uneven to climb up." a tick after arriving (rev 226 recording 1696,
  tick 326).

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q113); PRs: [#1174](https://github.com/RSPSApp/tsps/pull/1174).
