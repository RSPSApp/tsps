---
quest: His Faithful Servants
key: his_faithful_servants
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# His Faithful Servants

Supporting work for Desert Treasure II, tracked outside the 128; natural testing pending.

## Capture facts (rsprox captures)

From the user's rsprox captures (revision 242.1): `BarrowsMiniQuest.bin`, the whole miniquest
from a fresh start, and `StrangeOldLockpickBarrows.bin`, a finished account's Barrows run with the
strange old lockpick. Ticks are the recording's.

- **Before the start (tick 16).** A spade on a brother's mound gets the Strange Old Man's line
  "You want to dig? Good, good! But we talk first. Talk then dig!" (chat_left, chathap2 568). No
  `human_dig`, no `digspade` sound, no dig.
- **The start (ticks 66-84).** `hfs` (varbit 14973) goes 0 -> 2 as the player's "Okay..." shows,
  after his "Yes! Do this! ..." line. No start chat line. The menu that follows is
  "Can you tell me more about the brothers?|I'll be back soon."
- **The book (ticks 93, 1020).** "The Strange Old Man gives you a book." is an item box (193)
  with the crumbling tome (4707). The tome goes into the inventory as the box opens. With the
  tome carried he says "Read it! Read it!" instead (tick 101).
- **The icon (tick 885).** It is the chest's first reward (`trail_rewardinv` slot 0), in the
  reward window with the loot. `hfs` 2 -> 4 at the search.
- **The hand-in (ticks 991-1010).**
  - `hfs` 4 -> 6 at "You give the icon to the Strange Old Man." (item box, icon 28130).
  - `hfs` 6 -> 8 at the disintegration box (`barrows_icon_dust` 28131). It comes with
    `snare_impact` 3002 and `lore_fire_titan_death` 4759, delay 30.
  - `hfs` 8 -> 10 at "The Strange Old Man gives you a lamp and a map." (objectbox_double 11).
  - No jingle, completion scroll or completion chat line.
- **The map (tick 1065).** `barrows_map` (14975) is 1 once studied. After that the crypts no longer
  hide the minimap: no `minimap_toggle 2` in the lockpick capture.
- **The lamp (ticks 1074-1077).** "Use the lamp to receive 20,000 Prayer experience?" Yes./No.
  On Yes: `hfs_reward_lamp` (14974) 1, `found_gem` 2655, and a message box (229) reading
  "<col=0000ff>Your wish has been granted!</col><br>You have been awarded 20,000 Prayer experience!".
- **The tunnel warnings (ticks 1028-1035).** `barrows_warning_toggle` (12434) goes 0 -> 1 as his
  scream shows. Once condensed, the crypt's hidden-tunnel line is the menu's title, with no
  message box (lockpick capture tick 23).
- **Login.** A finished account receives `hfs` 10, `hfs_reward_lamp` 1, `barrows_map` 1 and
  `barrows_warning_toggle` 1.
- **The strange old lockpick (lockpick capture ticks 52-68; miniquest capture 543-704).**
  - Using it on a locked tunnel door opens it and walks the player through, as Open does.
  - One charge pays for the hallway, and its other door is free (48 -> 47 -> 47). The door
    varbit doesn't change.
  - A full pick becomes the used one in its slot.
  - Inspect: "Your Strange old lockpick has N charges remaining."

## Recorded differences (the Wiki is kept)

- Tick 77: the player says "Right... So you want me to go and kill six brothers and bring you
  back an icon?". The Wiki transcript has "kill the six brothers".
- Ticks 83, 90 and 100: the menus before the icon lack "I wanted to ask you about warnings.",
  which the Wiki transcript lists.
- Ticks 1012-1061, his chat after the miniquest:
  - "A big scary monster! HAHA..." (the Wiki has no "!").
  - "Wanna hear a secret?" -> "What?" -> "They're not normal!" -> "Right..." (the Wiki: "Pst,
    wanna hear a secret?" and the Sure!/No thanks. menu).
  - Every one ends in the menu "Can you tell me more about the brothers?|I wanted to ask you about
    warnings.|I'll leave you to it then...". The Wiki's standard dialogue has "Ask about tunnel
    warnings." instead.

## Ours (no source)

- The icon's space: it is given only when a slot is left once the loot is in (a stack already held
  takes none), with no chat line otherwise. The Wiki says only that it needs enough space, isn't
  dropped, and that six free slots are advised.
- The lockpick's last charge: the Wiki's "almost breaks" line, then the pick goes silently as
  the tunnels are left.
- A picked hallway stays passable until the layout changes.
- The lockpick on the puzzle door skips the puzzle for a charge, as Open with it carried did.

## Findings

None recorded.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) supporting (q130); PRs: [#1131](https://github.com/RSPSApp/tsps/pull/1131).
