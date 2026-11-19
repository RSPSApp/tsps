---
quest: Rum Deal
key: rum_deal
status: in-progress
tested: 2026-11-19
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Rum Deal

Aligned with a whole run of the quest on live: the user's RSProx capture `RumDeal.bin` (revision
242.1, SHA-256 `2877f6a2...3c2c69`; the start at tick 133, completion at 2813, then the brewers, Davey,
Donnie and both of Pirate Pete's lifts). Ticks below are the capture's. Two older recordings in the
rsprox.net index fill in two post-quest replies (3031: the empty barrel; 3034: the squid spot and the
gate after the quest).

The plugin is `server/plugins/quests/quests/RumDeal.Quest.js` with its units in
`server/plugins/quests/rumdeal/` (State, Journal, Patch, Brewery, Scenes); the gate is a pass-through
in `server/plugins/objects/Doors.plugin.js`. The words are the Wiki's: the "Rum Deal" transcript, with
the lines it lacks added from this capture in osrsreboxed-db's `capture-sources.json`, and the Pirate
Pete, 50% Luke, Captain Braindeath, Brewer, Davey, Captain Donnie and Zombie protester pages. Where the
capture words a line differently the Wiki's wording is kept (see "Recorded differences").

Checked by `server/tests/rum-deal-capture.test.cjs` (real Player, packets, plugins, cache and map),
and in game over the agent MCP: the start, knock-out, cutscene, meeting and window; the patch with
`advance_time`; and the gate both ways.

## Stages (varp 600, deal_quest)

| Value | Set by (capture tick) |
| --- | --- |
| 1 | "Yes." on "Start the Rum Deal quest?" (175) |
| 2 | "Of course, I fear no demon!" or "Because I came to offer to help." (242); the knock-out leaves it |
| 3, 4 | together as Braindeath's "Here, lad. I'll give ye the seed..." shows, with the seed (455); 3 alone with no room |
| 5 | the blindweed picked (1173) |
| 6 | "Here, I've been savin' some fer an emergency." (lost blindweed, 1210) or "Splendid, ..." |
| 7 | the blindweed into the hopper (1267) |
| 8 | "When is it ever..." continued (1317) |
| 9 | the bucket in the stagnant lake (1521) |
| 10 | the water into the hopper (1665) |
| 11 | "Here. Ye'll need this to catch them.", with the fishbowl and net (1726) |
| 12 | two ticks after the lever (2010) |
| 13 | "Give the controls a couple of belts with this wrench.", with the wrench (2067) |
| 14 | the Evil Spirit's death (2382) |
| 15 | the end of the Fever Spider talk (2400) |
| 16 | the body into the hopper (2511) |
| 17 | the end of the brewing talk (2564) |
| 18 | "Hand it over or I'll run ye through!" continued; the swill goes (2729) |
| 19 | the end of Braindeath's Rabid Jack talk (2813) |

## Varbits

| Varbit | Values (capture tick) |
| --- | --- |
| 1366 deal_farming | the patch multiloc 10096: 1, 2, 3 raking (821, 829, 833), 4 planted (845), 5 grown (1160), 3 picked (1173), then one weed stage back each farming tick (1659, 2168, 2653) |
| 1354 deal_barrel | creatures in the barrel 1-5 (1964-1995), 0 on the lever (2008); the lever multiloc 10164 reads it |
| 1357 / 1358 | deal_slug / deal_thulhu: each kind in the barrel, 0 on the lever |
| 1355 deal_multi_hopper | the controls multiloc 10104: 1 possessed with stage 12 (2010), 0 with the spirit gone (2382), 2 in the brew scene (2551) |
| 1359-1364 deal_multi_pirate_a-f | 1 with stage 18 (2729) |

