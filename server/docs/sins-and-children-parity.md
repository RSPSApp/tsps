# Sins of the Father / Children of the Sun parity notes

Sources used for the route:
- RSProx recording https://rsprox.net/download/1637 (client revision 226.1). It contains both
  quests' start, completion, varbit transitions, the trek, mausoleum interface and finale.
- RuneLite Quest Helper pinned at [06da90f982518a093f2fe1c9cfac5547fa7053d3](https://github.com/Zoinkwiz/quest-helper/tree/06da90f982518a093f2fe1c9cfac5547fa7053d3)
  (`sinsofthefather/`, `childrenofthesun/`, `DoorPuzzleStep`, `ValveStep`).
- OSRS Wiki pages/transcripts for unrecorded branches; this checkout's cache
  for ids (`scripts/lookup-gameval.ts`).

## Validation status
Descriptive "native" below means the live/captured varbit values used by the plugin and its
focused tests; it is not a claim of full MCP acceptance. Native4 Sins of the Father is blocked
at stage 16: the crypt landing (3738,9700,1) is clipped while the canonical landing
(3738,9703,1) is walkable. Children of the Sun resumed from its earned stage-6 checkpoint and
its native4 route is ongoing. Neither quest has a full native pass. Current full native passes
across the issue are six (The Golem, Throne of Miscellania, Shades of Mort'ton, Tai Bwo Wannai
Trio, Scrambled!, Royal Trouble); no all-32 claim.

## Native stages

`SinsOfTheFather.Quest.js` uses the live myq5 varbit values: 2 start,
6 Hameln, 12 following Carl, 16 Kroy, 18 Kroy dead, 20 tables destroyed,
22 report, 24 Paterdomus, 34 meeting, 36 escort, 38 escort done, 40 boathouse,
44 graveyard, 48 mausoleum, 50 lock ready, 52 lock solved, 54 convincing, 56 convinced,
58 lab, 62 bloodveld, 64 Safalaan, 66 book, 68 book handed, 72 disguise brief,
78 disguise made, 80 Damien, 86 Damien dead, 88 Darkmeyer plan, 90 Darkmeyer,
92 Desmodus, 94 Mordan, 98 slaves, 100 Arboretum, 112 logs, 114 logs given,
116 Vertida, 120 flail, 122 Safalaan's walk, 126 ready, 130 Vanstrom,
132 dead, 138 complete. Kroy table varbits are 1 after Kroy dies and 2 after
each table is smashed (capture 10353/10354).

`ChildrenOfTheSun.Quest.js` uses vmq1 values 2 start, 4 delegation, 6 tail,
8 at the house, 10 report, 12 marking, 14 four marked, 16 roof, 18 in the
cell, 20 left the cell, 22 Itzla departs, 24 complete (`vmq1_questcomplete_type`
= 2 at completion).

## Save migration

Both quests write a one-time schema marker (`quest.*.schema`). A save without
the marker is from the pre-native ladder and is mapped once before play:
Sins maps every supported old value (10→2, 20→6, 100→36, 130→54, … 300→138);
Children maps old completed 22→24. Mapping only changes the stage, so completed
saves never receive rewards again. Every native stage transition writes the
marker, so a new native stage 20/22 is never reinterpreted as old progress.

## Route coverage

| Node | Sins | Children |
| --- | --- | --- |
| Start/accept, requirements | Veliaf at Slepe; Taste of Hope + skills | Alina/Noah dialog choice |
| Dialogue branches | Wiki transcript variants by stage | 18 wiki variants + conditions |
| Carl follow | area-scoped Slepe route from NPC 9558's actual capture-1637 spawn/walk updates; captured start teleport (3754,3307); look-back pauses/view-cone and RegionManager edge-ray LOS hiding; seen/too-close and too-far reset/retry; persisted captured steps never infer from proximity; stairs require earned follow and captured Continue choice | — |
| Trek | rucksack knife, 3 short vines → long vine, vine swing, nail beasts, zombie axe, dead-tree logs, three bridge repairs, crossing, juvinates | — |
| Mausoleum | actionable per-player door overlays 38070/38071; captured interface 665 Kakurasu: row/col sums, dynamic OP1 buttons, solved grid advances 52 | — |
| Other objects | per-player barrel/boat/table/door overlays (owner objects re-synced on region load), crypt stairs landing 3738,9703→captured Kroy arrival, crypt gate 39512/39513, cracked wall, Arboretum valves/tree/shelves, hideout crate | bandit door, Varrock stairs/roof |
| Inventory | disguise set, 7 logs, ruby/sickle crafting, flail, tome reclaim | none |
| Combat | Kroy, bloodveld, Damien, Vanstrom phases: pets/darkness/orb and 0hp→200hp enrage + lightning | none |
| Finale | captured scene actors, Safalaan walk, fade out/in escape | cell actors/teleport/walk, roof recovery |
| Cameras | QuestScenes tracks for Carl, crypt/Kroy, Paterdomus, Icyene meeting, mausoleum, lab, Damien, prison, Castle Drakan, escape/hideout | delegation, eavesdrop and roof tracks |
| Completion | once; XP tome plus other rewards | once; quest point/Varlamore access |
| Saved state | schema migration, relog spawn/object recovery | schema migration, cell/roof recovery |

## Remaining differences (explicit)

- The Mort Myre trek still uses the overworld tiles rather than a separate
  instanced temple-trek region; item and object steps are implemented.
- The mausoleum puzzle uses the real interface/sums/buttons, but the client
  button graphics are the cache's own; the server tracks the grid in memory,
  so relogging mid-puzzle regenerates a fresh solvable grid.
- Darkmeyer bank/attack restrictions and the Hallowed Sepulchre/daeyalt
  entrances are outside this quest's mandatory route.
- Vanstrom uses the real stats, enrage, lightning, pets, darkness and orb
  mechanics; exact damage prayer interactions/animations are approximated.
- Children's tail uses captured checkpoints joined by a real RegionManager
  collision route to the bandit door; it is still waypoint-based (spotted at
  1 tile, fail past 14) rather than a client line-of-sight simulation. Cell
  bars are not spawned as custom scenery; captured actors, teleports and
  walking are.
- Camera tracks use the captured move/look coordinates and reset ticks, but
  dialogue-driven shot changes are scheduled by tick offset rather than bound
  to individual line confirmations, so a very fast/slow reader sees them at a
  slightly different line.
- Native MCP has been attempted: Sins reached native3 stage 6 and native4 stage 16 before the
  clipped crypt landing; Children reached native3 stage 6 and native4 is ongoing. Focused tests
  exercise the real plugin/dialogue handlers but do not substitute for full native acceptance.

## Focused test

`server/tests/remaining-morytania-parity.test.cjs` (27 tests) covers start/accept,
Children marking/failure/cell scene/16-24 handoff/migration, Sins native myq5
values, Kroy table varbits, disguise conditions/Trader Sven, the full trek
item/object chain, the Kakurasu interface and native 52/54, save migration for
overlapping stages, Vanstrom enrage/lightning, all captured camera groups and
their resets/logout cancellation, per-player object isolation/packet lookup,
region-load resync, the collision-valid tail-to-door route, canonical crypt landing/Kroy route and
crypt gate, Carl follow/look-back too-close/far/retry, persisted-checkpoint vs
proximity/relog/logout cleanup, all captured Carl NPC steps walkable/connected and the first look-back wall hides the captured position, the captured Continue stairs gate, and the
132/138 finale with a single tome reward.
