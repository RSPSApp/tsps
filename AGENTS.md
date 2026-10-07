# AGENTS.md

Server rules and plugin conventions are in [server/AGENTS.md](server/AGENTS.md).

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
