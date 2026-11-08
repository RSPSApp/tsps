---
name: tsps-bugfix-loop
description: Fix TSPS issues with parallel workers, gameplay verification and ready PRs; manage claims, stalls and cleanup. Also use for an explicitly requested individual fix.
---

# TSPS bugfix loop

Follow root/server AGENTS.md. This skill owns bugfix work; PR review stays separate.

## Scope

- Never resume a stopped loop without an explicit request. A one-off fix or local
  preview does not restart either loop. Preview means no commit, push or PR.
- Before every external mutation, recheck current authorization and live loop state.
  A stop ends loop actions; separately requested one-off work stays within its scope.
- Use project tooling and your own authorized account. Verify the authenticated
  identity before mutations; never share credentials between contributors.
- When authorized to run continuously, reuse the existing controller/locks/claims.
  Use its configured cadence, including empty queues; stay quiet when unchanged.
  Without a controller, coordinate through issue claims. Never start a competing daemon.

## Work

1. Prioritize the quickest **complete** fixes, nearly finished work and blockers.
   Recheck comments, assignees, linked PRs and manual ownership immediately before claiming.
2. Verify the claim; fetch exact current main. Give each worker its own
   `scripts/wt new` checkout/ports and unique absolute result path.
3. Workers implement and verify; coordinator does a quick once-over and checks hashes.
   Dedicated reviewers own substantive review and integration.
4. Use available suitable workers on any contributor's machine. On resource or quota
   exhaustion, preserve work and hand it off to another authorized worker.
5. Chase actual successful tools/process exits, publish completed work promptly and
   refill useful slots. Never transfer a live owner's checkout or overwrite evidence.

## Finish

- Reproduce the real interaction/producer. Fix shared causes; never invent mechanics
  or hand-edit generated osrsreboxed JSON. Bind tests/native proof to the final tree
  and complete patch, including new files; disclose limits and reuse unchanged proof.
- Publish ready PRs only when authorized. `Fixes #N` means complete; otherwise use
  `Refs #N`. Respect drafts/holds/owners and verify linkage and closure after merge.
- Clean owned scratch on every completion, merge and check. Stop owned servers/browsers,
  retire eligible worktrees safely and reserve enough disk for the next task.

## Details only when needed

| Need | Read |
| --- | --- |
| Contributing compute, workers, stalls and publication | [Operations](references/operations.md) |
| Gameplay/client checks and diagonal-door lessons | [Verification](references/verification.md) |
| Captures, mechanics and generated data | [Evidence](references/evidence.md) |
| Storage and worktree retirement | [Cleanup](references/cleanup.md) |
