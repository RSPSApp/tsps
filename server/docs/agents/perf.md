# Measuring performance

Start the server with the agent MCP enabled, then connect to it:

    AGENT_MCP=1 yarn dev
    claude mcp add --transport http tsps http://127.0.0.1:49700/mcp

In a worktree, `scripts/wt` has already registered `tsps` at that worktree's own
`AGENT_MCP_PORT` (see [docs/worktrees.md](../../../docs/worktrees.md)); never connect to another
worktree's port.

## Before and after a change

1. **Load:** `load_spawn` logs in headless *real* players (bots skip `onPlayerProcess` and NPC
   aggression, so they hide the costs you are measuring). Put them where the code under test
   runs, e.g. `{ count: 200, x: 3100, y: 3600, radius: 30 }` for the Wilderness, and leave
   some load elsewhere so global costs show too. They are never saved.
2. **Before:** `perf_sample { seconds: 60 }` - server tick timings and per-plugin timings for
   exactly that window.
3. Make the change, restart, spawn the same load again.
4. **After:** `perf_sample { seconds: 60 }`, then `load_despawn`.

Compare `server.avgTickMs` and the phases the change touches (`player.process.area`,
`npc_aggression`, `combat.process.can_attack.policy` ...), plus the plugin's own row. Area
methods show up under their plugin as `area:process`, `area:canAttack` and so on.

`server_perf` and `plugin_perf` read the same data without the timed window. `load_status`
shows what load is online.
