/** Shared ownership for the bounded legacy-channel Clan Wars implementation. */
let api;
const matches = new Map();
const negotiations = new Map();
const channelGames = new Map();
const LOBBY = { minX: 3124, maxX: 3135, minY: 3618, maxY: 3631, z: 0 };
const RETURN = [3128, 3629, 0];
const IN_MATCH_ATTRIBUTE = "clan-wars:in-match";

function init(value) { api = value; }
function channel(player) {
  const query = { player };
  api.emitCustomEvent("friends-chat:channel", query);
  return query.channel ?? null;
}
function captain(player) {
  const value = channel(player);
  return value && value.members.includes(player) && value.rankOf(player) >= 5 ? value : null;
}
function inLobby(player) {
  const at = player.getLocation();
  return !player.getPrivateArea() && at.getZ() === LOBBY.z && at.getX() >= LOBBY.minX
    && at.getX() <= LOBBY.maxX && at.getY() >= LOBBY.minY && at.getY() <= LOBBY.maxY;
}
function uid(name) { return api.core.CacheDefinitions.getComponentId(name); }
function group(name) { return api.core.CacheDefinitions.getInterfaceId(name); }
function bit(player, name, value) {
  const id = api.core.CacheDefinitions.getVarbitId(name);
  if (id == null) throw new Error(`Missing cache varbit ${name}`);
  player.getPacketSender().sendVarbit(id, value);
}
function now() { return api.core.World.getProcessCycle(); }
function location(tile) { return new api.core.Location(...tile); }
function live(player) { return api.core.World.getPlayers().search((other) => other === player) === player; }

module.exports = { init, matches, negotiations, channelGames, LOBBY, RETURN, IN_MATCH_ATTRIBUTE,
  channel, captain, inLobby, uid, group, bit, now, location, live,
  get api() { return api; }, get core() { return api.core; } };
