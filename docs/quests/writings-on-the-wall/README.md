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

Flight 1 of 3 (Betty at Land's End, Hudson's permission, the Land's End witnesses, the report, Betty at
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

## Findings

Flight 1 is not finished. Done in this checkpoint: the quest, stages, flag varbits, the cache-window NPC spawns, and every
Wiki-transcript conversation of flight 1 (Betty at Land's End and Hosidius, Hudson, the corporals, Hugor, Lan, the monk,
Joyce, the report cutscene as dialogue, the trip offer).

- **open** The Land's End and Hosidius loc interactions are not wired yet: the body inspect menu, the letter, the shelves and
  newspaper, the blood wall, Lan's bed and knife, the Hosidius door/window/basement, Bernard's body, bookcase, compost bin and
  head. Until they are, the evidence flags that need them (letter, news, wall, knife, certificate, head) cannot be set in game, so
  stage 8 and stage 20 are reachable only through the conversation flags.
- **open** Interfaces 984-988 (certificate, Hosidius letter, Land's End letter, news cutting) and 989-992 (the blood walls) are not opened.
- **open** The report cutscene and Betty's walk to the basement are dialogue, not scenes. NPC tiles for the corporals, Hudson, Joyce and the monk are approximate.
- **open** The "Let's get going." conversation plays the arrest and the cell text and sets stage 22; the cell and the way out are flight 2.
- **open** The Wiki marks parts of the transcript incomplete; those cases are not invented.

## Runs

None yet.
