---
quest: The Corsair Curse
key: the_corsair_curse
status: passed-with-issues
tested: 2026-10-25
tester: community
model:
commit:
cache: osrs-241_2026-10-20
start:
travel:
---

# The Corsair Curse

Community-reported completion accepted for scheduling (skip full manual replay). The scenes, the dig,
the fire, Ithoi's fight and the journal are now aligned with a whole run of the quest on live: rsprox
capture **local 1001340** (revision 240.1, start at tick 4380, completion at 7401). Tick numbers below are
that recording's. Bug thread: issue #2410.

## Capture facts the plugin relies on

### Varbits

`corscurs_progress` (6071): 5 on "Sure, I'll try to help with your curse." (4380), 10 with "Captain Tock
swaggers off towards Rimmington." and sound 1753 (4414), 15 with "The ship sails to Corsair Cove..." (4702),
20 when the last crew theory is ruled out (6050), 25 Tock's "Arrr, I don't rightly know..." (6128), 30 and 35
on Gnocci's and Arsen's reports (6191, 6225), 40 Ithoi's confession (6314), 45 "The Corsairs all think I'm
sick too..." (6345), 49 two ticks after the driftwood is lit (6380), 50 when Ithoi's spell lands (6401), 52
Tock's kill order (6497), 55 two ticks after Ithoi's death (7250), 60 on completion (7401).
`corscurs_navigator` 1 on "Okay, it doesn't sound like you know..." (4882); `corscurs_thief` 1/2 on Arsen's
story (5033, 5037), 3 with Tock's artefact box (5498), 4 on Tess's "Dis is tooth-pick." with the artefact
leaving the inventory (5663; the item box before it keeps it), 5/6 on the report (6026, 6030);
`corscurs_cabinboy` 1/2/3 and `corscurs_cook` 1/2/3 as below. NPCs (the crossroads, ferry, sick and
post-quest crew), the doll and the driftwood are cache multinpcs/multilocs on these varbits.

### Cutscene state (every scene)

The screen fades out (fade_overlay 174 by script 948, `[0, 255, 0, 0, 50]`, or 15 cycles for the ship and
the fire); two ticks later `fov_clamp`, `cutscene_status`, `minimap_state` 2, `gravestone_tli_hide`,
`option_areasounds_override` (the player's own area-sound volume, 71 in this run), `areasounds_override`
1 and `draw_distance_max_override` go on, the side tabs close, the five camera-shake axes are cleared and
the player is in a copy of the map; then it fades back in (`[0, 0, 0, 255, 50]`). The end reverses it with
`cam_reset`. Between a click and the next line live shows an empty, unclickable messagebox.

### Tock's ship (4382-4405)

"Now, I've a ship moored west of Rimmington..." is held. +1 the player is on the real ship (2918,3231);
camera (2943,3224,800)/(2928,3224,100) at +2, (2926,3224,800)/(2911,3224,100) rates 6/0 at +3 with the fade
in, look-at (2911,3227,100) rate 1/0 at +12; fade out at +21, back at the crossroads at +22, the line's
continue at +23.

### Colin's mermaid (5054-5220; instance from chunk 313,353)

"I was using Ithoi's telescope..." is held five ticks with the fade. Colin (7965) stands at 2527,2836,1,
the player at 2528,2841,1; night tint `[0, 0, 54, 150, 60]`. Each line's tick after the click on the one
before: "What lands lie..." +2 (Colin steps east), "Eh?" +3 (seq 2171), "What was that?" +1 (seq 857),
"Is that what I think it is?" +3 (seq 7825, Colin becomes 7966), "It's so dark..." +1, "... yes, it's a
mermaid!" +2 (seq 7827, back to 7965, jingle 103), "Hello?" +2 (wave 863), "Can you hear me?" +2 (864),
"You're the most lovely..." +2 (cheer 862, jingle 165), "I can see you moving your arms..." +5, "*kiss*" +6
(1374, sound 1854), "Hello?" +4, "Oh, no..." +6 (7966 again), the last two at once (tint out, jingle 265).
The last click: back at the player's tile a tick later, `corscurs_cabinboy` 1 with "Perhaps you can find the
mermaid..." (head 7965) at +3. No mermaid NPC is ever shown.

### Gnocci's doll (5314-5418; instance from chunk 311,352)

"I was fishing..." is held five ticks. Gnocci fishing (7971) on 2505,2836, the player on 2500,2840; both
play human_lobster (619) every four ticks. "C'mon little lobsters, come to Gnocci!" +5, "Obby-lobby..." +0,
the player's "'obby-lobby' - what?" +2 over a quick fade out, "It's a traditional..." +0, "C'mon little
lobsters. We don't want..." +1 with the fade back, "Ooh, what's this?" +2 (the player's seq 4185, Gnocci
becomes 7970), "Looks more like a child's toy" +2, "Is it moving?" and "She's moving! SHE'S POSSESSED!
HELP!" at once; the scream is held eight ticks, with seq 4280, jingle 243 and sound 941 (7 loops) at +1 and
the cache's `corscurs_doll` script (2085) at +2. Then Gnocci (7972) digs (seq 830, sound 1470) and runs
east two tiles a tick to 2513,2839; "I buried Her in the sand..." held at +13; back at +17, and the line
again with its continue and `corscurs_cook` 1 at +18. No doll NPC is spawned and the player never digs.

### The telescope (5913-5940)

