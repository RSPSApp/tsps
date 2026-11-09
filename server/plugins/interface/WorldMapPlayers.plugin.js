// Admins with the world map open see a dot per player, refreshed this often.
const REFRESH_TICKS = 4;
const WORLD_MAP_PLAYERS_DATASET = "worldMapPlayers";

const ticks = new WeakMap();
let core = null;

/** [x, y, plane, isBot] per online player. */
function playerRows() {
  const rows = [];
  core.World.getPlayers().forEach((player) => {
    const loc = player.getLocation();
    rows.push([loc.getX(), loc.getY(), loc.getZ(), player.isPlayerBot?.() === true ? 1 : 0]);
  });
  return rows;
}

function sendPlayerDots({ player }) {
  const sender = player.getPacketSender?.();
  if (!sender?.isWorldMapOpen?.() || !core.PlayerRights.hasAdminRights(player)) {
    ticks.delete(player);
    return;
  }
  const tick = ticks.get(player) ?? 0;
  ticks.set(player, tick + 1);
  if (tick % REFRESH_TICKS === 0) {
    sender.sendContentData("server", [{ key: WORLD_MAP_PLAYERS_DATASET, rows: playerRows() }]);
  }
}

module.exports = {
  name: "World Map Players",
  description: "Gives admins a live dot on the world map for every online player, with bots marked differently, refreshed every few ticks.",
  register(api) {
    core = api.core;
    api.onPlayerProcess(sendPlayerDots);
  },
};
