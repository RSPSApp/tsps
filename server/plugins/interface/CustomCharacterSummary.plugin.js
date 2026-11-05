const attachSummary = require("./sidejournaldefaults/Summary.SideJournalDefaults");

function attachExplicitSummary(api) {
  // The legacy disabledPlugins list enables omitted plugins; this feature still needs opt-in.
  const world = api.core.WorldDefinition?.readWorldConfig?.() ?? {};
  if (world.plugins?.CustomCharacterSummary === true) attachSummary(api);
}

module.exports = {
  name: "CustomCharacterSummary",
  enabled: false,
  dependsOn: ["SideJournalDefaults"],
  register(api) {
    attachExplicitSummary(api);
  },
};
