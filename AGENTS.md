# AGENTS.md

Server rules and plugin conventions are in [server/AGENTS.md](server/AGENTS.md).

## GitHub identity

Run agent commits, pushes and GitHub mutations through `rsps-shell` as `nharrison93`.
Verify `gh api user --jq .login` before mutations. Commit with
`-c user.name=nharrison93 -c user.email=nharrison93@proton.me`.
Use HTTPS pushes with `gh auth git-credential` and verify the credential account;
the default GitHub SSH key can authenticate as `tobywisener` even inside `rsps-shell`.

## Generated data

Manual modifications to `npc-dialogues.json` or **any generated JSON dumped from
[RSPSApp/osrsreboxed-db](https://github.com/RSPSApp/osrsreboxed-db) are strictly forbidden,
including conflict resolutions, one-off repairs and post-dump patches. Fix the source,
parser or export logic in `../osrsreboxed-db`, then regenerate and import its output.
Preserve the fix in the dumper with a regression check; repeat generation from the same
inputs must produce identical content. Resolve generated-file conflicts by regeneration,
and report any remaining difference. Generated files change only through this process.
Inspect the original source and fix parser/runtime bugs at their cause; moving a
repaired output subtree into a dumper override does not satisfy this rule.

## Worktrees

Several agents work at once, each in its own worktree with its own ports. They are in the
worktree's root `.env`, written by `scripts/wt` ([docs/worktrees.md](docs/worktrees.md)). Start
with `yarn start` and never override them; the defaults (3000, 43594, 49700) belong to the main
checkout.

- **Your ports:** `scripts/wt ls` lists every worktree with its branch, client URL, game port
  and agent MCP port. A worktree without a slot gets one with `scripts/wt slot`.
- **Checking your work:** use the agent MCP on your own port
  ([server/docs/agents/testing.md](server/docs/agents/testing.md)). Never connect to another
  worktree's server, or stop it.
- **When it's ready for the user:** end with `Ready to test: http://localhost:<PORT> (<branch>)`
  and what to look at.
- **New worktrees:** `scripts/wt new <branch>`, not plain `git worktree add`; it writes the
  ports and copies `node_modules`.
