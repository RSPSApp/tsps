---
quest: Watchtower
key: watchtower
status: in-progress
tested: 2026-11-22
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Watchtower

Aligned with a whole run of the quest on live: the user's RSProx capture `Watchtower.bin` (revision
242.1, SHA-256 `88b9e066...45bbe8c`; the start at tick 182, the lever at 6050, the scroll read at 6093,
then the enclave, the gap and the teleport after the quest). Ticks below are the capture's.

The plugin is `server/plugins/quests/quests/Watchtower.Quest.js` with its units in
`server/plugins/quests/watchtower/` (State, Journal, Scenes); the two Gu'Tanoth gates are pass-through
gates in `server/plugins/objects/Doors.plugin.js`. The words are the Wiki's: the "Watchtower" and "Ogre
guard" transcripts, with the lines they lack added from this capture in osrsreboxed-db's
`capture-sources.json`. Where the capture words a line differently the Wiki's wording is kept (see
"Recorded differences").

Checked by `server/tests/watchtower-capture.test.cjs` (real Player, packets, plugins, cache and map),
`watchtower-ground-spawns.test.cjs`, the Watchtower cases in `quest-scene-return-state.test.cjs`, the
teleport and diary tests, and in game over the agent MCP.

## Stages (varp 212, itwatchtower)

| Value | Set by (capture tick) |
| --- | --- |
| 1 | the wizard's "Try searching the surrounding area..." after "Yes." on "Start the Watchtower quest?" (215) |
| 2 | "You could start by checking out the ogre settlements..." at the end of "So what do I do?"; the fingernails go with it (791). "I won't bother then." leaves stage 1 and the nails (756) |
| 3 | the relic, three ticks after the wizard's assembly (2040) |
| 4 | the north-west guard's "It's got the statue of Dalgroth...", the relic taken (2314) |
| 5 | the city guard's "I want you to bring me an item..." (2646) |
| 6 | the death rune for the map (2665) |
| 7 | the mad skavid's "The others are with the shamans in the enclave..." with the crystal (3315) |
| 8 | the first cave nightshade on an enclave guard (3451) |
| 9 | the wizard's "Collect a guam leaf, add jangerberries..." (5065) |
| 10 | the wizard's "Here it is - a dangerous substance..." with the magic ogre potion (5450) |
| 11 | the wizard's "Put the crystals on the pillars there..." (6004) |
| 13 | the lever (6050); live never sends 12 |
| 14 | the spell scroll read (6093) |

Older saves completed at 12 are moved to 13 once at login, with the varbits below.

## Varbits (varp 936)

| Varbit | Set (capture tick) |
| --- | --- |
| 3117 watchtower_guard | the tower guard's first "let 'em up" (256) |
| 3118 watchtower_gate_chat_1 | the east guards ask for gold (2217) |
| 3119 watchtower_gate_chat_2 | the north-west guards first stop the player (2308) |
| 3120 watchtower_gate_chat_3 | the battlement guards ask for a gift (2450) |
| 3121 watchtower_puzzle_chat | the city guard's riddle (2646) |
| 3124 watchtower_rock_mined | the Rock of Dalgroth's crystal (5885) |
| 3125 watchtower_nightshade_used | the first run past the enclave guards (3635) |
| 3127-3130 watchtower_pillar_1-4 | the pillar multilocs: 1 with the crystal (6014-6038), 2 lit (6050). The yellow crystal is 3128, magenta 3129, cyan 3127, grey 3130 |
| 3131-3136 watchtower_shaman_1-6 | the shaman multinpcs 6208-6213: 1 once destroyed (5719-5852), for that player only |
| 3137 watchtower_enclave_scene | the enclave scene seen (3668) |
| 3138 watchtower_tooth_got | Gorad's tooth (1496) |

Not sent: 3126 watchtower_crystal_variable (1 at 5481, as the journal opened at stage 10); nothing in
the cache reads it and its meaning isn't known. Who gave which task, the relic parts the wizard holds,
the skavid words and the paid gate are server-side, as live keeps them (no varbit changes at 1162,
2030-2034, 3051 or 2222).

## Facts the plugin relies on

- **The start** (182-216): "Start the Watchtower quest?" with "Yes.|No."; the skills are not needed to
  start (Wiki). "You've started a new quest" with stage 1.
- **The tower ladder** (255-259): before the quest the guard's "You can't go up there..." (Wiki); after
  it, once, "It is the wizards' helping hand - let 'em up." with 3117, then the climb (seq 828) to
  (2545,3111,1); later climbs say nothing (2012-2018). Once the quest is complete the first floor's ladder
  up goes to the completed tower's copy of the top floor, (2933,4712,2).
- **The bushes**: seq 5216 and the Wiki's line on arrival, the item at once (284-588).
- **The trellis** (325-332): "You climb up the wall...", "...and squeeze in through the window.", seq 828,
  then (2548,3117,1) two ticks later.
