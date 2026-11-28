---
quest: Icthlarin's Little Helper
key: ictlharins_little_helper
status: in-progress
tested: 2026-11-28
tester: agent
model: claude-opus-5-5
commit: 1e9950566
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Icthlarin's Little Helper

Rebuilt from the user's rsprox capture of a whole run and what the quest unlocks after it (local 1002310, revision
243, ticks below). The plugin is `server/plugins/quests/quests/IcthlarinsLittleHelper.Quest.js` with its units in
`server/plugins/quests/icthlarin/`; `server/tests/icthlarins-little-helper-capture.test.cjs` checks it against these
facts.

## What the capture recorded

One run from "No." to the start menu to the completion scroll and the declined Contact! start (stages 0-26 in
order), then the post-quest catspeak talk with the cat, Klenter's farewell, the Sphinx's Menaphite gods, and the
Pollnivneach carpets. The recording account brought a bag of salt and a bucket of sap, already had willow logs,
and got the Apmeken (intestines) jar.

## Facts the quest relies on

### Stage (varbit 418 `ics_little_var`, varp 445 bits 0-4) and its varbits

| Value | Set by | Tick |
|---|---|---|
| 1 | "Yes." to "Start the Icthlarin's Little Helper quest?" (with varbit 397 `ics_little_jar_multi` = 2) | 480 |
| 2, 3 | both in one tick, as the hypnosis lands the player outside Klenter's Pyramid (with 449 `ics_specvis` = 1) | 489 |
| 4 | touching the pyramid door: flashback 1 (446 `ics_stateofmind` = 1) | 1042 |
| 5 | the western door's puzzle solved | 1229 |
| 6 | the Sphinx's "Here, I have a token that he will know is from me..." (13884 `ics_given_token` at the token box, 1493) | 1489 |
| 7 | the High Priest's "Cats act as guardians against the Devourer..." (450 `ics_givensphinxstatue` at the token box, 1620) | 1700 |
| 8 | the cat opens the pyramid door (407 `ics_intestinespot_vis` = 1: the jar is gone from its table) | 1856 |
| 9 | the deja-vu at the pit: flashback 2, landing at (3280, 9200) | 1972 |
| 10 | the correct jar touched: the Apmeken apparition | 2048 |
| 11 | the apparition dies | 2132 |
| 12 | back over the pit with the past's jar: the flashback ends at (3292, 9192) | 2180 |
| 13 | the western door's puzzle solved again | 2293 |
| 14 | the jar dropped in its room: "You return the burial jar." | 2300 |
| 15 | the High Priest's "That's right. We need the carpenter to create a new holy symbol..." | 2530 |
| 16 | the carpenter's holy symbol (408 `ics_little_priestvis` = 1) | 2833 |
| 17 | the deja-vu at the pit: flashback 3, landing at (3295, 9198) | 3032 |
| 18 | the unholy symbol used on a sarcophagus of the eastern room | 3057 |
| 19 | out through the eastern door: the flashback ends at (3292, 9192), the ceremony set up | 3076 |
| 20, 21 | both as the eastern door opens: the ceremony cutscene | 3111 |
| 22 | the priest becomes the possessed priest (4210) | 3148 |
| 23 | the possessed priest dies (an attack potion(4) drops) | 3219 |
| 24 | the ceremony High Priest's "We have a few things to finish here..." | 3281 |
| 25 | Icthlarin frees the player (flashback 4) | 3325 |
| 26 | the town High Priest's trinket; the scroll and jingle 152 | 3378 |

