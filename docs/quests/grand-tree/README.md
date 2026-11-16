---
quest: The Grand Tree
key: grand_tree
status: passed-with-issues
tested: 2026-10-29
tester: agent
model: claude-haiku-5-5
commit: 62d662706242
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# The Grand Tree

A fresh account ran the quest from King Narnode to the completion scroll, with the
natural twig, trapdoor and Daconia rock steps. Rewards, the repeat talk and a relog all
checked out. Open: the translation quiz doesn't track wrong answers, and `travel_to` has
several route problems (gate, open doors, a Castle Wars transport) that the run worked around.

## Live capture (rsprox local 1002189, revision 242.1)

A whole run, start (tick 10173) to completion (tick 12894), in rsprox capture local 1002189. The quest follows it;
the tests are `server/tests/grand-tree-capture.test.cjs`. Ticks below are the capture's.

**Stages (varp 150)** move with these, not before:

| Stage | With | Tick |
| --- | --- | --- |
| 0 -> 10 | the King's "hands you" double object box (the bark sample and translation book come with it, not on "Yes.") | 10338 |
| 10 -> 20 | Hazelmere's "The mage carefully examines the sample." (the sample is taken then) | 10574 |
| 20 -> 30 | the King's "First I must warn the tree guardians." | 10819 |
| 30 -> 40 | Glough's "Your type can't be trusted!" | 10906 |
| 40 -> 50 | the King's "Certainly. He's on the top level..." | 11000 |
| 50 -> 60 | Charlie's "I don't know what he's up to." | 11056 |
| 60 -> 70 | Search on the open cupboard: the journal | 11119 |
| 70 -> 80 | the King's "I'm afraid Glough has placed guards..." | 11205 |
| 80 -> 90 | the foreman's lumber order box | 11514 |
| 90 -> 100 | Charlie's "Hmm... you could be in luck!" | 11723 |
| 100 -> 110 | a tick after the reach into the chest | 11989 |
| 110 -> 120 | the King's twigs box (the invasion plans are taken then; slots O, Z, T, U) | 12117 |
| 120 -> 130 | a tick after the fourth twig (ours: on the fourth twig's tick, so a logout in between cannot strand all four pillars filled at 120; the box and sound still come a tick later) | 12203 |
| 130 -> 140 | the black demon's death | 12394 |
| 140 -> 150 | the King's "A reward will have to wait though..." | 12553 |
| 150 -> 160 | the last line, "You too, your highness!" (the Daconia rock is taken then) | 12894 |

**Items kept:** Hazelmere's scroll, the translation book, Glough's journal, the lumber order and Glough's key all
stay in the inventory (the capture's player banks the last three after the quest). Only the bark sample, the invasion
plans, the twigs and the Daconia rock are taken.

**Boxes:** every hand-over and narration is a box with its mesbox chat line, never a plain game message:
`plugins/quests/grandtree/Boxes.GrandTree.js` lists them (message box 229, object box 193 with its item, the
double object box 11 for the King's hand-over). The only game messages are the started/completed lines and "You
search the root but don't find anything.".

**The translation:** the third to fifth menus only offer the options for the answers so far: with the right
answers, five options ending "None of the above." (no "More..." page) and four in the last, without the
transcript's "If the player chose the previous options incorrectly:" options (`Quiz.GrandTree.js`).

**Scenes** (`Scenes.GrandTree.js`, `Demon.GrandTree.js`), ticks from the continue before each:

- *Under the tree:* +5 "Down here." over the King's head and the trapdoor at 2463,3497 opens (loc 2445, sound 91);
  the player walks to 2464,3497, reaches (seq 827) at +11 and is at 2463,9896 at +12; the talk below at +18. Back
  up: +4 "Up here.", a walk to 2464,9897, the climb (seq 828) at +9 and 2464,3497 at +10.
- *The arrest:* after "Guards! Guards!" a guard (1433) comes up at 2477,3462 and walks to 2479,3463; "Come with
  me!" at +5. Then the player walks to the ladder (2477,3463) at +6, climbs (seq 828) at +12 and is in the cell
  (2464,3496,3) at +13. The King appears at 2467,3495 at +16, walks to the cell door (2465,3496) and speaks at
  +20, without Charlie being talked to. On that line's continue the door opens (loc 1548, sound 1631), the King
  steps to 2465,3495 and the player walks out to 2465,3496; the next line at +3 and the door shuts at +6.
- *The glider:* on "Okay, you're the boss!..." the glider map (138) opens with pilot_journey 7 and the glider's
  fade (colour 1512708, 20 cycles); the player is at 2918,3058 a tick later; fade in at +3; all closed and Errdo's
  "Sorry about that." at +4. There is no "You fly on the glider." chat line.
- *The office:* after "Follow me." the fade starts at +3 as the player walks 3 tiles north; at +6 the player is at
  2955,3033 with the office foreman at 2954,3031, both walk to 2954,3025; fade in at +8; "Tell me again why you're
  here." at +21.
- *Femi's cart:* after "Jump in the back of the cart" the player walks to 2461,3379, climbs in (seq 828) at +7 and
  is at 2459,3409 at +8, with Femi at 2458,3409 and her cart (loc 308) at 2458,3410; her next line at +8. The gate
  Femi sneaks the player in after the lumber order (stage 90).
- *The watchtower:* the tree lands on 2486,3465,2; each twig goes on its pillar with seq 832 and sound 2739, no chat
  line; the fourth adds sound 1586 and a tick later the message box and sound 91.
- *Glough's pet:* the reach (seq 827, delay 15), the fade at +1, a copy of the cave at +4 (player at 2491,9864, side
  tabs closed), camera and fade in at +7; Glough at 2476,9866 and "Hello?" over the player's head at +9, "Anybody?"
  at +14, Glough walks to 2485,9864, "Glough?" at +23; at +26 the camera, a walk to 2486,9864 and the conversation.
  Before "Fool... meet my little friend!" the demon at 2476,9864 (seq 64 and sound 400, delay 90) with a camera
  shake; Glough backs off to 2485,9860. Its continue: an empty message box and the fade at +1; at +4 the real cave
  (2491,9864), at +6 Glough (2487,9858) and the demon (2478,9866) facing south and the fade in; the demon fights.
  A tick after its death Glough cries "Mummy!" over his head and is gone 4 ticks later.
- *The King's guard:* the chat closes 1 tick after "Never! Not Glough!...", 9 after "Guard!" and 5 after "Go and
  check out that passage!".
- *The roots:* the reach (seq 827), the answer a tick later; the rock's object box first, the rock itself once it
  is continued.
- *The scroll:* "5 Quest Points", "18,400 Attack XP", "7,900 Agility XP", "2,150 Magic XP", "Gnome Glider
  Access", with the Daconia rock.

**Recorded differences** (the Wiki's transcript wins on wording): live says "Traveller, Can I speak to you...",
"Do this carefully!", Errdo's "Okay! You're the boss! Hold on tight, it'll be a rough ride!" and the player's "Take me
to Karamja please!"; the menu option "You must act now or we will all die!" has no comma; the foreman's "Hmm...in
that case we'd better go to my office." / "Follow me." and "Right answer. I have to watch for imposters." / "What's
Glough's favourite dish?" are two pages each; "Fool... meet my little friend!" is shown twice. Ours keeps the
transcript's text.

**Ours** (no capture or Wiki): the trapdoor under the King closes 2 ticks after the player is below; the
cupboard's Close and its sound; Femi and her cart stay 100 ticks after the drop; the office foreman's login tile;
the Daconia rock's root is drawn once per player from the cave's roots (Wiki: "It may be in any of the roots").

## Findings

Newest first. One line each, linked to its issue or PR when there is one.

- **fixed** The whole quest follows rsprox capture local 1002189 (above): stage timing, kept items, boxes, the
  translation menus, the arrest and release, the crash flight, the office, Femi's cart, the watchtower, Glough's
  pet and the scroll.
- **fixed** Translation quiz: the "previous options correctly/incorrectly" conditions now follow the picks, so a
  wrong translation reaches "Are you sure you translated correctly?" and the right one shows live's menus.
- **fixed** The lumber order is no longer taken by Charlie; the stage moves on with his clue line.

- **open** (travel_to) The planner routes through gate 190 at 2461,3384, which the live world doesn't have: "Object with id 190 does not exist".
- **open** (travel_to) The planner clicks "Open" on tree doors that are already open (1967/1968 at the base); nothing happens and the leg blocks. Walking through by hand works.
- **open** (travel_to) The Castle Wars recruiter transport (8644) to the Castle Wars lobby is blocked on "Join".
- **open** (Monkey Madness I) The shipyard gate guard (`enterShipyard`) refuses anyone opening the gate from inside without the royal seal, so a player who finishes the Karamja shipyard can't leave. Worked around with a Varrock Teleport (runes supplied as setup).
- **fixed** The staircase at 2389,3512 (climb-up) put the player on the tile in front of the stairs, blocking the way to Anita. Its landing is now declared as 2388,3513,1 in `plugins/objects/data/climb-links.json`.
- **fixed** The cave ladder at 2463,9897 didn't climb: its surface end is a trapdoor showing only "Open", so the generic pairing found nothing. Declared with landing 2463,3498,0 in the same file.
- **fixed** The watchtower tree (2447) climb-up landed on 2484,3465,2; it now lands on 2485,3465,2 (`GrandTree.Quest.js`).
- **fixed** Monkey Madness II's tree 28800 Climb-down landed on 2485,3464,1; it now lands on 2484,3463,1 (`MonkeyMadnessII.Quest.js`, the branch split from tree 13).

## Runs

Newest first. A rerun adds an entry; it never rewrites an older one.

### 2026-10-29 · agent · claude-haiku-5-5

- **Start:** fresh account, placed at the quest start (2466,3497,0) with `::tele` (the only teleport). Baseline: quest points 0, quest varp 0, all skills at 99, empty inventory and equipment.
- **Route:** King Narnode (start, stage 10) → Hazelmere on the island east of Yanille (20) → back to Narnode (30, correct translation picks) → Glough's tree house (40) → Narnode (50) → Charlie's cell (60) → Glough's cupboard for the journal (70) → confronting Glough (arrested to the cell, released, 80) → Captain Errdo's glider to Karamja → shipyard gate with the password Ka-Lu-Min → the Foreman's questions (lumber order, 90) → Charlie's clue (100) → Anita's key (ladder at 2389,3512) → Glough's chest for the invasion plans (110) → Narnode (120, four twigs) → pillars 2440–2443 in T-U-Z-O order (130) → trapdoor → black demon (140) → Narnode → Daconia rock from the roots (150) → Narnode completes (160).
- **Result:** stage 160; quest points 0 → 5; XP Attack +18,400, Agility +7,900 (+32 activity), Magic +2,150 (+35 activity); the Daconia rock consumed. The repeat talk with Narnode gave no reward. After a relog, stage, quest points and XP were unchanged, and the saved row held stage 160 and quest points 5.
- **Not checked:** the black demon was killed with `::maxgear melee` by the tester, so it isn't a natural-gear fight. Spirit tree and gnome glider access (the rewards) weren't used. The Quest Helper route wasn't compared step by step. The visual overlay wasn't checked. No recovery cases exist in this quest beyond the twigs and the replacement items, which weren't exercised.
