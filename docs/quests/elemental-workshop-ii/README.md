---
quest: Elemental Workshop II
key: elemental_workshop_ii
status: untested
tested:
tester:
model:
commit:
cache:
start:
travel:
---

# Elemental Workshop II

No native playthrough recorded; natural completion pending.

## Findings

### Post-quest elemental helmet recipe (2026-11-16)

The [OSRS Wiki Elemental helmet recipe](https://oldschool.runescape.wiki/w/Elemental_helmet)
requires completed Elemental Workshop II, boostable Smithing 20, a carried hammer and beaten
book. One elemental metal becomes one elemental helmet after four ticks for 20 base Smithing
XP. The ordinary XP policy still applies. The direct item-on-workbench route does not require
retaining a crane schematic or an unrepaired crane. With both books carried, elemental metal
uses the helmet recipe; the existing slashed-book-only shield path remains available.

The existing transcript choice `An elemental helm.` calls the same guarded recipe. An
unfinished quest, replaced material, invalidated prompt or cancelled action consumes nothing.
The exchange replaces the original plain bar in its own slot, including in a full inventory.
It does not complete the quest again or award quest rewards/diary credit.

Path: decoded native item use -> map/walk-to -> EW I handoff -> EW II direct recipe or native
chatmenu 219 -> transcript choice -> four-tick task -> real inventory slot + Smithing XP ->
PlayerSave. Task/prompt state is transient. Banking, walking, teleporting, changed requirements,
new modals, explicit Close, logout and disconnect stop pending work; a fresh valid use can retry.

`server/tests/elemental-helmet-smithing-native.test.cjs` uses registered real Players, the active
cache/map workbench, decoded native uses/moves/choices and actual Bank/container/save APIs.
It covers the four-tick boundary, full inventory, boosts/refusals, accepted menu eligibility,
real removal/refill before walk arrival and during crafting, cancellation, retries, repeated
uses and save/load. Quest state and materials are seeded; this is not a natural quest run.
The first recipe regression failed on the unmodified quest handlers (bar 2893 remained instead
of helmet 9729), then passed after the handoff/recipe change.

Focused EW I/EW II consumers cover ordinary shields, the stage-5/6 claw menu, mind-helmet
completion, timed mind shields and elemental smelting. Three `qh728-q030` fixture failures
also reproduce with the unchanged base quest handlers: its inventory stand-in lacks `contains`
(two checks), and its death-task actor lacks `getEquipment` (one check). Those unrelated
fixtures are not relaxed here. Its changed workbench fixture supplies the retained prompt's
teleport serial and the focused handoff passes.

IDs are checked against active `osrs-242_2026-11-03`: metal 2893, helmet 9729, beaten book
9717, hammer 2347, workbench 3402 at 2717,9887,0. Local reference symbols at
`6e5033af6215963581a51b348f452320ff18f0f6` (rev241) agree on these IDs and chatmenu 219,
options child1. The newer runtime cache remains authoritative.

No local capture showed elemental-helmet workbench crafting or its success message. Four
ticks and costs/rewards are Wiki evidence. Exact animation, sound and success/quest-refusal
copy remain unverified and are not invented. The existing full-quest playthrough status above
is unchanged.

Independent review of the implementation verified the source/build fingerprints and traced
the actual dispatch, prompt, inventory/Bank, task/movement and save owners. Two extra native
checks passed: real inventory drag invalidation with a fresh retry, and real Bank book
switches between pending mind-shield and helmet work in both directions with valid retries.
No findings were reported in the inspected paths; no exhaustive correctness claim.

### Native recipe walkthrough

A rendering browser used native inventory Use and the actual workbench 3402. Quest completion,
Smithing 20, tools, three bars, a full bag and nearby placement were controlled fixtures;
no timers or crafting outcomes were forced. The first recipe remained pending at world ticks
568–571 and exchanged the bar at tick 572, adding 20 Smithing XP. The client showed the
helmet icon in the selected slot, with the tools and full bag retained. Current level 19
refused another native use without changing the bar or XP; no refusal text appeared.

Escape with no modal open emitted no Close packet and that attempt completed a second
helmet. It is not cancellation evidence. The subsequent native floor click did cancel pending
work: task active at tick 933, stopped at 934, bar and XP retained. A fresh native use from the
walked-to position then crafted the third helmet. Final state: no bars, three helmets,
Smithing XP 4470 to 4530, quest stage 12 and quest points unchanged at zero.

An actual network disconnect/save followed by a new native login restored the first two
helmets and XP 4510. Later, native logout reached title state 10 and removed the player;
after persistence flush, the committed SQLite row contained three helmets and XP 4530.
The final fresh-context relog helper failed with a closed target page, so a post-logout native
relog displaying all three helmets is not claimed. These are distinct persistence checks.
The native login gates used actual title/form state, welcome 378 and Play to root 161; the
anonymous account had been warmed with onboarding skipped.

The owned game stopped through the real five-second GameUpdate countdown, with persistence
completed and saved=1/failed=0. Owned client/browser/helpers stopped and all five assigned
ports were clear. Packet evidence excluded authentication responses; retained logs were
sanitized. No audible playback, retail animation/copy parity or natural quest run was verified.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q031); PRs: [#1117](https://github.com/RSPSApp/tsps/pull/1117).
