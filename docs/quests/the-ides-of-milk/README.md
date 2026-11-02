---
quest: The Ides of Milk
key: the_ides_of_milk
status: passed
tested: 2026-11-02
tester: agent
model: DeepSeek V4.1 Flash
commit:
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# The Ides of Milk

A fresh account completed the full 4153 route from Cassius through Brutus, the post-quest
amulet and lamp, repeat dialogue and a normal relog. The low-combat recommendation box was
missing before the start menu and Gillie's "he'll be happy" line differed from the capture;
both are fixed.

## Findings

- **fixed** The low-combat recommendation was a transcript message step, so it never blocked
  the start menu. It is now the start-menu warning every other recommended-combat quest uses.
- **fixed** Gillie says "I'm sure he'll **be** happy to share some information with you" in
  4153; the wiki transcript has "he'll he happy". Corrected in the dumper and regenerated.
- **fixed** Added the captured Cassius, Gillie, Seth and Duke chat-head animations from 4153,
  plus Professor Oddenstein's captured post-quest lines from 3209.

## Runs

### 2026-11-02 — agent — DeepSeek V4.1 Flash

- **Start:** fresh account, placed at Cassius with `::tele` (the only teleport).
- **Route:** Cassius start; Gillie and Seth; shelf book; book hand-in and first sample;
  Duke; Gillie and the second sample; the north-east Release gate and Brutus; Gillie's
  report; Cassius' confrontation. `travel_to` handled every leg, including the cow-field
  gate and the castle staircase.
- **Result:** `cowquest` 20106 reached 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21 and 22
  in the captured order; 1 Quest point; the first sample dealt one poison-coloured damage
  and the second none; Brutus spawned as 15626 with 58 Hitpoints in the private field;
  Gillie handed over the cowbell amulet (33103) and magic lamp (33117); repeat Gillie and
  Cassius dialogue matched; a normal logout/login kept the stage, Quest point and items.
- **Re-check:** a second level-3 account saw the recommendation box before the start menu and
  Gillie's corrected "he'll be happy" line.
- **Not checked:** alternate refusal/space branches, every special-attack roll, and the
  lamp's exact XP confirmation. The capture covers one route and one fight.