Other varbits: 13882 `ics_met_sphinx` (the Sphinx's first talk, 625), 13883 `ics_cat_safe` ("I didn't rob anybody's
grave!", 1426), 13885 `ics_sphinx_amascut` (1537), 399 `ics_metembalmer` with 400 `ics_little_embalmer_multi`
(bits 401 salt, 402 sap, 403 linen: 1, 3, 7 at 2608, 2610, 2765), 412 `ics_metcarpenter` (2825), 398
`ics_little_carpenter_multi` (the logs, 2828), 410 `ics_scarabs` (the swarm, reset with each copy), 409
`ics_little_tilecount`, 420-444 `ics_tile1-25` and 445 `ics_tilechecker` (the puzzle). After the quest Klenter's
farewell sets 449 back to 0 (3656).

Quest Helper (pinned 06da90f9) reads 397 as 1 Het, 2 Scabaras, 3 Apmeken, 4 Crondis. The capture's 2 came with the
intestines jar (Apmeken, item 4679), and the cache's item order is liver, intestines, stomach, lungs, so the plugin
uses 1 Het, 2 Apmeken, 3 Scabaras, 4 Crondis.

### The start and the hypnosis (445-515)

- The Wanderer's lines switch between her normal eyes (4193) and her red eyes (6187) line by line; every captured
  line's head and chat animation is in `server/plugins/quests/icthlarin/data/lines.json`.
- "Don't blink..." continued (485): hypnotise (1164), fade_overlay to black (script 948 [0, 255, 0, 0, 50]), an
  empty held messagebox; minimap off (486). At 489 the stage moves, the player stands at (3294, 2782) facing the
  door, the jar takes the waterskin's slot and the tinderbox goes. At 492 the kneel (1332); at 493 the City of the
  Dead music, "You slowly pick yourself off the ground...", the screen back ([0, 0, 0, 255, 50]).
- The rock north-east of her tent (6621) leads in: black at the click's arrival, the player at (3320, 2796) two
  ticks later, back a tick after. The wall crack (6620) leads out (world/data/loc-teleports.json).

### Klenter's Pyramid (1033-3333)

- Every visit is a new copy of the map (`build_area`), with mummies 949-953 at (3279, 9176), (3277, 9186),
  (3310, 9171), (3284, 9189), (3306, 9183). Inside the copy the player comes in at (3277, 9171) and leaves at
  (3294, 2781).
- The swarm (4192) comes up near (3296-3300, 9176-9178) once a copy: "You've disturbed a swarm of scarabs!",
  its scarab_spiral (1949) and scarabs_appear (1478, 10 cycles late).
- A flashback: hypnotise and black; two ticks on, the copy, with the present's quest item (the jar, or the holy
  symbol in flashback 3) swapped for the unholy symbol in its slot; two ticks on the sepia ([0, 0, 3283739, 120, 50])
  and the first line, with the ics_flashback overlay (146). Ending it: [3283739, 120, 0, 0, 50], two ticks on the
  real map or a new copy with the present's item back, then the screen from black.
- Inside a flashback teleports are refused: "An outside force seems to be blocking your teleport." (2015).
- The ladder (6645) in the present: human_reachforladder (828), out the next tick (1863). In flashback 1: "I must get
  to the heart of the pyramid..." and "Do you want to leave?"; "Yes." ends it early with the stage kept (1072).
- The pit jump (1170-1188): camera to (3293, 9186, 475) at rate 10 and (x, 9185, 475) at rate 20, looking at
  (x, 9197, 300); three exactmoves 2 ticks apart: (x, 9191)->(x, 9193) at 30/60 cycles with ic_running (1995) and
  pit_jump (1172), (x, 9193)->(x, 9196) with ic_pit_jump (1992), (x, 9196)->(x, 9197) with ic_up_ons (1993) and
  pit_land (1174); 15% run energy taken on landing; cam_smoothreset 6 ticks later. The way south mirrors it (2318).
  The fall (2189-2203): ic_pit_fall (1994) and pit_fall, black, the player at (3312, 9180), then (3311, 9180) with
  pit_shoot. Wiki (Pit): 20% energy needed, 31% success at 1 Agility to 90% at 99.
- The doors (44059 west, 44060 east) are walked through onto their tile with icthalarins_door_opens (2000), the
  scrape (2410), and icthalarins_door_closes (1999) the next tick (2022).
