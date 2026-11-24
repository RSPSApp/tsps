---
quest: The Golem
key: the_golem
status: in-progress
tested: 2026-11-24
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: fresh
travel: travel_to
---

# The Golem

Aligned with a whole run of the quest on live: the user's RSProx capture `TheGolem.bin` (revision 242,
SHA-256 `027e1914...2fd858`; the start at tick 26, the repairs at 36-63, the letter at 113-117, Elissa at
338-388, the notes at 463-498, the museum at 556-761, the temple at 1100-1250, the program at 1405 and
completion at 1438, then the post-quest talk at 1444). Ticks below are the capture's. A second run, local
recording 1001607 (revision 241), agrees wherever both recorded the same step.

The plugin is `server/plugins/quests/quests/TheGolem.Quest.js`. Black dye (the pestle on a black mushroom)
is Land of the Goblins' plugin, for every player. The phoenix feather is the pickpocketing data's
(`server/plugins/skills/data/pickpocketing.json`). The words are the Wiki's "The Golem" and "Curator Haig
Halen" transcripts. osrsreboxed-db's `capture-sources.json` adds this capture's start prompt and Elissa's
"Sorry, I need to go.", and its `runtime-bindings.json` puts the curator's Fossil Island menu back under its
option. Where the capture words a message differently, the Wiki's wording is kept (see "Recorded
differences").

Checked by `server/tests/the-golem-capture.test.cjs` (real Player, packets, plugins, cache and map),
`the-golem-reading.test.cjs`, `the-golem-study-case.test.cjs`, the Golem cases in
`golem-storm-quest-parity.test.cjs`, and in game over the agent MCP.

## Stages (varbit 346 golem_a, varp 437)

| Value | Set by (capture tick) |
| --- | --- |
| 1 | "Yes." on "Start The Golem quest?" (28); the start message comes with it, before the player's line |
| 2 | the fourth soft clay, the same tick as golem_clay 4 (63) |
| 3 | continuing the player's "I'm looking for a statuette recovered from the city of Uzer." to the curator (612 -> 614) |
| 4 | the statuette into the empty alcove (1102) |
| 5 | the last statuette turned into a=1 b=1 c=0 d=2 (1184) |
| 6 | entering the open door the first time (1195) |
| 7 | continuing the golem's "Demon must be defeated! Task incomplete." (1275 -> 1276) |
| 10 | continuing the golem's "Thank you. Now my mind is at rest." after the program (1437 -> 1438); live never sends 8 or 9 |

The completion threshold is the cache's quest DB row (10).

## Varbits (varp 437)

| Varbit | Set (capture tick) | Cache transform |
| --- | --- | --- |
| 347 golem_b | 1 reading the letter (117), 2 continuing Elissa's "...the notes he made are in the library in the Exam Centre." (376 -> 377), 3 reading the notes (487) | |
| 348 golem_clay | 1-4, one per soft clay (38, 48, 55, 63) | NPC 6277: 0-1 broken 5134, 2-3 damaged 5135, 4 repaired 5136 |
| 349-351 statuettes A-C | 0 faces right, 1 left; A and B turned to 1 (1180, 1184) | 6303-6305 -> 6307 right, 6308 left |
| 352 statuette D | 1 inserted facing left (1102), 2 turned right (1174) | 6306 -> 6309 empty (no Turn), 6308 left, 6307 right |
| 353 golem_head_open | 1 the implement (1430), 0 as the completion scroll closes (1442) | |
| 354 golem_throne_gems | 1 the gems taken (1230) | 6300 -> 6301 throne, 6302 no gems |
| 355 golem_retrieved_statuette | 1 the statuette out of the case (677) | 24626 -> 24627 Study/Open, 24550 Study only |
| 356 golem_seen_underground | 1 on the first climb down, the landing tick (129) | |

The temple door 6310 is 6363 "Open" below stage 5 and 6364 "Enter" from stage 5 (varbit 346).

## Facts the plugin relies on

- **Chatheads.** Every golem line has the multi-NPC 6277 as its head, and the name of the form it shows:
  "Broken clay golem" (25, 30), "Damaged clay golem" at two and three clays (51, 58), "Clay golem" once
  repaired (65 onwards).
- **Soft clay** (36-63): each is animation 881, synth sound 1850 with delay 5, and an item box with the soft
  clay. The fourth box is followed by the golem's lines. Before the start: "Maybe you should ask the golem
  first!" (Wiki).
- **The letter** (113-117): a world spawn at 3479,3092 (Wiki, `ground-items.json`), as is the strange
  implement at 2713,4913. Read sets golem_b 1 and shows interface 220; read before the quest starts it moves
  nothing (ours: no recording reads it then).
- **Stairs**: Climb-down 6373 from 3491,3090 lands on 2721,4886 (129); Climb-up 6372 lands on 3491,3090
  (1127). No animation.
- **Elissa** (338-388): her first two menus end with "Sorry, I need to go.", which ends the talk with that
  line. The letter option is in her first menu.
- **The bookcase** 6292 at 3366,3332, approached from 3366,3333 (467): "You search the bookcase..." one tick
  after arriving, then two ticks later either the notes and an item box (470, 479) or, with the notes held,
  "You already have Varmen's expedition notes, so you find nothing of interest." (475). The Dig Site's
  bookcase 17320 beside it is that plugin's.
- **Elissa after the quest** (1931-1941): "What do you do here? | What is this place? | Sorry, I need to go."
- **The notes** (486-498): Read sets golem_b 3 and opens book 392, "The Ruins of Uzer".
- **The curator** (556-643): his statuette option appears once the notes are read. "Talk about Fossil
  Island." leads to "I've got some questions regarding Fossil Island." and its own menu (561-576).
