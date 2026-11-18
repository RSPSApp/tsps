---
quest: Big Chompy Bird Hunting
key: big_chompy_bird_hunting
status: passed
tested: 2026-10-23
tester: agent
model:
commit:
cache: osrs-241_2026-10-20
start: checkpoint
travel:
---

# Big Chompy Bird Hunting

Toad inflation, a real Chompy kill, Rantz hunt/cooking and the hand-in completed naturally on one account from a fresh start. Rewards matched the source exactly and survived relog.

## Findings

- **fixed** Item-on-NPC on swamp toads returned "I can't reach that!" until a shared MovementQueue/UseItemPacketListener reach fix.
- **open** Long westward walks beyond the local planner window stayed unresolved during an earlier checkpoint.

## Capture facts (rev 242)

From the user's rsprox capture `BigChompyBirdHunting.bin` (revision 242.1, one account from stage 0 to 65,
then Rantz's hat menus and a second chest visit). Tick numbers are the capture's; the raw transcript stays
outside the repo. `server/tests/big-chompy-capture.test.cjs` checks these against the server.

| Ticks | Live |
| --- | --- |
| 169-182 | Start menu; "No." gives Rantz's practice line; "Yes." sets varp 293 to 5 on his "Good you creature..." line. |
| 541-543 | Arrows: 293 = 10 with the item box "Rantz takes six ogre arrows off you." (ogre arrow), the same line in chat after it. |
| 580 | 293 = 15 on Rantz's second answer to "How do we make the chompys come?" ("Dey's fussie eaters..."). |
| 628-657 | Fycie and Bugs at 15 and 20: "Rantz said that you play with the 'fatsy toadies'..." and their answers. |
| 645-651 | Chest Unlock: human_pickuptable (832) and "Humph!" as the click is handled (1747, from beside the chest); the next tick "You manage to lift the huge rock off the chest.", "I guess this is what an ogre would call a locked chest.", loc 3377 -> 3378, 293 = 20. Search: human_openchest (536), skillmulti mode 23 "How many would you like to take?" (max = free slots), then the item box "You take a pair of bellows." |
| 1739-1753 | A failed lift: "You strain to lift the huge rock off the chest...", two ticks later "... but it's just too heavy for you.<br>The experience has left you feeling temporarily weakened.", "Arrgghhhhh!", Strength 59 -> 58. Then "You take 8 pairs of bellows." |
| 712-725 | Suck: "You collect some gas from the swamp." (SwampBubbles). Inflate on arrival: "Come here toady!", human_chompybird_ogrebellows (1026) + spotanim 241 + sound 1455 (30 cycles late), the toad's chompy_toad_inflate (1019), "You manage to catch the toad and inflate it with the swamp gas."; four ticks later "You add the bloated toad to your inventory.", bellows (3) -> (2), the toad gone. |
| 1238-1248 | With three bloated toads: "One of your bloated toads manages to escape.", one toad leaves the pack and a swamp toad appears saying "Ribbitt!". |
| 779-836 | 293 = 25 on the player's "Yes, I have a 'fatsy toady'..."; the toad item box; on "Over 'dere creature..." varbit current_hint_arrow 7, camera look-at (2636,2966 height 25, rate 7) and move-to (2639,2956 height 900, rate 2), hint arrow on 2636,2966 height 32. Camera reset when the line is continued (809); arrow cleared 50 ticks after it was drawn (836). |
| 817-833 | Ogre arrow on Rantz at 25: "You show Rantz the ogre arrow." + "Creature already given Rantz stabbers..."; bloated toad: "You show the bloated toad to Rantz." + "Hey creature got da fatsy toady..."; bellows: "Nothing interesting happens." |
| 842-944 | Drop: "You carefully place the bloated toad bait." (spam), human_pickupfloor, the bait on the player's tile; 293 = 30. Rantz at 30 and 35: "There you go, I've placed the bait." page. The bait bursts 100 ticks later with chompy_toad_exploding and toad_burst (1457); the quest stays at 30. |
| 992-1018 | The demonstration from the landing: fly_down + "Sqwirk!"; +11 293 = 35; +17 Rantz says (and chat shows) "Hey, dere's da chompy, I's gonna shoot it."; +19 he shoots (ogre_longbow 1025, spotanim 243 height 96, sound 1452 range 10, projectile 242 41->116); the bird at the bait "Sqwark!" + sound 1453; +22 "Rantz keeps missing the chompy bird..." and "Rantz: Grrr...de'ese arrows are rubbish."; chompy_update_attack, "!!Croak!!" / "Gobble!", the bait gone and 293 = 40. No camera, no "A chompy swoops down!". |
| 1063 | 293 = 45 on the item box "Rantz hands over an ogre bow...". 1072: Claim-arrows without a diary tier, "You need to complete the easy, medium, hard or elite tier of the Western Diary to use this feature." 1081: the bow on Rantz, "Yeah, it's a goodly stabbie chucker...". 1089, 1358: Check kills, "You've scratched up no kills yet! You've got to complete the quest first!" |
| 1150-1154 | Bugs and Fycie at 45: "You's better talk to Dad, he might have something for you to do." / "...him chasey sneaky chompy." |
| 1323-1352 | At 45 the landing bird gets current_hint_arrow 7 and an NPC hint arrow. Its death: chompy_update_death and transformation to 1476 on one tick (same NPC), sound 1450, 293 = 50, arrow cleared, no drop. Pluck on arrival: "You start plucking the chompy bird.", human_pickupfloor, sound 2581; two ticks later the carcass goes, raw chompy and bones on its tile, 15 feathers in the pack, 30 Hunter XP. |
| 1367-1393 | 293 = 55 on "Okay's now you's needs to cook da chompy!". Rantz says "Onion" every time (1377, 1390, 1456); Bugs equa leaves (1415, 1431), Fycie tomato (1422, 1426). |
| 1472-1476 | The spit-roast: "You carefully place the chompy bird on the spit-roast.", varbit ogre_spit_roaster 1, human_cooking, two spit_roast sounds, the raw chompy gone; +2 "You add the other ingredients and cook the food.", varbit 2; +4 "Eventually the chompy is cooked.", varbit 0, human_pickuptable, the three seasonings swapped for the seasoned chompy, 293 = 60, item box "You use the onion, tomato and the equa leaves with the chompy bird to make a seasoned chompy." |
| 1504-1513 | The hand-in page; 293 = 65 after "It's my pleasure!", the seasoned chompy taken, scroll: 2 Quest Points, 1,470 Cooking XP, 735 Ranged XP, 262 Fletching XP, An Ogre Bow, Ability to make Ogre Arrows. |
| 1528-1668 | Post-quest menus: "What are the hats like?/Can you show me the hats please?/How many chompies do I have to stick?/Can I have a hat please?/Ok, thanks."; after "What are the hats like?": "How many chompies do I have to stick?/How do I get a hat?/Can I have a hat please?/Can you show me the hats please?/Ok, thanks."; after "How many..." the first again. Each hat shows in an item box. The bow on Rantz (1643) goes straight to "You show Rantz the marks on your bow.". |
| 103-130, 1759-1765 | The cave entrance and both exits: "You walk through the cave entrance into a dimly lit cave." / "You walk back out of the darkness of the cave into daylight."; the right exit 3380 lands where 3381 does. |

