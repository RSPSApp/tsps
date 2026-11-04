"use strict";

const Common = require("./Common.MaggotKing");

const INSTANCE_ATTRIBUTE = "maggot-king:instance";
const sessions = new Map();
let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { TemplatedInstanceArea } = Common.core();
  AreaClass = class MaggotKingLair extends TemplatedInstanceArea {
    constructor(session) {
      const [width, height] = Common.data.instanceChunks;
      super(width, height);
      this.session = session;
      this.copyLairMap();
    }

    getName() {
      return "Maggot King's lair";
    }

    isMulti() {
      return false;
    }

    copyLairMap() {
      const [sourceX, sourceY] = Common.data.sourceMin;
      const sourceChunkX = sourceX >> 3;
      const sourceChunkY = sourceY >> 3;
      for (let x = 0; x < this.widthChunks; x++) {
        for (let y = 0; y < this.heightChunks; y++) {
          this.setChunk(0, x, y, {
            sourceChunkX: sourceChunkX + x,
            sourceChunkY: sourceChunkY + y,
            sourcePlane: 0,
            rotation: 0,
          });
        }
      }
    }

    canAttack(attacker, target) {
      return (attacker === this.session.player && target === this.session.boss)
        || (attacker === this.session.boss && target === this.session.player);
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.() && mobile.getAsPlayer() === this.session.player) {
        if (logout) mobile.moveTo(Common.loc(Common.data.outside));
        this.session.close();
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

class Session {
  constructor(player) {
    this.player = player;
    this.area = new (areaClass())(this);
    this.boss = null;
    this.ended = false;
  }

  tile(worldTile) {
    const [sourceX, sourceY] = Common.data.sourceMin;
    return this.area.tile(worldTile[0] - sourceX, worldTile[1] - sourceY, worldTile[2] ?? 0);
  }

  enter() {
    const { data } = Common;
    const spawn = this.tile(data.bossSpawn);
    this.area.enter(this.player);
    this.player.setAttribute(INSTANCE_ATTRIBUTE, true);
    this.player.moveTo(this.tile(data.arrival));
    this.boss = Common.api().spawnNpc({
      id: Common.core().NpcIdentifiers.MAGGOT_KING,
      x: spawn.getX(), y: spawn.getY(), z: spawn.getZ(),
      owner: this.player, ownerOnly: true, wanderRadius: 0,
    });
    if (!this.boss) {
      this.player.moveTo(Common.loc(data.outside));
      this.area.leave(this.player, false);
      return false;
    }
    this.boss.__skipDefaultRespawn = true;
    this.area.add(this.boss);
    return true;
  }

  close() {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this.player);
    this.player.setAttribute(INSTANCE_ATTRIBUTE, null);
    if (this.boss) {
      this.area.detach(this.boss);
      Common.api().removeNpc(this.boss);
      this.boss = null;
    }
  }
}

function sessionOf(player) {
  const session = sessions.get(player);
  return session && !session.ended ? session : null;
}

function enter(player) {
  if (!player || sessionOf(player)) return false;
  const session = new Session(player);
  sessions.set(player, session);
  return session.enter();
}

module.exports = { enter, sessionOf, sessions, areaClass, _test: { INSTANCE_ATTRIBUTE } };
