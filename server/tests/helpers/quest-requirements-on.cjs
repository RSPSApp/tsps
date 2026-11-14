// Quest-lock tests need quests:equipment-requirements on whatever the world sets: a world may turn
// the requirements off in world.json or the gitignored world.local.json. Require this before
// PluginManager reads plugin config (before PluginManager.loadFromDirectory); it keeps every other
// world setting as configured. Tests of the switched-off world still mock the key themselves.
const WorldDefinition = require("../../dist/game/definition/WorldDefinition");

const KEY = "quests:equipment-requirements";
const readWorldConfig = WorldDefinition.readWorldConfig;
WorldDefinition.readWorldConfig = function readWorldConfigWithQuestRequirements(...args) {
  const config = readWorldConfig(...args);
  const plugins = config.plugins ?? {};
  const quests = plugins.Quests;
  return {
    ...config,
    pluginConfig: { ...(config.pluginConfig ?? {}), [KEY]: true },
    // A scoped "Quests" entry overrides pluginConfig; pin it there too when it sets the key.
    plugins: quests && typeof quests === "object" && "equipment-requirements" in quests
      ? { ...plugins, Quests: { ...quests, "equipment-requirements": true } }
      : plugins,
  };
};
