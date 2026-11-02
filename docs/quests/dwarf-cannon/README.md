---
quest: Dwarf Cannon
key: dwarf_cannon
status: passed-with-issues
tested: 2026-10-30
tester: agent
model: claude-haiku-5-5
commit: 495ddabd3bdc6c4cd1aab95764cf988a98690e92
cache: osrs-241_2026-10-20
start: fresh
travel: travel_to
---

# Dwarf Cannon

A full start-to-finish run on a fresh account: Black Guard acceptance, six railings, the
watchtower remains, Lollk's rescue, the cannon repair, Nulodion's notes and ammo mould, and
completion with its reward. Repeat dialogue, a relog and the goblin cave's mud pile exit were
checked too. The cannon's repair order and the `travel_to` no-route issue are still open.

## Findings

Newest first.

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
- **open** `travel_to` returned `no-route` twice right after the goblin-side log balance
  (around 2598–2601, 3477), and it did not recover on the next call. Walking the planner's
  waypoints with `walk_to` got through. Not a quest bug; recorded for the travel tool.
- **open** The cannon repair finishes on the gear click, after the safety and spring parts are
  set. The wiki's part order has not been confirmed yet, so this is recorded as unverified.
- **fixed** The goblin cave mud pile landed the player at (2622, 3395), but the transport data
  gives (2623, 3391). Corrected in the plugin's exit tile; re-tested by climbing the mud pile,
  which landed at (2623, 3391).

## Runs

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
