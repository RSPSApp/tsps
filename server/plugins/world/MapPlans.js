const { editorGenerationPath } = require("./EditorGeneration");
// Legacy agent/API adapter: the canonical planner and bundled assets live in the editor.
const plans = require(editorGenerationPath("buildings/MapPlans"));
const { readCatalog } = require("../agent/mcp/EditBuild.AgentMcp");
const { readStyles } = require("../agent/mcp/EditStyles.AgentMcp");
const { readSets } = require("../agent/mcp/EditGenerators.AgentMcp");
const { sizeOf } = require("../agent/mcp/EditSizes.AgentMcp");
const options = { readCatalog, readStyles, readSets, sizeOf };
module.exports = {
  catalog: () => plans.catalog(options),
  preview(core, query) {
    return plans.preview(query, id => {
      const def = core.ObjectDefinition.forId(id);
      return { sizeX: def?.getSizeX?.() ?? 1, sizeY: def?.getSizeY?.() ?? 1 };
    }, options);
  },
};
