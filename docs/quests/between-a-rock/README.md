---
quest: Between a Rock...
key: between_a_rock
status: in-progress
tested: 2026-11-13
tester: agent
model: claude-opus-5-5
commit:
cache: osrs-242_2026-11-03
start: checkpoint
travel: manual
---

# Between a Rock...

Aligned with the user's whole-quest capture `BetweenARock.bin` (RSProx, revision 242.1, a male
account; transcribed with a fresh RSProx clone). Ticks below are that recording's. The words are
the "Between a Rock..." record in `npc-dialogues.json`; the capture gives when, where and how
each shows.

Code: `server/plugins/quests/quests/BetweenARock.Quest.js` (stages, conversations, items, objects),
`server/plugins/quests/betweenarock/Scenes.BetweenARock.js` (the kick, the golden cannonball, the
cannon, the landing and the first thoughts), `Schematics.BetweenARock.js` (the puzzle) and
`Mine.BetweenARock.js` (inside the rock). Capture facts the code reads are in
`server/plugins/quests/data/between-a-rock.json`. The Keldagrim cart rides (issue point 1) are
`server/plugins/world/keldagrimminecarts/` and `server/plugins/world/data/keldagrim-minecarts.json`.

## Stages (dwarfrock_quest, varbit 299)

| Value | Set when (tick) |
| --- | --- |
| 10 | "Sure, sounds interesting!" (376); dwarfrock_lookingforinfo at the end of the talk (396) |
| 20 | the Dwarven Engineer's "Great, thanks a lot!" (597) |
| 30 | Rolad's "Okay, thanks, I'll go and look for the pages then." (1047) |
| 40 | Rolad hands the book over (1221), in the joined pages' slot |
| 50 | the book is opened (1247) |
| 60 | Dondakan's "Well, we're not very much closer to a solution then, are we?" (1542), before his menu |
| 70 | the golden cannonball is fired (2041; the capture sets 70 at the end of that talk, 2064) |
| 80 | Dondakan's schematic is handed over (2138) |
| 90 | the first landing in the rock (3295) |
| 100 | the Avatar is killed: the player is out the next tick (5751) |
| 110 | Dondakan's last line (5784) |

## Facts

- **Keldagrim carts:** while riding, the appearance's stance is `human_minecart_anim` (2148) on all
  seven slots, which draws the rider in a cart, with the weapon, shield and boots hidden (725-744,
  772-790, 801-815, 837-855, 872-888). Track 4 runs east to 2935,10169 and then south down to
  2936,10152 before the fade (725-753); its cart is back at the front 3 ticks after boarding.
- **Khorvak** (issue point 7): his Talk-to was swallowed by Forgettable Tale's named hook, which
  returned without `false` when it did not apply; the Barmaid's had the same fault.
- **The pages:** each is shown in a box with the page; the third joins the three into
  `dwarf_rock_pagex3` (4573) with a second box (1156-1159). A second mine cart: "You've had enough of
  searching carts, there's nothing more inside them." (1080).
- **The book** (issue points 2 and 5): Read opens book 392, "The Arzinian Being of Bordanzan", three
  spreads, the diagram (`dwarf_rock_diagram`, 25128) on the last; turning plays
  `human_readbook_turnright` with its spot animation (1247-1257). Closing it at stage 50 gives the
  "interesting read" box with the book; from stage 80 the "peculiar picture" message box, "Tear out
  the page?" Yes/No, and the base schematic in the book's slot (2151-2170).
- **The kick** (issue point 3): continuing "...But see!" closes the chat and removes
  `dwarf_cannon_balls_flight_multi` at 2822,10167 for the player; Dondakan walks to 2823,10172, the
  camera moves at +6 (2817,10170 h500 / 2827,10175 h500, rate 10), he kicks at +10
  (`dwarfrock_dwarf_kickrock` delay 30, sound 1406), walks back, the camera resets at +18 and the loc
  and the talk come back at +19 (1567-1586). His first menu follows the talk (1659).
- **The golden cannonball** (issue point 4): +0 loc removed and camera (2822,10162 h600 / 2822,10173
  h400, rate 10), +3 camera to 2822,10170 h550 rate 3, +4 `dwarf_cannon_balls_flight_gold` and sound
  1408, +8 the usual loc and a camera reset, +9 the talk (2041-2050).
- **The furnace:** "Do you wish to make a golden cannonball?"; on Yes `human_furnace` and the first
  two messages, one a tick for the next two, and the cannonball 8 ticks on in the bar's slot
  (1764-1775). 37.5 Smithing XP (Wiki).
- **The golden helmet** (issue point 6): Smith on an anvil with gold bars, or a gold bar used on one,
  asks "Would you like to make a golden helmet?"; Yes plays `human_smithing` (898) and 4 ticks later
  the two messages, the helmet in the first bar's slot and 30 Smithing XP (2343-2362, 5114-5123).
