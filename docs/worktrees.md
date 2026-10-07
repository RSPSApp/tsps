# Worktrees

Run several branches at once, one [git worktree](https://git-scm.com/docs/git-worktree) each, on
their own ports. Testing a branch is then switching browser tab, not stopping, checking out and
rebuilding.

```bash
scripts/wt new feat/my-change     # ../tsps-feat-my-change, slot 1
cd ../tsps-feat-my-change && yarn start
scripts/wt ls                     # every worktree, its URL and whether it's running
scripts/wt rm feat/my-change      # when the branch is merged
```

## Slots

Each worktree gets a slot from 1 to 9, written into a marked block in its root `.env`:

| | Client | Game (WebSocket) | Agent MCP |
| --- | --- | --- | --- |
| Main checkout | 3000 | 43594 | 49700 |
| Slot N | 3100 + N | 43700 + N | 49800 + N |

- **The client** connects to its own slot's server by default, under the branch's name on the
  login screen. Each port is its own browser origin, so each tab remembers its own login.
- **Voice** signalling is off in slots (`VOICE_SIGNAL_PORT=0`); set a free port in `.env` below
  the block to test it.
- **`BROWSER=none`** stops `yarn start` opening a tab per worktree.
- **The agent MCP** is registered as `tsps` for that worktree only (`claude mcp add -s local`),
  so an agent there talks to its own server.
- **Your settings** in `.env` outside the block are kept. Don't copy a `.env` with
  `WEBRTC_WORLD_TOKEN` into a worktree, or every branch registers as the same public world.

## Set-up cost

- **`node_modules` and `server/caches`** are copied from the main checkout as copy-on-write
  clones (APFS, btrfs), so they're instant and take no space until they change. Run
  `npm run setup` in the worktree if the branch changes dependencies.
- **Player saves** live in the worktree's `server/data/`, so each branch starts with its own
  accounts.
- **An existing worktree** gets a slot with `scripts/wt slot <path>`.
