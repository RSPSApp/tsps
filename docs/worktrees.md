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

Each worktree gets a slot from 1 to 99, written into a marked block in its root `.env`:

| | Client | Game (WebSocket) | Agent MCP | Gateway (official client) | World config page |
| --- | --- | --- | --- | --- | --- |
| Main checkout | 3000 | 43594 | 49700 | 43595 | 49600 |
| Slot N | 3100 + N | 43700 + N | 49800 + N | 43900 + N | 49600 + N |

- **The client** connects to its own slot's server by default, under the branch's name on the
  login screen. Each port is its own browser origin, so each tab remembers its own login.
- **The gateway** ([runelite-gateway/README.md](https://github.com/RSPSApp/tsps/blob/main/runelite-gateway/README.md)) listens on `GATEWAY_PORT` for the
  official client through RSProx.
- **RSProx** takes its own listening ports counting up from `proxy.port.min` in
  `~/.rsprox/proxy.properties`. Current RSProx defaults it to 43701 (and moves an older 43601
  there), which is where the slots' game ports start. If you run RSProx beside worktrees, set
  `proxy.port.min` to a range no slot uses, such as 44000, while RSProx is closed.
- **The world config page** listens on `WORLD_ADMIN_PORT`, on 127.0.0.1 only. A worktree
  slotted before that port existed has no `WORLD_ADMIN_PORT` line; the server then uses
  49600 + `WT_SLOT`, and `scripts/wt slot` adds the line. The server prints the page's link at
  startup; see
  [server/README.md](https://github.com/RSPSApp/tsps/blob/main/server/README.md#world-config-page).
- **Voice** signalling uses the authenticated game connection, so it needs no separate port.
- **`BROWSER=none`** stops `yarn start` opening a tab per worktree.
- **The agent MCP** is registered as `tsps` with `claude mcp add -s local`, run in the worktree.
  Claude Code keeps a git worktree's local MCP config under the main checkout's project, though,
  so there is one `tsps` entry for every checkout: the last `scripts/wt new` or `scripts/wt slot`
  points it at that slot's port, and `scripts/wt rm` removes it. Run `claude mcp get tsps` to
  see where it points. To reach a worktree's own server whatever the entry says, use
  `scripts/agents/mcp` from that worktree (it reads `AGENT_MCP_PORT` from its `.env`; see
  [testing.md](https://github.com/RSPSApp/tsps/blob/main/server/docs/agents/testing.md)). To
  point the entry back at the main checkout:
  `claude mcp remove tsps -s local && claude mcp add -s local --transport http tsps http://127.0.0.1:49700/mcp`.
- **Your settings** in `.env` outside the block are kept. Don't copy a `.env` with
  `WEBRTC_WORLD_TOKEN` into a worktree, or every branch registers as the same public world.

## Set-up cost

- **`node_modules` and `server/caches`** are copied from the main checkout as copy-on-write
  clones (APFS, btrfs), so they're instant and take no space until they change. Run
  `npm run setup` in the worktree if the branch changes dependencies.
- **Player saves** live in the worktree's `server/data/`, so each branch starts with its own
  accounts.
- **An existing worktree** gets a slot with `scripts/wt slot <path>`.