- The puzzle (interface 147, 1217 and 2282): a press turns the tile and its eight neighbours (its own, N, NE, E,
  SE, S, SW, W, NW, each an f2b 2001 or b2f 2002 animation after a -1); opening it presses five tiles at random
  and replays them with the counter (component 30: 2003, then 2004-2007, then 2007 and 2003); all gold is solved:
  the "tile win" jingle (192), the close and unlock (2419) two ticks later.
- The jars: the wrong one "I don't want this jar."; the right one in flashback 2 brings its apparition with "You
  will not defile this place!" overhead and abyssal_demon_teleport (409); after its death "You take the burial jar."
  in an item box. Dropped in its room once the room is open again: "You return the burial jar." (Wiki, Canopic
  jar: anywhere else "The burial jar magically turns to dust as you drop it.").
- The sarcophagi: "You search the sarcophagus, but you don't find anything interesting." (2152).

### The ceremony (2515-3333)

- From stage 16 the ceremony High Priest (11649) stands at (3308, 9195) facing west, the priests (11606) at
  (3307, 9193), (3304, 9193) and (3303, 9195); the last is the one possessed.
- The cutscene (3111-3149): cutscene_status, the minimap off, the side tabs closed, camera (3297, 9191, 520) looking
  at (3310, 9197, 320) at rates 232/100; the Wanderer (11590) appears at (3308, 9197) with 409; she turns into
  Amascut (11591) on "Adventurer, kill these pathetic priests."; the priest turns (11608) on "You! Priest of the dog
  lord..."; she leaves with 409 20 cycles late; at the end stage 22, the possessed priest (4210), everything back.
- Flashback 4 (3298-3333): "All of a sudden, a final sense of deja-vu sweeps over you...", Icthlarin (4199) at
  (3274, 9171) with the player at (3282, 9171), camera (3286, 9169, 510) looking at (3277, 9171, 110); "Argh..." then
  stage 25 and the player outside the door.

### The journal

Live's text at stages 3 (twice), 4 (in and out of the flashback), 5, 6, 7, 11 and 15 (twice): each part blue with
red names while current, struck through in the past tense once done.

## Ours (not recorded, no Wiki value)

- The journal's text at stages 1-2, 8-10, 12-14 and from 16 on.
- Which jar the start picks: the Wiki's highest of Attack/Strength, Ranged and Magic with the matching worn
  bonuses, always the highest (the Wiki's "still a chance to get a different one" has no odds).
- The swarm's trigger box (3295-3301, 9175-9179), round the four recorded spawns.
- A full inventory when the past's jar is taken, and flashback 3 with neither the holy symbol nor a free slot:
  "You don't have enough inventory space..." refusals.
- The salt lake's Collect: no message.

## Not covered

- The pyramid's wall crushers and pit traps: no capture shows one (the account walked round them); the Wiki gives
  8 damage for a crusher and the pit traps' return to the start, but not the tiles.
- The sarcophagi's loot and their damage, poison and swarm events (Wiki, Sarcophagus: no rates).
- The possessed priest's recovery if the fight takes too long (Wiki: "The priest seems to recover..."; no duration).
- `cam_smoothreset` after the pit jump: tsps has no such packet, so the camera resets at once.
- The pyramid's music (Mirage, Hypnotised in a flashback): the copy plays its region's.

## To record

- The salt lake's Collect, the suntrap with a bucket of saltwater, and a knife on an evergreen tree with a bucket.
- The carpenter without willow logs, and a lost holy symbol.
- A wrong riddle answer confirmed ("Totally positive."), and the Sphinx afterwards.
- A death or a logout inside a flashback; the possessed priest left too long.
- The Het, Scabaras and (pre-2022 saves) Crondis jars and their apparitions.
- The journal at stages 1, 8, 12-14 and 16-25.

## Runs

### 2026-11-28 · agent · claude-opus-5-5

- **Start:** see the PR's Testing section for the fresh-agent playthrough.
