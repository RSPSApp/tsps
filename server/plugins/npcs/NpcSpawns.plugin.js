const fs = require("fs");
const path = require("path");

const CUSTOM_NPC_SPAWNS_FILE = "data/definitions/npc-spawns-custom.json";

/** The map editor's spawn patch; absent until the editor has exported one. */
function loadCustomNpcSpawns() {
  const file = path.resolve(process.cwd(), CUSTOM_NPC_SPAWNS_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

module.exports = {
  name: "NpcSpawns",
  description: "Registers the NPC spawn list and the map editor's custom spawn patch as definition sources.",
  register(api) {
    api.registerDefinitionSource("npc_spawns", "data/definitions/npc-spawns.json");
    api.registerDefinitionSource("npc_spawns", {
      name: "editor-custom",
      priority: 200,
      load: loadCustomNpcSpawns,
    });
  },
};