- **Pickpocket** (649-651): animation 881, synth sound 2581 with delay 10, the key and an item box. No XP.
  Before stage 3: "The curator doesn't seem to have anything of value." (Wiki).
- **The case** 24626 (665-761): Study opens vm_timeline 534 with model 25576, then 25568 with the stolen line
  (670, 680). Open with the key gives the statuette and varbit 355 at once, and the item box two ticks later
  (676-679). The key on the emptied case gives another the same way (758-761). The statuette on the golem
  gets "Nothing interesting happens." (1081).
- **The alcove** (1100-1102): the statuette goes in at once with "You insert the statuette into the alcove."
  The player stands on the alcove's own tile to use and turn it (1169-1184).
- **The door** (1105-1195): shut, "You can't find any way to open the door." (1112). Solving it gives "The door
  grinds open.", loc animation 1909 on 2720,4912 (shape 10, rotation 0), and synth sounds 1852 and 1848
  (1184). Entering is the spam message "You step into the portal.", then (first time) stage 6 and "This room
  is dominated by a colossal horned skeleton!", landing on 2720,4884,2 (1195). The demon's portal 6282 back
  out lands on 2721,4911,0 with the same spam message (1250).
- **The throne** (1230): the hammer used with a chisel carried gives two each of ruby, emerald and sapphire,
  animation 881, synth sound 2581, and an item box with a ruby.
- **Black dye and the pen** (1309, 1388): the mushroom crushed into a carried vial is an item box with the
  dye. The feather on the dye becomes the pen in an item box, and the dye is kept (1388, and local 1001607).
- **The program** (1405-1406): one tick after the pen on papyrus, the papyrus becomes the program in an item
  box reading "You write on the papyrus:<br>YOUR TASK IS DONE". The pen is kept.
- **The implement** (1429-1430): "You insert the key and the golem's skull hinges open." (game message).
- **Completion** (1434-1442): the program plays synth sound 1849 and three lines. Continuing the last takes the
  program and completes: 1 quest point, 1,000 Crafting and 1,000 Thieving XP, the scroll with the statuette
  at 78,126. Closing the scroll shuts the skull with "The golem's skull shuts automatically."
- **Rewards and unlocks** (Wiki): the carpet between Shantay Pass and Uzer opens with completion
  (`MagicCarpets.plugin.js`; the capture rides it at 1485-1505). The quest is required for Shadow of the
  Storm, the Medium Desert Diary and Recipe for Disaster.

## The journal

Captured at stages 2 (100, 135, 333, 522), 3 (689), 4 (1121), 6 (1209) and 7 (1288); the plugin sends those
lines. The lines for stage 1, golem_b 2 before the notes are read, stage 3 before the statuette is taken,
stage 5 and the completed quest are ours: no capture opens the journal there.

## Recorded differences

The Wiki's wording is kept; the capture says:

- Pickpocketing the curator: "You pick the curator's pocket and steal a key." (651, and local 1001607). The
  Wiki's "You steal a tiny key." is used.
- Crushing the mushroom: "You crush the mushroom and create some black dye." (1309, and local 1001607). The
  Wiki's "You crush the mushroom and pour the juice into a vial." is used.
- "Damage... severe... task... incomplete..." with a lower-case "task" (25). The Wiki's capital is kept.
- Three obvious slips in the Wiki transcript are corrected to the capture (as Rum Deal's start prompt was):
  the start prompt's "Yes."/"No." (Wiki "Yes"/"No", tick 26), Elissa's "I wrote"/"That" (Wiki "AI wrote",
  a lower-case "that", ticks 375-376), and "The golem's skull shuts automatically." (Wiki "golems", tick 1442).
- The curator's menu lists the statuette option second (558). The Wiki's order, fourth, is kept.
- Entering the throne room, live sends the music unlock before "You step into the portal." (1195); ours after
  (the region music system).

## Not covered

- Ours (no source): the Crafting refusals for the repair and the program, the full-inventory refusal at the
  throne, the curator's line once the key has been taken, and the skull shutting a tick after the implement
  when no program is carried (Wiki: it shuts; the delay is not recorded).
- Black dye's Empty option does nothing; no recording empties it.
- The quest-rating interface (983) and the quest-history varbits (last_quest_*, last_started_*,
  last_completed_*) live sends are not sent by QuestRuntime for any quest.
- Picking a black mushroom with one held shows the box and gives none (unchanged; not recorded).

## Runs

### 2026-11-24 · agent · claude-opus-5-5

- **Start:** fresh account; setup before the baseline: Crafting 20, Thieving 25, soft clay x4, vial, pestle and
  mortar, papyrus, hammer, chisel, food, Varrock teleports, stamina potions, waterskins, coins; one `::tele` to
  Uzer.
- **Route:** every step by its real click, no `::tele` or stage setting after the start; `travel_to` (walks
  skipped) between Uzer, the Digsite, Varrock and back, the phoenix grabbed in the desert. Screenshots after the
  stairs both ways, the door into the throne room and the portal back: none black, the player visible.
- **Result:** stages 1, 2, 3, 4, 5, 6, 7, 10 on their recorded actions; +1 QP, +1,000 Crafting, +1,000 Thieving
  once; repeat gave nothing; a relog and the saved row kept stage 10 and the XP; post-quest golem, Elissa,
  curator and the Uzer carpet checked.
- **Found:** the letter doubled (a per-player copy beside the world spawn, fixed) and post-quest Elissa still
  offered the statuette question (fixed). Outside the quest: a Shantay Guard attacked and killed the account
  north of the pass while the desert warning was open, and the Uzer carpet charges without live's fare lines.
- **Not checked:** the Quest Helper overlay (no bridge), animations and sounds on screen, the chatbox name.
