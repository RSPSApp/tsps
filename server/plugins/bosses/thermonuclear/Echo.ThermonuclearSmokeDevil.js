"use strict";

/** The normal Thermonuclear smoke devil, dressed by EchoBosses in the Echo appearance and Wiki
 * stats, with its NORMAL typeless smoke shot, facemask rule and movement. Echo charged attacks,
 * knockback and elemental changes are intentionally missing. No Slayer assignment is required
 * for Echo; the base 93 Slayer requirement remains.
 */
const Common = require("./Common.ThermonuclearSmokeDevil");
const BOSS = "thermonuclear-smoke-devil";
const INSIDE_ATTRIBUTE = "thermonuclear-smoke-devil:echo-inside";
const sessions = new Map();

function end(session) {
  if (!session || session.ended) return;
  session.ended = true;
  sessions.delete(session.player);
  session.player.setAttribute(INSIDE_ATTRIBUTE, null);
  session.player.getCombat().reset();
  session.player.getCombat().getHitQueue().clear();
  session.npc?.getCombat().reset();
  session.npc?.getCombat().getHitQueue().clear();
  session.area?.destroy();
  Common.api.emitCustomEvent("echo-boss:release", { player: session.player, token: session.token });
}

/** Live's Echo spawn (rsprox.net 1161): a dust-devil spotanim and spawn sequence as it appears. */
const SPAWN_SPOTANIM = "leagues_6_lore_dust_devil_spawn_spotanim";
const SPAWN_SEQUENCE = "lore_lust_devil_spawn";
function spawnFlourish(npc) {
  const { CacheDefinitions, Graphic, Animation } = Common.core;
  const spotanim = CacheDefinitions.getSpotanimId(SPAWN_SPOTANIM), sequence = CacheDefinitions.getSeqId(SPAWN_SEQUENCE);
  if (Number.isInteger(spotanim)) npc.performGraphic(new Graphic(spotanim));
  if (Number.isInteger(sequence)) npc.performAnimation(new Animation(sequence));
}

function start(request) {
  if (request.boss !== BOSS || request.handled) return;
  request.handled = true;
  const { player } = request;
  if (sessions.has(player)) return;
  if (player.getSkillManager().getMaxLevel(Common.core.Skill.SLAYER) < 93) {
    player.sendMessage("You need a Slayer level of 93 to fight the Echo Thermonuclear smoke devil.");
    return;
  }
  const claim = { player, boss: BOSS, token: null };
  Common.api.emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  const session = { player, token: claim.token, variant: "echo", role: "boss", ended: false };
  sessions.set(player, session);
  try {
    const { PrivateArea, Boundary, NPC } = Common.core;
    const lair = Common.LAIR;
    session.area = new (class extends PrivateArea {
      constructor() { super([new Boundary(lair.minX, lair.maxX, lair.minY, lair.maxY, 0)]); }
      isMulti() { return true; }
      postLeave(mobile, logout) {
        if (mobile === player) {
          if (logout) player.setLocation(Common.location(Common.OUTSIDE_TILE));
          end(session);
        }
        super.postLeave(mobile, logout);
      }
    })();
    const [x, y, z] = Common.DATA.spawnTile;
    session.npc = Common.api.spawnNpc({ id: Common.BOSS_ID, x, y, z, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!session.npc) throw new Error("Echo Thermonuclear spawn failed");
    session.npc.__skipDefaultRespawn = true;
    session.npc.__thermonuclearEchoSession = session;
    session.npc.setFlag(NPC.WALK_THROUGH_ENTITIES_FLAG, true);
    session.area.add(session.npc);
    const configure = { player, boss: BOSS, role: "boss", npc: session.npc, token: session.token, configured: false };
    Common.api.emitCustomEvent("echo-boss:configure", configure);
    if (!configure.configured) throw new Error("Echo Thermonuclear could not be configured");
    spawnFlourish(session.npc);
    session.area.enter(player);
    player.moveTo(Common.location(Common.INSIDE_TILE));
    player.setAttribute(INSIDE_ATTRIBUTE, true);
  } catch (error) {
    end(session);
    player.sendMessage("The Echo encounter could not be started.");
  }
}

function death({ npc }) {
  const session = npc?.__thermonuclearEchoSession;
  if (!session || session.ended || session.completed) return;
  session.completed = true;
  Common.api.emitCustomEvent("echo-boss:completed", { player: session.player, boss: BOSS, token: session.token, npcs: [npc], location: Common.core.Projectile.centreOf(npc) });
}
function logout({ player }) {
  const session = sessions.get(player);
  if (session) player.setLocation(Common.location(Common.OUTSIDE_TILE));
  end(session);
}
function playerDeath({ player }) { end(sessions.get(player)); }
function shutdown() { for (const session of [...sessions.values()]) logout({ player: session.player }); }
function login({ player }) {
  if (!player.getAttribute(INSIDE_ATTRIBUTE)) return;
  player.setAttribute(INSIDE_ATTRIBUTE, null);
  player.moveTo(Common.location(Common.OUTSIDE_TILE));
}
function attach(api) {
  api.persistAttribute(INSIDE_ATTRIBUTE);
  api.onCustomEvent("echo-boss:start", start);
  api.onNpcDeath(death);
  api.onPlayerLogout(logout);
  api.onPlayerDeath(playerDeath);
  api.onPlayerLogin(login);
  api.onServerShutdown(shutdown);
}
module.exports = { attach, start, end, death };