### Recorded differences (Wiki kept)

- Dialogue wording is the Wiki transcript's where the capture differs: the hat item boxes ("1 Feather white" for
  "1 Feather Plain", "blue" for "Rune", "yellow" for "Gold") and the "How many chompies..." answer
  ("...for a hat. ~ Rantz flashes fingers at you, you think he means 30. ~" for "...for a hat: ~ Rantz flashes
  his fingers. You think he means 30. ~"). Of the transcript's two "What are the hats like?" answers, the one
  live plays (colons) is used.
- The capture's hint arrow went at tick 836, 50 ticks after it was drawn and a tick after the player started to
  walk. We clear it on the 50-tick timer; the capture can't tell the two apart.

### Ours (no source)

- The chest locks again 100 ticks after it is opened (Wiki: "it may lock again"); Unlock before stage 15 says
  "Nothing interesting happens."; using bellows on the bubbles keeps its old two lines.
- The demonstration moves on to 40 eight ticks after Rantz's miss if the bird never reaches the bait.
- The hunting hint arrow is cleared if the bird flies off unkilled.
- A bait bursting next to the player says "You're hit by bits of exploding toad!" (the Wiki transcript's line; no
  capture stood beside a burst).
- An escaped bloated toad's swamp toad leaves again after 100 ticks; inflating with a full pack (and fewer than
  three toads) keeps the old "You need an empty inventory slot for the bloated toad.".
- Rantz's first seasoning line is rewritten to the player's own pick (the transcript's stage-50 page always says
  Onion; its repeat page picks at random).

## Runs

### 2026-10-23 · agent · model not recorded

- **Source:** issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q006); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Start:** checkpoint: fresh stage-0 prefix to stage 20; saved checkpoint resumed after later restarts.
- **Result:** varp 293 = 65; QP 0->2, Cooking +1,470, Ranged +735, Fletching +262.
- **Checked:** repeat dialogue (Rantz), relog (twice), save history, logout/offline.
- **Not checked:** No overlay, all-branch or recovery claim; No separate QP reading at stage 60; Later plugin edits and uncovered recovery need rechecks.
- **PRs:** [#1097](https://github.com/RSPSApp/tsps/pull/1097).
