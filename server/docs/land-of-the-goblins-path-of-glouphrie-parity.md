# Land of the Goblins / The Path of Glouphrie parity

Implemented by `server/plugins/quests/quests/LandOfTheGoblins.Quest.js` and
`server/plugins/quests/quests/PathOfGlouphrie.Quest.js`.

## Sources

- OSRS Wiki: <https://oldschool.runescape.wiki/w/Land_of_the_Goblins>,
  <https://oldschool.runescape.wiki/w/The_Path_of_Glouphrie> and their transcripts.
- RuneLite Quest Helper, pinned [06da90f982518a093f2fe1c9cfac5547fa7053d3](https://github.com/Zoinkwiz/quest-helper/tree/06da90f982518a093f2fe1c9cfac5547fa7053d3):
  `helpers/quests/landofthegoblins/LandOfTheGoblins.java`,
  `helpers/quests/thepathofglouphrie/` (sections, monolith and Yewnock solvers).
- RSProx OSRS 226.1 recording https://rsprox.net/download/1694: captured stage varbits
  13599 and 15288, dialogue, menus and completion scroll. This cache's varbits 13599/15288
  and stage values agree with the capture.

## Validation status
Descriptive "native" below means the plugin path is implemented and focused-tested, not that a
full MCP route passed. Land of the Goblins native4 is blocked at stage 2: Dorgesh-Kaan doors
6919/6920 still swap leaves while leaving the doorway clipped, so mandatory city entry is not
passable. The Path of Glouphrie stopped at native3 stage 14 and its native4 route is ongoing.
Neither quest has a full native pass. Current full native passes across the issue are six
(The Golem, Throne of Miscellania, Shades of Mort'ton, Tai Bwo Wannai Trio, Scrambled!, Royal
Trouble); no all-32 claim.

## Route coverage

### Land of the Goblins (varbit 13599)

| Stage | Route node | Implementation |
| --- | --- | --- |
| 0 -> 2 | Grubfoot outside the Dorgesh-Kaan mine, accept | start hook checks Another Slice of H.A.M., Fishing Contest, 38 Agility / 40 Fishing / 45 Thieving / 48 Herblore |
| 2 -> 4 | Follow Grubfoot, talk to Zanik in Oldak's lab | Grubfoot following flag, Zanik transcript selector |
| 4 -> 6 | Grubfoot's dream cutscene, Grubfoot leaves | captured camera/fade/minimap track, action `zSUlVq`/`YUdQ2P`, then `5Ck1fo` |
| 6 -> 8 -> 10 | Oldak teleports the pair to the Goblin Cave | teleport dialogue choice, action `8mebE2` |
| 10 -> 12 | Enter the real Goblin Cave (loc 2) and have the cave guards turn the human away | cave entrance, cave guards, Zanik-enters action `gge_be` |
| 12 -> 14 -> 16 | Makeover Mage and pharmakos berry recipe | mage line events |
| 16 -> 18 | Select and confirm goblin potion (all equipment removed) | native interface 739, type varbit 13615, player appearance transform + varbit 13612 |
| 18 -> 20 | Guard accepts the goblin name | `Yes, me ...` choice |
| 20 -> 22 | Enter the Goblin Temple | real Goblin Cave, guard acceptance, temple zone |
| 22 -> 24 -> 26 | Search sphere crate, talk to Zanik, free her | crate object, cell transcript, `Z18uaI`/`EPc9qL` |
| 26 -> 28 -> 30 -> 32 -> 34 | Bighead: Zanik's location, faith test (True/False/False), crypt lore, six keys | Bighead transcript selector, action `jarIa4`, crypt line |
| 34 -> 36 -> 38 | Six keys unlock the crypt; enter and summon Snothead | key mask + inventory keys, gate object, crypt teleport |
| 38 -> 40 -> 42 -> 44 -> 46 -> 48 | Defeat each high priest and ask the predecessor's name / Yu'biusk | grave objects, owned NPC fights, ghost lines |
| 48 -> 50 | Return to Oldak and Zanik; meet at the fungus ring | Oldak line, ring Oldak/Zanik spawns |
| 50 -> 52 | Adjust the 9-4-1 relay | object opens native interface 738, Add/Subtract widgets 21-26, Confirm 38, varbits 13603-13605, arrival action `UszKmx` |
| 52 -> 54 -> 56 | Open the strange box; Zanik is taken; complete | Yu'biusk and box camera tracks, `Eh5lL0`, portal `oeHSHw`, `dfkFWY` |

Checks: dyeing/bleaching mail with Aggie, whitefish, black mushroom dye, six enclave
guard `Pass` checks, six priest pickpockets, all crypt fights, one-time sphere crate and
relog restoration are implemented and covered by the focused test.

### The Path of Glouphrie (varbit 15288)

| Stage | Route node | Implementation |
| --- | --- | --- |
| 0 -> 2 | Start with King Bolren | start hook: Eyes of Glouphrie, Waterfall, Tree Gnome Village, 60 Strength / 56 Slayer / 56 Thieving / 47 Ranged / 45 Agility |
| 2 -> 4 -> 6 | Bolren again, Golrie's device, storeroom | Bolren line, Golrie choice |
| 6 -> 8 -> 10 -> 12 | Tunnel, monolith pushes | tunnel object, owned monolith NPCs with Push/Reset |
| 12 -> 14 | Unlock the strongroom gate, read the diary | gate key/pass, lectern chapters with captured diary-vision camera tracks |
| 14 -> 16 | Sing the crystal chime, machine ready | bowl objects, seed/chime, three diary chapters |
| 16 -> 18 -> 20 | Solve Yewnock's machine, reveal and kill Dumpling | native interface 848, random first-slot target + two-slot sum, Insert/Reset/Submit, Dumpling reveal camera tracks, owned creature |
| 20 -> 22 -> 24 | Bolren, then Gianne jnr. | dialogue lines/choices, Longramble spawn |
| 24 -> 26 -> 28 | Find Longramble, deliver toads/mint cake | Longramble transcript, trade actions |
| 26 -> 30 -> 32 -> 34 -> 36 | Spirit tree conversations | dying-tree Talk-to/variant sequence |
| 36 -> 38 | Use the crystal chime on Incomitatus | `QJ5K9p`, capture camera track, tree object swap |
| 38 -> 40 -> 42 | Thank the tree, enter the Poison Waste sewer | tree object, sewer entrance |
| 42 -> 44 -> 46 | Sewer ladders, metal gate, Warped Depths, defeat three terrorbirds | real 49700/49701 ladders, boss-door zone, owned terrorbirds, heavy door install |
| 46 -> 48 -> 50 | Peek through the heavy door, final cutscene, Hazelmere, complete | heavy door, captured multi-move camera/fade track, actions `5N6PuB`/`Lv5xyo`, four lamps |

Checks: monolith pushes/reset, one-time chests, disc conversion, strongroom gate,
owned NPC recovery on relog and lamp recovery from Hazelmere are implemented. The
focused test drives the mandatory stage route, puzzle gates, sewer/bird/final
cutscene order, camera/fade packets, logout interruption, relog restoration and
completion/reward-once.

## Shared world objects

Loc 6311 ("Black mushrooms") is shared by Land of the Goblins, The Golem and normal world
picking. LOTG claims it only while its quest is active and the object is inside the Goblin
Cave (2560-2630, 9780-9870); every other placement is left unhandled so The Golem's handler
(registered later, per `Quests.plugin.js`) or ordinary picking can run. A regression loads
both quest plugins and dispatches the Uzer and Goblin Cave placements in real handler order.

## Save migration

On login, pre-capture odd/linear stages are migrated once and stamped with a version:
LOTG `10,15,20,25,27,30,32,35,40,49,50,51,52,55,60` map onto the captured stages;
POG `1..12` map onto the captured even stages. Migration only changes the stage varbit,
never calls completion, so quest points, XP and lamps are not replayed. Tests cover both
migrations, including completed old saves.

## Known approximations / gaps

- The Goblin Cave is mapped and walked (loc 2 at 2622,3392, chamber around 2617,9797,
  guards at 2580,9852). The temple staircase loc is absent from this cache (verified
  MapObjects empty at 2581,9853), so guard acceptance moves the player inside; this remains a
  mandatory-route substitution.
- Dorgesh-Kaan doors 6919/6920 are a current shared blocker: after the self-opening door fix
  the leaves rotate but both doorway tiles remain clipped, so native4 cannot walk into the
  city. This is not recorded as a Land of the Goblins pass.
- Goblin form uses the supported player appearance transform and native interface 739
  (six unarmoured goblin types), with relog restoration and removal on completion.
  Sunlight/combat reversal is not simulated; `[goblin name]` is a name bit.
- The storeroom is not instanced: the tree swap and monolith positions are world state; the
  singing bowl's Inspect/Sing-crystal forms follow each player's varbit 15289.
- Yewnock's machine uses the real 848 interface and a random first-slot target plus a
  two-slot sum, reset/submit/insert handling and disc return. Chest discs are a fixed set
  and this server has no plugin hook for the client disc-picker, so discs are used on the
  machine instead; the exchanger still splits discs into equivalent pairs.
- The Poison Waste sewer uses its real entrance and five ladders; warped terrorbirds require
  the crystal chime in the inventory to be attacked (Wiki), and the final action arrives at
  Hazelmere's house. Warped tortoises and the full multi-chamber population are not added.
- Recorded camera/fade/minimap tracks play for the captured cutscenes; walk-in follower
  movement and non-captured actor animations remain transcript/stage driven.
