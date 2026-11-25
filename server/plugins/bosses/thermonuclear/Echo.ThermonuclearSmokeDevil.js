"use strict";

/** The Leagues VI Echo Thermonuclear smoke devil: the normal boss, dressed by EchoBosses in the
 * Echo appearance and Wiki stats, in a private copy of the room, fighting as live does (rsprox.net
 * 1161): smoke pools, sets of ranged and magic shots, the charged special and its prayer
 * (EchoFight.ThermonuclearSmokeDevil.js). No Slayer assignment is required for Echo; the base 93
 * Slayer requirement remains.
 */
const Common = require("./Common.ThermonuclearSmokeDevil");
const EchoFight = require("./EchoFight.ThermonuclearSmokeDevil");
const BOSS = "thermonuclear-smoke-devil";
const INSIDE_ATTRIBUTE = "thermonuclear-smoke-devil:echo-inside";
const sessions = new Map();

function end(session) {
  if (!session || session.ended) return;
  session.ended = true;
  session.fight?.stop();
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

const ECHO = Common.DATA.echo;
/** The fade overlay, as the other fades into a place send it (CatacombsOfKourend): script 948 over 50 cycles. */
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface?.(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/** Runs `action` `ticks` from now, unless the session has ended by then. */
function after(session, ticks, action) {
  const { Task, TaskManager } = Common.core;
  let left = ticks;
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, null, false); }
    execute() {
      if (session.ended) { this.stop(); return; }
      if (--left > 0) return;
      this.stop();
      action();
    }
  })());
}

/** The player is still in the Echo's room: logged in, alive, and in its private area. */
function present(session) {
  const player = session.player;
  return !session.ended && player.isRegistered?.() !== false && player.getHitpoints?.() > 0
    && player.getPrivateArea?.() === session.area;
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
  const { PrivateArea, Boundary } = Common.core;
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
  enter(session);
}

/**
 * Live's way in (rsprox.net 1161): the screen fades with "You enter the Smokey Cave.", the player
 * is moved in 2 ticks later and the screen fades back in, and the Echo appears 2 ticks after the move.
 */
function enter(session) {
  const { player } = session;
  const entry = ECHO.entry;
  player.getMovementQueue?.()?.setBlockMovement?.(true)?.reset?.();
  fade(player, true);
  player.getPacketSender().sendTypedMessage?.(Common.core.ChatType.MESBOX, entry.message);
  after(session, entry.minimapOffTicks, () => player.getPacketSender().sendVarbit?.(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  after(session, entry.moveTicks, () => {
    session.area.enter(player);
    player.moveTo(Common.location(Common.INSIDE_TILE));
    player.setAttribute(INSIDE_ATTRIBUTE, true);
    player.getMovementQueue?.()?.setBlockMovement?.(false);
  });
  after(session, entry.fadeInTicks, () => {
    player.getPacketSender().sendVarbit?.(MINIMAP_STATE_VARBIT, 0);
    fade(player, false);
  });
  after(session, entry.spawnTicks, () => spawnEcho(session));
  after(session, entry.overlayCloseTicks, () => player.getPacketSender().closeSubInterface?.(OVERLAY_ATMOSPHERE_UID));
}

/** The Echo appears on its own tile in the middle of the pools (not the normal boss's spawn), and fights. */
function spawnEcho(session) {
  const { player } = session;
  if (!present(session)) return;
  try {
    const { NPC } = Common.core;
    const [x, y, z] = ECHO.spawnTile;
    const npc = Common.api.spawnNpc({ id: Common.BOSS_ID, x, y, z, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (!npc) throw new Error("Echo Thermonuclear spawn failed");
    session.npc = npc;
    session.completed = false;
    npc.__skipDefaultRespawn = true;
    npc.__thermonuclearEchoSession = session;
    npc.setFlag(NPC.WALK_THROUGH_ENTITIES_FLAG, true);
    session.area.add(npc);
    const configure = { player, boss: BOSS, role: "boss", npc, token: session.token, configured: false };
    Common.api.emitCustomEvent("echo-boss:configure", configure);
    if (!configure.configured) throw new Error("Echo Thermonuclear could not be configured");
    spawnFlourish(npc);
    EchoFight.begin(session, npc);
  } catch (error) {
    end(session);
    player.moveTo(Common.location(Common.OUTSIDE_TILE));
    player.sendMessage("The Echo encounter could not be started.");
  }
}

function death({ npc }) {
  const session = npc?.__thermonuclearEchoSession;
  if (!session || session.ended || session.completed || session.npc !== npc) return;
  session.completed = true;
  // Its shots in flight go with it (recorded: none lands after the death).
  session.fight?.stop();
  Common.api.emitCustomEvent("echo-boss:completed", { player: session.player, boss: BOSS, token: session.token, npcs: [npc], location: Common.core.Projectile.centreOf(npc) });
  after(session, ECHO.respawnTicks, () => respawn(session));
}

/**
 * Live: with the player still in the room, the next Echo appears 25 ticks after the last one dies.
 * Each kill is its own Echo encounter (a new claim: the orb still carried, its own timer).
 */
function respawn(session) {
  if (!present(session)) return;
  Common.api.emitCustomEvent("echo-boss:release", { player: session.player, token: session.token });
  const claim = { player: session.player, boss: BOSS, token: null };
  Common.api.emitCustomEvent("echo-boss:claim", claim);
  if (!claim.token) return;
  session.token = claim.token;
  spawnEcho(session);
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
/** The player's hits on the Echo: the style it prays against, and the last style to land. */
function hitModify({ npc, hit }) {
  const fight = npc?.__thermonuclearEchoSession?.fight;
  if (!fight || fight.stopped || !hit?.getAttacker?.()?.isPlayer?.()) return;
  fight.onHit(hit);
}
function attach(api) {
  api.persistAttribute(INSIDE_ATTRIBUTE);
  api.onNpcHitModify(hitModify);
  api.onCustomEvent("echo-boss:start", start);
  api.onNpcDeath(death);
  api.onPlayerLogout(logout);
  api.onPlayerDeath(playerDeath);
  api.onPlayerLogin(login);
  api.onServerShutdown(shutdown);
}
module.exports = { attach, start, end, death, hitModify };
