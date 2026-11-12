/** Jailed-member native viewing. Wiki15201300; cache242 LOC26741/UI93/scripts562..567.
 * Quarter-map camera positions are our presentation choice, not recorded retail coordinates.
 */
const C = require("./Common.ClanWars");
const active = new Map();
const BUTTONS = ["central", "sw", "se", "nw", "ne"];
const FRACTIONS = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
const OP1 = 1 << 1;
const ORB_MODEL = 9752; // Rev242 clanwars_viewing_start_darkrock model.

function ownedOrb(game, object) {
  if (!object || object.getId() !== C.core.CacheDefinitions.getLocId("clanwars_viewing_start_darkrock")) return false;
  // The native resolver and the template share these exact cached objects. A
  // matching name/id elsewhere is not authority to view this private match.
  for (let x = 0; x < game.area.widthChunks; x++) for (let y = 0; y < game.area.heightChunks; y++) {
    if (game.area.getChunkObjects(0, x, y).includes(object)) return true;
  }
  return false;
}

function admitted(player, game) {
  return C.matches.get(player) === game && game.members.has(player)
    && game.jailed.has(player) && !game.fighters.has(player)
    && game.phase !== "over" && !game.expired() && player.getArea() === game.area
    && player.getHitpoints() > 0 && !player.isDyingReturn();
}
function select(player, state, index) {
  const [fx, fy] = FRACTIONS[index];
  const tile = state.game.area.tile(Math.floor(state.game.area.widthChunks * 8 * fx),
    Math.floor(state.game.area.heightChunks * 8 * fy), 0);
  player.moveTo(tile);
  state.pendingCamera = true;
  state.selection = index;
  player.getPacketSender().sendClientScript(562, index, state.model);
}
function use({ player, object }) {
  const game = C.matches.get(player);
  if (!game) return false;
  if (game.expire()) return true;
  if (!ownedOrb(game, object)) return false;
  if (!admitted(player, game) || player.busy() || active.has(player)) {
    player.sendMessage("Only jailed fighters may use this battle's viewing orb.");
    return true;
  }
  const sender = player.getPacketSender(), camera = sender.getCameraState();
  if (camera.mode === "controlled") {
    player.sendMessage("Finish your current camera scene before using the viewing orb.");
    return true;
  }
  const state = { game, camera, location: player.getLocation().clone(),
    fixedDistance: player.getFixedViewDistance(), hidden: player.isAppearanceHidden(),
    blocked: player.getMovementQueue().isMovementBlocked(), untargetable: player.isUntargetable(),
    model: ORB_MODEL };
  active.set(player, state);
  game.viewers.add(player);
  player.getMovementQueue().reset().setBlockMovement(true);
  player.setUntargetable(true);
  player.setAppearanceHidden(true);
  player.setFixedViewDistance(64);
  sender.sendInterface(C.group("clanwars_view"));
  for (const name of BUTTONS) {
    sender.sendInterfaceFlags(C.uid(`clanwars_view:${name}`), OP1);
    sender.sendInterfaceFlagsRange(C.uid(`clanwars_view:${name}`), 0, 1, OP1);
  }
  select(player, state, 0);
  return true;
}
function stop(player, restorePosition = true) {
  const state = active.get(player);
  if (!state) return false;
  // Relinquish first: close/replacement callbacks can re-enter this cleanup.
  active.delete(player);
  state.game.viewers.delete(player);
  const dying = player.isDyingReturn();
  player.setAppearanceHidden(state.hidden);
  player.setFixedViewDistance(state.fixedDistance);
  // Once dying, PlayerDeathTask owns these locks through its final reset.
  if (!dying) {
    player.getMovementQueue().setBlockMovement(state.blocked);
    player.setUntargetable(state.untargetable);
  }
  if (restorePosition && !dying && C.matches.get(player) === state.game
    && player.getArea() === state.game.area && state.game.phase !== "over") player.moveTo(state.location);
  player.getPacketSender().closeInterface(C.group("clanwars_view"));
  player.getPacketSender().restoreCameraState(state.camera);
  return true;
}
function tick(game) {
  for (const player of [...game.viewers]) {
    const state = active.get(player);
    if (!state) { game.viewers.delete(player); continue; }
    if (!admitted(player, game)) { stop(player); continue; }
    if (state.pendingCamera && !player.isNeedsPlacement()) {
      const at = player.getLocation();
      player.getPacketSender().sendCameraTarget({ x: at.getX(), y: at.getY(), level: at.getZ() });
      state.pendingCamera = false;
    }
  }
}
function clicked(event) {
  const state = active.get(event.player);
  if (!state || event.groupId !== C.group("clanwars_view")) return;
  event.handled = true;
  if ((event.opId ?? 1) !== 1) return;
  if (state.game.expire()) return;
  if (!admitted(event.player, state.game) || event.player.getInterfaceId() !== C.group("clanwars_view")) {
    stop(event.player); return;
  }
  if (event.childId === (C.uid("clanwars_view:com_3") & 65535)) { stop(event.player); return; }
  const index = BUTTONS.findIndex(name => event.childId === (C.uid(`clanwars_view:${name}`) & 65535));
  if (index >= 0 && index !== state.selection
    && (event.slot == null || [0, 1, 65535].includes(event.slot))) select(event.player, state, index);
}
function closed({ player, interfaceId }) { if (interfaceId === C.group("clanwars_view")) stop(player); }
function shutdown() { for (const player of [...active.keys()]) stop(player, false); }
function attach(api) {
  api.onInterfaceActionClick(clicked);
  api.onCustomEvent("interface:closed", closed);
  api.onServerShutdown(shutdown);
}
module.exports = { use, stop, tick, attach, active };
