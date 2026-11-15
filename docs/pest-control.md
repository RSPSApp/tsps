# Pest Control

The Void Knights' Outpost minigame (`server/plugins/minigames/PestControl.plugin.js`, with its
parts in `server/plugins/minigames/pestcontrol/`). Behaviour is from the OSRS Wiki and rsprox
captures; this page holds the capture facts the plugin relies on.

## Leaving the lander and the island

Each boat has its own jetty tile, the one beside its gangplank where the player stood before
boarding. Every way off a lander or the island ends there, not at one shared outpost tile
(rsprox.net recordings 4004, 4020, 4021, 4023, 4029, 4030, 4031, 4040, 4041, rev 237):

| Boat | Gangplank | Jetty tile (`returnLocation`) | Lander tile |
| --- | --- | --- | --- |
| Novice | `pest_lander_gangplank` (2658, 2639) | (2657, 2639) | (2661, 2639) |
| Intermediate | `pest_lander_gangplank_2` (2643, 2644) | (2644, 2644) | (2640, 2644) |
| Veteran | `pest_lander_gangplank_3` (2637, 2653) | (2638, 2653) | (2634, 2653) |

- **Lander ladder** (`pest_lander_ladder`, `_2`, `_3`, "Climb"): the filterable (spam) line
  "You leave the lander.", the lander overlay closes and the player is on the jetty tile.
- **The in-game Squire's Leave** (`pest_squire_instance`, op 3): no message. The player
  arrives beside him, and two ticks after that they are on their boat's jetty tile
  (recordings 4031 tick 611-613, 4040 tick 563-565).
- **The in-game Squire's Talk-to** plays the generated "minigame dialogue / standard dialogue"
  (`Squire (Void Knights)` in npc-dialogues.json): "Be quick, we're under attack!", then the
  menu What's going on? / How do I repair things? / I want to leave. / I'd better get back to
  it then. (recording 4030). "I want to leave." ends with "Away you go then, the lander will
  take you back."; the box closes and the next tick the player is on the jetty tile, again
  with no message (recording 4030 ticks 65-70).
- **The end of a game** returns everyone to their boat's jetty tile (recordings 4029, 4031,
  4040, 4041).
- A player who logs out in a game is saved on their boat's jetty tile. One who logs in inside
  the game bounds with no game to return to (a server restart) is put on the novice tile.
  Ours: the novice tile there, as the boat isn't known.

## Repairing barricades and gates

Barricades (`pest_barricade_*`) and gates (`pest_wall_gate_*`) are repaired with op 3, Repair,
one stage a click (rsprox.net recordings 4014, 4020, 4023, 4025, rev 237):

- With a hammer and logs: `pest_repair` (seq 3931) and synth 1728 the tick the player reaches
  it, one log gone, and the loc one stage up (`_destroyed` -> `_damaged_2` -> `_damaged_1` ->
  `_fixed` for a gate, `_destroyed` -> `_damaged` -> `_fixed` for a barricade), 5 Crafting XP
  and `pest_activity_counter` up 8 (clicks at recordings 4020 tick 105, 4023 tick 58, 4025
  ticks 259-791). No chat line.
- No hammer: "You'll need a hammer to make any repairs!" (click at recording 4020 tick 99). No logs:
  "You'll need some logs to make any repairs!" (click at recording 4014 tick 570). Nothing changes.
- Open or Close on a destroyed gate: "It's been totally destroyed!", and the gate stays as
  it is (clicks at recording 4025 ticks 251 and 257).
- Ours: the refusals answer on arrival, as the repair does; the captures show them a tick
  after it.

## Void seal

Rub, in the inventory or worn, is `pestcontrol/VoidSeal.PestControl.js`. From rsprox captures
(rsprox.net recordings 4015 and 4017, rev 237) and the Wiki's Void seal page:

- **In a game, with a pest on or next to the player's tile:** "You unleash the power of the
  Void Knights!". The player plays `pest_magic_attack` with spotanim
  `pest_spiral_attack_on_player`, and each of those pests gets `pest_spiral_attack_on_enemy`
  and a hit, and plays its own defend seq if it survives (`defiler_defend`, `torcher_defend`,
  `shifter_defend`). A pest swinging that tick keeps its attack. The seal loses a charge in
  the same slot (seal(7) becomes seal(6)). Pests two tiles away aren't hit (recording 4017,
  ticks 228-300).
- **Damage:** 8-12 (Wiki). The three pests one rub hit all took 11 (recording 4017, tick 237),
  so it is rolled once per rub. The hitsplats are the "others" type even for the player who
  rubbed it, so the hit has no source. The Wiki says the seal adds nothing to the activity bar,
  and with no source it doesn't. The health the hit really takes is still put on the pest's
  damage list under the player, so a pest the seal alone kills dies as the match's (a splatter
  still explodes); that list isn't the activity bar.
- **The lock:** each unleash sets busy (varbit 12393) to 1 and back to 0 three ticks later
  (recording 4017: 228-231, 237-240, 282-285, 292-295, 300-303, 340-343, 349-352). A rub inside
  it gets no answer and keeps its charge (the click at tick 343), so a double click is one rub.
- **No pest that close:** "There are no monsters near you!", and the charge is kept (recording
  4017, ticks 58, 113, 221, 303).
- **The last charge** (seal(1), worn, recording 4017 tick 349): both messages, then "The seal
  dissolves as the last of its power is unleashed!", and the neck slot empties.
- **Off the island:** "You can only use this whilst in Pest Control.", and the charge is kept
  (recording 4015).

Ours: portals, the Void Knight and the Squire are never hit. The Wiki says "nearby Pests", and
no capture shows a portal next to the player taking the seal's spotanim.

## Score board

The outpost's Score board (`pest_scores`, loc 27780, "View") shows how many games the player
has won on each lander (Wiki, Score board (Pest Control)). rsprox.net recordings 4006 (ticks
3050, 3084) and 4009 (tick 15408), rev 237:

- View sets the busy varbit (12393) to 1, runs `toplevel_mainmodal_open` [-1, -1], opens
  `pest_scores` (628) as the main modal and writes the counts as bare numbers to
  `pest_scores:novice` (628:8), `:intermediate` (628:9) and `:veteran` (628:10), in that
  order (4006 tick 3061, 4009 tick 15412).
- Closing it sets busy back to 0 (recording 4006 tick 3071).

The counts are saved with the player (`pest-control:wins`,
`server/plugins/minigames/pestcontrol/Scores.PestControl.js`). Ours: a game counts when it is
won and rewarded; whether live also counts a win refused for inactivity isn't captured.
