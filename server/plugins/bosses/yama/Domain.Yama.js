/**
 * Yama's Domain, one per player, as captured: the Voice copies the domain's cache map into an
 * instance (11x7 chunks, unturned) and moves the player in behind a fade, with Yama on his throne
 * to the north. The glowing portal to the south leads back to the Voice (Wiki). Leaving it any
 * way - the portal, a teleport, death, logging out - ends it; a player saved inside comes back by
 * the Voice. A death there is Yama's: the player wakes by the Voice (Wiki), who holds what they
 * dropped (Voice.Yama).
 */
const Common = require("./Common.Yama");

const CHUNK = 8;

/** Per player: their domain while they are in it. */
const sessions = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class YamasDomain extends TemplatedInstanceArea {
    constructor() {
      const { width, height } = Common.data.instance;
      super(width, height);
      this.session = null;
    }

    getName() {
      return "Yama's Domain";
    }

    /** As captured: the multiway indicator comes on with the move in. */
    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    /** The throne, Yama and anything else spawned for the fight go with it. */
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
     * Leaving ends the domain. Logging out puts the player back by the Voice before they're saved,
     * so they never log in to a domain that's gone. Leaving a fight alive is escaping it.
     */
    postLeave(mobile, logout) {
      const session = this.session;
      const player = mobile.isPlayer?.() && session?.player === mobile.getAsPlayer() ? mobile.getAsPlayer() : null;
      if (player && logout) player.setLocation(Common.toLocation(Common.data.voice.respawn));
      if (player) {
        if (session.fight && !session.fight.over && !session.died) {
          player.setAttribute(Common.LAST_RESULT_ATTRIBUTE, "escaped");
        }
        session.end();
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class Session {
  constructor(player) {
    this.player = player;
    this.area = new (areaClass())();
    this.area.session = this;
    this.copyDomain();
    this.throne = null;
    this.fight = null;
    this.died = false;
    this.ended = false;
  }

  /** The captured chunks: all of plane 0, and plane 1 where its rows mark one. */
  copyDomain() {
    const { sourceChunkX, sourceChunkY, width, height, plane1 } = Common.data.instance;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const chunk = { sourceChunkX: sourceChunkX + x, sourceChunkY: sourceChunkY + y, rotation: 0 };
        this.area.setChunk(0, x, y, { ...chunk, sourcePlane: 0 });
        if (plane1[height - 1 - y]?.[x] === "#") this.area.setChunk(1, x, y, { ...chunk, sourcePlane: 1 });
      }
    }
  }

  /** The instance's copy of a domain tile. */
  tile([x, y, z]) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return this.area.tile(x - sourceChunkX * CHUNK, y - sourceChunkY * CHUNK, z ?? 0);
  }

  /** The domain tile an instance tile copies. */
  worldTile(location) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return [
      location.getX() - this.area.getBaseX() + sourceChunkX * CHUNK,
      location.getY() - this.area.getBaseY() + sourceChunkY * CHUNK,
      location.getZ(),
    ];
  }

  /** An NPC of the domain's, standing still, gone with the instance. */
  spawn(id, tile, face) {
    const at = this.tile(tile);
    const npc = Common.api.spawnNpc({
      id, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0, face: Common.facing(face),
    });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__yamaSession = this;
    this.area.add(npc);
    return npc;
  }

  /** Yama on his throne, waiting to be talked to or challenged. */
  seatYama() {
    const { npcs, domain, varbits } = Common.data;
    this.throne = this.spawn(npcs.throne, domain.throne.tile, domain.throne.face);
    this.player.getPacketSender().sendVarbit(varbits.throneState, 0);
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.fight?.stop();
    const sender = this.player.getPacketSender();
    sender.sendVarbit(Common.data.varbits.throneState, 0);
    sender.sendVarbit(Common.data.varbits.multiway, 0);
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

const sessionOf = (player) => sessions.get(player) ?? null;

/** Builds the player's domain and moves them in behind the captured fade. */
function enter(player) {
  if (sessionOf(player)) return;
  const session = new Session(player);
  sessions.set(player, session);
  session.seatYama();
  const { domain } = Common.data;
  player.getMovementQueue().reset();
  Common.travel(player, domain.enterMessage, () => {
    if (session.ended) return;
    session.area.enter(player);
    player.moveTo(session.tile(domain.arrival));
    player.setPositionToFace(session.tile([...domain.arrivalFace, 0]));
    player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(Common.data.varbits.multiway, 1);
    Common.playMusic(player, domain.music);
  });
}

/** Back to the Voice; the area's postLeave ends the domain. */
function leave(player) {
  player.moveTo(Common.toLocation(Common.data.voice.respawn));
  sessionOf(player)?.end();
}

/** The glowing portal: out through the same fade (no capture of the way out). */
function leaveByPortal({ player }) {
  if (!sessionOf(player)) return false;
  player.getMovementQueue().reset();
  Common.travel(player, "You leave Yama's Domain.", () => leave(player));
  return true;
}

/** A player saved inside (the server stopped, or they logged out there) comes back by the Voice. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || sessionOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
  player.moveTo(Common.toLocation(Common.data.voice.respawn));
}

/** Yama has the last word, as the challenger falls (Wiki transcript; the first as captured). */
function yamaGloats({ player }) {
  const session = sessionOf(player);
  const yama = session?.fight?.yama;
  if (!yama) return;
  const { overheads } = Common.data;
  const lines = overheads.death;
  const line = Common.count(player, Common.SOUL_DEBT_ATTRIBUTE) === 0
    ? overheads.firstDeath
    : lines[Math.floor(Math.random() * lines.length)];
  yama.forceChat(line);
}

/** A death in the domain: the player wakes by the Voice, and it counts as soul debt. */
function respawnByVoice(event) {
  const session = sessionOf(event.player);
  if (!session) return;
  const { player } = event;
  session.died = true;
  player.setAttribute(Common.SOUL_DEBT_ATTRIBUTE, Common.count(player, Common.SOUL_DEBT_ATTRIBUTE) + 1);
  if (session.fight) player.setAttribute(Common.LAST_RESULT_ATTRIBUTE, "defeated");
  leave(player);
  // Here, not in a death handler of the Voice's own: this one handles the death, so the rest never run.
  const held = player.getAttribute(Common.HELD_ITEMS_ATTRIBUTE);
  if (held?.announce) {
    held.announce = false;
    player.sendMessage(Common.data.retrieval.heldMessage);
  }
  event.handled = true;
}

function attachDomain(api) {
  api.persistAttribute(Common.INSIDE_ATTRIBUTE);
  api.persistAttribute(Common.SOUL_DEBT_ATTRIBUTE);
  api.persistAttribute(Common.LAST_RESULT_ATTRIBUTE);
  api.onPlayerLogin(recoverOnLogin);
  api.onObjectInteraction("Glowing portal", { Leave: leaveByPortal });
  api.onPlayerBeforeDeath(yamaGloats);
  api.onPlayerDeath(respawnByVoice);
}

module.exports = { attachDomain, enter, leave, sessionOf };
