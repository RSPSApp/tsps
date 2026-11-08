# Cleanup and safe retirement

**Every completion, merge and sweep:** clean unused task-owned worktrees and scratch.
Check free space before allocation; reserve enough for builds, runtime and saved evidence.
Never omit required visual proof merely to save disk.

## Remove disposable work, preserve unique work

- Stop only owned server, watcher-parent and browser descendants. Closed ports alone
  don't prove they exited; verify commands, working directories and consumers.
- Preserve patches/new files, original refs, receipts, logs, captures and private saves
  before removing source views. Keep unresolved work transferable.
- Remove owned regenerable builds/caches when no process, reviewer, symlink or Git
  alternate needs them. A stopped server does not release reviewer dependency holds.
  Prefer stable shared immutable dependencies where the environment supports them.
- Copied Webpack packs can be named `development-*` / `default-development`
  directly in client/node_modules/.cache. Check physical paths; never follow links
  out of the candidate or delete shared packages.
- Credentials, configurations, skills, chats/history, live databases and controller
  state are not scratch, regardless of their parent directory.
- Record removed paths and measured free space. Copy-on-write file sizes don't equal
  recovered bytes. If durable writes fail, stop allocation/mutations and reconcile
  in-flight actions before retrying.

## Runtime worktree retirement gate

Use repository worktree tooling and available cleanup guards. No private host script
or fixed installation path is required; preserve these checks whichever tooling is used.

1. **Worker archives; leaves checkout intact.** Stop writers. Preserve checkout-relative
   environment files, every save and unique ignored input in an owner-only archive.
   Verify hash, extraction and members. Handle only exact SQLite/WAL/SHM names as
   database files; players.sqlite.pid, for example, is still an ordinary save.
2. Back up SQLite through its backup API; check extracted integrity and logical equality
   against the WAL-aware source. Later writes require a new archive. Never use immutable
   source reads or permission changes to evade checks. If absent, prove database absence.
3. An alternative stopped-source copy requires no writers, consumers, WAL or journal;
   fence source bytes and verify private-copy integrity and logical equality.
   Record digest algorithm/encoding; raw WAL changes alone don't prove saved-data changes.
4. **Coordinator verifies, then retires.** Recheck archive contents, released reviewer/
   dependency holds, exact clean head and fresh merged-head coverage, including squash
   merges. Record authorization, remove through worktree tooling, retain the actual
   removal receipt and reconcile ownership.
5. Any failed archive/check stops removal. No unconditional deletion fallback.
   Never fabricate lost-save proof; report loss and preserve what remains.

Abandoned unpublished work additionally needs terminal ownership, archive authorization,
HEAD contained in fresh main and verified absence of a PR/remote branch. Don't move HEAD
or attach an unrelated merged PR to satisfy checks. Owned superseded dirty investigations
need explicit retirement scope plus a verified full source/input archive. Source-only views
can record verified absence of private inputs.

Keep active controllers and foreign worktrees intact. Update assignments only after
verified removal. Missing historical records alone neither authorize deletion nor forbid
cleanup when ownership, exact head, archive and consumer checks establish eligibility.
