// Load testing: log in many headless players and keep them moving, so an optimisation can be
// measured (perf_sample) before and after under the same load. These are real logged-in
// players, not bots - World skips onPlayerProcess and NPC aggression for bots, so bots would
// never exercise the paths being measured. Accounts are never saved.
const SKIP_PERSISTENCE_ATTRIBUTE = "bot-skip-persistence"; // honoured by World/Player saves
const LOAD_PASSWORD = "loadtest";
const MAX_LOAD_PLAYERS = 2000;
const LOGIN_BATCH = 25;
const TILE_PROBES = 20;

// Module scope, not per request: the MCP server is rebuilt for every call.
const loadPlayers = new Map(); // username -> { player, x, y, z, radius, wanderChance }
let wanderTimer = null;

module.exports = function registerLoadTools(ctx) {
  const { core, tool, z } = ctx;
  const { World, Location, RegionManager, GameConstants } = core;

  const randomTile = (x, y, plane, radius) => {
    for (let probe = 0; probe < TILE_PROBES; probe++) {
      const tile = new Location(
        x + Math.floor(Math.random() * (radius * 2 + 1)) - radius,
        y + Math.floor(Math.random() * (radius * 2 + 1)) - radius,
        plane,
      );
      if (!RegionManager.blocked(tile, null)) return tile;
    }
    return new Location(x, y, plane);
  };

  const online = (username, entry) => World.getPlayerByName(username) === entry.player;

  const wander = () => {
    for (const [username, entry] of loadPlayers) {
      if (!online(username, entry)) {
        loadPlayers.delete(username);
        continue;
      }
      if (Math.random() >= entry.wanderChance || entry.player.getMovementQueue?.()?.hasPendingWork()) continue;
      const tile = randomTile(entry.x, entry.y, entry.z, entry.radius);
      core.dispatchClientMessages(entry.player, [
        { type: "move", worldX: tile.getX(), worldY: tile.getY(), modifierFlags: 0 },
      ]);
    }
    if (loadPlayers.size === 0) {
      clearInterval(wanderTimer);
      wanderTimer = null;
    }
  };

  const nextIndex = (prefix) => {
    let index = 0;
    for (const username of loadPlayers.keys()) {
      if (username.startsWith(prefix)) index = Math.max(index, Number(username.slice(prefix.length)) || 0);
    }
    return index + 1;
  };

  const loginOne = async (username, spec) => {
    const { player, error } = await core.connectHeadlessClient(username, LOAD_PASSWORD);
    if (!player) return error;
    player.setAttribute(SKIP_PERSISTENCE_ATTRIBUTE, true);
    player.moveTo(randomTile(spec.x, spec.y, spec.z, spec.radius));
    loadPlayers.set(username, { player, ...spec });
    return null;
  };

  tool(
    "load_spawn",
    "Log in `count` headless real players (named prefix1, prefix2, ...) scattered within `radius` tiles of x/y/z, optionally wandering. They run every per-player hook a real player does, are never saved, and stay until load_despawn. Call repeatedly to add load in several places.",
    {
      count: z.number().int().min(1).max(500),
      x: z.number().int(), y: z.number().int(), z: z.number().int().min(0).max(3).default(0),
      radius: z.number().int().min(0).max(64).default(10),
      wanderChance: z.number().min(0).max(1).default(0.1).describe("Chance per tick that an idle player walks somewhere new; 0 stands still"),
      prefix: z.string().regex(/^[a-z]{1,6}$/).default("load"),
    },
    async ({ count, x, y, z: plane, radius, wanderChance, prefix }) => {
      if (loadPlayers.size + count > MAX_LOAD_PLAYERS) {
        throw new Error(`At most ${MAX_LOAD_PLAYERS} load players; ${loadPlayers.size} already online`);
      }
      const spec = { x, y, z: plane, radius, wanderChance };
      const first = nextIndex(prefix);
      const errors = [];
      for (let start = 0; start < count; start += LOGIN_BATCH) {
        const names = [];
        for (let i = start; i < Math.min(start + LOGIN_BATCH, count); i++) names.push(`${prefix}${first + i}`);
        const results = await Promise.all(names.map((name) => loginOne(name, spec)));
        results.forEach((error, i) => error && errors.push(`${names[i]}: ${error}`));
      }
      if (!wanderTimer && loadPlayers.size > 0) {
        wanderTimer = setInterval(wander, GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE);
        wanderTimer.unref?.();
      }
      return {
        spawned: count - errors.length,
        failed: errors.length,
        errors: errors.slice(0, 5),
        loadPlayers: loadPlayers.size,
        playersOnline: World.getPlayers().stream().filter(Boolean).length,
      };
    }
  );

  tool(
    "load_despawn",
    "Log out load players spawned by load_spawn: those with this prefix, or all of them.",
    { prefix: z.string().regex(/^[a-z]{1,6}$/).optional() },
    ({ prefix }) => {
      let removed = 0;
      for (const [username, entry] of loadPlayers) {
        if (prefix && !username.startsWith(prefix)) continue;
        if (online(username, entry)) entry.player.requestLogout();
        loadPlayers.delete(username);
        removed++;
      }
      return { removed, loadPlayers: loadPlayers.size };
    }
  );

  tool(
    "load_status",
    "How many load players are online, grouped by spawn spot.",
    {},
    () => {
      const spots = new Map();
      for (const [username, entry] of loadPlayers) {
        if (!online(username, entry)) continue;
        const key = `${entry.x},${entry.y},${entry.z} r${entry.radius} wander=${entry.wanderChance}`;
        spots.set(key, (spots.get(key) ?? 0) + 1);
      }
      return {
        loadPlayers: [...spots.values()].reduce((sum, n) => sum + n, 0),
        playersOnline: World.getPlayers().stream().filter(Boolean).length,
        spots: Object.fromEntries(spots),
      };
    }
  );
};

module.exports.loadPlayerCount = () => loadPlayers.size;
