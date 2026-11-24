const fs = require("fs");
const path = require("path");
const { effectiveFile } = require("./MapEditFiles");

function reloadSavedMap(core, regionId) {
  if (!Number.isInteger(regionId) || regionId < 0 || regionId > 65535) throw new Error("Choose a region ID from 0 to 65535");
  const file = effectiveFile(path.resolve("data/regions", `${regionId}.pack`));
  if (!file || !fs.existsSync(file)) throw new Error(`No saved pack for region ${regionId}`);
  const { MapRegionReplacementManager: manager, RegionManager, World } = core;
  const result = manager.replaceMapRegion(regionId, file);
  RegionManager.registerReplacementRegion(regionId);
  if (!RegionManager.reloadRegion(regionId)) throw new Error(`Could not load clipping for region ${regionId}`);
  let clientsUpdated = 0;
  let clientsFailed = 0;
  World.getPlayers().forEach((player) => {
    if (!player || !World.isPlayerSessionConnected(player)) return;
    try {
      if (manager.sendReplacementToPlayer(player, regionId, true)) clientsUpdated++;
      else clientsFailed++;
    } catch {
      clientsFailed++;
    }
  });
  return { ...result, clientsUpdated, clientsFailed };
}

module.exports = { reloadSavedMap };
