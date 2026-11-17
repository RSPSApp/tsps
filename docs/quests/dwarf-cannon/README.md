---
quest: Dwarf Cannon
key: dwarf_cannon
status: passed-with-issues
tested: 2026-11-03
tester: agent
model: claude-opus-5-5
commit: e213d50ad1792cc4be775e5c2c398abe7d428493
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Dwarf Cannon

The latest run is scripted and unwatched: [route.cjs](https://github.com/RSPSApp/tsps/blob/main/docs/quests/dwarf-cannon/route.cjs) plays the whole quest over the
agent MCP from a fresh account, checks Quest Helper's step before each leg and the stage after
it, and finishes with the rewards, a repeat talk and a relog. It passed from stage 0 to 11 with
no quest code changes. The railing failure's stat drain (the sources disagree), headless Quest
Helper gaps and the `travel_to` no-route issue are still open.

To re-run it (needs the Quest Helper bridge and a server with `AGENT_MCP=1`), from `server/`:

```bash
ROUTE_PASSWORD=<any> NODE_PATH=$PWD/node_modules node ../docs/quests/dwarf-cannon/route.cjs \
  --mcp http://127.0.0.1:<AGENT_MCP_PORT>/mcp --player <fresh account> [--from "<step>"]
```

On a failure it prints the step, the helper's step and the stage, and the `--from` to resume
with on the same account once the cause is fixed. `--from` and `--to` must name a step (the
script lists them otherwise). Step 12 saves the pre-completion observation to `--checkpoint`
(default: a per-account file in the system temp directory), so a resume at "13 rewards"
measures the reward against it; without that checkpoint it stops and asks for a resume from
step 12.

The script tests the server's quest logic, not the client UI: it sends the clicks a client would
send, so a client that fails to offer or send a click (see #1963) is not caught. Quests with
custom interfaces still need a check in a real client.

## Live behaviour (rsprox captures)

From local recordings 1001565 (rev 241, the whole quest), 1001618 (rev 241, start to the railings) and
1002239 (rev 242, start to Lollk). Ticks below count from the action that starts each step.

**varp 0 (`mcannon`)**, the saved stage:

| Value | Set when | Recording, tick |
| --- | --- | --- |
| 1 | Lawgof's "That's the spirit!", after the player's "Sure, I'd be honoured to join." | 1001565 4717 |
| 2 | Lawgof's "Excellent! I have two men there" in the railings report (all six fixed stays 1) | 1001565 5054, 1002239 2205 |
| 3 | climbing the watchtower's top ladder (`mcannonladder`), where the remains multiloc shows | 1001565 5087, 1002239 2246 |
| 4 | the continue of the remains box ("You give the Dwarf Captain his subordinate's remains...") | 1001565 5146 |
| 5 | entering the goblin cave (`mcannoncave`, the crawl to 2620,9797) | 1001565 5240, 1002239 2365 |
| 6 | "You untie the child." | 1001565 5291, 1002239 2416 |
| 7 | "The Dwarf Captain gives you a tool kit." | 1001565 5474 |
| 8 | the gear, with "Well done! You've fixed the cannon!..." | 1001565 5493 |
| 9 | the close after the player's "Okay, I'll see what I can do." (Okay then, just for you!) | 1001565 5566 |
| 10 | "The Cannon Engineer gives you some notes and a mould." (a two-item box) | 1001565 5665 |
| 11 | completion | 1001565 5895 |

Saves from before this numbering (internal 2 = railings unreported, 3 = reported, 5 = Lollk found, 6 = toolkit)
move once at login (`dwarf-cannon:stage-schema`): 2 to 1, 3 to 3 with the remains carried or 2 without, 5 to 6,
6 to 7.

**Railings.** "This railing is broken and needs to be replaced." is a message box. Its continue sends "You
attempt to replace the broken railing..." (the Wiki transcript spells it "repalce"; we keep the Wiki), then
`mcannon_hammer_anim` (4190) with sound 2721 two ticks later, and the outcome two ticks after that. Success
sets `mcannon_railing<n>_fixed` (2240-2245) and takes a railing; railing 6 also sets `mcannon_taken_corpse`
(2246), in all three recordings, whichever railing is fixed last. Each failure pairs one message, one cry and
one effect, the same in all three recordings (counts over the three):

| Message | Cry | Effect | Then |
| --- | --- | --- | --- |
| Your arm is getting tired. | Urrrgh! | Crafting -1 | swings again 4 ticks later (4 of 5) |
| You cut yourself on the rusty old railing. | Oooch! | 1 damage | stops (4 of 4) |
| You accidentally crush your hand in the railing. | Ow! | 2 damage | stops (9 of 9) |
| You wrench your back trying to handle the railings. | Gah! | Strength -1 | swings again 4 ticks later (7 of 7) |

One of sounds 518-521 (delay 20) comes with each failure. The success chance is the Wiki's ("Railing", from
Mod Ash): Crafting only, 24% at level 1 to 59% at 99 (low 60, high 150 of 256); each failure is one of the four
at 25%.

**The remains.** Take plays the player's "I had better take these remains." first; the remains go into the pack,
and off the floor for that player (a `loc_del`), as the line closes. No chat message.

**Lollk.** The search: "You search the crate..." with `human_pickupfloor` (827); 3 ticks later "Inside you see a
dwarf child, tied up!" with `human_pickuptable` (832, delay 30); 2 ticks later "You untie the child.", varp 0 = 6,
and Lollk (5190) appears at 2571,9851 facing south saying "Hooray!" as his first line opens. With "The dwarf child
runs off into the caverns." he walks to 2570,9851, 2569,9850, 2568,9849, 2567,9848 and is gone the tick after.

**The mud pile.** `human_reachforladder` (828) two ticks after arriving, then the move to 2623,3391.

**The repair puzzle** (IF1 409). A tool click sets its `mcannonmulti_tool<n>` varbit and the selected model; it
stays selected after it is used. The spring set without the safety plays `mcannon_interface_gun_attach_spring`
(3202), the safety with the spring `mcannon_interface_gun_safety_off_with_spring` (3198), the gear with both
`mcannon_interface_gun_work_with_spring` (3205), and the interface closes 4 ticks after the gear. The recording
did the spring first, then the safety, then the gear.

**Completion.** Lawgof takes the notes and the mould (the Wiki's "Ammo mould" agrees), and every quest varbit
(2235-2246) goes back to 0, so the railings show broken again. The scroll shows the toolkit and four lines:
"1 Quest Point", "750 Crafting XP", "Ability to use a", "Dwarf Multicannon".

**Recorded differences kept as the Wiki has them.** Dialogue wording: "The Black Guard? What's that?" (live
"The Black Guard, what's that?"), "seems to have stopped" (live "seem"), "Please traveler" (live "traveller"),
"It fires mould?" (live "It fires a mould?"), "Select an Option" (live "Select an option"), "You search the
crate.." in the Lollk variant (live "..."), and "repalce" above. The no-hammer line was not recorded (the
player had one).

**Ours (no source):** the post-quest Inspect of a railing (now shown broken again) keeps the player's "I've fixed
all these railings now."; a railing used on a broken railing is an Inspect; the gear before the safety and spring
does nothing; a later search of the crate is "You search the crate but find nothing."; Lollk leaves after 100 ticks
if the talk is abandoned before he runs off; the crate also works at varp 0 = 4 (a save migrated inside the cave).

## Findings

Newest first.

- **open** #1963: the X on the cannon repair interface (IF1 409, component 11, buttonType 3)
  does not close it. The client gives IF1 buttonType 1, 4, 5 and 6 components actions but not
  3 (close), so the button has no menu entry or click. Shared client code, not quest code.
- **not reproduced** #1963: "tool selection does not work". The server recovered from seven
  wrong orders (gear first, pliers on the spring, a part with no tool, spring before safety,
  switching tools, the same tool twice) and the correct clicks still repaired the cannon; in a
  real client the repair worked both in order and after a wrong order first.
- **not a bug** #1963: railings "autofix" when spammed. Each Inspect is an attempt that
  succeeds at random, as on the Wiki ("It may take several attempts"); a new click replaces the
  pending attempt, so spamming does not stack rolls (six clicks: five attempts started, one
  resolved).
- **fixed** Railing repair failure: now the Wiki's four effects (1 or 2 damage, Crafting or Strength
  -1), each with the message and cry the captures pair it with; see "Live behaviour" above.
