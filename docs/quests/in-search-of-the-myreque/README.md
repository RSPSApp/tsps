---
quest: In Search of the Myreque
key: in_search_of_the_myreque
status: passed-with-issues
tested: 2026-11-20
tester: agent
model: claude-opus-5-5
commit: 44fdb7896
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# In Search of the Myreque

Every leg from the Hollows bridge to completion was played through the agent MCP against a live playthrough capture
(docs/in-search-of-the-myreque.md), from stage checkpoints. The duplicate Veliaf in the hideout comes from In Aid of the
Myreque and is fixed by #6307.

## Findings

- **open** A second, owner-only Veliaf Hurtz (5048) stands on (3506,9837) next to the world one for anyone who has not
  started In Aid of the Myreque: In Aid's own spawn. Removed in #6307. #5488
- **fixed** A repaired bridge could not be walked (the rungs kept their floor-decoration clipping), in either direction.
  #6264
- **fixed** No cutscene for the hand-in: the hound just appeared. The cutscene now plays in a copy of the hideout. #5488
- **fixed** The hidden wall teleported with invented messages; it now opens and the player walks through, both ways. #5488
- **fixed** The quest completed as the Stranger's talk started, before its lines were read. #5488

## Runs

### 2026-11-20 · agent · claude-opus-5-5

- **Start:** checkpoint: an account with Nature Spirit set complete, the stage set with `::quest` at 25 (Hollows), then
  55, 65 and 97 for the later legs, the weapons, planks, nails, hammer and coins given with `::item`; `::infhp` and
  `::master` for the hellhound fight (declared combat aid).
- **Route:** both trees and all three rung repairs, walking the bridge both ways; Curpile's quiz failed once (knock-out to
  Mort'ton) and passed on the retry; Cyreg's Travel back to the Hollows; the doors in the earth, the tunnel (Harold's
  words on arrival), Veliaf and the five members, the hand-in and the whole cutscene in its copy, the fight and the kill
  (Veliaf talks by himself), the hidden wall both ways, the basement ladder and the Stranger.
- **Result:** varp 387 25 -> 52 -> 55 -> 60 -> 65 -> 67 -> 70 -> 80 -> 85 -> 90 -> 95 -> 97 -> 105; varbits 173/174 per
  quiz attempt, 176-178 and 3928 1/3/7, 2496 2/6/7/15/31, 396 1 from the cutscene; completion after the last line.
- **Not checked:** a fresh full run; leaving the fight and coming back in game (covered by a test); the Mort'ton boat's
  fare question in game (covered by a test); relog mid-cutscene; the visual client.
