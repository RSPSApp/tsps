---
quest: Tower of Life
key: tower_of_life
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Tower of Life

The plugin (`server/plugins/quests/quests/TowerOfLife.Quest.js`, with `toweroflife/Puzzles.TowerOfLife.js` and
`toweroflife/Scenes.TowerOfLife.js`) follows one whole run of the quest on live OSRS: the user's RSProx capture
`TowerOfLife.bin` (revision 242.1, SHA-256 `05d16331089ad679508d79b71a80eb17db86e4c1e62849f84fc340dd8249c51a`).
Ticks below are that capture's. The words are the "Tower of Life" transcript page's (OSRS Wiki); where the Wiki
and the recording word a line differently the Wiki's is kept (see "Recorded differences").

## Stages (tol_prog, varbit 3337)

The stage is tol_prog itself; each value is set where the capture sets it.

| tol_prog | Set by | Tick |
| --- | --- | --- |
| 2 | "Sure, why not." to Effigy's "Start the Tower of Life quest?" | 378 |
| 4 | Bonafido's "Okay. Come to me kitted out like a builder..." | 460 |
| 6 | Bonafido's "Cosmic! ..." after the builder's quiz | 1130 |
| 8 | first time through the tower door, wearing the outfit | 1289 |
| 10 | two ticks after "Wait! What about-" to Effigy, all machines working | 2659 |
| 11 | the end of the creation cutscene | 2872 |
| 12 | Effigy's "Good on you! I knew you would help us!" | 2955 |
| 14 | the Homunculus mind puzzle's message box | 3094 |
| 16 | the Homunculus's "Easy. You run down and I watching from here..." | 3291 |
| 17 | the end of the scare | 3388 |
| 18 | complete, after the Homunculus's last line in the dungeon | 3442 |

Saves from before this scale (stages 2-16 with flags) are moved onto it once at login.

## Getting in

- Tower door before tol_prog 6: message box "You're going to need permission to enter this building." (294).
  At 6 and later it opens as a pass-through gate (tol_inviswall 21929 on the doorway, the open leaf 21815, sound
  3419, shut two ticks on).