- **The evidence**: "I have this robe..." (the first decoy carried, robe, dagger, armour, eye patch) and
  "Let me see..." / "No, sorry, this is not evidence..."; used on the wizard, the answer alone (634-666).
- **Og**: the key with "Here is a key to the chest it's in..." (1162), no message; his gold for relic part 1
  with "Well, well, the little t'ing has got it!..." and the item box "The ogre gives you part of a
  horrible statue." (1802-1803); a lost part with "Grrr, why do I bother?..." (1815). "Guards!" and
  Grew's "guards!": an ogre attacks (1053, 1226).
- **Grew**: the tooth for part 2 and the yellow crystal in a double box (1716); a lost crystal with "I
  suppose you want another?..." (1755), a lost part with "Stupid morsel, I have another..." (1773).
- **Toban**: the dragon bones for part 3 in a box (1405); his tunnel says "You enter the cave." with the
  island and the player's "Wow! That tunnel went a long way." (1359); his ladder "You climb down the
  ladder." on the same tick (1525); his chest: seq 832 (delay 5), sound 2419, the gold in a box a tick
  later with sounds 52 and 51 (1509-1515).
- **Gorad**: "I've come to knock your teeth out!" and his answer, then he attacks; three ticks after his
  death 3138 and the tooth in a box (1493-1496).
- **The relic** (2026-2040): one talk; each part with the player's line and the wizard's ("Ah, it's part
  of..." for the first, "Ah, it's more of..." for the others), the part taken as the wizard's line shows;
  after "Well, if you ever want to make friends..." the wizard's seq 5352, spotanim 969 (height 50) and
  sound 3267, and three ticks later stage 3 and the relic box. No cutscene.
- **The east gate** (2207-2230): "Halt!..." / "I am a friend to ogres." / "You will be my friend only with
  gold..." (3118); then "Creature, did you bring me the gold?" / "Here it is!", the bar taken, "It's
  brought it! On your way."; the player walks to (2549,3028) and the gate opens (inviswalls 38848 in the
  doorway, 37393/37394 the leaves swung south, sound 46) and is back two ticks later. After paying, "I know
  you, creature; you may pass." (3271) and the gate opens again.