Not sent: 1356 deal_squidfish (0, 5, 2, 7, 4 over the catches, 1815-1835) and 1365 deal_diversion (1 at
the first sneak past Luke, 1465; 4 on Pete's lift, 3110): nothing in the cache reads them and their
meaning isn't known.

## Facts the plugin relies on

- **The start** (153-264): the start prompt "Start the Rum Deal quest?" with "Yes.|No."; Pete's "Yes,
  the mighty, fearsome..." and "Wanna give it a shot?" before the demon menu. After asking for the
  cash, Pete's "Hello again!" talk (the Pirate Pete page) leads to the knock-out.
- **The knock-out** (268-366): the chat closes on "What diversion?" with the player's "Ow!", seq 401,
  spotanim 245 (delay 20, height 124) and sound 1842 (delay 15); the fade out 2 ticks later; at +6 a copy
  of the brewery's top floor (rebuild of zones 2136-2175, 5096-5119, plane 1) with the player at
  (2142,5105,1), Braindeath at (2142,5111) facing north and the side tabs closed; the camera at +9 and
  the fade in at +13. Braindeath's and Pete's lines are held chatheads (no continue) with their words
  overhead in pieces, three ticks a piece; Pete walks in from (2148,5108) to (2144,5111). The fade out at
  +88, the player at (2144,5108,1) at +91, and at +95 the tabs back, the fade in, spotanim 245 and sound
  2727; "Are ye alright, lad?" at +98.
- **The window** (402-429): on "Them!" the message box held with no continue as the screen fades (15
  cycles); the player moved to (2152,5098,0) at +1, the camera on the protesters at +2 (2145,5088 at
  height 310, looking at 2145,5066) and panning to 2156,5088 at +3; the box blanked and the rum_deal_title
  overlay (295) at +7; down with the fade out at +24, the player back at +26, "Are they..." at +27.
- **The brewers** are numbered as the Wiki's transcripts by NPC id: 627 is Brewer 2, 628 is 3, 629 is 8,
  630 is 7, 631 is 5, 632 is 6, 633 is 4, 634 is 1, before the quest (510-574) and after it (2883-2946).
- **The blindweed patch** (805-1174): Inspect is a game message; a rake on the patch raises 1366 by one
  every 4 ticks with seq 2273, sound 2442, a weed and 4 Farming XP; the seed goes at once with seq 2291
  and sound 2432, and 3 ticks later "You plant a seed in the blindweed patch." (spam), 1366 = 4 and 20
  XP; it grows on the next farming tick with "I wonder how my Blindweed is coming along..."; Pick plays
  seq 2292 and sound 2437 and gives the blindweed, 45 XP and 1366 = 3 three ticks later; inspected then,
  "The patch is empty and weeded."
- **The hopper**: the stage moves as the item goes in and its message comes a tick later with seq 827
  and sound 1764 (blindweed, spider body) or seq 2283 and sound 2134, the bucket handed back (water).
- **50% Luke**: Talk-to is his own page's talk (1369-1453). The gate (10172 at 2120,5098): going north
  his "Tryin' ter get away" line, one of the six distractions and his overhead "Where?", the gate open
  with it (inviswall 38848 in the doorway, 10173 the tile north, sound 62), the player one tile north and
  the gate back two ticks later (1456-1469); coming back his "Hey! What are you doing out there?" talk
  and the same opening as it ends (1570-1581). The same after the quest (recording 3034).
- **The stagnant water** used on Braindeath: "What exactly do you want me to do with this?" and his two
  lines (1629-1633).
- **The squid spot** (635): one catch a click: "You dunk the bowl in the water...", seq 2813 and sound 2600
  (delay 20) at once, the catch 4 ticks later, no Fishing XP (1800-1854). After the stage: "You have no
  need to do that any more." (recording 3034).
- **The barrel**: each creature with seq 832 and sound 1765; Count: "There are some Sluglings in this
  barrel." with one, then "There are N loads of Sluglings and M Karamthulhu in this barrel."
  (1966-2002); empty, "This barrel is empty and smells nasty." (recording 3031). The lever: its message
  with sound 1763, the varbits to 0, stage 12 two ticks later.
- **The wrench**: lost, Braindeath gives another with "Arr! I'd get more work out of a minty flavoured
  brick!" (2088). Davey blesses every wrench brought to him (2141, 2278); with the holy wrench, "You mean
  more help?..." (2211). The blessing: Davey cheers (862) and the wrench is blessed as the chat closes, the
  camera moves at +4 and +6, the player's seq 2811 and spotanim 465 at +9, "Groovy." at +12 and the
  camera back at +15.
- **The controls**: the plain wrench, "You try and force the Evil Spirit from the controls with the
  wrench!" and "Come out and face me!", the Wiki's line 2 ticks later (2238-2240); the holy wrench, its
  message with seq 2810, "The power of Guthix compels you!" and sound 1766, and 2 ticks later "The Evil
  Spirit is forced from the controls!", the spirit at (2143,5097,1) with a hint arrow and sound 1762; it
  attacks at once (2314-2317).
- **The Fever spider body** drops (with the spider's own table) during the quest (2435).
- **The brew** (2548-2554): the camera on the controls as the chat closes, 1355 = 2 three ticks later, the
  camera back with "Is that it?" at +6. No bucket is handed over.
- **Donnie**: with swill at stage 17 the drinking talk; at stage 18 with swill "Hey you! I can smell the
  'rum' on ye!" and the second swill goes too (2756-2765); without swill his usual menu (2769).
- **The scroll**: 2 Quest Points, 7,000 Prayer, Fishing and Farming XP, "A Holy Wrench" (2813).
- **After the quest**: Braindeath's "Fancy some 'rum'" (2874), the brewers' own page, Davey's (2964),
  Donnie's (3162). Pete's lifts both ways (3075-3129): the blow with the same effects, the fade out at
  +2, the player at (3680,3536,0) or (2162,5114,1) at +6, the fade in and "Ooooh... my head..." at +8.
- **The journal** (629, 852, 906, 1177, 1248, 2171, 2643): its words and colouring.

## Recorded differences (the Wiki's value kept)

- "These be dark times ... beseiged" (the capture: "besieged"); "The captian points out of the
  window...." (the capture: "The Captain points out of the window...").
- "You scoop up a bucket of stagnant water." (the capture: "...of the stagnant water.").
- "You stuff the squirming Karamthultu into the barrel." (the capture: "Karamthulhu").
- "You pressurise the asserted sea creatures." (the capture: "assorted").
- "You must be a Level 40 Fisherman to fish here." though the quest needs 50 Fishing (not captured).
- On Port Phasmatys' dock the Wiki has "Well, possibly, but could I go to Mos Le'Harmless instead?" and
  Pete's answer before the menu; the capture goes straight from "Want a lift to Braindeath Island?" to
  the menu, and the Wiki's "continue" from that branch has nowhere to go, so the plugin plays the
  capture's order.

## Ours

- The Karamthulhu is a third of the catches (the capture: one in six).
- The farming ticks are on a five-minute grid from the epoch, with no per-account offset.
- Partly raked patches inspect as "needs weeding"; the grown patch is the Wiki's line without "(Crop)".
- A full backpack loses the raked weed; the seed needs a weeded patch ("This patch needs weeding first.").
- Journal entries the capture only shows struck through are blue when current; stage 18's entry and the
  completed page were not captured.

## Not covered

- Zombie swabs keep attacking after Intimidate (the Wiki says they stop).
- The protesters' and pirates' overhead chants, and the drunk pirates after stage 18.
- Pete's "No reason." in the "Hello again!" talk is "(same as above)" on the Wiki and was not captured.

## Runs

- 2026-11-19, agent (claude-opus-5-5): checkpoint run over the agent MCP on feat/rum-deal (start through
  the seed, the patch, the gate); the rest by `server/tests/rum-deal-capture.test.cjs`.

Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q100); PRs: [#1161](https://github.com/RSPSApp/tsps/pull/1161).
