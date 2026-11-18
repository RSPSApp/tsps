/**
 * TEMPORARY ECHO PLACEHOLDER: the normal Cerberus, dressed by EchoBosses in the Echo appearance
 * and Wiki combat statistics, with her normal attack cycle, souls, lava and firewall unchanged.
 * This is not an implementation of Echo Cerberus' own mechanics. See docs/echo-bosses.md.
 */
const Common = require("./Common.Cerberus");
const Lair = require("./Lair.Cerberus");
const Fight = require("./Fight.Cerberus");
const FireWall = require("./FireWall.Cerberus");
const RETURN_ATTRIBUTE = "cerberus:echo-return";
const ECHO_SLAYER_LEVEL = 91;
const sessions = new Map();

function release(session) {
  if (session.ended) return;
  session.ended = true;
  sessions.delete(session.player);
  session.arena.fight?.stop();
  FireWall.clear(session.arena);
  Common.api.emitCustomEvent("echo-boss:release", { player: session.player, token: session.token });
  session.player.setAttribute(RETURN_ATTRIBUTE, null);
  if (!session.area.isDestroyed()) session.area.destroy();
  Common.api.emitCustomEvent("persistence:save", { player: session.player, reason: "echo-cerberus-exit" });
}

function start(request) {
  if (request.boss !== "cerberus" || request.handled) return;
  const { player } = request;
  const source = Lair.arenas.find(arena => arena.def.winch[0] === player.getLocation().getX() &&
    Math.abs(arena.def.winch[1] - player.getLocation().getY()) <= 2) ??
    Lair.arenas.find(arena => Math.max(Math.abs(arena.def.winch[0] - player.getLocation().getX()),
      Math.abs(arena.def.winch[1] - player.getLocation().getY())) <= 3);
  request.handled = true;
  if (!source || sessions.has(player)) return;
  // No task is needed for the Echo, but the level is (the cache's leagues_echo_cerberus row: "91 Slayer").
  if (player.getSkillManager().getMaxLevel(Common.core.Skill.SLAYER) < ECHO_SLAYER_LEVEL) {
    player.sendMessage(`You need a Slayer level of ${ECHO_SLAYER_LEVEL} to fight the Echo of Cerberus.`);
    return;
  }
  const claim = { player, boss: request.boss, token: null };
  Common.api.emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  const { PrivateArea, Boundary } = Common.core;
  const arena = new Lair.Arena(source.def), session = { player, token: claim.token, arena, area: null, ended: false, completed: false };
  class EchoCerberusArea extends PrivateArea {
    constructor() { const b = arena.bounds; super([new Boundary(b.minX, b.maxX, b.minY, b.maxY, 0)]); }
    getName() { return "Echo Cerberus (normal mechanics placeholder)"; }
    isMulti() { return false; }
    process(mobile) { if (mobile === arena.cerberus) arena.fight?.tick(arena.players()); }
    canAttack(attacker, target) {
      if (Common.isSoul(target)) return false;
      if (attacker.isPlayer?.() && attacker !== player || target.isPlayer?.() && target !== player) return false;
      return null;
    }
    postLeave(mobile, logout) {
      if (mobile === player) {
        if (logout) player.setLocation(Common.toLocation(source.def.outside));
        release(session);
      }
      super.postLeave(mobile, logout);
    }
  }
  try {
    session.area = new EchoCerberusArea(); arena.area = arena.privateArea = session.area;
    const [x, y] = source.def.spawn;
    const npc = Common.api.spawnNpc({ id: Common.ids.npcs.attacking, x, y, z: 0, wanderRadius: 0, owner: player });
    if (!npc) throw new Error("Echo Cerberus could not spawn");
    npc.__skipDefaultRespawn = true; npc.__echoCerberus = session; npc.setFlag?.("combat:no-regen");
    session.area.add(npc);
    const configure = { player, boss: request.boss, role: "boss", npc, token: claim.token, configured: false };
    Common.api.emitCustomEvent("echo-boss:configure", configure);
    if (!configure.configured) throw new Error("Echo Cerberus could not be configured");
    arena.cerberus = npc; sessions.set(player, session);
    player.setAttribute(RETURN_ATTRIBUTE, [...source.def.outside]);
    session.area.enter(player); player.moveTo(Common.toLocation(source.def.entry));
    FireWall.place(arena); arena.fight = Fight.begin(arena, npc);
    Common.api.emitCustomEvent("persistence:save", { player, reason: "echo-cerberus-entry" });
  } catch (error) {
    if (session.area && player.getPrivateArea?.() === session.area) player.moveTo(Common.toLocation(source.def.outside));
    if (session.area) release(session);
    else Common.api.emitCustomEvent("echo-boss:release", { player, token: claim.token });
    player.sendMessage("The Echo encounter could not start. Your orb has not been consumed.");
    Common.api.log?.(String(error));
  }
}

function died({ npc, killer }) {
  const session = npc?.__echoCerberus;
  if (!session || session.ended || session.completed || killer !== session.player) return;
  session.completed = true;
  Common.api.emitCustomEvent("echo-boss:completed", { player: session.player, boss: "cerberus", token: session.token,
    npcs: [npc], location: npc.getLocation(), privateArea: session.area });
}
function recover({ player }) {
  const outside = player.getAttribute(RETURN_ATTRIBUTE);
  if (!Array.isArray(outside) || sessions.has(player)) return;
  player.setAttribute(RETURN_ATTRIBUTE, null); player.moveTo(Common.toLocation(outside));
  Common.api.emitCustomEvent("persistence:save", { player, reason: "echo-cerberus-recovery" });
}
function grave(request) {
  const session = sessions.get(request.player);
  if (!session) return;
  const [x, y, z = 0] = session.arena.def.outside; request.tile = { x, y, z };
}
function shutdown() { for (const session of [...sessions.values()]) { session.player.moveTo(Common.toLocation(session.arena.def.outside)); release(session); } }
function attach(api) {
  api.persistAttribute(RETURN_ATTRIBUTE, null);
  api.onCustomEvent("echo-boss:start", start);
  api.onCustomEvent("gravestones:grave-location", grave);
  api.onNpcDeath(died);
  api.onPlayerLogin(recover);
  api.onServerShutdown(shutdown);
}
module.exports = attach;
module.exports._test = { start, died, recover, sessions, release };