- **The north-west gate** (2308-2321): the guard stops the player first even with the relic ("Stop,
  creature!..." / "Until then..."), then "I've got a proof of friendship right here!", the Wiki's carrying
  branch and stage 4; the walk west through the gate (leaves 37393/37394 swung west). After, "It's the
  small creature; you may pass." (3410).
- **The market**: "You cautiously grab a cake from the stall." (2356, 2372).
- **The battlement guards** (2440-2458): their first talk sets 3120; next time the gift talk, "You offer
  the guard a rock cake." in a box and the cake taken with "Well, well, look at this...". After the cake
  their first talk again (6252).
- **The battlement** (2465-2467): two ticks after arriving, the move over (30/90 cycles) with seq 839 and
  sound 2453; back the same way for free (6241-6248).
- **The gap** (2507-2543): the bridge guard's (4372) talk; paid, "You daringly jump across the chasm.", 20
  coins, 5 Agility XP, seq 5355 and sound 2461 with a 45-cycle move to (2530,3029), then "Phew! I just
  made it."; back to (2531,3026) free with "I'm glad that was easier on the way back!". After the quest the
  toll and the 5 XP stay (Wiki, Gap (Gu'Tanoth): "Each jump from the south costs 20 coins"); Agility 25 (Wiki).
- **The city guard** (2636-2710): with the death rune the riddle talk is "I worked it out!" at once; the
  rune and map in a box. The riddles and a lost map as the Wiki.
- **The skavid caves**: with the map "You enter the cave..." and the inside on arrival (2903, 2947);
  exits on arrival, no message. Insides: cave1 (2498,9418), cave2 (2530,9467), cave3 (2518,9454), cave4
  (2498,9451), cave5 (2504,9440), cave6 (2522,9411); exits (2563,3024), (2523,3070), (2540,3054),
  (2553,3054), (2552,3034), (2529,3012). Without the map: skavid_cave6 fades out, (2523,3070) three ticks
  later and the fade back (2255-2260).
- **The skavids** (2912-3211): before the scared skavid has taught any words, the skavid's line, the
  player's "???", "The skavid is trying to communicate..." and "You don't know any skavid words yet!".
  After: its line, "...trying to communicate...", the menu; right, "It seems the skavid understood you."
  with its reply; wrong, "???" and "It seems that was the wrong reply." and round again; again, "You have
  already talked to this skavid." Words: 4376 "Cur bidith" Ig, 4377 "Gor cur" Ar, 4378 "Bidith tanath"
  Cur, 4379 "Tanath gor" Nod.
- **The scared skavid** (2995-3001): after "You will have to learn skavid..." the chat closes, an ogre
  (4363) is beside it; two ticks later it strikes (seq 359) and shouts while the skavid is hit (seq 5356)
  and cries "Tanath cur, tanath cur!"; four ticks later it is gone and the talk goes on.
- **The mad skavid** (3310-3320): the crystal and stage 7 with his second line, then its box.
- **The enclave** (3421-3670): the guards' talk ends in an attack; the entrance alone, "No you don't!"
  and an attack; cave nightshade on a guard, his line (stage 8 the first time), then the cws_warning_12
  screen (interface 573); Yes: "You run past the guard while he's busy." and three ticks later the
  entrance (2588,9410), the first time with the scene (Scenes.Watchtower.js has its timeline). After the
  quest the entrance gives the warning and lets the player in (6301-6311). Its gate, "The gate is locked
  tight.<br>You'll have to find another way out." (6316).
- **The potion** (5084-5280): the bat bones ground with seq 364 and sound 2608; jangerberries into the
  guam potion and the ground bones into that, 10 Herblore XP each with sound 2611; ground bones into the
  guam potion explodes: both messages, seq 365, spotanim 176, 5 damage, an empty vial.
- **The infusion** (5443-5450): after "That's great news; let me infuse it with magic..." the chat
  closes with "The wizard mutters strange words over the liquid..."; four ticks later stage 10 and the
  magic potion with the next line.
- **The shamans** (5709-5852): the potion poured (seq 5361), eight ticks later "There is a bright flash!",
  "The ogre dissolves into spirit form.", the shaman's varbit and the player's line; the sixth adds "You
  hear a scream...<br>The shaman dissolves before your eyes.", the crystal in a box, the empty vial, seq
  827 and sounds 3268 and 2581. The shaman robe lies at (2617,9437).
- **The Rock of Dalgroth**: Prospect, "You examine the rock for ores..." and four ticks later "The rock
  contains a crystal!" (3714-3718); Mine, "You swing your pick at the rock..." and four ticks later 3124
  and the crystal in a box (5881-5885).
- **The pillars and the lever** (6004-6062): each crystal with seq 832, in a tick later with sound 975;
  a wrong one "That is not the right crystal for this pillar; try another."; the lever seq 835, a tick
  later stage 13, "The magic force field activates.", the pillars lit, the player moved into the completed
  tower at (2928,4715,2), sound 2400 and jingle 234; four ticks on the coins, the scroll and the Magic XP
  with the wizard's two lines, the completion message and scroll after them.
- **The scroll** (6093-6096): stage 14, seq 5354 and "You memorise what is written on the scroll." in a
  box; two ticks later "You can now cast..." in a box (the scroll goes with the stage here; live: with this
  box); a tick later "The scroll
  crumbles to dust."
- **Watchtower Teleport** lands at (2934,4713,2), the completed tower's top floor (6337); the Ardougne
  hard diary task counts it there.

## Recorded differences

- The scared skavid says "Thank you, kind one." on live (2990); the Wiki's "Thank you, kind [sir/madam]."
  is kept.
- The mad skavid opened with "Bidith ig..." and took "Cur." (3310-3313); the Wiki transcript's "Gor nod..."
  and "Tanath." are kept (the Wiki's guide lists eight phrases).
- The Wiki calls the scared skavid's attacker an ogre shaman; live sends ogre_chieftan_caves (4363), which
  the plugin uses.
- Skavid 3's and Skavid 4's wrong-word loop is captured (3195-3211, 3083-3096); the same lines fill the
  other skavids' wrong words in capture-sources.
- The lever's rewards go with stage 13 here (live: four ticks later, t6054), so a logout between cannot
  save a completion without them.
- The cws_warning_12 screen opens a tick after the guard's line closes here (live: the same tick, 3633),
  so the chat's close does not take it with it.
- Live let the first nightshade (3451) and one Yes on the warning (3462) go by while the guards were
  attacking the player; here the warning always follows and Yes always runs past.
- skavid_cave2 without the map only said "There's no way I can find my way through without a map of some
  kind." on live (2263); the Wiki's circuit is kept for it.

## Not covered

- Ours: the trellis's Agility 18 refusal, the bushes before the quest, the light-source refusal in the
  caves, the Magic 14 / Herblore 14 / Mining 40 / Thieving 15 refusals, "I can't touch it..." on the rock
  before the shamans, the relic parts used together, the potion steps before the recipe, the vial of
  water + jangerberries and + guam leaf orders, nightshade before stage 7, a second scroll read, the
  rock cake stall's 6.4 XP: no capture shows them.
- Ours: Toban gives a lost relic part back with no line (the Wiki has only the "you lie to me" answer).
- The guards' push "back down the hill": 3 damage (Wiki), no push or stun (no capture says where).
- The battlement guards' "Okay, okay, I'm going." lava push (the Wiki's prose) is not played.
- The journal's uncaptured pages (see Journal.Watchtower.js).
- The city guards' "Hey, you can't go climbing all over the city! Use the path!" before the shortcut's
  refusal (2715, 3282); the shortcut's own message is the capture's.
- The mad skavid's "you have the crystal" line is missing from the Wiki.
