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
  arrives beside him, and the tick after that they are on their boat's jetty tile
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
