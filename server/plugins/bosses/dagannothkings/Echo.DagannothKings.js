"use strict";
/**
 * TEMPORARY ECHO PLACEHOLDER: the three normal Kings, dressed by EchoBosses in their Echo
 * appearance and Wiki statistics, with separate health pools and normal Rex/Prime/Supreme attacks, not the
 * Echo shared attacks. All three must die before one encounter reward is awarded.
 * See docs/echo-bosses.md. Ordinary public/Slayer lairs remain unchanged.
 */
const Common = require("./Common.DagannothKings");
const Hud = require("./Hud.DagannothKings");
const KINGS = { rex: Common.REX_ID, prime: Common.PRIME_ID, supreme: Common.SUPREME_ID };
const KING_ORDER = ["rex", "prime", "supreme"];
// Normal public-lair spawn positions (npc-spawns.json), retained for placeholder mechanics.
const SPAWNS = { supreme: [2906, 4448, 0], prime: [2911, 4451, 0], rex: [2913, 4445, 0] };
const RETURN_ATTRIBUTE = "dagannoth-kings:echo-return";
const sessions = new Map();
function end(session) {
  if (session.ended) return;
  session.ended = true; sessions.delete(session.player); Hud.hideForLeaver(session.player);
  session.player.setAttribute(RETURN_ATTRIBUTE, null);
  Common.api.emitCustomEvent("echo-boss:release", { player: session.player, token: session.token });
  if (!session.area.isDestroyed()) session.area.destroy();
  Common.api.emitCustomEvent("persistence:save", { player: session.player, reason: "echo-dagannoth-kings-exit" });
}
function start(request) {
  if (request.boss !== "dagannoth-kings" || request.handled) return;
  request.handled = true; const { player } = request;
  if (sessions.has(player)) return;
  const claim = { player, boss: request.boss, token: null }; Common.api.emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  const session = { player, token: claim.token, area: null, npcs: [], dead: new Set(), ended: false, completed: false };
  const { PrivateArea, Boundary } = Common.core, b = Common.PUBLIC_LAIR;
  class EchoKingsArea extends PrivateArea {
    constructor() { super([new Boundary(b.minX, b.maxX, b.minY, b.maxY, 0)]); }
    getName() { return "Echo Dagannoth Kings (normal mechanics placeholder)"; }
    isMulti() { return true; }
    npcAggression(player, npc) {
      if (!npc.__echoKings) return null;
      const range = npc.__echoKingRole === "rex" ? Common.AGGRO_TILES[Common.REX_ID] : Common.AGGRO_TILES[Common.PRIME_ID];
      return Common.tileDistance(npc.getLocation(), player.getLocation()) <= range;
    }
    npcAggressionTolerance() { return true; }
    canAttack(attacker, target) { if (attacker.isPlayer?.() && attacker !== player || target.isPlayer?.() && target !== player) return false; return null; }
    postLeave(mobile, logout) {
      if (mobile === player) { if (logout) player.setLocation(Common.location(Common.OUTSIDE_TILE)); end(session); }
      super.postLeave(mobile, logout);
    }
  }
  try {
    session.area = new EchoKingsArea();
    for (const role of KING_ORDER) {
      const [x, y, z] = SPAWNS[role], npc = Common.api.spawnNpc({ id: KINGS[role], x, y, z, owner: player, wanderRadius: 0 });
      if (!npc) throw new Error("Echo King could not spawn");
      npc.__echoKings = session; npc.__echoKingRole = role; npc.__skipDefaultRespawn = true;
      session.area.add(npc); session.npcs.push(npc);
      const configure = { player, boss: request.boss, role, npc, token: session.token, configured: false };
      Common.api.emitCustomEvent("echo-boss:configure", configure);
      if (!configure.configured) throw new Error("Echo King could not be configured");
    }
    // Live opens the bar on Supreme as Yes is answered (rsprox.net 89), then follows the king fought.
    Hud.show(player, session.npcs[KING_ORDER.indexOf("supreme")]);
    // The normal room's spinolyps retain their existing combat/dive controllers.
    for (const original of Common.core.World.getNpcsNear(Common.location(Common.PUBLIC_SPAWN), 40)) {
      if (original.getPrivateArea?.() || !Common.inPublicLair(original.getLocation()) ||
          !Common.isSpinolyp(original) && !Common.isSubmerged(original)) continue;
      const at = original.getSpawnPosition?.() ?? original.getLocation();
      const npc = Common.api.spawnNpc({ id: original.getId(), x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0 });
      if (npc) { npc.__skipDefaultRespawn = true; session.area.add(npc); }
    }
    sessions.set(player, session); player.setAttribute(RETURN_ATTRIBUTE, [...Common.OUTSIDE_TILE]);
    session.area.enter(player); player.moveTo(Common.location(Common.PUBLIC_SPAWN));
    Common.api.emitCustomEvent("persistence:save", { player, reason: "echo-dagannoth-kings-entry" });
  } catch (error) {
    if (session.area && player.getPrivateArea?.() === session.area) player.moveTo(Common.location(Common.OUTSIDE_TILE));
    if (session.area) end(session); else Common.api.emitCustomEvent("echo-boss:release", { player, token: session.token });
    player.sendMessage("The Echo encounter could not start. Your orb has not been consumed."); Common.api.log?.(String(error));
  }
}
function died({ npc, killer }) {
  const session = npc?.__echoKings;
  if (!session || session.ended || session.completed || killer !== session.player || session.dead.has(npc)) return;
  session.dead.add(npc);
  if (session.dead.size !== session.npcs.length || session.npcs.length !== 3) return;
  session.completed = true;
  Common.api.emitCustomEvent("echo-boss:completed", { player: session.player, boss: "dagannoth-kings", token: session.token,
    npcs: session.npcs, location: npc.getLocation(), privateArea: session.area });
}
function recover({ player }) { if (!player.getAttribute(RETURN_ATTRIBUTE) || sessions.has(player)) return; player.setAttribute(RETURN_ATTRIBUTE, null); player.moveTo(Common.location(Common.OUTSIDE_TILE)); Common.api.emitCustomEvent("persistence:save", { player, reason: "echo-dagannoth-kings-recovery" }); }
function grave(request) { if (sessions.has(request.player)) { const [x, y, z] = Common.OUTSIDE_TILE; request.tile = { x, y, z }; } }
function shutdown() { for (const session of [...sessions.values()]) { session.player.moveTo(Common.location(Common.OUTSIDE_TILE)); end(session); } }
function attach(api) {
  api.persistAttribute(RETURN_ATTRIBUTE, null);
  api.onCustomEvent("echo-boss:start", start);
  api.onCustomEvent("gravestones:grave-location", grave);
  api.onNpcDeath(died);
  api.onPlayerLogin(recover);
  api.onServerShutdown(shutdown);
}
module.exports = attach;
module.exports._test = { start, died, sessions, end, recover };
