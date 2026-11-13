"use strict";

const { moveContinuous, WALK_SPEED, MAX_PREDICTION_MS } = require("./ContinuousMotion.FreeMovement");
const states = new WeakMap();
const WORLD_INPUTS = new Set(["move", "teleport", "world_map_click", "npc_option", "object_option",
  "player_option", "ground_item_action", "inventory_use_on", "item_on_player", "item_on_npc",
  "item_on_object", "spell_on_npc", "spell_on_player", "widget_target", "interaction_stop"]);

function snapshot(player, state) {
  return { index: player.getIndex(), seq: state.seq, x: state.x, y: state.y,
    level: state.level, rotation: state.rotation, active: state.active,
    moving: state.moving, running: state.running, blocked: state.blocked, snap: !!state.snap };
}

function sendPosition(core, player, state, forceObservers = false) {
  const packet = core.encodeFinePosition(snapshot(player, state));
  player.getSession().sendClientPacket(packet);
  const now = performance.now();
  if (forceObservers || now - state.broadcastAt >= 100) {
    state.broadcastAt = now;
    for (const observer of player.getLocalPlayers()) {
      if (observer.getPrivateArea() === player.getPrivateArea() &&
          observer.getLocation().getZ() === state.level) observer.getSession().sendClientPacket(packet);
    }
  }
}

function cancel(core, player, state, target = player.getLocation(), snap = false) {
  state.active = state.moving = false;
  player.getMovementQueue().setExternalMovement(false);
  if (snap || Math.floor(state.x / 128) !== target.getX() || Math.floor(state.y / 128) !== target.getY() || state.level !== target.getZ()) {
    state.x = target.getX() * 128 + 64;
    state.y = target.getY() * 128 + 64;
    state.level = target.getZ();
  }
  state.snap = snap;
  sendPosition(core, player, state, true);
  state.snap = false;
}

