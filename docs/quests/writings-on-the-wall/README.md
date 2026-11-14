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

Flight 1 of 3 (Betty at Land's End, Hudson's permission, the Land's End evidence and witnesses, the report, Betty and the clues at
Hosidius). Implemented from the OSRS Wiki raw wikitext and the revision 242 cache. Not yet played in the client;
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

## Not registered yet

`TheWritingsOnTheWall` is deliberately NOT in `QUESTS` in `Quests.plugin.js` while only flight 1 exists: it would register a startable quest that cannot be completed (Piscarilius, the cipher, Shayzien, the island, the amulet and the reward are flights 2 and 3). The final flight adds it to `QUESTS` once the quest completes. The plugin and its test load directly.

## Findings

Flight 1 is implemented: the quest, stages, flag varbits, the cache-window NPC spawns, every Wiki-transcript conversation of flight 1, the
Land's End and Hosidius loc interactions and the item/interface reads (interfaces 984, 986, 987, 988 and 990 are opened with the cache's own
scripts; they need no server-side content).

Stage values chosen between the cache's visibility windows (the cache pins only the windows): 1 (told to find Hudson), 4 (permission), 8 (all
Land's End evidence found), 10/12 (reported / at the uncle's house), 16 (basement), 20 (all Hosidius clues found), 22 (Piscarilius, flight 2).

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
- **open** The "Let's get going." conversation plays the arrest and the cell text and sets stage 22; the cell and the way out are flight 2.
- **open** The Wiki marks parts of the transcript incomplete; those cases are not invented.
- **flights 2 and 3** Piscarilius (the cell, Jensen's house, the drawers, wardrobe, bed and blood), the letter decoding and map, Shayzien, the island
  and cutscene, Hudson's amulet and the reward are not implemented.

## Runs

None yet.