Observe: the player's "Let's see if I can find that mermaid he saw...". On its continue: seq 2171, the fade
out; +2 an instance of one sea chunk (2528,2816) tiled 6 x 6, the player at its corner and Bugs (7969) at
+22,+33 of it; jingle 244 at +3; camera at +4, the `wom_telescope` lens (386) on `overlay_atmosphere` at +5
with a slow camera pull; jingle 138 at +11; the player's line held at +13; back at +21 and the line again
with `corscurs_cabinboy` 2 at +23. Observed again later: "I've seen enough of that ogre already...".

### The dig (5842-5864)

Dig by the tree: the player's "Okay, he said he buried the possessed doll in the sand..." and the menu. On
"Search for the possessed doll...": seq 830 and sound 1470; +1 `corscurs_cook` 2 and the doll
(`corscurs_doll_multi`, 7993) on 2505,2839, which moves a tile a tick (sound 941 each) to 2509,2838 and back
a step; the player's "That's not possessed..." held at +4; at +11 the doll is gone (sound 2496) and the line
continues.

### The fire (6378-6406; instance from chunk 313,352)

Tinderbox on the driftwood (`corscurs_driftwood_multi`): seq 733 and "You light the driftwood..." held; +2
progress 49 (the multiloc burns), sound 2596, quick fade; +3 the player in the hut, Ithoi (7962) on his bed;
camera at +5 with sound 2066, fade in at +6; "Arrr... uh-oh!" over him at +8; at +11 the player below the
hut (2529,2838,0), at +13 Ithoi running (7963) from the foot of his stairs to 2532,2836 by +17; "Arrr!" at
+20, his cast at +21; progress 50 (the driftwood wet), the player's line held at +23; he runs back by +26;
the real map at +27 and the line's continue at +28.

### The fight (6964-7250)

Climbing Ithoi's stairs at progress 52 enters a copy of the hut (chunk 312,351) with Ithoi (7964) on
2529,2839,1; he faces the player a tick later and attacks every five ticks with strike spells and Curse
("You feel weakened."), shouting one of four lines with each cast. "Awww!" with his death sequence, and two
ticks later the real hut and progress 55.

### Other interactions

- Spade in the sand (`sand_withspade`): seq 832, sound 2733, the spade; the sand shows `sand_withoutspade`
  for 13 ticks (5753-5766).
- Tinderbox by Gnocci's bed: seq 827, then the tinderbox and sound 2582 a tick later (5436-5437).
- Vines into the ogre cave: seq 827, the cave a tick later on the side the player stood on (5606-5609);
  out: seq 828, the cove a tick later (5677-5678).
- Sailing to the cove: the fade out with the box and jingle 171, the deck three ticks later, the fade in a
  tick after that, the box closing by itself (4702-4708).
- Chat-head animations: every captured line's, in `plugins/quests/data/chathead-animations.json`.
- The journal: 13 snapshots (5903 ... 7418); each crew section grows a block per varbit step, the newest in
  blue with its red words, the older ones struck; the crew sections strike together at progress 20.
  The overview's start sentence is "talking to Captain Tock north of Port Sarim." (4352).

## Recorded differences (Wiki followed)

- The Wiki has Ithoi cast Water Strike on the fire; the capture draws Water Bolt's graphics (cast 120,
  projectile 121, sounds 209/210, tick 6399). Ours plays Water Strike's (93, 94, 95; sounds 211/212).
- Tock's "Arrr, ye've found my ship - good [lad/lass]." is "good stuff." in the capture (4692).
- The completion scroll here reads "2 Quest Points" and "Corsair Cove Bank Access" (7401). The 1,200
  Firemaking XP came with the 3 November 2026 update, after this recording; ours follows the Wiki.

## Dialogue the Wiki lacks (from the capture)

Added through osrsreboxed-db `capture-sources.json`: Tock's short "Ahoy, young [lad/lass]." before his first
question (4356, 4365); Chief Tess's "He skinny man who climb down vine the other day, yah? He big fool. You
see what he stole?" before the hand-over, and the apology given to the player, not Tess (5653-5655); Colin's
"What?" (6047); Ithoi's "Besides, if ye be sayin' I poisoned my crew..." (6306).

## Ours

- Scripted actors (Gnocci running, Ithoi, the doll) walk or run to the captured tile each tick; live places
  them (rsprox "teleport"), so the client may draw a slide where live snaps.
- The telescope's copy is one chunk tiled, so the capture cannot say which copy its camera stands in; ours is
  the one south of Bugs.
- Journal blocks never captured in their active (blue) form keep the struck words in plain blue: the intro
  before arrival, Colin's first and last, Arsen's first three and fifth, Gnocci's first, the kill order.
- Arsen's report before Gnocci's lists his first in the journal (the capture heard Gnocci first).
- The fight allows teleports and the normal attack rules; a death leaves the grave outside the copy.

## Findings

- **fixed** Colin and Gnocci missing from their cutscenes and the chat head changing to theirs (the player was
  transformed into them): both are real NPCs in copies of the cove now. #2410
- **fixed** The mermaid choreography, Gnocci's burial and run, the driftwood scene's second-floor start and
  Ithoi's part: from the capture. #2410
- **open** Colin's walk animation at the ferries (reported on #2410): no capture of the ferry walking.

## Runs

### 2026-10-25 · community (thehardcorenoobs1234) · model not recorded

- **Source:** community report ([#1257](https://github.com/RSPSApp/tsps/issues/1257)); moved here from its ledger on 2026-10-29. Proven against plugin hashes, not a commit, so a later plugin change is not flagged automatically.
- **Not checked:** Single account/run report; no full Quest Helper, recovery, multiplayer, dialogue, event or cutscene parity claim.
