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
copy remain unverified and are not invented. Rendered browser QA and independent review are
pending; the existing full-quest playthrough status above is unchanged.

## Runs

No run yet. Tracked in issue [#728](https://github.com/RSPSApp/tsps/issues/728) active (q031); PRs: [#1117](https://github.com/RSPSApp/tsps/pull/1117).
