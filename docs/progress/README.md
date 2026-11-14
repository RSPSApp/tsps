# Repository content progress

[osrs-progress.json](osrs-progress.json) records the full content inventory used by
[rsps.app/progress](https://rsps.app/progress): 20 categories and 520 items at initial
import, including task statuses, detailed acceptance criteria, source paths and Wiki
references. Maintain this file with content changes; agents do not need to wait for
the website to refresh before selecting work or documenting delivery.

The initial import is the website's **11 November 2026** assessment. Its statuses and
notes are preserved, not a new audit of current main. Some descriptions are stale.
[import-source.json](import-source.json) identifies the original download. Read the
implementation and newer merged PRs before treating an imported gap as missing.
The numerical estimates discussed outside this repository are not imported scores.

## Updating content

1. Find the item by category and name. Read its `taskDetails`, `devNotes` and
   `implementedIn`, then compare current source and relevant open/merged PRs.
2. Include the affected item's update in the same PR as the content. Update only
   the relevant `tasks` entries and corresponding detail/remaining-work notes.
   Keep the four task positions aligned with `taskDetails`. A branch's status is
   proposed until that PR merges; the file on main describes delivered main.
3. Add a dated `devNotes` entry describing the player-visible outcome, source or
   immutable commit, verification document/result and limitations. Use public
   repository links, not private session boards, local artifact paths or credentials.
   Link the PR when known; the branch's own source/doc paths suffice before opening it.
4. Mark a task `done` only when its full stated acceptance is met. A partial slice
   stays `in-progress`, even if its PR is merged. Record unsupported mechanics,
   evidence gaps and the condition for resuming them. Tests support a claim but do
   not themselves earn completion credit. Never infer completion from PR counts.
5. Preserve category/item identities, task order and weights. Correct stale criteria
   using cited evidence; explain scope changes rather than deleting unfinished work.
   On conflicts, reconcile the affected entries and retain both deliveries' evidence.
   This is authored progress metadata, not an osrsreboxed generated game-data export.
6. Run `node scripts/check-content-progress.mjs`. Review the JSON diff alongside the
   implementation. No extra runtime run is needed solely for a metadata update.

`updated` is the date of the latest repository assessment recorded in the file, not
an assertion that every item was re-audited that day. Individual dated notes identify
which items were reviewed. Keep older evidence and limitations when adding new notes.
Issue assignment/qualification remains on GitHub; this file does not reserve work.

Example note (replace placeholders with actual evidence):

> 2026-11-14, <commit/PR>: implemented <ordinary player interaction>. Verified by
> <public documentation/tests and actual results>. <Task name> remains in progress:
> <specific remaining behavior or evidence gap>.

## Website integration

The inventory retains the website's existing JSON structure and status values.
The documented scoring is `done = 1`, `in-progress = 0.5`, `todo = 0`; an item's four
tasks contribute equally. Item `weight` defaults to 1 and 0 excludes an item from
counted progress. Do not store hand-entered percentages or change weights to increase
the score. The checker validates structure; it does not certify gameplay completeness
or reproduce the site's category/overall aggregation.

The maintainer can use the **merged main** version of this file as the website's
`osrs-progress.json` input. An automatic update should copy the reviewed file and use
the site's existing calculation/rendering code, after checking that consumer's schema
and weighted aggregation. This PR does not configure a website deployment or sync job.
Do not automatically overwrite repository assessments with a later website snapshot;
reconcile changes with their source evidence, preserving newer repository deliveries.

## Post-import deliveries to reconcile

These are concrete merged advances beyond the imported descriptions, not fresh task
scores. They provide starting points for an acceptance-by-acceptance reassessment:

| Item | Merged delivery | Remaining scope / distinction |
| --- | --- | --- |
| Clan Wars | [Kill targets #4576](https://github.com/RSPSApp/tsps/pull/4576), [timed matches #4615](https://github.com/RSPSApp/tsps/pull/4615), viewing orbs, negotiated restrictions and multiple arenas documented in [clan-wars.md](../clan-wars.md). | The imported four partial tasks are not a claim that these additions are absent. Unsupported objective modes, combat controls and restoration behavior remain distinct. Open PRs are not delivered main. |
| Maggot King | [Encounter/recovery #5159](https://github.com/RSPSApp/tsps/pull/5159), [egg Pop #5164](https://github.com/RSPSApp/tsps/pull/5164), [fire burns #5176](https://github.com/RSPSApp/tsps/pull/5176), [bile protection #5223](https://github.com/RSPSApp/tsps/pull/5223); [mechanics and limits](../maggot-king.md). | Corpse-choice/reward acquisition and complete achievement reconciliation are not supplied by these combat slices. |
| Mahogany Homes | [Work orders/client checklists #5049](https://github.com/RSPSApp/tsps/pull/5049), [provenance #5062](https://github.com/RSPSApp/tsps/pull/5062); [Construction](../construction.md). | Reconcile stale cancellation/blueprint claims against current source and Wiki; do not implement a stale missing-work description blindly. |
| Golem crafting | [Regular crafting #5054](https://github.com/RSPSApp/tsps/pull/5054), [continuous-input shaping #5110](https://github.com/RSPSApp/tsps/pull/5110); [mechanics and limits](../golem-crafting.md). | Imported all-todo statuses predate this playable loop. Repeatable monolith and disclosed timing/orientation limits require separate qualification. |

