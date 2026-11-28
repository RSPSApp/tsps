const { editorGenerationPath } = require("../../world/EditorGeneration");
// Shared editor planning logic; the MCP layer adds world mutations.
module.exports = require(editorGenerationPath("buildings/StructureRecipes.js"));