function input(core, { player, packet }) {
  // Bound input at the trust boundary. No client coordinates or timestamps are accepted.
  if (![packet.seq, packet.dx, packet.dy, packet.rotation, packet.duration].every(Number.isInteger) ||
      packet.seq < 0 || packet.duration < 0 || packet.duration > 40 ||
      Math.abs(packet.dx) > 32767 || Math.abs(packet.dy) > 32767 || packet.rotation < 0 || packet.rotation > 2047) return;
  const location = player.getLocation();
  const now = performance.now();
  let state = states.get(player);
  if (!state) {
    state = { seq: -1, x: location.getX() * 128 + 64, y: location.getY() * 128 + 64,
      level: location.getZ(), active: false, moving: false, running: false, blocked: false,
      rotation: packet.rotation, time: now, credit: 20, broadcastAt: 0, runDistance: 0, inputAt: now };
    states.set(player, state);
  }
  if (packet.seq <= state.seq) return;
  state.seq = packet.seq;
  // Preserve the same bounded window the client predicts. A render/network stall
  // must not discard time from acknowledged inputs and pull the player backwards.
  // Credit still comes only from the server clock, never client packet frequency.
  state.credit = Math.min(MAX_PREDICTION_MS, state.credit + Math.max(0, now - state.time));
  state.time = now;
  state.inputAt = now;
  if (!packet.active) { cancel(core, player, state); return; }
  if (state.active && (location.getX() !== Math.floor(state.x / 128) ||
      location.getY() !== Math.floor(state.y / 128) || location.getZ() !== state.level ||
      player.getPrivateArea() !== state.privateArea || player.getForceMovement() != null || player.isNeedsPlacement())) {
    cancel(core, player, state, location, true);
    return;
  }
  const queue = player.getMovementQueue();
  const mobility = queue.getMobility();
  state.blocked = player.getHitpoints() <= 0 || !mobility.canMove() ||
    player.getForceMovement() != null || player.isNeedsPlacement();
  if (state.blocked) {
    // Hold the player where they stand, off-centre too; only coordinates left on another tile
    // (an inactive controller from before a teleport) fall back to this tile's centre.
    cancel(core, player, state, location);
    return;
  }
  if (!state.active) {
    queue.reset();
    queue.walkToReset();
    player.getCombat().reset();
    player.setFollowing(null);
    player.setMobileInteraction(null);
    player.setPositionToFace(null);
    player.closeInterruptibleInterfaces();
    if (Math.floor(state.x / 128) !== location.getX() || Math.floor(state.y / 128) !== location.getY() || state.level !== location.getZ()) {
      state.x = location.getX() * 128 + 64;
      state.y = location.getY() * 128 + 64;
      state.level = location.getZ();
    }
    state.privateArea = player.getPrivateArea();
    state.active = true;
  }
  state.rotation = packet.rotation;
  state.running = !!packet.running && player.getRunEnergy() > 0;
  const duration = Math.min(packet.duration, state.credit);
  state.credit -= duration;
  const previous = { x: state.x, y: state.y };
  const wasMoving = state.moving;
  if (state.active && !state.blocked) {
    const result = moveContinuous(previous, packet.dx, packet.dy,
      WALK_SPEED * duration * (state.running ? 2 : 1),
      (ax, ay, bx, by) => queue.canWalkTo(
        new core.Location(bx, by, state.level), new core.Location(ax, ay, state.level)));
    state.x = result.x;
    state.y = result.y;
  }
  state.moving = !state.blocked && !!(packet.dx || packet.dy) && packet.duration > 0 &&
    (state.x !== previous.x || state.y !== previous.y);
  const tileX = Math.floor(state.x / 128), tileY = Math.floor(state.y / 128);
  const tileChanged = tileX !== location.getX() || tileY !== location.getY();
  if (tileChanged) {
    player.setLocation(new core.Location(tileX, tileY, state.level));
  }
  queue.setExternalMovement(state.active && state.moving, tileChanged);
  if (state.moving && state.running) {
    state.runDistance += Math.hypot(state.x - previous.x, state.y - previous.y);
    const drain = Math.floor((state.runDistance + 1e-6) / 256);
    if (drain > 0) {
      state.runDistance = Math.max(0, state.runDistance - drain * 256);
      player.setRunEnergy(player.getRunEnergy() - drain);
      player.getPacketSender().sendRunEnergy();
    }
  }
  if (state.running !== player.isRunningReturn()) {
    player.setRunning(state.running);
    player.getPacketSender().sendRunStatus();
  }
  sendPosition(core, player, state, state.moving !== wasMoving);
}

function worldInput(core, { player, packet }) {
  const state = states.get(player);
  if (state?.active && WORLD_INPUTS.has(packet.type)) cancel(core, player, state);
}

function teleport(core, mobile, target) {
  const state = states.get(mobile);
  if (state?.active) cancel(core, mobile, state, target, true);
}

function processPlayer(core, { player }) {
  const state = states.get(player);
  if (!state?.active) return;
  const location = player.getLocation();
  if (location.getX() !== Math.floor(state.x / 128) || location.getY() !== Math.floor(state.y / 128) ||
      location.getZ() !== state.level || player.getPrivateArea() !== state.privateArea ||
      player.getForceMovement() != null || player.isNeedsPlacement()) {
    cancel(core, player, state, location, true);
  } else if (performance.now() - state.inputAt > 250 && state.moving) {
    state.moving = false;
    sendPosition(core, player, state, true);
  }
}

function syncView({ player, view }) {
  const state = states.get(player);
  if (state?.active) view.finePosition = snapshot(player, state);
}

function logout({ player }) { states.delete(player); }

module.exports = {
  name: "Free movement",
  description: "Continuous free movement: moves players by client input at walk and run speed with server-checked timing, and sends fine positions to observers.",
  register(api) {
    api.onCustomEvent("player:movement-input", input.bind(null, api.core));
    api.onCustomEvent("player:world-input", worldInput.bind(null, api.core));
    api.onCustomEvent("player:sync-view", syncView);
    api.onPlayerProcess(processPlayer.bind(null, api.core));
    api.onPlayerLogout(logout);
    api.core.Mobile.onBeforeTeleport(teleport.bind(null, api.core));
  },
};
