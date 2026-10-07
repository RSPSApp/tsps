// The ::serverperf and ::pluginperf numbers, returned as data instead of chat lines.
const { loadPlayerCount } = require("./Load.AgentMcp");

// ServerPerf keeps 300 ticks of samples: 180 seconds at 600 ms a tick.
const MAX_SAMPLE_TICKS = 300;
const MAX_SAMPLE_SECONDS = 180;

module.exports = function registerPerfTools(ctx) {
  const { core, tool, z } = ctx;
  const { ServerPerf, PluginPerf, World, GameConstants } = core;
  const ms = (value) => Math.round(value * 1000) / 1000;
  const tickMs = GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE;

  const serverSummary = (ticks) => {
    const summary = ServerPerf.getSummary(ticks);
    return {
      ...summary,
      avgTickMs: ms(summary.avgTickMs),
      maxTickMs: ms(summary.maxTickMs),
      avgDriftMs: ms(summary.avgDriftMs),
      maxDriftMs: ms(summary.maxDriftMs),
      topPhases: summary.topPhases.map((phase) => ({
        name: phase.name, totalMs: ms(phase.totalMs), avgMs: ms(phase.avgMs), maxMs: ms(phase.maxMs),
      })),
    };
  };

  const pluginRows = (limit) => PluginPerf.snapshot(limit).map((row) => ({
    ...row,
    totalMs: ms(row.totalMs), avgMs: ms(row.avgMs), maxMs: ms(row.maxMs),
    topEventTotalMs: ms(row.topEventTotalMs), topEventAvgMs: ms(row.topEventAvgMs), topEventP95Ms: ms(row.topEventP95Ms),
  }));

  tool(
    "server_perf",
    "Game tick timings over the last N ticks: average/max tick and drift, plus the 20 most expensive phases (e.g. area, npc_aggression, combat.process.can_attack). Always collected.",
    { ticks: z.number().int().min(1).max(MAX_SAMPLE_TICKS).default(60) },
    ({ ticks }) => serverSummary(ticks)
  );

  tool(
    "plugin_perf",
    "Per-plugin hook and area timings since the last reset, most expensive first. Only collected while profiling is on (it adds a little overhead): turn it on, let the server run, then read.",
    {
      profiling: z.enum(["on", "off"]).optional().describe("Start or stop collecting; omit to leave it as is"),
      reset: z.boolean().default(false).describe("Clear collected stats before reading"),
      limit: z.number().int().min(1).max(50).default(15),
    },
    ({ profiling, reset, limit }) => {
      if (profiling) PluginPerf.setEnabled(profiling === "on");
      if (reset) PluginPerf.reset();
      return { profiling: PluginPerf.isEnabled(), plugins: pluginRows(limit) };
    }
  );

  tool(
    "perf_sample",
    "One before/after measurement: clears plugin stats, profiles for `seconds`, then returns server tick timings and per-plugin timings for exactly that window, with the player count. Run it once before a change and once after, under the same load_spawn load.",
    {
      seconds: z.number().int().min(5).max(MAX_SAMPLE_SECONDS).default(30),
      limit: z.number().int().min(1).max(50).default(15),
    },
    async ({ seconds, limit }) => {
      const wasProfiling = PluginPerf.isEnabled();
      PluginPerf.setEnabled(true);
      PluginPerf.reset();
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      const result = {
        seconds,
        playersOnline: World.getPlayers().stream().filter(Boolean).length,
        loadPlayers: loadPlayerCount(),
        server: serverSummary(Math.round((seconds * 1000) / tickMs)),
        plugins: pluginRows(limit),
      };
      if (!wasProfiling) PluginPerf.setEnabled(false);
      return result;
    }
  );
};
