const attachSummary = require("./sidejournaldefaults/Summary.SideJournalDefaults");

function attachExplicitSummary(api) {
  // The legacy disabledPlugins list enables omitted plugins; this feature still needs opt-in.
  const world = api.core.WorldDefinition?.readWorldConfig?.() ?? {};
  if (world.plugins?.CustomCharacterSummary === true) attachSummary(api);
}

module.exports = {
  name: "CustomCharacterSummary",
  description: "Our own Character Summary tab for the side journal. Off unless the world turns it on; needs SideJournalDefaults.",
  enabled: false,
  dependsOn: ["SideJournalDefaults"],
  register(api) {
    attachExplicitSummary(api);
  },
};
