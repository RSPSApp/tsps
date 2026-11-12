---
quest: Goblin Diplomacy
key: goblin_diplomacy
status: passed-with-issues
tested: 2026-10-25
tester: community
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# Goblin Diplomacy

Community-reported completion accepted for scheduling (skip full manual replay). Retained caveat: Scenes were missing; repeated NPC conversations could be needed to progress.

## Live behaviour (rsprox captures)

From the user's revision 242 capture `20261112T150929-5ab63b4` (world 360), which plays the whole
quest: two start conversations, the dyeing, the start, and the orange, blue and brown fittings to the
reward. Ticks are the capture's.

### Conversations

- Before the quest, each talk opens with one of the Wiki's random openings (ticks 94, 107: "All
  goblins should wear red armour!"; 167: "Green armour best.").
- After "Wouldn't you prefer peace?" the next menu is "Why are you arguing about the colour of your
  armour?" / "Do you want me to pick an armour colour for you?" / "I'll leave you to it." (ticks 126
  and 138): the question just asked is gone. After "Why are you arguing ..." it is "What is the goblin
  new century?" / peace / pick / leave (ticks 122, 133).
- "Start the Goblin Diplomacy quest?" No: "Actually, I think I'll leave you to it." (155). Yes: "I can
  do that." / "What colour we try?" / "Orange armour might be good."; `gobdip_main` (2378) goes 0 to 3
  with "You've started a new quest" as "Yep, bring us orange armour." shows (186). With orange mail
  carried the player goes straight on: "I have some orange armour here." (187).
- Under way, a talk opens with a random opening and then the menu "I have some <colour> armour
  here." / "Why are you arguing about the colour of your armour?" / "Wouldn't you prefer peace?" /
  "I'll leave you to it." (blue 221-224, brown 253-262). The hand-in plays from the first option.
- Dyeing: "You dye the goblin mail blue." (161), "You dye the goblin mail orange." (164).

### The fitting (orange 188-217, blue 227-251, brown 265-290)

- t0, the continue past "I have some <colour> armour here.": an empty message box holds the chat and
  the screen fades out (`fade_overlay` 174, script 948 `[0, 255, 0, 0, 25]`).
- t1: `rebuild_region` copies the 3 x 3 chunks from 2944, 3504 (source chunk 368, 438). The player is
  at 2957, 3513 facing 2955, 3511. General Bentnoze `general_bentnoze_red_noop` (11249) at 2958, 3512
  and General Wartface `general_wartface_green_noop` (11250) at 2958, 3511 face 2953, 3511; Grubfoot
  at 2954, 3511 faces 2956, 3511, as `catwalk_goblin_brown_noop` (11251), `_orange_noop` (11252) or
  `_blue_noop` (11254) for the armour he wore last. The cave entrance and hut doors are their noop
  variants (43462 at 2947, 3506; 43459/43460 at 2957/2958, 3509). `cutscene_status` 1, hidden npc/loc/obj
  ops, `minimap_state` 2, `fov_clamp` 3, `gravestone_tli_hide` 1, `draw_distance_max_override` 1,
  `option_areasounds_override` 30, `areasounds_override` 1, five zero camera shakes; the combat, stats,
  journal, inventory, worn, prayer, magic, settings and emote tabs close.
- t2: camera to 2961, 3514 height 450 looking at 2957, 3512 height 150 (rates 232/232), fade in
  `[0, 0, 0, 255, 25]`. t3: "Grubfoot!".
- "Yes General Wartface?": Grubfoot walks east as it shows (193, 269-270). Continuing past "Put on this
  armour!" holds the chat and he walks back to 2954, 3511. From the tick he is there (A): A+1 he faces
  the curtain (2953, 3511); A+2 `curtain_open` (4346); A+3 he is moved onto the curtain tile; A+4 he
  faces 2954, 3511 and `curtain_closing` (4347); A+8 the same NPC transforms into the next armour and
  the curtain opens; A+9 he is moved to 2954, A+10 to 2955 and the curtain closes; A+11 "What do you
  think?".
- With "Human! Get us blue armour!", "Human! Get us brown armour!" and "Thank you for sorting out
  argument, human. You have reward now." the player faces 2958, 3511 and both generals face the player
  (213, 247, 286).
- t0 of the way out, the continue past the last line: the mail goes, `gobdip_main` 3 to 4 / 4 to 5 /
  5 to 6 and `gobdip_grubfoot_vis` (13594) 1 / 2 / 0, the chat is held and the screen fades out
  (215, 249, 287). t1: back on the tile the player talked from, client state off, tabs back,
  `cam_unlock` + `cam_reset`. t2: fade in, the message box closes (brown: the gold bar and 200 Crafting
  XP, 289). t3 (brown): 5 quest points, "Congratulations, you've completed a quest", jingle 153, the
  scroll with the goblin armour (288) and "5 Quest Points" / "200 Crafting XP" / "A Gold Bar" (290).
- The village's Grubfoot is `catwalk_goblin` (1965), a multinpc on `gobdip_grubfoot_vis`
  (671/672/673 brown/orange/blue), at 2955, 3510.

## Findings

- **fixed** Scenes were missing; repeated NPC conversations could be needed to progress. [#1257](https://github.com/RSPSApp/tsps/pull/1257) The fittings and the mid-quest menu follow the capture since [#4685](https://github.com/RSPSApp/tsps/pull/4685).

## Runs

### 2026-11-02 — agent — DeepSeek V4.1 Flash

- **Skipped:** No rsprox database capture covers the quest. The archive has post-quest
  Goblin Village sightings and unrelated Grubfoot dialogue from Land of the Goblins, but no
  captured start, crate, dye, fitting or hand-in. Not replayed.

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
