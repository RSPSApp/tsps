---
quest: The Fremennik Trials
key: fremennik_trials
status: passed-with-issues
tested: 2026-11-28
tester: agent
model: claude-opus-5-5
commit: 63e095385
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# The Fremennik Trials

A fresh account played every trial, the completion and Rellekka afterwards on branch
feat/quest-the-fremennik-trials: rewards once, relog and the offline save held, and the
post-quest townsfolk greet the player by their Fremennik name. Not proven: the recovery cases in
game (they are in the tests), and one Koschei aid was applied before the player's own hit.
The capture facts are in [docs/fremennik-trials.md](../../fremennik-trials.md).

## Findings

- **open** Inga (3946) could not be reached from the street in the run ("I can't reach that!");
  her after-quest talk plays through the runner.
- **open** Not implemented: the post-quest enchanted lyre teleport and charges at Fossegrimen's altar;
  the quest rating interface (983) and last-completed-quest varbits (all quests); Miscellania's
  first-visit varbits; Brundt's Charos rename.
- **fixed** After the quest, Rellekka's NPCs spoke to the player as an outerlander; Olaf sold the
  Music cape from an invented menu; the running journal was ours; the reward's level-ups came under
  the scroll; Mord and Maria refused with the pre-Trials line; Lalli's fleece could be lost to a full
  inventory. Fixed on this branch, with osrsreboxed-db#155 for the missing lines.

## Runs

### 2026-11-28 · agent · claude-opus-5-5

- **Start:** fresh account; Woodcutting 40, Crafting 40, Fletching 25 and melee levels set, coins,
  tinderbox, knife, axe, raw sharks and food supplied; one `::tele` to Rellekka. An adamant axe was
  added after the start (the supplied rune axe needed 41 Woodcutting).
- **Route:** Bard, Reveller (lost once, then the low-alcohol switch), Hunter (Draugen), the Merchant
  chain forwards and back, Warrior (all four Koschei forms, the pass on the would-be killing hit with
  infhp off), Navigator, Seer (riddle MIND), Brundt. Travel by walking and `travel_to`; every ladder,
  door, portal and trapdoor clicked, and every landing tile equal to the rsprox capture's.
- **Combat aids:** infhp and `set_npc_hitpoints` after the player's hits for the Draugen and forms 2-3;
  in form 1 the hitpoints were lowered before the player's own hit (an aid used too early).
- **Result:** varp 347 0 -> 10; +3 quest points; 2,812.4 XP in each of the ten skills; no item; the
  name Ralton. Repeat talk gave nothing more; relog and the saved row (stage 8) matched.
- **Post-quest:** Brundt, Thorvald, Sigli, Peer, Swensen, Olaf, Askeladden, Manni, Thora, Yrsa,
  Skulgrimen, Sigmund, Lalli, Agnar and Jarvald played their after-quest talks; the Sailor sailed to
  Miscellania and back; Mord and Maria refused until the Isles.
- **Not checked:** the recovery cases in game; the camera reset after the contest (outside the clip);
  overheads and chathead animations visually; the Quest Helper overlay.
