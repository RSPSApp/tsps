---
quest: Enlightened Journey
key: enlightened_journey
status: passed-with-issues
tested: 2026-11-23
tester: agent
model: claude-opus-5-5
commit: 4cb30fdc6
cache: osrs-242
start: fresh
travel: manual
---

# Enlightened Journey

The plugin (`server/plugins/quests/quests/EnlightenedJourney.Quest.js`, with
`enlightenedjourney/Scenes.EnlightenedJourney.js`) and the balloon transport plugin
(`server/plugins/world/BalloonTransport.plugin.js` and `balloontransport/`) follow one whole run of the quest on live
OSRS, followed by every balloon route opened and flown: the user's RSProx capture "Enlightened Journey & all paths"
(revision 242, SHA-256 `e425e9e3843b0a25fc116bc0d3b97978756bc93ed7cf06d9bf66ecae047fcd2c`). Ticks below are that
capture's. The words are the "Enlightened Journey" and "Auguste" transcript pages (OSRS Wiki), with the one branch
the Wiki lacks added from the capture in osrsreboxed-db (see "Dialogue").

## Stages (zep_quest, varbit 2866)

The stage is zep_quest itself (client script 4024 case 42; Quest Helper keys on the same values); each value is set
where the capture sets it.

| zep_quest | Set by | Tick |
| --- | --- | --- |
| 5 | "Yes." to "Start the Enlightened Journey quest?" (with "You've started a new quest") | 255 |
| 6 | "Let me show you!" continued: the balloon diagram (zep_if_balloon_blueprint 472) opens, the chat closes | 262 |
| 10 | his explanation's last line, "You're the adventurer, you should know! ...", continued | 306 |
| 20 | "Good, you have everything! Now, I need you to create an origami balloon." | 349 |
| 40 | the end of the first experiment's scene (the origami balloon taken then) | 528 |
| 60 | "Well, that went down like a lead balloon." shows (the two papyrus and potatoes taken then) | 592 |
| 70 | "Here you go. Now be very careful not to lose it!" continued (the sapling and apples given then) | 639 |
| 80 | the last material handed in, as its thank-you is continued | 850 |
| 90 | two ticks after "Great! Let me just put it all together..." is continued (the 12 branches taken) | 1463 |
| 100 | the landing in Taverley (zep_multi_piccard 1 with it) | 2099 |
| 200 | Auguste's "For all your hard work..." | 2122 |

Saves from before this scale (compact stages 1-8) are moved onto it once at login.

## Hand-ins (zep_* varbits)

Each material is taken, and its bit set, as Auguste's thank-you is continued: zep_ydye 2874 (755), zep_rdye 2873 with
zep_alldye 2879 (757), zep_silk 2876 (769), zep_bowl 2878 (774), zep_sandbags 2875 with zep_quest 80 (850). All six
go back to 0 at completion (2122). After each hand-in or refusal the hand-in menu comes back with only what is still
owed ("Sandbags.|Silk.|Bowl.|Never mind." at 757 and 765, "Sandbags.|Bowl.|Never mind." at 769).

## Items

- Papyrus on a ball of wool: "You create the origami balloon structure.", zep_making_balloon 5140 and zep_construct
  3248 (446). An unlit candle on the structure: the balloon at once, the message, animation and sound a tick later,
  with 35 Crafting XP (483-484).
- A dye on the origami balloon: "You dye the origami balloon blue." and 10 Crafting XP (2541). The Wiki's other
  seven dyes make their own colour (not capture-verified).
- A tinderbox on a balloon: "You light the origami balloon.", zep_set_off_balloon 5142, the colour's set-off spotanim
  (886 for blue) and zep_balloon_float 3245, five cycles late, and 20 Firemaking XP; three ticks later its on-fire
  projectile from two tiles south to eight (2583-2586).
- An empty sack on the sand pit: one sandbag a use, "You fill the bag with sand." (spam), zep_fill_sandbag 5155 and
  sand_bucket 2584 (799-825).
- The capture bought its 12 willow branches and destroyed the sapling; planting and cutting follow the Wiki.

## Scenes

- **First experiment** (zep_quest 20, holding the plain origami balloon; 492-540): "Wonderful! I'll take that..."
  continued fades out; three ticks later a copy of Entrana (chunks from 345,416) with the player on (2808,3355), the
  cutscene Auguste (zep_piccard_cutscene 4716) beside them facing south-west, the side tabs closed; a tick later the
  throw and spotanim 880, the camera (2810,3358,400) looking at (2809,3355,300), the fade in and jingle 116; three
  ticks after that the burning projectile 882 and a slow pan. The talk carries on fourteen ticks after the continue,
  with the cutscene Auguste's head. "We're doomed." continued fades out; three ticks later the copy is gone, the
  player back where they stood, zep_quest 40 and the balloon taken; the fade in six ticks after that.
- **Second experiment** (zep_quest 40; 566-606): "Commendable..." continued fades out; three ticks later the copy,
  with zep_peasant_1-4 (4724-4727) south-east facing south. They walk west under the balloon tile by tile as
  recorded; peasant 1 shouts "Burn, stab, burn!", "Destroy the floating thing!" and "We are peasants against science!"
  overhead (578, 586, 590); the projectile 878, the on-fire spotanim 879 on (2808,3349). At 592 zep_quest 60, the
  materials taken, the player shrugs (2113) and says "Well, that went down like a lead balloon."; its continue ends
  the scene as the first, the fade in seven ticks later.
