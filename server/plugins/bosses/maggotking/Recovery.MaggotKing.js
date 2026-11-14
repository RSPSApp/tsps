"use strict";

const Common = require("./Common.MaggotKing");
const Instance = require("./Instance.MaggotKing");
const KILLS_ATTRIBUTE = "maggot-king:kills";

function grave(request) {
  if (!Instance.sessionOf(request.player)) return;
  const [x, y, z] = Common.data.outside;
  request.tile = { x, y, z };
  if (Number(request.player.getAttribute(KILLS_ATTRIBUTE) ?? 0) < 5) request.feeMultiplier = 0.25;
}
function death(event) {
  const session = Instance.sessionOf(event.player);
  if (!session) return;
  // The dangerous-death item/grave pass already ran. Only its respawn destination changes.
  event.handled = true;
  event.player.moveTo(Common.loc(Common.data.respawn));
  session.area.leave(event.player, false);
}
function kill({ npc, killer }) {
  const session = npc?.__maggotKingSession;
  if (!session || session.player !== killer || session.ended) return;
  const count = Math.max(0, Number(killer.getAttribute(KILLS_ATTRIBUTE) ?? 0)) + 1;
  killer.setAttribute(KILLS_ATTRIBUTE, count);
  require("../../interface/BossKillCount.plugin").sendBossKillCount(killer, `Your Maggot King kill count is: <col=ff0000>${count}</col>.`);
}
function teleported({ player }) {
  const session = Instance.sessionOf(player);
  if (session && player.getPrivateArea() !== session.area) {
    // A teleport may already have attached the player to a different private scene.
    session.area.detach(player);
    session.close();
    session.area.destroy();
  }
}
function shutdown() {
  for (const session of [...Instance.sessions.values()]) {
    session.player.moveTo(Common.loc(Common.data.outside));
    session.area.leave(session.player, false);
  }
}
function attach(api) {
  api.persistAttribute(KILLS_ATTRIBUTE, 0);
  api.onCustomEvent("gravestones:grave-location", grave);
  api.onCustomEvent("teleport:landed", teleported);
  api.onPlayerDeath(death);
  api.onNpcDeath(kill);
  api.onServerShutdown(shutdown);
}

module.exports = { attach, KILLS_ATTRIBUTE };
