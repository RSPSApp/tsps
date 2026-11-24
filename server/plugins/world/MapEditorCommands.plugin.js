const { reloadSavedMap } = require("./SavedMapReload");

let core;

function reloadMap({ player, parts }) {
  try {
    const regionIds = parts.slice(1);
    if (!regionIds.length || regionIds.length > 12 || regionIds.some((id) => !/^\d{1,5}$/.test(id))) {
      throw new Error("Usage: ::reloadmap region [region ...]");
    }
    for (const id of new Set(regionIds.map(Number))) {
      const result = reloadSavedMap(core, id);
      player.sendMessage(`Region ${id} loaded. Updated ${result.clientsUpdated} connected clients.`);
      if (result.clientsFailed) {
        player.sendMessage(`${result.clientsFailed} clients could not receive region ${id}. They can relog to pick it up.`);
      }
    }
  } catch (error) {
    player.sendMessage(String(error.message ?? error));
  }
  return true;
}

module.exports = {
  name: "MapEditorCommands",
  description: "Lets the world owner load saved map packs without restarting.",
  register(api) {
    core = api.core;
    api.registerCommand("reloadmap", reloadMap, core.PlayerRights.OWNER, "Load a saved map pack");
  },
};