- The builders' own pages before tol_prog 4 and after their piece is had; their quest talks while it is not
  (The Guns' standard talk at 722, right after the shirt; Black-eye's and Gummy's at 1141, 1145).
- Every costume piece comes with "Try the beckon emote while wearing an item of builders' clothing!".
- No fingers: tol_nofingers_asked (3376) with "But there's no way I'm giving any to you." (679). Pickpocket:
  "You attempt to pick the man's pocket.", a tick later "You pick the man's pocket...and find some boots!",
  seq 881, sound 2581 and 8 Thieving xp (691-692). Boots used on him: "Nothing interesting happens." (706).
- Plants (tol_plant4, 21924): "You search the plant..." with seq 5216; five ticks later "Nope, nothing here."
  with seq 2113, or the message box "Aha! You find some trousers!" (731-815; found on the seventh search).
- Bonafido's whistles: a held message box with the emote and an area sound (radius 10), moving on by itself:
  dance 866/3437 (5 ticks), tune 862/3438 (5), attention 5845/3426 (3) (925-1020).

## Crates

Search: seq 5819 and map_anim 1025 (delay 20, height 20) on the crate; eight ticks later "You found something!",
seq 855 and the item (1297-2397; 35 searches, none empty). tol_crate01 and tol_crate10 give metal bars, 02 pipes,
03 pipe rings, 04 rivets, 05 valve wheels, 06 metal sheets, 07 coloured balls, 08 binding fluid, 09 a triangle
sandwich. Once the machines work: "You have no need to search the crates." (3047).

## Machines

- Fix: tol_examined_*_mach (3373-3375) the first time; the page's two message boxes, then "Construct it?"
  Yes/No. Short of materials: "You need 5 metal bars to fix the machine." (2215; the first material short, with
  its full count). Building: seq 5846 (and sound 3421 for the two machines), four ticks later tol_*_prog 1, the
  materials gone and "You built the machine! It still needs calibrating, though." / "You built the cage!".
- Pressure (510): balls start at 3, 4, 1, 1 with tol_pres_initpuzzle (7982). Lever 1 frees wheel 2 when pulled
  and wheel 1 when not; lever 2 does the same for 4 and 3 ("Pipe N: The wheel won't budge. A lever will release
  it."). An unplugged ball stops at 3, 4, 3, 4 ("...There isn't enough pressure because of the hole!") and plugs
  its hole when lowered onto 1, 2, 2, 3 ("...The leak is blocked!"); 1 is the floor ("...You can't lower the
  pressure any further."). All four plugged at 5: three ticks later "The machine is working!" (game message and
  box) and the interface closes (1590-1669).
- Pipes (511): pieces 01-05 (components 10, 13, 9, 11, 12) start at (356,58), (327,171), (402,153), (323,229),
  (449,64); piece 3 starts turned twice. A press moves the piece in hand 8 pixels; none goes above y 58 (presses
  ignored, nothing resent, 2114-2115). Each piece has four rotations (green models base..base+3; tol_pipe5_rot,
  7981, for the fifth only). In its first rotation a piece locks onto its target from up to 9 pixels away on both
  axes: (83,80), (126,64), (159,69), (256,60), (237,155). "Please select a piece of pipe first.", "You've already
  solved that piece!". The machine works four ticks after the last lock (2003-2189).
- Cage (509): opens on its second side. A bar of the right direction and size fills the first open slot that
  takes it on the side shown ("You fix the part of the cage!", the slot's model, sound 3420); otherwise "That's
  not going to work."; "You can't make bars smaller than that."; pressing the shown bar's button again takes it
  away. The last bar: "It's complete!", the cage turns once round a side a tick, and five ticks on tol_cage_state
  and tol_cage_prog 2, "The cage is complete!" (2437-2579). After the last machine: "The tower should be in
  working order now! Best go and tell Effigy!" (2582).

## Scenes

- Effigy at tol_prog 8 with the machines working: on "Wait! What about-" the chat closes as the screen fades
  (15 cycles); two ticks later tol_prog 10, the fade in and "Why does nobody listen? ..." (2645-2659).
- The ladder up at tol_prog 10: seq 828 and a fade out; five ticks later a copy of the tower (rebuild_region zone
  1602,1282) with the player on (2648,3221,3), the tabs closed, and Effigy 3586 (2652,3217), Transmute 3593
  (2647,3215) and Currency 3595 (2650,3215), the player and all three facing the cage at (2649,3218) (2721-2722); camera at +1, fade in and pans at +6/+11/+16, the talk at +21. After
  "It begins!": seq 4411 on the three, map_anim 736 at eight tiles with sound 3422 three ticks on, and the
  Homunculus 3589 at (2648,3217) with seq 5833 seven ticks on. "Arghhh!"/"Oh no...": spotanim 1026, seq 5834,
  sounds 3428 and 3418, waves of map_anim 736; tol_cage_state 0 on "Run away!"; the fade on "Flee for your
  lives!", out of the copy to (2648,3221,2) three ticks on, tol_prog 11 two after (2712-2872).
- The ladder up at tol_prog 11: "I should go and talk to Effigy outside first." (2892).
- Effigy at tol_prog 16: a cutscene on the ground floor (tabs closed, camera at (2641,3213) looking at
  (2639,3220)); tol_homonc_pres (3359) and sound 3423 with "Boo."; after "Me look dungeon, ..." the fade, and
  three ticks on tol_prog 17 with the Homunculus gone and the tabs back (3361-3388).

Each scene's timers start when its line is continued, not when the line event comes: the event comes as the
dialogue chain is built, often before the line is shown, so a player who read slowly got the fade in before the
fade out and a black screen, and the scare ended (tabs and camera back, tol_prog 17) while its talk still played
(issue #6485). What a line shows with (camera, sounds, tol_homonc_pres) plays as that line is shown. While a scene
plays, a close (Esc) or a world click keeps the chat, since the scene ends only from its last line's continue. A death
mid-scene (ours: none captured) lets the scene go, with its timers, and the scene plays again.

Every scene fades a tick after its last line is continued. The two Tower of Life recordings agree on the gaps after
each fade (hand-off fade+2, Flee fade+3 and fade+5, scare fade+3) but not always on the continue's own tick: the
hand-off fades a tick after it in both (2656 -> 2657 here; 9032 -> 9033 in rsprox.net recording 1002189), Flee on it
here (2867) and a tick after in 1002189 (9290 -> 9291), the scare a tick after here (3384 -> 3385) and on it in
1002189 (9672). The tick after is what four of the six show.

## The Homunculus

- Mind puzzle (tol_prog 12): the message box sets tol_prog 14 and tol_homon_align (3358) to 7, opens overlay 508
  and moves the camera. The fourteen questions run round in a loop, each answer moving the bar +1 (logic), -1
  (magic) or not at all, with the overlay's fifteen arrows hidden and the one at the bar shown, until it reaches 0
  or 14. Walking off closes the overlay with a cam_reset (3143), as the bar reaching an end does (3284); talking again ("It's me again, Homunculus.") starts over at 7
  (3149). At the end, "I decided to root for logic." when logic won (3286).
- Trapdoor before tol_prog 17: "It seems to be locked." (2628, 3043, 3331). Open: seq 827 and sound 91 (delay
  40), tol_trapdoor_open (3372) a tick later; Climb-down: seq 827, a tick later (3038,4376,0) (3414-3422).
- The dungeon Homunculus's "Thrank you..." completes the quest and clears the pressure varbits and
  tol_homon_align (3442). The scroll shows the builder's shirt and "Creature Creation Access". The dungeon ladder
  goes back to (2649,3212,0) (3493).

## Recorded differences (the Wiki's kept)

Where the transcript and the capture word or split a line differently, the transcript's words play: e.g. "made just
for my fellow alchemists and I!" (capture: "...and me!"), "What a keen eye this chap has!" (capture: "What a keen
eye you have!"), "6 rivets, 4 metal pipes and 5 metal rings." (capture: "pipes, and 5"), and lines the Wiki splits
in two that the capture shows in one box.

## Not in the transcript data

The capture has these talks, which the dialogue data does not; the plugin plays the nearest transcript variant:
Effigy at tol_prog 2 ("Hi, Effigy." / "My favorite builder! Any luck?") and 4 ("Hey, Effigy. I've spoken with
Bonafido!"); Transmute at 2 ("Do you know where I can find Bonafido?") and 4 ("Why do they call you
'Transmute'?"); Currency at 2 ("I've agreed to help you with this tower; what's it for?") and 4 ("Hi, I've just
spoken with Bonafido. Interesting chap."); No fingers after the boots ("Still looking for boots?"); the pipe
machine's "Looks like the pipes need connecting, to allow the liquid to travel further up the tower!". They
belong in osrsreboxed-db's dialogue corrections.

## Ours

- The trousers turn up on one search in four (the capture's seventh; no Wiki rate).
- Crates never come up empty (the Wiki says they can; none of the capture's 35 did).
- Pipe rotations 1 and 3 show the grey of rotations 0 and 2 when not in hand.
- A cage bar stops at size 4; a full pressure pipe ignores another raise.
- A worn-off outfit at the door gets Bonafido's reminder as a chat message.
- The journal after tol_prog 11.

## Runs

The in-game check for this alignment (agent MCP, every stage from 0 to 18 on one account) is in the PR.
Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) (q116).