- **Stage 70:** Talk-to asks "So you want to... fire me into the rock?" again (2079); at stage 80 with
  no helmet and parts missing it is "What did you want me to find again?" (2140, 2174).
- **The puzzle:** Assemble opens `dwarf_rock_schematics` (113) and its control panel (114) in the side
  modal; varps 261-263 select pieces (1 to start), 264-266 show them; moves are 5 pixels (paper_move;
  the right presses were silent), rotate steps rot1-rot4 (paper_turn). Start: piece 1 at 371,137 rot4,
  2 at 24,202 rot2, 3 at 182,199 rot2. Solved: pieces snap to 239,171 / 236,173 / 239,174, the borders
  hide, the congratulations layer shows, jingle 87, varbit 305, the assembled schematic in Dondakan's
  part's slot (2697-2795).
- **The cannon:** fade, the player in the cannon at 2057,4978 plane 3 (+3) with
  `dwarfrock_fake_dondakan` (+7), `dwarfrock_cannon_incannon` and the fade back (+8); held lines at
  +14, +19, +23, +32, +37, overhead and (Dondakan's) as game messages; the zoomed heads
  (`dwarf_rock_cannon`, 112) at +44, +51, +60; `dwarf_rock_fade_out` and sound 1411 at +66; fade at
  +69; the landing at +73 (3209-3282).
- **Landing:** on 2426,4965 (flying to 2420,4965) or 2323,4939 (to 2329,4939); the flight 3 ticks
  after arriving (`dwarfrock_cannon_flying`, sound 1409, camera above at rate 232), the screen back the
  tick after, `dwarfrock_cannon_fly_getup` at +9 (3282-3295, 3728-3738, 5276-5285).
- **First thoughts:** held lines and message boxes at +0, +4, +8, +12, +19, +23, +28; the Being at
  +33 with cam_shake (0, 10) and sound 1405; +39, +43; the helmet's warning with its continue at +48
  (3295-3343). Later landings show only the warning (3738).
- **The helmet's time:** varbit 309 starts at 800 when the warning is continued and drops by 25
  every 25 ticks; the messages come at 700, 550, 400, 300, 200 and 100 (3350-4479). Taking the helmet
  off: "The world turns black..." and the player at 2825,10171 (3679); gold carried is gone, with
  its box (5757).
- **The Being:** while gold is mined it speaks (chat with continue, cam_shake and sound 1405), the
  camera reset as the line goes (3381-3454). Gold rocks and veins come back after 9 ticks; the veins
  (5989-5991) use the wall swing and go to `dwarf_gold_depleted` (3389).
- **Walls of flame:** Jump-through leaps two tiles (`human_longjump` delay 20, sound 1407, "You close
  your eyes and leap through the flames! Ouch!"), the player held 23 ticks, then 5 damage; the two
  jumps into the ring pan the camera (3517-3540, 4123-4146, 5571-5594). The centre flames: "The flames
  are too hot in the centre!"; Talk-to on them is the Being, the room shaking on its first line.
- **The Avatar** appears at 2375,4951 facing the player with a hint arrow after the Being's last line
  (3574). Its death takes the player out the next tick: the helmet into the inventory or dropped ("You
  don't have any space in your inventory, so you drop your helmet."), at 2824,10171, the gold gone
  (5751-5757).
- **Rewards:** after the quest scroll closes, "Dondakan gives you a rune pickaxe." with the pickaxe
  (5789).
- **Fire** on Dondakan's cannon before the quest is done: "This definitely isn't your cannon." (268).

## Runs

### 2026-11-13 · agent · claude-opus-5-5

- **Start:** checkpoints set with `::quest between a rock <stage>` (50, 80, 90) next to Dondakan, in the
  rock and at White Wolf Mountain's station; not a fresh run.
- **Route:** the kick, the cannon cutscene, landing and first thoughts, the book and the puzzle (vision
  clips); the wall of flame, the Being, the Avatar fight and the eject, the finishing talk and the
  pickaxe box, Khorvak (agent MCP); track 4 to White Wolf Mountain (vision clip).
- **Result:** stage 110 after Dondakan's last line, the rune pickaxe with its box; the Avatar's death
  sets 100 and lands the player at 2824,10171 with the helmet in the inventory.
- **Not checked:** a fresh start-to-finish run, the furnace and anvil in game (unit-tested), the gold
  boatman.

## Not covered

- The capture's three Avatar fights picked strength, magic and magic for a player whose best skill
  is Magic; the code keeps the Wiki's highest-stat rule. The Avatar's regeneration without enough
  gold is not simulated.
- The Being's chance to speak while gold is mined is ours (one ore in two).
- The puzzle's tolerance (6 pixels) is the smallest that fits the capture's solve.
- The furnace's first two messages differ from the capture in `npc-dialogues.json` ("You heat the
  gold bar" vs "...", "to a liquid state" vs "into a liquid state").
- The boots haggling's amount input, and the gold boatman's banking.
