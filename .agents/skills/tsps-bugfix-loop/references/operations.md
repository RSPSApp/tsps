# Operations

## Contribute compute

A worker needs a checkout, project dependencies/cache, its own ports and a bounded
issue—not access to another contributor's machine or credentials.

- Claim one unowned issue before allocating a checkout. Use your own authorized
  account and any suitable coding agent or local tools; follow repository rules.
- Handoff: issue/scope, base commit, branch or full patch including new files,
  candidate tree/hash, checks with commands/results, evidence and remaining limits.
  Share sanitized artifacts; local absolute paths alone are not a transferable result.
- Without push access, return the patch and verification to the coordinator for publication.
  Preserve unfinished work before returning a task to the pool.
- If a shared controller exists, use its configured coordination interface and locks.
  Otherwise use issue comments/assignees and linked PRs. Never require a private
  watcher installation or launch a competing scheduler.
- Key PR ownership by number and full head SHA; queue changed heads behind active owners.
  Refresh claims, current assignments and recent dispatches before assigning work:
  a dispatched task can exist before its status row.
- Keep coordination updates short and locked where supported; preserve unrelated records.
  Never hold a lock across network calls or builds.
- Reading instructions cannot enable a loop. Before every external mutation, recheck
  current authorization and loop state. On an authorized restart, verify the old
  controller exited, then a fresh poll and successful worker tools. Preserve settings.

## Recover the actual bottleneck

| Observation | Action |
| --- | --- |
| Unassigned issue has a fresh claim comment | Respect that owner; release a racing duplicate before dispatch. |
| PR search matches only a numeric cache/item ID | Confirm an explicit issue reference and real overlap. |
| Two branches touch one file | Respect explicit holds; disjoint hunks are not whole-file ownership. |
| Worker finishes or stalls | Record worker identity separately from setup/server PIDs; inspect actual tools and exits. Preserve edits before transfer. |
| Terminal agent needs another action | Explicitly resume it; a message alone may not restart it. |
| All reviewers wait on authors | Save findings and release waiting slots; resume for the repair delta. |
| Resource, balance or quota failure | Stop futile retries, preserve work, use an authorized available worker. No purchases or credential changes. |
| Worker-state database lock/write failure | Check disk and lock owner; use one bounded retry. Never reset its database or kill foreign sessions. |
| New runner needed | Verify the requested model/tool identity and a real successful tool operation; do not silently substitute. |
| Tool handle expired | Recover with a fresh handle and existing receipts/process state; do not repeat mutations. |
| Denial versus transient tool error | Preserve the specific denial; use only bounded permitted retries, never bypass controls. |
| Source/game PR dependency | Publish source promptly, track both heads, release the hold after merge and check affected inputs. |

## Publication

- Freeze staged, unstaged and new files against the **original base**. Retain staged
  deletions, full binary patch/hash and candidate tree; compare blobs with tested files.
  Later fixes also retain the delta from the published head.
- Keep worker results distinct from review results. Record base/head/tree, tests,
  native extent, proof reuse, limits, PR/dependencies and cleanup; never overwrite evidence.
- Ensure required parent history/alternates exist before push. Preserve commit intent;
  after a delayed response reconcile the remote ref before retrying.
- GitHub can briefly show stale heads/empty closing links or UNKNOWN mergeability.
  Re-read metadata; don't duplicate a successful push/PR.
- When a reviewer needs a reserved new head, create draft, reserve it, then mark ready.
  Never push over a reviewer's active repair.
- Authorized reviewers merge with normal protections, exact reviewed head, independently
  read current main and validated integration tree; respect claims and holds.
  After an independent merge, reconcile actual actor/head/tree instead of re-reviewing
  or posting a review to a closed PR.
- Partial PRs use `Refs`: even “does not close #N” can trigger closure.
  Track paired PRs/diary coverage and verify prerequisites before closing.
