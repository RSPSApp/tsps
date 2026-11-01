# Mage Training Arena

The Mage Training Arena is a members' Magic minigame north of the Emir's Arena. This page
records the sources and the parts that are implemented; the code is
`server/plugins/minigames/MageTrainingArena.plugin.js` with one unit per room in
`server/plugins/minigames/magetrainingarena/`, its data in
`plugins/minigames/data/mage-training-arena.json`, and its tests in
`server/tests/mage-training-arena.test.cjs`.

## Sources

- [Mage Training Arena](https://oldschool.runescape.wiki/w/Mage_Training_Arena), its room pages,
  [Pizazz points](https://oldschool.runescape.wiki/w/Pizazz_points),
  [Progress hat](https://oldschool.runescape.wiki/w/Progress_hat),
  [Entrance Guardian](https://oldschool.runescape.wiki/w/Entrance_Guardian) and
  [Rewards Guardian](https://oldschool.runescape.wiki/w/Rewards_Guardian_\(Mage_Training_Arena\)).
- rsprox recording **1757** (1 December 2024, revision 227, Leagues V): a full visit to all four
  rooms. Its Telekinetic section covers five solved mazes, the fifth-maze bonus, the Reset and
  Observe options, the statue's slide, the completion graphics and sounds, and the room HUD. It is
  a Leagues V world, so its point and XP messages carry the league multiplier; the base values
  below are the Wiki's.
- The Wiki's ten [Telekinetic Theatre solution maps](https://oldschool.runescape.wiki/w/Mage_Training_Arena/Telekinetic_Theatre)
  and their tile markers supplied the start/goal/player-position data for the five mazes the
  capture does not visit.

## Rooms

| Room | Entry | Scoring | Status |
| --- | --- | --- | --- |
| Telekinetic Theatre | Magic 33 | 2 Telekinetic points + 250 XP per maze; every fifth: 8 points, 1,000 XP, 10 law runes, full run energy | Implemented |
| Enchanting Chamber | Magic 7 | Enchantment points by spell level, doubled on every tenth shape and for dragonstones; orbs pay runes on leaving | Implemented |
| Alchemists' Playground | Magic 21, no coins carried | Alchemist points per 100 arena coins; 10 real coins per 100 and 2 XP per coin | Implemented |
| Creature Graveyard | Magic 15 | Graveyard points per 16 fruit; runes on leaving | Implemented; falling-bone damage is not modelled |

## Telekinetic Theatre

The room has ten fixed mazes across planes 0-2. Each maze has a wall box, a statue start, a
pitfall goal and an arrival tile. `Telekinetic.MageTrainingArena.js` spawns a private Maze
Guardian for the player and slides it with the world's own collision map:

- the cast side is the side of the maze the player stands on (the four sides exclude the
  corners, as on the Wiki);
- a cast slides the statue away from the player until the next tile is blocked; a corner cast
  spends its runes and moves nothing;
- the statue turns into the moving form and glides over five ticks, then either becomes the
  completed guardian (goal) or a statue again;
- New-maze starts the next arena; Reset returns the statue to its start; Observe toggles the
  overhead camera;
- leaving or logging out removes the private guardian and resets the maze, but the five-maze
  streak is saved. The streak is what the Wiki says is retained when leaving the arena.

The room HUD is cache interface 198: component 6 is the Telekinetic point total and component
11 is the current streak.

## Shared behaviour

- Pizazz points are saved per player in `mage-training-arena:<type>-points`, capped at the
  post-8-May-2024 values (Telekinetic/Graveyard 8,000, Alchemist 16,000, Enchantment 32,000).
- The Progress hat brightens at 300 of every type and is full at 600.
- Death in a room keeps real items and Hardcore status, removes room-only items and returns the
  player to the hall.
- Enchanting, Alchemy and Graveyard keep their room items and progress over a logout; the
  Telekinetic Theatre does not.
