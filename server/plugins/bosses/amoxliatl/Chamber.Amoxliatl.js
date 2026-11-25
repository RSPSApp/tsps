/**
 * Amoxliatl's chamber, one per player, as captured: once The Heart of Darkness is done, the door
 * west of the frost nagua (vmq3_ruins_door_multi, "Door" by then) copies map square 5446 into an
 * instance (plane 0, unturned) behind the fade, and puts the player at its east end by the three
 * ice blockages (Exit asks "Are you sure you want to exit?", Quick-exit doesn't). Five ticks after
 * the move she rises on her platform. Leaving any way - the blockages, a teleport, death, logging
 * out - ends it; a player saved inside comes back outside the door, and a death there leaves its
 * grave outside the door too (Wiki: "a grave outside the instance").
 */
const Common = require("./Common.Amoxliatl");

const CHUNK = 8;
const QUEST_KEY = "the_heart_of_darkness";

/** Per player: their chamber while they are in it. */
const sessions = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class AmoxliatlChamber extends TemplatedInstanceArea {
    constructor() {
      const { chunks } = Common.data.instance;
      super(chunks, chunks);
      this.session = null;
    }

    getName() {
      return "Amoxliatl's chamber";
    }

    /** As captured: the multiway indicator comes on with the move in. */
    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** She, her ice and anything else spawned for the fight go with it. */
    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Common.api.removeNpc(entity);
      }
      super.destroy();
    }

    /**
     * Leaving ends the chamber. Logging out puts the player back outside the door before they're
     * saved, so they never log in to a chamber that's gone.
     */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() && this.session?.player === mobile.getAsPlayer() ? mobile.getAsPlayer() : null;
      if (player && logout) player.setLocation(Common.toLocation(Common.data.door.outside));
      if (player) this.session.end();
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class Session {
  constructor(player, quest = false, echoToken = null) {
    this.player = player;
    this.quest = quest;
    // The Echo fights its own way (EchoFight.Amoxliatl) in the same chamber.
    this.variant = echoToken ? "echo" : "normal";
    this.echoToken = echoToken;
    this.area = new (areaClass())();
    this.area.session = this;
    const { sourceChunkX, sourceChunkY, chunks } = Common.data.instance;
    this.area.copySquare(chunks, sourceChunkX, sourceChunkY, 0, 0, 0, 0, 0);
    this.boss = null;
    this.fight = null;
    /** Kills since the player came in (Kemo Makti). */
    this.kills = 0;
    /** Times she has risen this visit: her line differs after the first. */
    this.rises = 0;
    this.ended = false;
  }

  /** The instance's copy of a chamber tile. */
  tile([x, y, z]) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return this.area.tile(x - sourceChunkX * CHUNK, y - sourceChunkY * CHUNK, z ?? 0);
  }

  /** The chamber tile an instance tile copies. */
  worldTile(location) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return [location.getX() - this.area.getBaseX() + sourceChunkX * CHUNK, location.getY() - this.area.getBaseY() + sourceChunkY * CHUNK];
  }

  /** As captured, the three blockages are added once the player is in. */
  placeExits() {
    const { GameObject, ObjectManager } = Common.core;
    const { exits } = Common.data;
    for (const [x, y, z, rotation] of exits.tiles) {
      ObjectManager.register(new GameObject(exits.id, this.tile([x, y, z]), exits.shape, rotation, this.area), true);
    }
  }

  /** An NPC of the chamber's, gone with the instance. */
  spawn(id, tile, face) {
    const at = this.tile(tile);
    const npc = Common.api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0, face });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__amoxliatl = this;
    this.area.add(npc);
    return npc;
  }

  /** She rises on her platform and the fight begins (Fight.Amoxliatl). */
  spawnBoss() {
    if (this.ended || this.boss) return;
    if (this.echoToken && !validateEcho(this.player, this.echoToken)) { this.failEntry(); return; }
    const { npcs, spawn } = Common.data;
    const boss = this.spawn(this.quest ? npcs.quest : npcs.boss, spawn.tile, Common.core.Direction[spawn.direction].getId());
    if (!boss) { this.failEntry(); return; }
    if (this.echoToken) {
      // The normal Amoxliatl, given the Echo profile by EchoBosses (the Wiki's Echo is an
      // override of her own id, with no separate appearance).
      // Live times each Echo from her rise (R1140: 99 ticks from the rise to the kill count read 0:59.40).
      const configure = { player: this.player, boss: "amoxliatl", role: "boss", npc: boss, token: this.echoToken, configured: false, timeFromNow: true };
      Common.api.emitCustomEvent("echo-boss:configure", configure);
      if (!configure.configured) { this.failEntry(); return; }
    }
    this.boss = boss;
    if (this.echoToken) require("./EchoFight.Amoxliatl").begin(this, boss);
    else require("./Fight.Amoxliatl").begin(this, boss);
  }

  /**
   * Live: with the player still in the chamber, the next Echo rises after a kill, as the normal
   * boss does. Each is its own Echo encounter, claimed again, so the orb must still be carried;
   * without it none rises.
   */
  respawnEcho() {
    if (this.ended || this.player.getArea() !== this.area || this.player.getHitpoints() <= 0) return;
    Common.api.emitCustomEvent("echo-boss:release", { player: this.player, token: this.echoToken });
    const claim = { player: this.player, boss: "amoxliatl", token: null };
    Common.api.emitCustomEvent("echo-boss:claim", claim);
    this.echoToken = claim.token;
    this.echoCompleted = false;
    if (this.echoToken) this.spawnBoss();
  }

  failEntry() {
    if (this.player.getArea() === this.area) this.player.moveTo(Common.toLocation(Common.data.door.outside));
    this.end();
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.fight?.stop();
    if (this.echoToken) {
      this.player.getCombat().reset();
      this.player.getCombat().getHitQueue().clear();
      this.boss?.getCombat().reset();
      this.boss?.getCombat().getHitQueue().clear();
    }
    if (this.echoToken) Common.api.emitCustomEvent("echo-boss:release", { player: this.player, token: this.echoToken });
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

const sessionOf = (player) => sessions.get(player) ?? null;

function questComplete(player) {
  const request = { player, key: QUEST_KEY, complete: false };
  Common.api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Through the door: a chamber of the player's own, behind the fade. A league character carrying the echo orb is asked first ("echo-boss:entry"). */
function passThrough({ player, objectId }) {
  if (objectId !== Common.data.door.id || sessionOf(player) || !questComplete(player)) return false;
  const entry = { player, boss: "amoxliatl", enter: () => enterChamber(player), handled: false };
  Common.api.emitCustomEvent("echo-boss:entry", entry);
  if (!entry.handled) entry.enter();
  return true;
}

function enterChamber(player, echoToken = null) {
  // The menu's No comes later: the door's own rule is asked again.
  if (sessionOf(player) || !questComplete(player)) {
    if (echoToken) Common.api.emitCustomEvent("echo-boss:release", { player, token: echoToken });
    return;
  }
  const origin = player.getLocation().clone();
  let session;
  try { session = new Session(player, false, echoToken); }
  catch (error) {
    if (echoToken) Common.api.emitCustomEvent("echo-boss:release", { player, token: echoToken });
    player.sendMessage("The encounter could not be started.");
    return;
  }
  sessions.set(player, session);
  player.getMovementQueue().reset();
  Common.travel(player, () => {
    if (session.ended) return;
    if (echoToken && (!validateEcho(player, echoToken) || !questComplete(player) || !player.getLocation().equals(origin) || player.getHitpoints() <= 0)) { session.end(); return; }
    const { arrival, arrivalFace, music, spawn } = Common.data;
    session.area.enter(player);
    player.moveTo(session.tile(arrival));
    player.setPositionToFace(session.tile([...arrivalFace, 0]));
    player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
    session.placeExits();
    Common.api.emitCustomEvent("music:unlock-track", { player, trackId: music });
    player.getPacketSender().sendSong(music);
    Common.later(spawn.afterArrivalTicks, () => session.spawnBoss());
  });
}

function startEcho(request) {
  if (request.boss !== "amoxliatl" || request.handled) return;
  request.handled = true;
  if (sessionOf(request.player) || !questComplete(request.player)) return;
  const claim = { player: request.player, boss: request.boss, token: null };
  Common.api.emitCustomEvent("echo-boss:claim", claim);
  if (claim.token) enterChamber(request.player, claim.token);
}

function validateEcho(player, token) {
  const request = { player, boss: "amoxliatl", token, valid: false };
  Common.api.emitCustomEvent("echo-boss:validate", request);
  return request.valid === true;
}
function logout({ player }) {
  const session = sessionOf(player);
  if (!session) return;
  if (player.getArea() === session.area) player.setLocation(Common.toLocation(Common.data.door.outside));
  session.end();
}
function playerDeath({ player }) { sessionOf(player)?.end(); }
function shutdown() { for (const session of [...sessions.values()]) logout({ player: session.player }); }

/** The quest reuses the same chamber and hazards with the cache's 400-HP guardian. */
function questFight(request) {
  if (sessionOf(request.player)) return;
  const session = new Session(request.player, true);
  sessions.set(request.player, session);
  request.handled = true;
  Common.travel(request.player, () => {
    if (session.ended) return;
    session.area.enter(request.player);
    request.player.moveTo(session.tile([1371, 4511, 0]));
    request.player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
    session.placeExits();
    Common.later(Common.data.spawn.afterArrivalTicks, () => session.spawnBoss());
  });
}

/** Back outside the door; the area's postLeave ends the chamber. */
function leave(player) {
  player.moveTo(Common.toLocation(Common.data.door.outside));
  sessionOf(player)?.end();
}

function leaveChamber(player) {
  player.getMovementQueue().reset();
  Common.travel(player, () => leave(player));
}

/** Exit asks first. */
function exit({ player, objectId }) {
  const { exits } = Common.data;
  if (objectId !== exits.id || !sessionOf(player)) return false;
  Common.api.sendMultiChatboxPrompt(player, exits.question, exits.yes, () => {
    player.getPacketSender().sendInterfaceRemoval();
    leaveChamber(player);
  }, exits.no, () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

/** Quick-exit leaves straight away. */
function quickExit({ player, objectId }) {
  if (objectId !== Common.data.exits.id || !sessionOf(player)) return false;
  leaveChamber(player);
  return true;
}

/** A player saved inside (the server stopped, or they logged out there) comes back outside the door. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || sessionOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
  player.moveTo(Common.toLocation(Common.data.door.outside));
}

/** A death in her chamber leaves its grave outside the door. */
function graveOutside(request) {
  if (!sessionOf(request.player)) return;
  const [x, y, z] = Common.data.door.outside;
  request.tile = { x, y, z };
}

function attachChamber(api) {
  api.persistAttribute(Common.INSIDE_ATTRIBUTE);
  api.onPlayerLogin(recoverOnLogin);
  api.onCustomEvent("gravestones:grave-location", graveOutside);
  api.onCustomEvent('amoxliatl:quest-fight', questFight);
  api.onCustomEvent("echo-boss:start", startEcho);
  api.onPlayerLogout(logout);
  api.onPlayerDeath(playerDeath);
  api.onServerShutdown(shutdown);
  api.onObjectInteraction("Door", { "Pass-through": passThrough });
  api.onObjectInteraction("Ice blockage", { Exit: exit, "Quick-exit": quickExit });
}

module.exports = { attachChamber, sessionOf, leave };