- **open** Headless Quest Helper does not see the cannon repair interface (IF1 409): its
  puzzle steps need `WidgetPresenceRequirement(McannonInterface.ROOT_RECT0)`, but the server's
  snapshot (`Snapshot.QuestHelper.js`) only lists widgets that have text, so the helper stays on
  its blank "use the toolkit" sub-step while the interface is open. Shared helper integration,
  not quest code; a browser client sends its own widgets.
- **open** Headless `quest_helper` returns `unavailable` once after moving into a new scene
  (`MISSING_STATE` for 5-104 `objectDefinitions`); the next call is `active`. Headless request
  filling (`Requests.QuestHelper.js`) answers varbit requests only. Shared helper integration.
- **fixed** Railing repair timing and chance: from the captures and the Wiki's Crafting-based chance
  (see "Live behaviour" above), replacing the unverified 5-tick, 50% attempt.
- **fixed** The watchtower's Dwarf remains (loc id 0, `mcannonremains_multiloc`) never showed:
  the client treated loc id 0 as "no loc". Overrides now mark a removal with their own value.
  Take plays the transcript's "I had better take these remains." Covered by client unit tests,
  not yet checked in game. The remains now show from varp 0 = 3 (the tower's top ladder), as live.
- **open** `travel_to` returns `no-route` (with no reason) right after the goblin-side log
  balance, around (2600–2601, 3477), in both directions between Lawgof and Nulodion. On
  2026-10-30 it did not recover; on 2026-11-03 the next call routed on each time. Not a quest
  bug; recorded for the travel tool.
- **verified (capture)** The repair also works spring first, then safety, then gear (1001565).
- **verified** The cannon repair order: the Wiki walkthrough gives pliers (2nd tool) on the
  safety switch, the hooked tool (3rd) on the spring, then the toothed tool (1st) on the gear,
  and Quest Helper `06da90f` encodes the same pairing with the gear last. The plugin completes
  on the gear once safety and spring are set. Whether live OSRS rejects spring before safety is
  unverified.
- **fixed** The goblin cave entrance was claimed by Land of the Goblins, which moved the player to
  (2617, 9797) at once; it is now LocTeleports' captured crawl to (2620, 9797).
- **fixed** The goblin cave mud pile landed the player at (2622, 3395), but the transport data
  gives (2623, 3391). Corrected in the plugin's exit tile; re-tested by climbing the mud pile,
  which landed at (2623, 3391).

## Runs

### 2026-11-03 · agent · claude-opus-5-5

- **Start:** fresh account; declared setup `::master`, `::maxgear melee`, then `::tele` to
  (2567, 3458) beside Captain Lawgof (the only teleport). Baseline: varp 0 = 0, quest points
  varp 101 = 0, empty inventory.
- **Route:** scripted with [route.cjs](https://github.com/RSPSApp/tsps/blob/main/docs/quests/dwarf-cannon/route.cjs), unwatched, Quest Helper `06da90f` headless
  through the bridge. Before each leg the script asserts the helper's step names it; after it,
  the saved stage and varp 0. Talk to Lawgof (Yes.), inspect the six railings (failures
  retried), report back, `travel_to` up the southern watchtower's ladders and take the remains,
  hand them in, `travel_to` into the goblin cave and search the crate, leave by the mud pile,
  take the toolkit, repair the cannon in the Wiki order (pliers/safety, hook/spring,
  toothed/gear) through IF1 409's buttons, report, `travel_to` to Nulodion and back.
- **Result:** varp 0 = 0 → 1 → 2 → 3 → 4 → 6 → 7 → 8 → 9 → 10 → 11, the saved stage matching
  each time; the cache's endstate (11) agrees. Quest points +1, Crafting XP +750 (against a
  pre-completion snapshot), the notes taken and the ammo mould kept; Quest Helper reports the
  quest complete. A repeat talk to Lawgof changed no QP or XP. A relog kept stage 11, the QP,
  the XP and the mould. Two clean passes on fresh accounts took 12 min 21 s and 12 min 5 s,
  about 7 min 40 s of each the two walks between Lawgof and Nulodion.
- **Follow-up (#1963):** in a real client the cannon repair worked in order and after a wrong
  order first; the interface's X does not close it (finding above).
- **Not checked:** visuals of the rest of the route (no client was connected for it: the
  remains' loc was not seen), the offline save beyond the relog, Nulodion's post-quest
  dialogue, recovery cases (lost toolkit, notes or mould, full bag), out-of-order cannon clicks,
  and the railing failure's damage and messages beyond seeing them occur.

### 2026-10-30 · agent · claude-haiku-5-5

- **Start:** fresh account at (3089, 3524), baseline recorded before the route: varp 0 = 0,
  quest points varp 101 = 0, all skills at 99, empty inventory. No `::tele` was used.
- **Route:** `travel_to` to Captain Lawgof's area, then `walk_to` along a `plan_route` path past
  the log balance. Talk to Lawgof, accept the Black Guard offer, fix the six railings, report
  back, and climb the southern watchtower by its gate and ladders. Take the remains, hand them
  to Lawgof, and search the goblin-cave crate to rescue Lollk. Return to Lawgof, take the
  toolkit and repair the cannon (tool 1 with gear; tool 2 with safety; tool 3 with spring; then
  tool 1 with gear again). Report to Lawgof, go to Nulodion for the notes and ammo mould, and
  return to Lawgof to complete.
- **Result:** varp 0 = 0 → 1 → 2 → 3 → 4 → 6 (Lollk) → 7 → 8 → 9 → 10 → 11 (native values).
  Quest points 0 → 1. Crafting XP +750, delivered once. Toolkit and notes were consumed; the
  ammo mould was kept. Repeat talk to Lawgof gave no duplicate reward. A relog kept stage 11, QP
  1, Crafting XP and the inventory.
- **Re-test after fix:** a server restart after the mud pile exit tile change (the agent MCP
  reconnected). Stage 11 persisted, and climbing the mud pile from the cave landed at
  (2623, 3391).
- **Not checked:** the offline save (confirmed by relog only, not a parent export), Nulodion's
  post-quest dialogue, recovery cases (lost notes or ammo mould, full bag), and the cannon
  repair order against the wiki. No visual Quest Helper overlay was checked.
