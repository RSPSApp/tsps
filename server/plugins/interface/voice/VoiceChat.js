"use strict";

const CHANNEL = "voice";
const AUDIBLE_DISTANCE = 15;
const participants = new Map();
let core;

function send(player, data) {
  player.getSession().sendClientPacket(core.encodePluginMessage(CHANNEL, data));
}

function canHear(player, other) {
  if (player === other || player.getPrivateArea() !== other.getPrivateArea()) return false;
  const a = player.getLocation(), b = other.getLocation();
  return a.getZ() === b.getZ()
    && Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY())) < AUDIBLE_DISTANCE;
}

function refreshPeers({ player }) {
  const state = participants.get(player);
  if (!state) return;
  const peers = new Map(player.getLocalPlayers()
    .filter(other => participants.has(other) && (state.broadcasting || participants.get(other).broadcasting) && canHear(player, other))
    .map(other => [other, participants.get(other).broadcasting]));
  if (state.peers && peers.size === state.peers.size && [...peers].every(([other, broadcasting]) => state.peers.get(other) === broadcasting)) return;
  state.peers = peers;
  send(player, { type: "peers", peers: [...peers].map(([other, broadcasting]) => ({ id: other.getIndex(), name: other.getUsername(), broadcasting })) });
}

function disconnectPlayer({ player }) {
  if (!participants.delete(player)) return;
  for (const other of participants.keys()) refreshPeers({ player: other });
}

function receiveMessage(event) {
  if (event.channel !== CHANNEL) return;
  event.handled = true;
  const { player, data } = event;
  if (data.type === "voice-state" && typeof data.enabled === "boolean") {
    if (!data.enabled) {
      disconnectPlayer({ player });
      return;
    }
    if (!participants.has(player)) participants.set(player, { peers: null, broadcasting: false });
    const state = participants.get(player);
    if (state.broadcasting !== (data.broadcasting === true)) state.peers = null;
    state.broadcasting = data.broadcasting === true;
    for (const other of participants.keys()) refreshPeers({ player: other });
    return;
  }
  if (!participants.has(player)) return;
  if (!["offer", "answer", "ice-candidate"].includes(data.type)) return;
  if (!Number.isInteger(data.target) || typeof data.connectionId !== "string"
    || !/^[a-zA-Z0-9-]{1,64}$/.test(data.connectionId)) return;
  const other = core.World.getPlayers().get(data.target);
  if (!other || !participants.has(other) || !participants.get(player).peers?.has(other) || !canHear(player, other)) return;
  if (data.type === "ice-candidate") {
    const candidate = data.candidate;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || typeof candidate.candidate !== "string" || candidate.candidate.length > 2048
      || (candidate.sdpMid != null && (typeof candidate.sdpMid !== "string" || candidate.sdpMid.length > 64))
      || (candidate.sdpMLineIndex != null && (!Number.isInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0 || candidate.sdpMLineIndex > 255))
      || (candidate.usernameFragment != null && (typeof candidate.usernameFragment !== "string" || candidate.usernameFragment.length > 256))) return;
    send(other, { type: data.type, from: player.getIndex(), connectionId: data.connectionId,
      candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex, usernameFragment: candidate.usernameFragment } });
  } else {
    if (!data.description || data.description.type !== data.type || typeof data.description.sdp !== "string"
      || data.description.sdp.length > 8192) return;
    send(other, { type: data.type, from: player.getIndex(), connectionId: data.connectionId,
      description: { type: data.type, sdp: data.description.sdp } });
  }
}

function shutdown() {
  for (const player of participants.keys()) send(player, { type: "unavailable" });
  participants.clear();
}

module.exports = function attach(api) {
  core = api.core;
  api.onCustomEvent("network:plugin-message", receiveMessage);
  api.onPlayerProcess(refreshPeers);
  api.onPlayerLogout(disconnectPlayer);
  api.onPlayerDisconnect(disconnectPlayer);
  api.onServerShutdown(shutdown);
};
