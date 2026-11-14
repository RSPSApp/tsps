---
quest: The Writing's on the Wall
key: writings_on_the_wall
status: in-progress
tested:
tester: agent
model: claude-sonnet-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# The Writing's on the Wall

All three flights (flight 1: Betty at Land's End, Hudson's permission, the Land's End evidence and witnesses, the report, Betty and the clues at
Hosidius; flight 2: Port Piscarilius, the cell and Jensen's house, the war tent scene and Edwards' house in Shayzien; flight 3: the island hideout, the finale, the reward and Hudson's amulet). Implemented from the OSRS Wiki raw wikitext and the revision 242 cache. Not yet played in the client;
`server/tests/writings-on-the-wall.test.cjs` covers the stage varbit, spawns, flags and dialogue.

## Sources

Raw wikitext (`?action=raw`, fetched 2026-11-14), sha256 of the bytes used:

| Page | sha256 |
| --- | --- |
| [The Writing's on the Wall](https://oldschool.runescape.wiki/w/The_Writing%27s_on_the_Wall) | `7ff488f2e3b190473f15391d98edc235c697ebd5d799b5228cb734c4813dca52` |
| [Transcript:The Writing's on the Wall](https://oldschool.runescape.wiki/w/Transcript:The_Writing%27s_on_the_Wall) | `f83af3f299303d1edda5182d0d5f6c795460fee32e8e457b716c3becc6f63d80` |

No RSProx capture of this quest was available and Quest Helper has no module for it.

## Cache facts used

- Quest row 219 (`quest_writingsonthewall`): members, Intermediate, Short, requirements Agility 22 and Thieving 20, rewards
  2,500 Agility and 2,500 Thieving XP, start NPC `wotw_betty_lands_end` (16845), completion value 48.
- The stage is varbit `wotw` (16800, bits 0-8 of varp `wotw_primary` 6242); the flag varbits 16801-16834 share that
  varp and `wotw_secondary` (6243).
- The cache's NPC transforms key who is visible on `wotw`: Betty at Land's End 0-12, Hudson and the corporals 0-8, Betty outside
  her uncle's house 12-14 and inside 16-20, jailed 24-30; the Land's End body is inspectable at 4-6 and only
  searchable at 0-2 and 8-12. The plugin's stages (1, 4, 8, 10/12, 16, 20, 22) sit inside those windows.
- Loc tiles (HF `dump:loc`, rev 242): Land's End bed 50789 (1514,3438), blood wall 50793 (1517,3439), shelves 50798 (1517,3437),
  Lan's bed 50799 (1496,3419); Hosidius front door 50800 (1785,3520), back door 50801 (1788,3527), window 50803 (1783,3525),
  compost bin 50808 (1786,3531), bookcase 50810 (1784,3523), basement table 50804 (1747,9935), drink shelves 50809 (1747,9938).

## Registration

The quest is registered in `QUESTS` (Quests.plugin.js) and has no gate: it is completable from Betty's start to value 48 (tested end to end through the real dispatchers).

## Flight 2

Stages chosen between the cache windows (the cache pins only the windows: Betty in the cell 24-30, the Piscarilius guards 22-32, Jensen's body 22-32,
the cell blood wall 32-34, Hudson/the corporals/Edwards' body and blood at Shayzien 36-40): 24 in the cell, 26 plank out, 30 all Jensen clues found, 32 back in
the cell (Betty gone), 34 the cell wall read, 36 the war tent scene is done, 40 all Shayzien clues found. Stage 22 is only passed through (the arrest dialogue).

- **open** The two Piscarilius guards are the cache's `wotw_soldier_cutscene_1/2` NPCs (16867/16872), spawned at guessed tiles (1757,3776) and (1757,3780);
  "caught" means standing on a tile next to either guard, an unconfirmed guess (the Wiki gives no rule), and only guard one speaks the overhead. The route from the house door to
  the ladder is NOT proven against the map's collision; the test only checks that the ladder's four neighbours are not caught under the rule, and walks no path. The cell tile, the cell wall crossing tiles and the war tent area (x 1480-1490, y 3631-3641 around the Wiki pin
  (1485,3636)) are approximate; Hudson, the corporals and Kyle at Shayzien use guessed tiles near the Wiki pins for Edwards' body (1451,3642) and Kyle (1452,3629).
- **open** Decoding the letter has no server step: the letter interface (987) and the blood-wall interfaces are drawn by the cache's own scripts, which I did not read;
  whether they show the right letters depends on the flag varbits (16801-16832) the plugin sends, which I have not verified in a client. The war tent scene runs when the
  player walks into the tent area at stage 34, not when the letter is shown to be decoded; it moves the stage on first (the area runs every tick) and then teleports the player to Edwards' house with no travel, from wherever they stood in the tent.
- **open** The Wiki leaves the plank dialogue ("exit or not") and the post-Jensen Betty talk as {{tmissing}}; they are not invented (Betty's "What are you doing back here?" is only played before any Jensen clue is found, and the plank is a statement without the missing menu). The drawers' blood has no cache varbit
  and is only a saved flag. Which Shayzien clues count (the wall, shelves, eyes, hands and Kyle's witness answer, not Hudson's victim answer) is this server's reading.
- **open** The map-drawing step and Hudson's "What do you know about the keystone lodge" option are not in the Wiki transcript and are not implemented; the island is flight 3.
- **open** The Corporal Breiman line "I don't think it was [him/her/them]" uses "them" for the Wiki's placeholder.

## Flight 3

The island and the finale. Stages: 40 the Shayzien clues are all found and the hideout opens (the Wiki's trapdoor window starts at 38; this server opens it at 40, when the clues are done),
44 the finale has been seen (Hudson waits in the hideout), 48 complete. The plant (loc 63325 at 1615,3582) offers the trapdoor menu; the hideout ladder (63326 at 1623,9932, no map counterpart) is given
an explicit exit tile; the hideout blood wall opens interface 989 and plays the Wiki's finale. The stage moves to 44 when the blood is read, so closing the conversation cannot strand the player.
Talking to Hudson at 44 plays his closing conversation and completes the quest: 1 quest point, 2,500 Agility and 2,500 Thieving experience and an amulet of sight. After the quest Hudson stands at
the Shayzien Administration (Wiki pin 1521,3567) and plays Transcript:Sergeant Hudson: another amulet of sight for 1,500 coins (through the dialogue, not a shop).

- **open** The finale and the report are dialogue, not scenes; the hideout arrival tile (1624,9936), the island exit tile (1617,3584) and Hudson's hideout tile are approximate.
- **open** The map-drawing step is not in the Wiki transcript and has no server step; the quest log hint ("revisit the murder sites") is not shown.
- **open** The "Familiar Voice" line uses the cache's `wotw_betty_cutscene_pre_reveal` NPC (16853) as the speaker.
- **open** Post-quest Hudson's first line and the "How are things going?" loop follow Transcript:Sergeant Hudson; its "Could I have another amulet?" branch when the player has the coins but no free slot reuses the Wiki's "no space" line.

## Findings

Flight 1 is implemented: the quest, stages, flag varbits, the cache-window NPC spawns, every Wiki-transcript conversation of flight 1, the
Land's End and Hosidius loc interactions and the item/interface reads (interfaces 984, 986, 987, 988 and 990 are opened with the cache's own
scripts; they need no server-side content).

Stage values chosen between the cache's visibility windows (the cache pins only the windows): 1 (told to find Hudson), 4 (permission), 8 (all
Land's End evidence found), 12 (reported and at the uncle's house; 10 is not used), 16 (basement), 20 (all Hosidius clues found), 22 (Piscarilius,
flight 2; not reachable until `setPiscariliusReady(true)`, which only flight 2 and the test call).

Approximations and gaps, each listed so nothing is silently missing:

- **open** Betty's start tile (1519,3438) comes from the cache's quest row; the spawn tiles of Hudson, the corporals, Joyce, the monk and Betty at
  the house are approximate (the cache gives no NPC tiles). Land's End and Hosidius loc tiles come from the cache map.
- **open** The report to Hudson and the door-opening sequence (Betty climbing down, the basement arrival) are dialogue plus a teleport, not scenes.
- **open** The Wiki transcript has no text for the Land's End shelves or the newspaper, so searching the shelves gives the newspaper cutting with no message;
  the blood wall opens interface 990 with no text; the basement drink shelves (two empty bottle gaps) do nothing; the "searching the body again"
  and the torso inspection after the letter is taken reuse the Wiki's first sentence only.
- **open** What counts as "all Land's End evidence" (letter taken, newspaper taken, blood wall seen, knife, Lan questioned, Betty's family answer,
  Hugor's witness answer) and "all Hosidius clues" (head inspected, certificate taken, Joyce, the monk, the drinking question, the Keystone Lodge
  question) is this server's reading of the Wiki, not a capture; the Hosidius and Land's End flag varbit levels are likewise assumed (1 seen, 2 taken).
- **open** Betty's "Let's get going." is not offered while Piscarilius is unimplemented, so no stage past 20 is reachable; with the gate on it plays the arrest and the cell text and sets stage 22.
- **open** Hudson, the corporals and the Land's End witnesses stop answering from stage 9; the Wiki does not say what they do after the report.
- **open** The basement is reached by teleport and left by the cache's ladder (loc 41428 at 1750,9933, Climb-up), which has no map counterpart, so the plugin supplies the destination (1785,3524) to the generic ladder event.
- **open** The window and the doors use a bounding box around the house (x 1784-1789, y 3521-3527) and teleports, not the loc geometry or collision; the tiles are not checked for walkability. The window sets the "found the window" flag only when climbed from outside.
- **open** Betty's alibi answer is collected (varbit 16808) but not required for the report; the required evidence set and the flag levels are this server's reading of the Wiki and have no source.
- **open** The Wiki marks parts of the transcript incomplete; those cases are not invented.

## Runs

None yet.
