---
quest: Creature of Fenkenstrain
key: creature_of_fenkenstrain
status: passed-with-issues
tested: 2026-11-28
tester: agent
model: claude-opus-5-5
commit: 1e9950566
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# Creature of Fenkenstrain

Rebuilt from a whole live run (the user's rsprox capture `CreatureOfFenkenstrain+Unlock.bin`, revision
243, varp 399 0 -> 8, then the Werewolf Agility Course). The plugin is
`server/plugins/quests/quests/CreatureOfFenkenstrain.Quest.js` with its units in
`server/plugins/quests/fenkenstrain/`; the words are the transcript pages, corrected from the same
capture in osrsreboxed-db's `capture-sources.json`.

## What live sends

Ticks are the capture's.

- **State.** Varp 399 `fenk_quest` goes 0, 1 (373, the "Grave-digging" answer), 2 (1396, the last part),
  3 (1416, the sewing box), 4 (1820, the repair), 5 (1882, "Destroy it!!!"), 6 (2133, the creature's last
  line), 8 (2225, the pickpocket). Varbit 13715 (the quest list, varp 3403) goes 0, 2, 3, 4, 5, 6, 7, 9 on
  the same ticks. Varp 400 holds the rest: the parts handed in (186-189, in the order arms, legs, torso,
  head), the needle (190) and threads (191 = 5), the star in the memorial (192, 982), the amulet's box
  shown (193, 572), the last part grave dug (197: 1 head, 2 torso, 3 arms, 4 legs, set as the dig starts),
  the tower (198, 1927), cavern (199, 1081) and shed (200, 1515) unlocked, both bridges (4441, 5023 = 1,
  1081) and the gardener's guide out (185). Completion clears all of varp 400 (2225).
- **People.** Dr Fenkenstrain 2014, the gardener 2013 and his guide 2012, the creature 2016, Rologarth 2017
  and Fenkenstrain in the tower 2015 are the cache's multinpcs: varp 399 and varbit 185 show and hide them.
  Their lines carry the multinpc's own id as the head (`if_setnpchead` 2014, 2013, 2016, 2017, 2015) and
  Rologarth's lines are named "Lord Rologarth".
- **The interview** (319-394): the first menu is "Yes.|No.|What job?"; the later menus have no full stops
  ("Stunning|Awe-inspiring|Breathtaking|Braindead", "Combat|Magic|Cooking|Grave-digging"). No "You've
  started a new quest" message.
- **The gardener** (549-610, 862-873): without the amulet each question gets the neck-twitch message box;
  with it the ghostspeak box (an item box, the amulet) shows once, then he answers. "Would you show me where
  the place was?" spawns the guide 2012 where he stood as the last line is continued, walking after the
  player; when he falls more than about 15 tiles behind he is put two tiles behind the player (709, 906,
  922). Off his route (ours: the area; the Wiki gives only the lines) he says "Oi'm afraid you've gone well off the beaten track.." (720), "Fare thee well -
  oi must return to me' garden." 6 ticks later, and is gone 5 after that (731). Talking to him: "Go
  southeast, mate." (724).
- **Digging** (927-1173): spade Dig on the tile beside each grave (3608,3490 head; 3503,3576 torso;
  3504,3576 arms; 3505,3576 legs). "You start digging...", `human_dig_long`, `digspade` twice (one looped
  3 with delay 25); 6 ticks later the item box "... and you unearth ...", and the same words in the chat
  as it is continued. With the guide there he says "This is the place where I met me' maker." as the head
  comes up and goes as its box is continued (934-937). An empty grave: "... but the grave is empty."
  (rsprox.net 366, 370). Graves read "The grave says:" and "   'Here lies  <name> - REST IN PEACE'".
- **The brain** (215-246): Take on the jar on the Hair of the Dog's bar is Roavar's sale, before or during
  the quest; the coins go and the brain comes as the player says "I'll buy one, please."; the jar stays.
- **Bookcases** (452-528): the north-east one's "Handy Maggot Avoidance Techniques" opens its compartment
  (`fenk_bookcase_open`, `bookcasedoor`, an item box with the journal) and gives the obsidian amulet;
  "Chimney Sweeping on a Budget" opens book 392; the north-west one's "The Joy of Gravedigging" opens in a
  message box and gives the marble amulet. The other books answer in an item box with the journal.
- **The memorial** (950-988): Push says "The coffin is incredibly heavy, and does not budge. " (a trailing
  space); the star amulet goes into the lid (item box); then Push moves the lid (`fenk_capstone_moves`,
  `scrape`) and the player is in the cave 3 ticks later (3577,9927). The island's memorial opens without a
  star (1107-1112, to 3504,9969).
- **The cave** (1013-1318): only the level 51 Experiment (1273, "It has a key hanging from its collar.")
  drops the cavern key. The mausoleum's door, the shed's door and the tower's door are pass-through gates:
  inviswall on the doorway, the open leaf across, the player steps through and the door is back two ticks
  later, with the door's sound and `locked` (2402) on every opening. The mausoleum's door takes a key each
  time (1081, 1254); the chest by the island's ladder gives one (1117).
