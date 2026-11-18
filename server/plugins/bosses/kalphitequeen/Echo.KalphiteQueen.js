/**
 * TEMPORARY ECHO PLACEHOLDER: the normal Queen, dressed by EchoBosses in the Echo appearance
 * and Wiki statistics for each of her two forms, with her normal mechanics and transformation. No Echo-specific mechanics are implemented.
 * See docs/echo-bosses.md. Rewards are centralized and happen only after form two.
 */
const Encounter = require("./Encounter.KalphiteQueen");
const RETURN_ATTRIBUTE = "kalphite-queen:echo-return";
const OUTSIDE = [3508, 9497, 2], ENTRY = [3508, 9493, 0], SPAWN = [3474, 9496, 0];
const sessions = new Map();
let api;
function end(session) {
  if (session.ended) return;
  session.ended = true; sessions.delete(session.player);
  session.player.setAttribute(RETURN_ATTRIBUTE, null);
  api.emitCustomEvent("echo-boss:release", { player: session.player, token: session.token });
  if (!session.area.isDestroyed()) session.area.destroy();
  api.emitCustomEvent("persistence:save", { player: session.player, reason: "echo-kalphite-queen-exit" });
}
function start(request) {
  if (request.boss !== "kalphite-queen" || request.handled) return;
  request.handled = true; const { player } = request;
  if (sessions.has(player)) return;
  const claim = { player, boss: request.boss, token: null }; api.emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  const { PrivateArea, Boundary, Location } = api.core;
  const session = { player, token: claim.token, area: null, npc: null, ended: false, completed: false };
  class EchoQueenArea extends PrivateArea {
    constructor() { super([new Boundary(3456, 3519, 9472, 9535, 0)]); }
    getName() { return "Echo Kalphite Queen (normal mechanics placeholder)"; }
    isMulti() { return true; }
    canAttack(attacker, target) { if (attacker.isPlayer?.() && attacker !== player || target.isPlayer?.() && target !== player) return false; return null; }
    postLeave(mobile, logout) {
      if (mobile === player) { if (logout) player.setLocation(new Location(...OUTSIDE)); end(session); }
      super.postLeave(mobile, logout);
    }
  }
  try {
    session.area = new EchoQueenArea();
    const npc = api.spawnNpc({ id: api.core.NpcIdentifiers.KALPHITE_QUEEN_2, x: SPAWN[0], y: SPAWN[1], z: 0, owner: player, wanderRadius: 0 });
    if (!npc) throw new Error("Echo Kalphite Queen could not spawn");
    session.npc = npc; npc.__echoKq = session; npc.__skipDefaultRespawn = true;
    session.area.add(npc);
    if (!Encounter.configureEcho(npc, "ground")) throw new Error("Echo Kalphite Queen could not be configured");
    sessions.set(player, session); player.setAttribute(RETURN_ATTRIBUTE, OUTSIDE);
    session.area.enter(player); player.moveTo(new Location(...ENTRY)); npc.getCombat().attack(player);
    api.emitCustomEvent("persistence:save", { player, reason: "echo-kalphite-queen-entry" });
  } catch (error) {
    if (session.area && player.getPrivateArea?.() === session.area) player.moveTo(new Location(...OUTSIDE));
    if (session.area) end(session); else api.emitCustomEvent("echo-boss:release", { player, token: session.token });
    player.sendMessage("The Echo encounter could not start. Your orb has not been consumed."); api.log?.(String(error));
  }
}
function died({ npc, killer }) {
  const session = npc?.__echoKq;
  if (!session || session.ended || session.completed || !Encounter.isAirborne(npc) || killer !== session.player) return;
  session.completed = true;
  api.emitCustomEvent("echo-boss:completed", { player: session.player, boss: "kalphite-queen", token: session.token, npcs: [npc], location: npc.getLocation(), privateArea: session.area });
}
function recover({ player }) { if (!player.getAttribute(RETURN_ATTRIBUTE) || sessions.has(player)) return; player.setAttribute(RETURN_ATTRIBUTE, null); player.moveTo(new api.core.Location(...OUTSIDE)); api.emitCustomEvent("persistence:save", { player, reason: "echo-kalphite-queen-recovery" }); }
function grave(request) { if (sessions.has(request.player)) request.tile = { x: OUTSIDE[0], y: OUTSIDE[1], z: OUTSIDE[2] }; }
function shutdown() { for (const session of [...sessions.values()]) { session.player.moveTo(new api.core.Location(...OUTSIDE)); end(session); } }
function attach(pluginApi) {
  api = pluginApi;
  api.persistAttribute(RETURN_ATTRIBUTE, null);
  api.onCustomEvent("echo-boss:start", start);
  api.onCustomEvent("gravestones:grave-location", grave);
  api.onNpcDeath(died);
  api.onPlayerLogin(recover);
  api.onServerShutdown(shutdown);
}
module.exports = attach;
module.exports._test = { start, died, sessions, end, recover };
