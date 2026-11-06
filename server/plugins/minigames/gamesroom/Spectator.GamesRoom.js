'use strict';
const Screen = require('./Interface.GamesRoom');
const { GAMES } = require('./Games.GamesRoom');
const views = new Map();
const audiences = new Map();
let core, services;

function viewOf(player) { return views.get(player)?.match; }
function leave(player, close = false) {
  const view = views.get(player);
  if (!view) return;
  views.delete(player);
  const audience = audiences.get(view.match);
  audience?.delete(player);
  if (!audience?.size) audiences.delete(view.match);
  if (close && player.getInterfaceId() === Screen.group(view.match.game)) {
    player.getPacketSender().sendInterfaceRemoval();
  }
}
function viewGame(event) {
  const { player, object } = event;
  const match = services.matchAt(object);
  if (!match) return false;
  if (!services.available(player) || match.players.includes(player)
      || player.getPrivateArea() !== object.getPrivateArea()) return;
  // The production object route owns reach/pathing and rejects replaced locs.
  // Match lookup additionally requires the exact live allocation, not a nearby
  // player or a lookalike table at the same coordinates.
  if (core.MapObjects.getPrivateArea(player, object.getId(), object.getLocation()) !== object) return;
  leave(player);
  services.prepare(player);
  Screen.showSpectator(player, match);
  views.set(player, { match, position: player.getLocation().clone() });
  let audience = audiences.get(match);
  if (!audience) audiences.set(match, audience = new Set());
  audience.add(player);
}
function refresh(match) {
  for (const player of [...(audiences.get(match) ?? [])]) {
    if (!valid(player)) { leave(player, true); continue; }
    Screen.refreshSpectator(player, match);
  }
}
function valid(player) {
  const view = views.get(player);
  return view && player.isRegistered() && player.getHitpoints() > 0
    && player.getLocation().equals(view.position)
    && player.getInterfaceId() === Screen.group(view.match.game)
    && player.getPacketSender().isSubInterfaceOpen(Screen.group(view.match.game));
}
function process(player) { if (views.has(player) && !valid(player)) leave(player, true); }
function click(event) {
  const match = viewOf(event.player);
  if (!match) return false;
  // Consume every board/options action while viewing, including forged player
  // actions. The viewer never enters Runtime's player match or result maps.
  if (!Object.keys(GAMES).flatMap(game => [Screen.group(game), Screen.optionsGroup(game)])
    .includes(event.buttonId >>> 16)) return false;
  event.handled = true;
  if ((event.opId ?? event.action) === 1 && valid(event.player)
      && event.buttonId === Screen.component(`boardgames_${match.game}:close`)) leave(event.player, true);
  return true;
}
function closed({ player, interfaceId }) {
  const match = viewOf(player);
  if (match && interfaceId === Screen.group(match.game)) leave(player);
}
function opened({ player, groupId, targetUid }) {
  const match = viewOf(player);
  if (match && targetUid === core.CacheDefinitions.getComponentId('toplevel_osrs_stretch:mainmodal')
      && groupId !== Screen.group(match.game)) leave(player);
}
function shutdown() { for (const player of [...views.keys()]) leave(player, true); }
function attach(api, runtime) {
  core = api.core; services = runtime;
  api.onObjectInteraction('Table', { 'View-game': viewGame });
}
module.exports = { attach, viewOf, leave, refresh, process, click, closed, opened, shutdown };