- **The basket** (zep_quest 80, twelve branches on the frame; 1458-1482): on the real map. "Great! Let me just put it
  all together..." continued; two ticks later zep_quest 90, the branches taken and a fade out; five ticks later
  zep_multi_basket 2 (the balloon on the platform, never 1), a cutscene with the player on (2808,3354) and the camera
  from above; three ticks on the jingle and a climb away; the fade out six ticks after that and the cutscene's end
  three ticks later.

## The flight (balloon controls)

Every route's screens are the capture's (plugins/world/data/balloon-routes.json): Taverley (the quest's, maps 1-3,
ticks 1640, 2032, 2069), the Grand Tree (7-9), Castle Wars (10-12) and Varrock (13-15). Their occupied cells match
the earlier transcription from the Wiki's images, so every solution and start height stands; some scenery models and
the Grand Tree's waterfalls (zep_waterfall 5157) were wrong.

- One move a tick at most (111 moves a tick apart over the six flights); two clicks in one tick move on two ticks.
- Over Entrana a bail, or a crash (the red rope at take-off, 1653; a cloud on the seventh move, 3025): the controls
  close on black, a tick later the player is on (2809,3355) with the tabs back, the fade in and the message box "You
  bail, but land safely on Entrana.", whose continue clears the overlay.
- Log storage's Preferences offers the three choices less the one set (all three while none is; 1577-1612). The
  quest's first flight asks it itself (the transcript's box and menu) only while none is set, and saves the answer;
  with one set, "Okay." flies by it, asking "Use logs from inventory | Use logs from storage" a tick later only when
  "ask" is set and both can pay (1638-1640, 1996-1997). The storage count is told even when the inventory paid (2001).
- Take-off and landing toggle cutscene_status, gravestone_tli_hide and cutscene_force_sidepanel with the minimap.
- Arrivals: "You arrive safely in Taverley." (2102), "at the Gnome Stronghold." (3149), "at the Crafting Guild."
  (3453), "at Castle Wars." (3640), "in Varrock." (3799).

## After the quest

- Taverley's Auguste: "Yes." opens the balloon map (2218); a station not yet opened, picked away from Entrana, is the
  message box "You can only open new locations from Entrana." (2223). The first Entrana trip is Auguste's "Weapons are
  not allowed on Entrana. I must search you first." and the box "You are quickly searched.", zep_already_searched 1833
  set as it is continued (2241-2246); later trips only send the chat line (2967). Three ticks after that first trip
  lands, zep_multi_piccard is 2: Assistant Stan keeps Taverley's balloon (2253).
- Entrana's Auguste explains the enterprise the first time (Auguste page, "Initial dialogue"), zep_return_check 2886
  set as "I have also hired assistants..." is continued (2983); after that his short menu.
- His menus have "What motivates you?" (2146-2174), which the Wiki lacks.
- Fly on Auguste before the quest is done: "You should speak to Auguste first." (277, 2112).

## Dialogue

Imported from osrsreboxed-db (RSPSApp/osrsreboxed-db#138), which adds to both pages from the capture: the "What
motivates you?" option with its five lines, and the hand-in menu's way back ("shows other options", the item menu
again) in place of the Wiki's "previous".

## Not capture-verified

- The seven other dye colours' message words; the plain balloon's release.
- The sapling's planting, growth and cutting (the capture bought its branches); the 30,000-coin replacement was
  refused for lack of coins and "already have one".
- The bomber jacket and cap replacements and the cap-and-goggles combination (Auguste page; Wiki: Bomber cap).
- Crashes past Entrana (the sea and the woods sites are calibrated tiles).

## Recorded differences

- The third completion line, "For all your hard work...", is sent with zep_piccard's head (4715) where the two before
  it use zep_multi_piccard (4728); ours uses the NPC talked to.

## Findings

- **fixed** The balloon diagram closed with the conversation that opened it (playthrough on 4cb30fdc6).
- **fixed** After the last hand-in the talk fell into "Here's the silk."; the hand-in menu went back to the top
  menu; the bomber replacement branch played nothing (dialogue fixes in RSPSApp/osrsreboxed-db#138).
- **fixed** The bail message box left an empty chat open; the quest flight asked the log question every time.

## Runs

### 2026-11-23 · agent · claude-opus-5-5

- **Start:** fresh account; 20 QP from five unrelated quests, Firemaking 20, Farming 30, Crafting 36 set, ordinary
  items supplied (papyrus, wool, potatoes, candle, dyes, silk, bowl, sacks, 12 willow branches, logs, tinderbox),
  one `::tele` to Auguste.
- **Route:** every stage by its real interactions: 5, 6, 10, 20, 40, 60, 70, 80 (sandbags one per use), 90 (the
  basket), two bails over Entrana, the recorded 57-move flight to Taverley (100), the reward (200).
- **Result:** 1 QP, 2,000 Crafting, 3,000 Farming, 1,500 Woodcutting and 4,000 Firemaking XP, the bomber cap and
  jacket, once; repeat talk gave nothing; relog and the offline save kept stage 200 and 21 QP. Post-quest: Taverley's
  four options, the balloon map, the trip to Entrana with the search; Entrana's first and second talk.
- **Clips:** second experiment, basket, take-off and bail, Entrana trip: no black screen, camera back on the player.
  The first experiment ran headless (the vision login closed the talk); its end screenshot was clean.
- **Not checked:** the sapling's planting and growth, the replacement purchase, the Quest Helper overlay.
