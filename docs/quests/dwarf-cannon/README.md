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

The latest run is scripted and unwatched: [route.cjs](route.cjs) plays the whole quest over the
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

## Findings

Newest first.

- **open** #1963: the X on the cannon repair interface (IF1 409, component 11, buttonType 3)
  does not close it. The client gives IF1 buttonType 1, 4, 5 and 6 components actions but not
  3 (close), so the button has no menu entry or click. Shared client code, not quest code.
- **not reproduced** #1963: "tool selection does not work". The server recovered from seven
  wrong orders (gear first, pliers on the spring, a part with no tool, spring before safety,
  switching tools, the same tool twice) and the correct clicks still repaired the cannon; in a
  real client the repair worked both in order and after a wrong order first.
- **not a bug** #1963: railings "autofix" when spammed. Each Inspect is a 5-tick attempt that
  succeeds at random, as on the Wiki ("It may take several attempts"); a new click replaces the
  pending attempt, so spamming does not stack rolls (six clicks: five attempts started, one
  resolved).
- **open** Railing repair failure: the Wiki walkthrough says a failed attempt deals "1 or 2
  damage or your Strength or Crafting will be temporarily reduced", but the transcript the
  plugin follows gives 0-2 damage, one of four messages and an overhead cry, with no stat
  drain. No amounts are given and no rsprox capture covers it, so nothing was changed.
- **open** Headless Quest Helper does not see the cannon repair interface (IF1 409): its
  puzzle steps need `WidgetPresenceRequirement(McannonInterface.ROOT_RECT0)`, but the server's
  snapshot (`Snapshot.QuestHelper.js`) only lists widgets that have text, so the helper stays on
  its blank "use the toolkit" sub-step while the interface is open. Shared helper integration,
  not quest code; a browser client sends its own widgets.
- **open** Headless `quest_helper` returns `unavailable` once after moving into a new scene
  (`MISSING_STATE` for 5-104 `objectDefinitions`); the next call is `active`. Headless request
  filling (`Requests.QuestHelper.js`) answers varbit requests only. Shared helper integration.
- **open** Railing repair (#1699) now follows the Wiki transcript variant
  `fixing-the-railings-trying-to-fix-a-railing`: "You attempt to repalce the broken
  railing..." (the transcript's spelling), seq 4190 `mcannon_hammer_anim` for its 5 ticks, then
  a random success ("This railing is now fixed.") or failure (one of the four messages, 0-2
  damage, an overhead cry). rsprox captures: none. The animation, its timing and the 50%
  success chance are unverified.
- **fixed** The watchtower's Dwarf remains (loc id 0, `mcannonremains_multiloc`) never showed:
  the client treated loc id 0 as "no loc". Overrides now mark a removal with their own value.
  Take plays the transcript's "I had better take these remains." Covered by client unit tests,
  not yet checked in game.
- **open** `travel_to` returns `no-route` (with no reason) right after the goblin-side log
  balance, around (2600–2601, 3477), in both directions between Lawgof and Nulodion. On
  2026-10-30 it did not recover; on 2026-11-03 the next call routed on each time. Not a quest
  bug; recorded for the travel tool.
- **verified** The cannon repair order: the Wiki walkthrough gives pliers (2nd tool) on the
  safety switch, the hooked tool (3rd) on the spring, then the toothed tool (1st) on the gear,
  and Quest Helper `06da90f` encodes the same pairing with the gear last. The plugin completes
  on the gear once safety and spring are set. Whether live OSRS rejects spring before safety is
  unverified.
- **fixed** The goblin cave mud pile landed the player at (2622, 3395), but the transport data
  gives (2623, 3391). Corrected in the plugin's exit tile; re-tested by climbing the mud pile,
  which landed at (2623, 3391).

## Runs

### 2026-11-03 · agent · claude-opus-5-5

- **Start:** fresh account; declared setup `::master`, `::maxgear melee`, then `::tele` to
  (2567, 3458) beside Captain Lawgof (the only teleport). Baseline: varp 0 = 0, quest points
  varp 101 = 0, empty inventory.
- **Route:** scripted with [route.cjs](route.cjs), unwatched, Quest Helper `06da90f` headless
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