- **Hand-ins** (1384-1432): every part carried is handed over in one talk (arms, legs, torso, head), then
  "Oh bother! I haven't got a needle or thread!"; the needle and thread likewise in one talk, then the
  sewing message box.
- **Shed, brush, chimney** (1482-1607): the gardener gives the shed key (item box); the shed door takes
  it once and opens freely after; the cupboard opens (`human_openhighcupboard`, `cupboard_open`) and gives
  the garden brush; canes come one per Take-from; a cane and bronze wire extend the brush three times; the
  three-cane brush up the upstairs west chimney (3544,3555,1) pokes (`fenk_human_poke`, `brushing`) and 5
  ticks later "You give the chimney a jolly good clean out." and the mould's item box.
- **The conductor** (1645-1657, 1819-1827): Smelt on a furnace with a silver bar and the mould opens
  silver_crafting; its lightning rod is the conductor (Crafting's menu, 50 XP, the mould kept). Repair on the
  roof: the repaired loc, `fenk_lightning` and `lightning`, the message box; it is broken again as the box
  is continued; Repair again: "The lightning conductor is now beyond repair."
- **The end** (1858-2340): Fenkenstrain sends the player after the creature and hands over the tower key
  as his last line is continued; "So have you destroyed it?!!? / Not yet. / Please, hurry - save me!!!!"
  after that; Pickpocket before the end is "What do you think you're doing???". After the creature's talk,
  Pickpocket: "You steal the Ring of Charos from Fenkenstrain.", the quest completes (2 QP, 1,000 Thieving,
  the ring; scroll lines "2 Quest Points", "1,000 Thieving XP", "The Ring of Charos"). Fenkenstrain is then
  in the tower: his talk, the refusal while the ring is kept (2329), the ring again once it is gone (2340).
- **The unlock** (2447-3031): the Werewolf Agility Course with the ring worn.

## Not from the capture

From the Wiki, or ours, as the code says at each place:

- Wiki: the signpost's start, its note after the quest ("AAARRGGGHHHHH!!!!!"), the clock and its letter
  (the text from Transcript:Letter (Creature of Fenkenstrain); the long scroll is ours), the chest empty
  while a key is carried, the "secret compartment is empty" lines, the brush's refusals, "The door is
  locked." (the shed), the inscriptions of the graves by the fairy ring and in the east graveyard, the
  pickpocket's 25 Thieving, the ring recovered by pickpocketing.
- Ours: the off-route area (the castle grounds and the Haunted Woods; the recording went off track at a
  tile the second walk passed without, see below); the locked line on the tower and mausoleum doors; a lost
  tower key (his first talk plays again, handing one over); Repair before the sewing or without a conductor
  ("Nothing interesting happens."); a full pack at a grave (the part waits); the cupboard's Shut; the
  journal after stage 3 (live's is recorded for stages 1-3); the Thieving refusal's wording (the other
  pickpockets').
- The twelve Haunted Woods graves the Wiki names without placing keep the previous implementation's names.

## Recorded differences

- The first guided walk went off track at 3594,3512 after 110 ticks (720); the second passed 3590,3507 and
  3588,3511 and reached the grave (934). One recording cannot tell a timer from a boundary; the area boxes are ours
  (the Wiki gives only his lines), and this off-track is not reproduced.

## Findings

- **open** The quest-rating box (983) live opens with the scroll does not open; no quest opens it yet (QuestRuntime).
- **open** `travel_to` routes through the castle's first-floor-side door pair at 3548-3549,3543 and cannot reach it ("I can't reach that!"); the cave's route data needs the bridges (69 Agility) and has no link through the mausoleum door. Route data, not quest code.
- **fixed** The headless Quest Helper stayed on the start step: it keys on varp 399, which the headless snapshot did not carry. Quests now project extra vars on `quest-helper:project-state`.

## Runs

### 2026-11-28 · agent · claude-opus-5-5

- **Start:** fresh account; declared setup: Priest in Peril and The Restless Ghost completed by command, combat 70, Crafting 20, Thieving 25, ordinary supplies; one `::tele` to Canifis.
- **Route:** the brain from the pub's jar; the interview (What job?, Braindead, Grave-digging); both first-floor bookcases and the star; the gardener's walk to his grave and the head; the memorial, the level 51 Experiment fought for real, the mausoleum door, the chest, the island graves; hand-ins; the shed, cupboard, canes, brush and chimney; the conductor at Port Phasmatys' furnace; the roof repair; the tower key and door; the creature; the pickpocket. Walking, stairs, ladders and memorials used as a client does; travel by ecto-tokens and walking.
- **Result:** varp 399 0,1,2,3,4,5,6,8 and varbit 13715 0,2,3,4,5,6,7,9 as live; varp 400's bits as live and cleared at the end; 2 QP, 1,000 Thieving, the Ring of Charos, each once (a repeat pickpocket gives nothing); relog and the offline save kept them; post-quest Rologarth, the tower's Fenkenstrain and the gardener; the ring dropped and stolen back; the Werewolf Agility trapdoor opens with the ring worn.
- **Not checked:** Fenkenstrain's stage-3 talk in game (tested), the head dig and memorial on video (the guide clip dropped its session), a full pack at the reward.
