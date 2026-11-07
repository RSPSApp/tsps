// Preset tests need the PvpMode plugin (it owns Presets) whatever a worktree's gitignored
// world.local.json says: test and play worlds often turn PvP off there. Require this before
// PluginManager.loadFromDirectory; it keeps every other world setting as configured.
const WorldDefinition = require("../../dist/game/definition/WorldDefinition");

const readWorldConfig = WorldDefinition.readWorldConfig;
WorldDefinition.readWorldConfig = function readWorldConfigWithPvpMode() {
  const config = readWorldConfig();
  if (config.disabledPlugins !== undefined) {
    const disabled = Array.isArray(config.disabledPlugins) ? config.disabledPlugins : [];
    return { ...config, disabledPlugins: disabled.filter((name) => String(name).toLowerCase() !== "pvpmode") };
  }
  return { ...config, plugins: { ...(config.plugins ?? {}), PvpMode: true } };
};
