"use strict";

/**
 * The gate into the Gnome Ball pitch (GATE_52, 2394).
 *
 * It works like the Al Kharid toll gate: clicking it swings the panel open for everyone in
 * view, force-walks the player one tile past the gate line with the agility runner, and
 * swings the panel shut again once the crossing finishes. Server clipping is left to the
 * closed panel, so only the player who opened it crosses; anyone else clicks it themselves.
 *
 * The panel swings the same way Doors.plugin.js rotates a self-opening door: the open face
 * is face + 1 and the panel moves one tile in the closed face's direction.
 */

const ObstacleRunner = require("../../skills/agility/ObstacleRunner");

/** The panel stays open this long after the last crossing player arrives. */
const GATE_CLOSE_DELAY_TICKS = 2;
/** From the closed panel's face to the tile its open hinge swings onto. */
const PANEL_OFFSETS = Object.freeze([[-1, 0], [0, 1], [1, 0], [0, -1]]);

let core;
let TaskManager;

/** gate key -> crossings in progress; the gate shuts once the last one is through. */
const crossings = new Map();

const gateKey = (gate) => `${gate.x},${gate.z}`;

/** Closed panel face + tile -> where the open panel sits and which way it faces. */
function openPanelPose(x, y, face) {
  const [dx, dy] = PANEL_OFFSETS[face & 0x3];
  return { x: x + dx, y: y + dy, face: (face + 1) & 0x3 };
}

/** The tile one past the gate line on the player's side, along the gate's crossing axis. */
function destinationFor(from, gate, face) {
  const horizontal = (face & 0x1) === 0;
  return horizontal
    ? { x: from.getX() < gate.x ? gate.x : gate.x - 1, y: from.getY(), z: gate.z }
    : { x: from.getX(), y: from.getY() < gate.y ? gate.y : gate.y - 1, z: gate.z };
}

function atGate(location, gate) {
  return location.getZ() === gate.z
    && Math.abs(location.getX() - gate.x) <= 1
    && Math.abs(location.getY() - gate.y) <= 1;
}

function panelAt(id, x, y, z, face) {
  return new core.GameObject(id, new core.Location(x, y, z), 0, face, null);
}

/** Swings the panel for everyone with the gate in view; the server keeps the closed clipping. */
function swingGate(closed, open, opening) {
  const from = opening ? closed : open;
  const to = opening ? open : closed;
  core.World.forEachNetworkPlayer((viewer) => {
    const area = viewer.getPrivateArea?.();
    if (area && !area.countsAsMainWorld?.()) return;
    const location = closed.getLocation();
    if (!viewer.getSession().isTileInScene(location.getX(), location.getY(), location.getZ())) return;
    const sender = viewer.getPacketSender();
    sender.sendObjectRemoval(from);
    sender.sendObject(to);
  });
}

function closeGateLater(gate, closed, open) {
  const task = new core.Task(GATE_CLOSE_DELAY_TICKS, false);
  task.execute = () => {
    task.stop();
    const key = gateKey(gate);
    const count = (crossings.get(key) ?? 1) - 1;
    if (count > 0) {
      crossings.set(key, count);
      return;
    }
    crossings.delete(key);
    swingGate(closed, open, false);
  };
  TaskManager.submit(task);
}

/** Opens the gate for viewers and force-walks the player one tile past the gate line. */
function crossGate(player, clicked) {
  const location = clicked.getLocation();
  const face = Number(clicked.getFace?.() ?? clicked.face ?? 0) & 0x3;
  const gate = { x: location.getX(), y: location.getY(), z: location.getZ() };
  const from = player.getLocation();
  if (!atGate(from, gate) || ObstacleRunner.isBusy(player)) return false;
  const closed = panelAt(clicked.getId(), gate.x, gate.y, gate.z, face);
  const pose = openPanelPose(gate.x, gate.y, face);
  const open = panelAt(clicked.getId(), pose.x, pose.y, gate.z, pose.face);
  const key = gateKey(gate);
  const count = crossings.get(key) ?? 0;
  crossings.set(key, count + 1);
  if (count === 0) swingGate(closed, open, true);
  const to = destinationFor(from, gate, face);
  // The leading wait keeps it to one tile per tick, as the Al Kharid gate does.
  ObstacleRunner.run({ player }, [{ wait: 1 }, { walk: [[to.x, to.y]] }], {
    onFinish: () => closeGateLater(gate, closed, open),
  });
  return true;
}

/** `door:toggle` is emitted by Doors.plugin.js before it swings a gate. */
function interceptGate(event) {
  if (event.handled || !event.player || !event.object) return;
  if (event.objectId !== core.ObjectIdentifiers.GATE_52) return;
  if (crossGate(event.player, event.object)) event.handled = true;
}

module.exports = function registerGate(registry) {
  core = registry.core;
  TaskManager = core.TaskManager;
  ObstacleRunner.init(registry);
  registry.onCustomEvent("door:toggle", interceptGate);
};

Object.assign(module.exports, {
  crossGate,
  interceptGate,
  atGate,
  openPanelPose,
  destinationFor,
  crossings,
  _test: {
    crossGate,
    interceptGate,
    atGate,
    openPanelPose,
    destinationFor,
    setCore: (value) => {
      core = value;
    },
  },
});
