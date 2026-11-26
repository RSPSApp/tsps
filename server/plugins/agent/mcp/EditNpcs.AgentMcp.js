const path = require("path");
const { createNpcSpawnStore } = require("./EditSpawnStore.AgentMcp");

// NPC spawning tools for the agent MCP server: search the NPC cache, describe
// definitions, and spawn/remove live NPCs. Spawns persist in
// data/definitions/npc-spawns.json, so they survive restarts and show up in the ?edit
// map editor (spawn overlay after a sync, full scene for cache-map NPCs).
// spawn_npc caps wanderRadius here; remove_npc searches this far for a spawn-tile match.
const MAX_WANDER = 32;

module.exports = function registerEditNpcTools(ctx) {
  const { core, tool, z, sleepTicks } = ctx;
  const { World, NPC, NpcDefinition, CacheDefinitions, Location } = core;

  // Overridable for tests; the server resolves it against its own working directory.
  const spawnsFile = () =>
    process.env.AGENT_MCP_NPC_SPAWNS_FILE ??
    path.resolve(process.cwd(), "data/definitions/npc-spawns.json");

  // Format-preserving read/write (line endings, one entry per line) lives in the
  // shared store, so this toolset and Edit.AgentMcp.js cannot drift.
  const store = () => createNpcSpawnStore(spawnsFile());
  const readSpawns = () => store().read();
  const writeSpawns = (spawns) => store().write(spawns);

  const sameTile = (entry, x, y, z) => entry?.x === x && entry?.y === y && (entry?.level ?? 0) === z;

  const npcCount = () => CacheDefinitions.getCounts().npcs;

  const checkTile = (x, y, z) => {
    for (const [name, value] of [["x", x], ["y", y]]) {
      if (!Number.isInteger(value) || value < 0 || value > 16383) {
        throw new Error(`Tile ${name}=${value} is outside the world (0-16383)`);
      }
    }
    if (!Number.isInteger(z) || z < 0 || z > 3) throw new Error(`Plane z=${z} is outside 0-3`);
  };

  tool(
    "search_npcs",
    "Find NPCs by name: guards, goblins, shopkeepers, fishing spots. Matches substrings case-insensitively; a numeric query matches ids by prefix. Returns up to `limit` {id, name} pairs for spawn_npc.",
    { query: z.string().min(1).describe("Name fragment (e.g. \"guard\") or id prefix"), limit: z.number().int().min(1).max(50).default(20) },
    ({ query, limit }) => {
      const trimmed = query.trim().toLowerCase();
      const byId = Number(trimmed);
      const results = [];
      const total = npcCount();
      for (let id = 0; id < total; id++) {
        let entry;
        try {
          entry = CacheDefinitions.getNpc(id);
        } catch {
          continue;
        }
        const name = entry?.name;
        if (!name || name === "null") continue;
        if (Number.isInteger(byId) && byId >= 0) {
          if (id !== byId && !String(id).startsWith(trimmed)) continue;
        } else if (!name.toLowerCase().includes(trimmed)) {
          continue;
        }
        results.push({ id, name });
        if (results.length >= limit) break;
      }
      return { query, count: results.length, results };
    }
  );

  tool(
    "describe_npc",
    "NPC definition details for spawning well: combat level, size, whether it can be attacked, and its options.",
    { id: z.number().int().min(0).describe("NPC id from search_npcs") },
    ({ id }) => {
      if (id >= npcCount()) throw new Error(`Unknown NPC id ${id}`);
      const definition = NpcDefinition.forId(id);
      return {
        id,
        name: definition.getName(),
        combatLevel: definition.getCombatLevel(),
        size: definition.getSize(),
        attackable: definition.isAttackable(),
        aggressive: definition.isAggressive(),
        options: definition.getActions() ?? [],
      };
    }
  );

  tool(
    "spawn_npc",
    "Spawn an NPC live in the main world: every online player (and the ?edit map editor after Refresh) sees it at once. Persists to npc-spawns.json, so it survives restarts. wanderRadius 0 roots it to its tile.",
    {
      id: z.number().int().min(0).describe("NPC id from search_npcs"),
      x: z.number().int().describe("World tile x"),
      y: z.number().int().describe("World tile y"),
      z: z.number().int().min(0).max(3).default(0).describe("Plane, 0 is ground level"),
      wanderRadius: z.number().int().min(0).max(MAX_WANDER).default(5),
      leashRadius: z.number().int().min(0).max(255).optional().describe("Maximum chase distance from the spawn"),
    },
    async ({ id, x, y, z = 0, wanderRadius = 5, leashRadius }) => {
      checkTile(x, y, z);
      if (id >= npcCount()) throw new Error(`Unknown NPC id ${id}; search_npcs finds valid ids`);
      const definition = NpcDefinition.forId(id);
      const npc = NPC.create(id, new Location(x, y, z));
      npc.getMovementCoordinator().setRadius(wanderRadius);
      if (leashRadius !== undefined) {
        if (!Number.isInteger(leashRadius) || leashRadius < wanderRadius || leashRadius > 255) {
          throw new Error("leashRadius must be at least wanderRadius and at most 255");
        }
        npc.getMovementCoordinator().setLeashRadius(leashRadius);
      }
      World.getAddNPCQueue().push(npc);
      // Registration runs on the next tick; wait so observe-style reads see it.
      await sleepTicks(1);
      const spawns = readSpawns();
      const already = store().find(spawns, id, x, y, z) !== undefined;
      if (!already) {
        spawns.push({
          level: z, name: definition.getName(), x, y, id, wanderRadius,
          ...(leashRadius === undefined ? {} : { leashRadius }), source: "agent-mcp",
        });
        writeSpawns(spawns);
      }
      return { spawned: { id, name: definition.getName(), x, y, z, wanderRadius, ...(leashRadius === undefined ? {} : { leashRadius }) }, persisted: !already };
    }
  );

  tool(
    "remove_npc",
    "Remove live NPC(s) standing on, or spawned on, a tile (optionally only this id) and drop their persisted spawns, so they stay gone after a restart. Give the spawn tile from list_spawned_npcs: a wandering NPC is found wherever it walked to. NPCs that come from the cache map rather than the spawn file return on restart.",
    {
      x: z.number().int().describe("World tile x"),
      y: z.number().int().describe("World tile y"),
      z: z.number().int().min(0).max(3).default(0),
      id: z.number().int().min(0).optional().describe("Only remove this NPC id"),
    },
    ({ x, y, z = 0, id }) => {
      checkTile(x, y, z);
      const onTile = (location) => location?.getX() === x && location.getY() === y && location.getZ() === z;
      // Spawns wander up to MAX_WANDER tiles from their spawn point, so a spawn-tile
      // match has to look that far; matching only the current tile races the NPC.
      const matches = World.getNpcsNear(new Location(x, y, z), MAX_WANDER, null)
        .filter((npc) => id === undefined || npc.getId() === id)
        .filter((npc) => onTile(npc.getLocation()) || onTile(npc.getSpawnPosition?.()));
      if (matches.length === 0) {
        const present = World.getNpcsNear(new Location(x, y, z), 2, null)
          .map((npc) => ({ id: npc.getId(), x: npc.getLocation().getX(), y: npc.getLocation().getY() }));
        throw new Error(
          `No matching NPC on ${x},${y},${z}; nearby: ${JSON.stringify(present.slice(0, 10)) || "none"}`,
        );
      }
      const spawns = readSpawns();
      let changed = false;
      const removed = [];
      for (const npc of matches) {
        World.getRemoveNPCQueue().push(npc);
        const at = npc.getLocation();
        removed.push({ id: npc.getId(), x: at.getX(), y: at.getY(), z: at.getZ() });
        // The file records the spawn tile, not where the NPC has wandered to.
        const spawn = npc.getSpawnPosition?.() ?? at;
        for (let i = spawns.length - 1; i >= 0; i--) {
          const entry = spawns[i];
          if (entry.id === npc.getId() && sameTile(entry, spawn.getX(), spawn.getY(), spawn.getZ())) {
            spawns.splice(i, 1);
            changed = true;
          }
        }
      }
      if (changed) writeSpawns(spawns);
      return {
        removed,
        persisted: changed,
        note: changed
          ? undefined
          : "No spawn-file entry covered these; they are gone for this session and return on restart.",
      };
    }
  );

  tool(
    "list_spawned_npcs",
    "NPCs persisted in npc-spawns.json (the file the ?edit editor overlays). Filter by source: agent-mcp entries are this toolset's, others are hand- or capture-made.",
    { source: z.string().optional().describe("Only entries with this source tag") },
    ({ source }) => {
      const spawns = readSpawns().filter((entry) => source === undefined || entry.source === source);
      return { count: spawns.length, npcs: spawns };
    }
  );
};
