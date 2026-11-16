---
quest: Jungle Potion
key: jungle_potion
status: passed
tested:
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Jungle Potion

All herbs including the Rogue's Purse from Pothole Cave were gathered and handed to Trufitus naturally. Rewards paid once; lost-herb recovery gave no extra progress.

## Herb searches (rsprox captures)

From the user's rev 242 Jungle Potion runs (rsprox index local 1002225, and JunglePotion below) and rsprox.net
1148, 1875 (snake weed) and 3030 (sito foil):

- Every herb loc: a spam line `You search the vine...` / `palm...` / `scorched earth...` / `rock...` /
  `wall...`, then `You find a herb.` in an objectbox (193) showing the grimy herb. The loc becomes its empty
  variant for everyone (snake_vine_empty 2576, ardrigal_palm_empty 2578, sito_soil_empty 2580,
  volencia_moss_rock_empty 2582, rogues_purse_cave_empty 6840).
- It grows back 99 ticks later: six vines in 1875 and one in 1148, and the scorched earth in 3030 (tick 1750
  to 1849). The palm, rock and fungus wall were never seen growing back; ours use the same 99 ticks.
- Marshy jungle vine: seq 2094 (human_openingchest_mid) and sound 1957 on each attempt, the roll 10 ticks
  later. A miss plays sound 1957 again and the next attempt starts one tick after, so a find lands at 10 or
  21 ticks. 27 finds took 30 rolls across the three recordings, so ours is 0.9 (fitted). The Wiki's
  Jungle Potion/Quick guide says "Your character may spend several minutes finding a herb"; every recorded search found the
  herb in 10 or 21 ticks, so the code follows the recordings and the Wiki's figure is a noted difference.
- Palm tree, scorched earth and rock: the line and the find on the same tick, with no animation.
- Fungus covered cavern wall (the user's JunglePotion run ticks 970-1029, three finds, and 1002225 ticks 7344-7361,
  one): human_pick_wall_start (2096) and search_vine (1957) as the search starts; each miss plays
  human_pick_wall_middle (2097) and the sound again; the find plays human_pick_wall_end (2098) with no sound. The
  eight recorded rolls came 3 to 10 ticks apart (6.1 on average, with moss giants and jogres hitting the player
  throughout), and 4 of them found the herb. Ours (fitted): a roll every 6 ticks (the length of
  human_pick_wall_middle) at 0.5, which finds the herb 12 ticks in on average, as the recorded finds did (5, 13, 14
  and 17 ticks after the last click). The Wiki's Quick guide says the wall "may take up to a minute".
- A fresh wall search (none running) shows sequence -1 and search_vine twice on its first tick, in all four
  recordings (ticks 973, 989, 1006; 1002225 tick 7347); a re-click mid-search shows human_pick_wall_start and one
  sound (977, 1012). Ours does the same.

## The quest from start to finish (rsprox captures)

The user's whole-quest run (JunglePotion, revision 242.1, SHA-256 3d37af4805f008d78f8dd17cd5fa4d6f5c8d04c6e225b7ac9c6e9c3320d8e7e6; every Trufitus branch, the
five herbs, Pothole Cave and the post-quest talk). Tick numbers are that recording's.

- **Start (ticks 145-160):** "Yes." on "Start the Jungle Potion quest?" plays the player's "It sounds like just the
  challenge for me..." first; varp 175 0 -> 1 and "You've started a new quest: Jungle Potion" come as that line is
  continued, with Trufitus's "That is excellent Bwana!". Druidic Ritual is still checked on "Yes." (Ours: no
  recording of a refusal).
- **Wording (ticks 107-162, 1127-1131):** "bring it to me. I will then give you details", "It grows near vines",
  "Hmm, sounds difficult", and his post-quest line ends "Chief of Tai Bwo Wannai." (no "He lives in a raised hut").
  These come from osrsreboxed-db's capture sources for Transcript:Jungle Potion and Transcript:Trufitus.
- **Hand-ins (ticks 327, 460, 747, 857, 1118):** "You give the <herb> to Trufitus." is an objectbox (193) showing the
  clean herb (zoom 400), varp 175 moving on as it shows. The Wiki's "Rogue's Pursee" typo is live's.
- **Completion (ticks 1119-1122):** his two lines, then "Trufitus shows you some techniques in Herblore. You gain
  some experience in Herblore." in a messagebox (229); as it is continued varp 175 11 -> 12, villagers_visible
  (varbit 887, varp 533 bit 20) 0 -> 1, the completion message and the quest scroll with marrentill (251) as its
  model, "1 Quest Point" and "775 Herblore XP".
- **Post-quest (ticks 1127-1131):** his four lines; continuing the last sets varp 175 12 -> 13. Every quest that
  needs Jungle Potion reads `>= 12`. Ours: talking again at 13 replays the same lines (not recorded).
- **Pothole Cave (ticks 936-951):** Search on the rocks shows "You search the rocks... You find an entrance into some
  caves." in a messagebox, then "Would you like to enter the caves?". "No thanks" is the messagebox "You decide to
  stay where you are!"; "Yes" is the messagebox "You decide to enter the caves. You climb down several steep rock
  faces into the cavern below." and the move to 2830,9520 comes as it is continued.
- **Climbing out (ticks 1046-1050):** Climb on the hand holds shows "You attempt to climb the rocks back out." in a
  messagebox; it is continued at 1049 and the player is at 2823,3120 the tick after (1050).
- The dump turns every Wiki `{{tbox}}` into the same plain message step as `{{mes}}`, so the quest plugin names the
  boxes itself.

## Not covered

- **Timfraku (Tai Bwo Wannai Trio's start):** live plays "You again! Only a fool would ignore my instructions." on
  the second talk before the news (tbwt_main 0 -> 1 on the first, ticks 534-575, Jungle Potion at stage 5),
  and no "Trufitus sent me." option before then; at varp 175 13 the player opens with "Trufitus sent me." and
  Timfraku "appears to concentrate very deeply" before "I cannot thank you enough..." (ticks 1429-1458). Ours
  offers "Trufitus sent me." in the first menu at any Jungle Potion stage and has no "You again!" talk. That
  belongs to the Trio quest's own plugin and transcript.
- The villagers' "thanks for helping out Trufitus" greetings after the quest (ticks 1133-1407) are the Tai Bwo
  Wannai Cleanup villagers'; not compared here. Live also sets their chat varbits (892-901) and chat_control (902)
  at tick 1122, beside villagers_visible; nothing here sets those.

## Findings

None recorded.

## Runs

### date not recorded · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q063); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh stage-0 prefix to varp 175 = 9, resumed after a server restart.
- **Result:** varp 175 = 12; QP 4->5, Herblore +775 quest XP (+10 cleaning XP).
- **Checked:** repeat dialogue, relog, save history, logout/offline, lost-herb re-search recovery.
- **Not checked:** Full-bag, interrupted hand-in and pre-start/stale-slot recovery unchecked; Overlay unchecked.
- **PRs:** [#1135](https://github.com/RSPSApp/tsps/pull/1135).
