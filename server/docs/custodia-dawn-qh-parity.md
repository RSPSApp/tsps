# Shadows of Custodia / The Final Dawn — capture and Quest Helper route check

## Sources
- RSProx recordings (revision 232.1): https://rsprox.net/download/3127 (Shadows of Custodia)
  and https://rsprox.net/download/3128 (The Final Dawn).
- Quest Helper pinned at `06da90f982518a093f2fe1c9cfac5547fa7053d3`:
  [ShadowsOfCustodia.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/shadowsofcustodia/ShadowsOfCustodia.java),
  [TheFinalDawn.java](https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/thefinaldawn/TheFinalDawn.java).
- Wiki: [Shadows of Custodia](https://oldschool.runescape.wiki/w/Shadows_of_Custodia),
  [The Final Dawn](https://oldschool.runescape.wiki/w/The_Final_Dawn).
- Cache ids checked with `server/scripts/lookup-gameval.ts`.

## Validation status
Descriptive "native" below means the server plugin path is implemented and covered by focused
tests, not that a full MCP playthrough passed. Native3 stopped at Shadows of Custodia stage 5
and The Final Dawn stage 3; native4 is ongoing. Neither quest has a full native pass. Current
full native passes across the issue are six (The Golem, Throne of Miscellania, Shades of
Mort'ton, Tai Bwo Wannai Trio, Scrambled!, Royal Trouble); no all-32 claim.

## Captured stage maps
- Shadows `soc` 16632 (captured varbit): 0→2 start, 2→4 Ictus, 4→5 parents, 5→6 wall,
  6→8 puddle, 8→9 fabric, 9→10 parents, 10→12 cave, 12→14 rescued boys,
  14→15 tasks, 15→16 both tasks, 16→18 boys talked, 18→20 creatures dead,
  20→22 Antos home, 22→24 complete.
- Final Dawn `vmq4` 16663 (captured varbit): 0→1 start, 1→3 Queen, 3→4 sermon, 4→5 passphrase,
  5→6 basement cutscene, 6→7 canvas, 7→8 scroll confiscated, 8→9 Enforcer dead,
  9→10 scroll read, 10→11 safe house briefing, 11→14 Vibia, 14→15 window,
  15→16 inside, 16→17 dog, 17→18 door, 18→19 upstairs, 19→20 purse open,
  20→21 purse sand, 21→22 branch, 22→23 Janus, 23→24 basement key, 24→25 Queen,
  25→26/27 travel, 27→28 Katlo, 28→29 Attala, 29→30 Teumo house, 30→31 Galna,
  31→32 drinks, 32→34 lever, 34→35 cutscene, 35→36 report, 36→37 Neypotzli,
  37→38 Eyatlalli, 38→39 fragment, 39→40 locate, 40→41 symbol, 41→43 twins,
  43→44 twins dead, 44→45 Attala, 45→46 Servius, 46→47 waves, 47→50 clear,
  50→51 Ennius, 51→52 Ennius dead, 52→55 cavern, 55→60 puzzles,
  60→61/62 doors and Metzli, 62→63 Metzli dead, 63→64 archive, 64→65 explore,
  65→66 skeleton, 66→67 finale, 67→68 complete.

## Captured ids used directly
- Shadows: notice board 56416, wall family 56432–56436, puddles 56422/56423, plank 56417,
  cave 56439; Marcus 14208, Ictus 14212, parents 14213/14214, injured boy
  14215/14217, Etz 14220/14221, Antos 14209, Ariadna 14218, creatures 14706.
- Final Dawn: bed 56534, drawers 56530–56533, painting 56522, chest 56537,
  chamber entry 56528, window 56498, safe-house door 56513, plant 56470, sand pot
  56472, shelf 56487, barrels 56490–56494, fireplace 56496, passage 56478,
  sun 56679/56682/56687, moon 56690/56693/56697/56700/56703, skeleton 56595,
  Ralos 56600, Ranul 56603, entrance 56613, final door 56642. Dungeon/scenery
  base locs are already in the cache map; the plugin no longer registers copies.

## Route coverage
| Area | Result |
| --- | --- |
| Shadows start/citizens/parents/trail/rescue | Plugin path; stage 4 is gated by Ictus as captured (shopkeeper optional) |
| Shadows wall/bows/boys/Antos | Plugin path; wall state 1→0→2→3 mirrors capture |
| Final Dawn start/temple/passphrase/Enforcer/scroll | Plugin path; stage 8/9/10 split matches capture |
| Final Dawn safe house | Window, dog, door, stairs, purse, sand, branch and trap stages plugin path; potato sack, knife and purse are captured ground pickups |
| Final Dawn Cam Torum/Teumo puzzle | Plugin path; barrel ids, glass, lever and passage stages match capture |
| Final Dawn Neypotzli/twins | Fragment and stage progression plugin path; keystone locate still collapses three marked-tile stops into one symbol sequence (gap) |
| Final Dawn crypt/sun/moon/Metzli/archive | Plugin stages 46–68; final skeleton completes exploration |

## Scenes and mandatory mechanics
- QuestScenes now emits the captured fade/camera beats at Queen, temple, basement,
  Janus interrogation, safe-house trap, Teumo basement/puzzle, twins, crypt,
  Ennius, Metzli, archive and exploration hooks. The safe-house trap is a private
  scene with Janus; the crypt scene adds the captured fire/debris locs.
- Shadows den entry and both rescue returns use captured fades; den entry adds the
  rockslide locs, and logout/scene end restores controls and camera.
- Sun: statue engraving gives the word pair; the player must be at the first altar
  and Itzla at the second, with direction prompts to move him. Wrong positions fail
  without consuming essence.
- Moon: each offering asks for the random captured kindling count; wrong amounts
  are incinerated.
- Crypt: six waves with increasing brawler/archer composition; wave 6 clear starts
  the Ennius scene.

## Start visibility
- HOD now leaves `vmq4_servius_palace_vis` (16668) at 1 after BANISHED. Cache
  14054 therefore resolves to 13694, whose name and Talk-to option can dispatch
  the Final Dawn start. Final Dawn accepts raw 14054 plus resolved 13694/14377 and
  re-sends visibility on stage-0 login for old saves. Verified by a combined
  HOD+FinalDawn test using the shipped `NpcType.transform` data.

## Remaining gaps
- Arc/cycle camera packets and some shake tracks are approximated with the closest
  linear camera beat; full instancing is not simulated.
- The temple chest uses the real captured 811 four-pin count UI (target 153 decoded from the
  recording). A first correct submission succeeds; wrong, forged, early or repeated amounts do
  not. The secret target is the captured code, as the recording does not prove per-player
  randomisation; there is no forced five-attempt/fail-first sequence.
- The Enforcer patrol is implemented: owner/private NPC 14266 follows the captured
  (1684,9706)->(1703,9706) walk, detection band, off-limits message, kick and teleport. It stops
  at the fight, logout and chest success.
- **Keystone locating remains a gap.** Three clicks on the same glowing-symbol object 56620
  collapse the three marked-tile visits (Streambound/Earthbound/Ancient Prison locate stops)
  into one sequence. The mandatory three-tile locate route is not implemented.
- Safe-house potato sack, knife and coin purse are captured ground pickups at their recorded
  tiles; they are not granted by Vibia.
- Boss special attacks are ordinary spawned bosses.
