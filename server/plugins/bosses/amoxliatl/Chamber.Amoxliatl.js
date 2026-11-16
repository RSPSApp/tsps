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
  constructor(player, quest = false) {
    this.player = player;
    this.quest = quest;
    this.area = new (areaClass())();
    this.area.session = this;
    const { sourceChunkX, sourceChunkY, chunks } = Common.data.instance;
    this.area.copySquare(chunks, sourceChunkX, sourceChunkY, 0, 0, 0, 0, 0);
    this.boss = null;
    this.fight = null;
    /** Kills since the player came in (Kemo Makti). */
    this.kills = 0;
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
    const { npcs, spawn } = Common.data;
    const boss = this.spawn(this.quest ? npcs.quest : npcs.boss, spawn.tile, Common.core.Direction[spawn.direction].getId());
    if (!boss) return;
    this.boss = boss;
    require("./Fight.Amoxliatl").begin(this, boss);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.fight?.stop();
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

function enterChamber(player) {
  // The menu's No comes later: the door's own rule is asked again.
  if (sessionOf(player) || !questComplete(player)) return;
  const session = new Session(player);
  sessions.set(player, session);
  player.getMovementQueue().reset();
  Common.travel(player, () => {
    if (session.ended) return;
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
  api.onObjectInteraction("Door", { "Pass-through": passThrough });
  api.onObjectInteraction("Ice blockage", { Exit: exit, "Quick-exit": quickExit });
}

module.exports = { attachChamber, sessionOf, leave };
