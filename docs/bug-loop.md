# The bug loop

How an agent works through GitHub issues unattended: claim one, fix every part of it, prove it
in game, open a PR another agent will review, then take the next. Any agent can follow this. The
helper scripts are in `scripts/agents/`, and a prompt as short as "run the bug loop until I stop
you" is enough.

Read [AGENTS.md](https://github.com/RSPSApp/tsps/blob/main/AGENTS.md) and [server/AGENTS.md](https://github.com/RSPSApp/tsps/blob/main/server/AGENTS.md) first. Everything here
sits on top of their rules.

## 1. Pick an issue

```sh
gh issue list --repo RSPSApp/tsps --state open --limit 150 --json number,title,assignees,comments
```

- **Skip:** issues with an assignee, a "looking into this" comment, or a PR (open or merged) that
  names the issue number (`gh pr list --repo RSPSApp/tsps --state all --search <N>`). Re-check
  right before you claim: another agent may have fixed it minutes ago.
- **Partly claimed is fair game.** If a comment claims only part of an issue, you may take the
  rest. Say exactly which parts in your claim.
- **Take what you can verify** through the agent MCP (rules, items, NPCs, dialogue, drops,
  movement) or with headless screenshots (visuals). A report that needs the reporter's answer
  waits for it. Suggestions aren't bugs; take them only when asked.
- **Ask for evidence when needed.** A useful report states what happened, what should happen and
  how to reproduce it. Evidence is not required to file: an obvious defect can be clear from the
  reproduction alone. When the behavior is non-obvious, ask for the precise rsprox/Wiki/cache/code
  or other mechanics evidence needed to establish or diagnose it, and label the issue
  `needs-evidence` / `capture-needed`; keep plausible bugs open, and never reject an obvious issue
  just for a missing link. Close completed or already-fixed work as **COMPLETED**, and close only
  confirmed non-bugs or duplicates as **NOT_PLANNED**.

## 2. Claim it

Comment, then assign yourself, both as the agent identity (AGENTS.md, "GitHub identity"), inside
`rsps-shell`:

```sh
gh issue comment <N> --repo RSPSApp/tsps --body "Claiming this one — working on a fix now."
gh issue edit <N> --repo RSPSApp/tsps --add-assignee @me
```

`@name` in a comment notifies that person; only use it for a real login you mean to notify.

## 3. Set up a worktree and server

```sh
scripts/wt new fix/<N>-<short-name>          # inside rsps-shell: it fetches over SSH
grep AGENT_MCP_PORT ../tsps-fix-<N>-<short-name>/.env
```

- **Check the `.env` before starting anything.** Without it a server binds the main checkout's
  ports.
- **Server only:** `cd server && AGENT_MCP=1 yarn dev`. nodemon restarts it on every edit, so
  give it 1–2 minutes to come back.
- **Screenshots:** run the full stack, `AGENT_MCP=1 yarn start` from the worktree root. Without
  the client the vision tools fail with "no WebGPU-capable Chromium found". The vision player
  must be logged out of the MCP first; the tool logs it in (password `vision1234`).
- **Only touch your own server.** Never stop or connect to another worktree's.

## 4. Fix it, and prove it

- **Reproduce first.** Use `scripts/agents/mcp` (or a native MCP client) on your worktree's
  port: `login`, `command` (`tele`, `item`, `master`, `quest …`), `object_option`,
  `npc_option`, `inventory_option`, `dialogue_*`, `can_attack`, `wait_ticks`, `observe`
  ([server/docs/agents/testing.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/testing.md)). Write down the
  before-state.
- **Fix the root cause** where every caller goes through, in the smallest diff that follows the
  module's existing pattern.
- **Show it fixed** with the same calls, and leave one focused test where the logic is
  non-trivial.

Where behaviour comes from, in this order (server/AGENTS.md rules 9, 10 and 16):

1. **Recordings beat everything.** If a plugin comment or data note cites an rsprox capture
   (`rsprox 4001`, `capture 3333`), that's live behaviour: don't overwrite it with a guess. Public
   recordings: <https://rsprox.net/database>.
2. **The cache** for ids, sequences and loc placements (`yarn dump:loc`, `dump:cs2`,
   `sequence-names.json`, `scripts/lookup-gameval.ts`).
3. **The OSRS Wiki** for rules, messages and transcripts. Quote messages exactly; if the Wiki has
   no wording, say so in the PR rather than inventing one.
4. **Generated data** (`npc-dialogues.json`, drops, shops, examines) is never hand-edited, not
   even one table. Fix the dumper in `../osrsreboxed-db` in its own worktree, regenerate, import.
   If the committed data already carries what you need (a Wiki footnote in a drop's `notes`),
   read it at runtime instead.

## 5. Close it fully

The goal is closed bugs, not partially closed ones.

- **Fix every part of the issue.** Don't split hard parts into a follow-up issue. "Needs a
  capture" means look for one first (rsprox, captures cited in the code).
- **If it really can't be done** (no recording, cache, CS2 or Wiki source exists), ship what's
  real with `Refs #N`. Then comment on the issue with exactly what evidence would finish it, and
  unassign yourself.
- **If it already works** (it matches a capture, or someone else fixed it), close it as
  **COMPLETED** with a comment that cites the evidence or the PR.
- **Keep plausible bugs open.** If the report looks like a real defect but the exact expected
  behavior, values, timing or messages are missing, don't close it. Comment with the precise
  evidence needed (for example, "an rsprox capture of this door being used" or "the cache/CS2
  value that defines the result"), apply `needs-evidence` (or `capture-needed` when a recording
  is the specific missing piece), and leave it unassigned or hand it back. Native detail or a
  reproduction not being available is not a reason to close.
- **Close confirmed non-bugs and duplicates as NOT_PLANNED.** Use **NOT_PLANNED** only when the
  report is confirmed not to describe a defect against any supported behavior, or is a duplicate.
  Completed or fixed work closes as **COMPLETED** (above), not **NOT_PLANNED**. State the precise
  reason and evidence.
- **Separate capture-needed from needs-evidence.** If the behavior is established and only a
  recording of the exact values, timing or messages is missing, label `capture-needed` and say
  what to capture. If the behavior is plausible but the source or reproduction is unclear, use
  `needs-evidence` and ask for the missing rsprox/Wiki/cache/code reference. Never use either
  label for a confirmed non-bug.
- **Keep these open:** obvious source-backed defects, supported capture-dependent work and
  approved feature roadmap requests.

## 6. Review before you ship

Agent-written diffs, yours or a sub-worker's, often break the same rules. Check:

- [ ] Plugins reach core only through `api.core`; add missing classes to `getCoreApi()`.
- [ ] `register` is attach-only: one line per hook, no loops or closures with bodies.
- [ ] `api.persistAttribute(KEY, startValue)` passes the starting value.
- [ ] Commands declare their rank; handlers don't check rights.
- [ ] No message, timing or id is invented; each is cited or flagged in the PR.
- [ ] No generated JSON changed by hand.
- [ ] `dependsOn` lists no members-only plugin (KeyChests, TheatreOfBlood …): on free-to-play
      worlds those are filtered out first, and your plugin silently disappears with them.
- [ ] A client feature doesn't fetch `/api/world`; it's development-only. Serve what you need
      through the public content API.

## 7. Ship it

```sh
scripts/agents/ship <commit-message-file> <pr-body-file> "<PR title>"   # inside rsps-shell
```

- **Commit message:** end with the attribution line your harness asks for. The PR body says
  `Fixes #N` for each issue it closes. `ship` warns if GitHub didn't link them.
- **PR body:** cause, change, the exact MCP calls with before and after results, the tests you
  ran, and anything unverified.
- **Stop your server** once the PR is open.

## 8. After the PR

```sh
scripts/agents/watch-prs <PR>...     # comments, reviews, new commits, merges
scripts/agents/watch-issues          # new issues while you work
scripts/agents/prune-worktrees       # dry run; --yes removes merged, clean, stopped worktrees
```

- **A reviewer's commit on your branch** means they're repairing it. Read their comment and
  don't push over them.
- **Review findings with no repair:** fix them on the branch, push, and say what changed.
- **Once merged:** check the issue closed (`gh issue view <N> --json state`), then remove the
  worktree (`scripts/wt rm <branch>` or `prune-worktrees --yes`).

## Running sub-workers

An orchestrating agent can hand one issue to a cheaper worker. Give the worker its worktree, its
MCP port and the issue. Tell it to read this file, server/AGENTS.md and testing.md, and not to
commit, push or comment. The orchestrator reviews the diff (section 6) and ships it.

- **opencode runs can stall** for 20+ minutes when other sessions use opencode too. Watch for its
  `step=` lines in `~/.local/share/opencode/log/opencode.log`, and switch to another worker if
  they stop.
- **One worker per worktree.** Two editing the same tree clash.
