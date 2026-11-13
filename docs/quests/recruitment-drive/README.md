---
quest: Recruitment Drive
key: recruitment_drive
status: passed
tested: 2026-11-12
tester: agent
model: claude-opus-5-5
commit: 3bfd4a0d7
cache: osrs-242_2026-11-03
start: checkpoint (Black Knights' Fortress and Druidic Ritual set complete with ::quest)
travel: manual
---

# Recruitment Drive

The quest is aligned with the user's whole-quest rsprox capture (revision 242.1, eleven attempts
through all seven rooms, `RecruitmentDrive.bin`), and an agent played two runs through the real
server: Sir Tiffy's trip, five rooms in random order, the finish and the rewards.

## How the grounds work (capture facts)

Ticks are the capture's.

- **Start:** Sir Amik's "Start the Recruitment Drive quest?" Yes sets rd_main (657) to 1 (tick 69).
- **Sir Tiffy:** "Testing...?" and "Organisation...?" leave the menu once asked (ticks 290, 330).
  "Yes, let's go!" needs an empty inventory and no worn items. "Jolly good show! ..." sets
  rd_spoke_to_tiffy (692). On its continue the screen fades out (948 `[0,255,0,0,50]`). Three
  lines follow with no continue, 2, 5 and 8 ticks later. The player reaches the first room 11
  ticks after the continue, and its observer speaks 2 ticks after that, with the fade in
  (335-350, 489-502). Inside, minimap_state (6719) is 2.
- **A run** is five of the seven rooms in a random order, with Sir Kuam's (Sir Leye) in every run
  of five (also the Wiki). Rooms by cache number: 1 Sir Spishyus, 2 Lady Table, 3 Sir Kuam,
  4 Sir Tinley, 5 Sir Ren, 6 Miss Cheevers, 7 Ms. Hynn. A passed room sets
  rd_roomN_complete (659-665).
- **Exit doors:** in the doorway the door becomes inviswall 38848, with rd_door_inactive 7375
  open on the far tile. door_open 62 plays, then the room's jingle after the silence track
  (159, 131, 155, 156, 160, 161, 162), and the player steps through. The room's items and side
  varbits go a tick later, and the door is back 2 ticks later. The player is moved to the next
  room the tick after that, and its observer speaks 2 ticks after arriving (621-627, 959-966). A
  door clicked too early says "You have not completed this room's puzzle yet."
- **Failing:** the observer's "No... I am very sorry. ..." (Sir Ren: "It's sad to say, ...",
  held 3 ticks; Sir Leye: "AH-HA HA HA! ..."). On close the screen fades out. 3 ticks later the
  side varbits are cleared, the items are taken and the player is at 2996,3375. Sir Tiffy's
  failure lines follow 5 ticks later, with the fade in (452-468, 551-568, 898-916).
- **Quitting:** a room's entrance portal asks "Quit the Training Grounds?" YES|NO. On YES the
  player is moved the tick after, with no fade, and Sir Tiffy's failure lines follow 5 ticks
  later (1776-1789).
- **The finish:** the fifth room's "Excellent work! You have passed all five ..." closes into the
  fade. The player is by Sir Tiffy 3 ticks later, and his finishing conversation plays a tick
  after that. "Your respawn point has been left alone, ..." shows, then the completion and
  rd_main 2 (3584-3600). The fourth room's observers say "Well done, that was your fourth
  test, ..." (2770).

### The rooms

- **Sir Ren (5):** rd_templock_1 (666) is the word (6 = LAST in all three captured runs). Each
  clue asked counts in rd_templock_2 (667). Once the final clue is given, a talk replays it
  with no menu (437). The door opens rd_combolock (285): four letters (43-46) from "A",
  arrows 47-54 with the lever sound 2400, and enter 56 (404-452, 2985-3003).
- **Ms. Hynn (7):** rd_templock_2 is the riddle (5 fingers, 1 husband, 3 captive). The number
  riddles use the "Enter amount:" count prompt (10 passes the husband riddle, 947). The
  captive's fate is a menu (2497). She asks again from her greeting on a talk (2487).
- **Lady Table (2):** rd_room_order (658) and rd_templock_2 take the layout (1-12). Her lines
  show at +0/5/10/15, with the dim and fade at +38 and every statue back at +43. The cache's
  missing statue for each layout matches every captured pass (layouts 2, 5, 6, 7).
- **Sir Tinley (4):** his clue sets rd_templock_2 to 1. From the continue it counts up one a
  tick, and the tick after 15 the room is passed (595-611). A walk click while it counts fails
  it (550-551).
- **Sir Kuam (3):** Sir Leye (20 hitpoints) appears with smokepuff 86, "No blade may defeat me!"
  and a hint arrow as the second line closes. Steel shortsword, claws, battleaxe and warhammer
  lie at 2458-2461,4967. A bladed killing blow fails the room ("You have failed to complete
  this room's puzzle..."); unarmed passes (898, 1068, 2013).
- **Miss Cheevers (6):** each bookshelf and crate holds one item, found once, two ticks after
  "You search ...". The chemical shelves use message boxes and menus with rd_got_ varbits
  671-679. The Bunsen burner, the stone door (686, 687) and the tin (688, 689) follow the
  captured solve, and the alchemical notes are the 11 captured spreads of book 392
  (`recruitmentdrive/data/cheevers-notes.json`).
- **Sir Spishyus (1):** the fox, chicken and grain are worn when picked up (weapon, shield and
  cape slots) and put on the side's pile when taken off. Each has a left and a right varbit
  (680-685). Over 5 kg the bridge is refused. A crossing walks eight tiles, and nine ticks
  after it starts the side left behind is checked (chicken and grain: 2/2 left, 3/3 right;
  fox and chicken: right 681 3, 683 2).

## Findings

- **open** Ours: a run lasts only the session. A player who logs in on the grounds is put by Sir
  Tiffy with the room's items gone (live has rd_roomlogout 2230; no capture logs out inside).
- **open** Ours: no capture shows the run ending in Sir Ren's, Miss Cheevers' or Sir Spishyus'
  room; their exit door then ends the run as the observers' line does.
- **open** Ours: Sir Leye's weapons are owner-only ground items (live: public spawns).
- **open** Ours: dying in Sir Leye's room ends the run with no message.
- **fixed** Sir Tiffy's "top-notch adventurer" and "So, are you ready to begin testing?" come
  from osrsreboxed-db#88.

## Runs

### 2026-11-12 · agent · claude-opus-5-5

- **Start:** checkpoint. Two accounts had Black Knights' Fortress and Druidic Ritual completed
  with `::quest` and were placed by Sir Tiffy with `::tele`. The second had `::master`
  (Sir Leye killed the first, a 10 HP account, which ended its run).
- **Route:** run 1 Sir Tinley → Miss Cheevers → Sir Spishyus → Sir Ren → Sir Kuam (died). The
  relog after a server restart put the player at 2996,3375 with no items or side varbits.
  Run 2 Miss Cheevers → Lady Table → Sir Spishyus → Ms. Hynn → Sir Kuam, then the finish.
- **Result:** rd_main 2, quest complete, 3,000 coins, the initiate sallet and +1,000 Prayer,
  Herblore and Agility XP. Sir Tiffy's menu drops asked options, and the not-ready refusal
  plays.
- **Not checked:** vision clips. Quest Helper was not run.
