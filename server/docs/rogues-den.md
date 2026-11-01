# Rogues' Den

The Thieving/Agility maze under The Toad and Chicken in Burthorpe, its lobby, wall safes and
rewards. Plugin: `plugins/minigames/RoguesDen.plugin.js`; data:
`plugins/minigames/data/rogues-den.json`; units: `plugins/minigames/roguesden/`.

## Sources

- OSRS Wiki: [Rogues' Den](https://oldschool.runescape.wiki/w/Rogues%27_Den),
  [Wall safe](https://oldschool.runescape.wiki/w/Wall_safe),
  [Wall safe (lobby)](https://oldschool.runescape.wiki/w/Wall_safe_(lobby)),
  [Floor (Rogues' Den)](https://oldschool.runescape.wiki/w/Floor_(Rogues%27_Den)),
  [Wall (Rogues' Den)](https://oldschool.runescape.wiki/w/Wall_(Rogues%27_Den)),
  [Contortion Bars](https://oldschool.runescape.wiki/w/Contortion_Bars),
  [Ledge (Rogues' Den)](https://oldschool.runescape.wiki/w/Ledge_(Rogues%27_Den)),
  [Grill (Rogues' Den)](https://oldschool.runescape.wiki/w/Grill_(Rogues%27_Den)),
  [Door (Rogues' Den shortcut)](https://oldschool.runescape.wiki/w/Door_(Rogues%27_Den_shortcut)),
  [Temporary skill drain](https://oldschool.runescape.wiki/w/Temporary_skill_drain).
- Transcripts: `Transcript:Brian O'Richard`, `Transcript:Rogue's equipment crate`,
  `Transcript:Rogue kit` (also in `data/definitions/npc-dialogues.json`).
- Cache `osrs-241_2026-10-20`: object placements are read with `MapObjects` rather than
  hand-copied, so trap, blade, ledge, door and safe tiles are the cache's.
- RSProx lobby recordings **3131, 3142, 3247, 3248** (revision 232/233): the trapdoor at
  2905,3537,0 lands at 3061,4985,1; Brian, Martin, the bankers and the lobby safes are where the
  cache places them; the doorway at 3056,4991,1 is the maze entrance.
- **There is no RSProx capture of the maze itself.** The database has no placement of the maze
  wall safe (7237) or the maze traps; its only `roguesden_` hits are the lobby. Maze coordinates
  and behaviour therefore come from the cache map and the Wiki, not a recording.

## Rules implemented

| Area | Behaviour |
| --- | --- |
| Entry | Talk to Brian once for access. The doorway then needs base (unboostable) 50 Agility and 50 Thieving, an inventory containing only the mystic jewel, no equipment and no follower. Without access or with items he says the matching transcript line. |
| Start | Prayer is set to 0; Thieving and Agility are set to their normal levels; a mystic jewel is given. Natural restoration and temporary-boost decay pause for the run (generic `stats:*` custom events), so a drained or boosted level is held. |
| Leave | Safe, trap/blade/guard catch, jewel, ladder, logout and walking out all end the run: Prayer/Thieving/Agility are restored to normal, the jewel is removed and the player returns to 3061,4985,1. |
| Experience | 12 per level drained in each skill. A safe gives the full amount; a failed/abandoned run gives Brian's transcript fraction: none before the first pendulum, half past it, full in the safe room. The Wiki does not print the fraction, so this is the only approximation in the run. |
| Floor traps | Spikes (7227), springs (7245), explosives (7230) and inert trapdoors (7250). Search drains 1 Thieving and holds only while the player stays on the tile; stepping on an armed trap ejects, unless running straight across it (the Wiki's run trick). |
| Wall traps | Spikes (7228), gas (7229), crushers (7249), blades (7225) and saws (7248). Spikes/gas/crushers eject when stood in front of; searching drains 1 Thieving. Blades/saws carry the player past for 10 Agility. A crusher is a 50/50 pass (1 Thieving on success, 5 Agility and the maze on failure). |
| Other obstacles | Contortion bars -5 Agility; pendulum -3; floor blade -3; ledges -4, long ledges -7; spinning blades cannot be disabled and eject on contact. Every Agility pass fails and ejects if the level would go below 0. |
| Shortcut | The three 80-Thieving doors (7246) drain 10 Thieving and carry the player through. |
| Guards | Rogue Guards 3190-3192 eject within two tiles. Flash powder (5559) blinds one for ten ticks. |
| Maze safes | Eight 7237 safes. Roll 0-199 against visible Thieving: at or under the level, a loot roll; over it, 50% eject with no loot and 50% drain 1 Thieving then still roll. Loot is 3/8 Rogue kit (5558), 5/8 Rogue's equipment crate (21307). A full inventory refuses the reward without ending the run. |
| Lobby safes | Four 7236 safes, 50 Thieving, 70 XP, 33.2%/62.9% success at 50/99 (41%/75.4% with a stethoscope). Loot is coins 10/20/40 or uncut sapphire/emerald/ruby/diamond at the Wiki's 128ths. Failure spawns a temporary floor trap and deals 2-6. |
| Rewards | The crate's Search menu offers one equipment piece or a kit; choosing a piece feeds the collection log and sets varbit 12012 when all five are owned. The kit's Build menu makes a spade, chisel, rope or tinderbox. |
| Cleanup | Trap disarm state is per player and re-arms on leaving the tile or ending the run; temporary lobby traps deregister after 30 ticks; the run's jewel and temporary state are removed. |

## Known gaps / follow-ups

- The exact partial-experience fraction on a failed run is not published; the three transcript
  cases are used. A capture of a partial run would settle it.
- The gear door (7232) and mosaic door (7234) use a small chat-menu stand-in rather than the
  cache's puzzle interface; both are optional side rooms.
- Wall-trap trigger orientation is derived from the object's rotation (`0 south, 1 west, 2 north,
  3 east`). The cache and Wiki agree on the trap tiles, but a maze recording would confirm the
  exact facing for every 2x1 wall.
- Flash powder and tiles are placed on plane 1 by the plugin because
  `ground-items.json` (generated) has those spawns on plane 0.
