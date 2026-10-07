/**
 * The Mad Angel's cathedral, one per player, as captured: climbing the pew copies the 13x13-chunk
 * scene around Ardeaglais into an instance (every plane, unturned) and puts the player in it,
 * with the angel dormant on its spot. Leaving by the pew, teleporting, dying or logging out ends
 * it; logging back in puts the player outside the pew.
 */
const Common = require("./Common.MadAngel");

const CHUNK = 8;
const PLANES = 4;

/** Per player: their cathedral while they are in it. */
const sessions = new Map();

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core;
  AreaClass = class MadAngelCathedral extends TemplatedInstanceArea {
    constructor() {
      const { chunks } = Common.data.instance;
      super(chunks, chunks);
      this.session = null;
    }

    getName() {
      return "Ardeaglais";
    }

    allowSummonPet() {
      return false;
    }

    /** The angel and its corpse go with it. */
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
     * Leaving, teleporting, dying or logging out ends the cathedral. Logging out puts the player
     * back outside the pew before they're saved, so they never log in to a cathedral that's gone.
     */
    postLeave(mobile, logout) {
      const player = mobile.isPlayer?.() && this.session?.player === mobile.getAsPlayer() ? mobile.getAsPlayer() : null;
      if (player && logout) player.setLocation(Common.toLocation(Common.data.pew.outside));
      if (player) this.session.end();
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
    const { sourceChunkX, sourceChunkY, chunks } = Common.data.instance;
    for (let plane = 0; plane < PLANES; plane++) {
      this.area.copySquare(chunks, sourceChunkX, sourceChunkY, plane, 0, 0, plane, 0);
    }
    this.boss = null;
    this.fight = null;
    this.ended = false;
  }

  /** As captured, the copy's broken pew is the way out (Exit, Quick-exit) rather than the way in. */
  placeExitPew() {
    const { GameObject, ObjectManager } = Common.core;
    const { pew } = Common.data;
    ObjectManager.register(new GameObject(pew.exitId, this.tile(pew.tile), pew.exitShape, pew.exitRotation, this.area), true);
  }

  /** The instance's copy of a cathedral tile. */
  tile([x, y, z]) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return this.area.tile(x - sourceChunkX * CHUNK, y - sourceChunkY * CHUNK, z ?? 0);
  }

  /** The cathedral tile an instance tile copies. */
  worldTile(location) {
    const { sourceChunkX, sourceChunkY } = Common.data.instance;
    return [location.getX() - this.area.getBaseX() + sourceChunkX * CHUNK, location.getY() - this.area.getBaseY() + sourceChunkY * CHUNK];
  }

  /** The dormant angel on its spot: the fighting angel, shown asleep until woken. */
  spawnAngel() {
    const { npcs, spawn } = Common.data;
    const at = this.tile(spawn.tile);
    const npc = Common.api.spawnNpc({ id: npcs.fighting, x: at.getX(), y: at.getY(), z: at.getZ(), owner: this.player, wanderRadius: 0, face: spawn.direction });
    if (!npc) return null;
    npc.__skipDefaultRespawn = true;
    npc.__madAngel = this;
    npc.setNpcTransformationId(npcs.dormant);
    this.area.add(npc);
    this.boss = npc;
    return npc;
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.fight?.hideHud(false);
    this.fight?.stop();
    this.player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
    if (!this.area.isDestroyed()) this.area.destroy();
  }
}

const sessionOf = (player) => sessions.get(player) ?? null;

/** Starts the player's cathedral: the instance and the dormant angel, ready for the move in. */
function open(player) {
  sessionOf(player)?.end();
  const session = new Session(player);
  sessions.set(player, session);
  session.spawnAngel();
  return session;
}

/** Moves the player into their cathedral (the fade's landing tick). */
function enter(session) {
  const { pew } = Common.data;
  const { player } = session;
  session.area.enter(player);
  player.moveTo(session.tile(pew.inside));
  player.setPositionToFace(session.tile([...pew.insideFace, 0]));
  session.placeExitPew();
  player.setAttribute(Common.INSIDE_ATTRIBUTE, true);
}

/** Moves the player back outside the pew; the area's postLeave ends the cathedral. */
function leave(player) {
  const { pew } = Common.data;
  player.moveTo(Common.toLocation(pew.outside));
  player.setPositionToFace(Common.toLocation([...pew.outsideFace, 0]));
  sessionOf(player)?.end();
}

/** A player saved inside (the server stopped, or they logged out there) comes back outside the pew. */
function recoverOnLogin({ player }) {
  if (!player.getAttribute(Common.INSIDE_ATTRIBUTE) || sessionOf(player)) return;
  player.setAttribute(Common.INSIDE_ATTRIBUTE, null);
  player.moveTo(Common.toLocation(Common.data.pew.outside));
}

function attachInstance(api) {
  api.persistAttribute(Common.INSIDE_ATTRIBUTE);
  api.onPlayerLogin(recoverOnLogin);
}

module.exports = { attachInstance, open, enter, leave, sessionOf };
