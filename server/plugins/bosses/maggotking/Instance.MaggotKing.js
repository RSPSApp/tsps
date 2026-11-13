"use strict";

const Common = require("./Common.MaggotKing");

const INSTANCE_ATTRIBUTE = "maggot-king:instance";
const sessions = new Map();
// Death observers outlive the live session marker. Only actors spawned by this encounter
// forfeit automatic loot while the separate corpse-choice reward chain is deferred.
const encounterBosses = new WeakSet();
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

    canAttack(attacker, target, method) {
      const { player, boss, fight } = this.session;
      if (attacker === player && target?.__maggotLarva?.fight === fight && fight?.larvae.has(target.__maggotLarva)) return true;
      if (attacker === player && target === boss) {
        return !method || method.type() !== Common.core().CombatType.MELEE || fight?.phase === "melee";
      }
      return attacker === boss && target === player;
    }

    process(mobile) {
      if (mobile === this.session.player) this.session.fight?.processFloor();
    }

    destroy() {
      if (this.isDestroyed()) return;
      this.session.close();
      super.destroy();
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
    this.fight = null;
    this.ended = false;
  }

  tile(worldTile) {
    const [sourceX, sourceY] = Common.data.sourceMin;
    return this.area.tile(worldTile[0] - sourceX, worldTile[1] - sourceY, worldTile[2] ?? 0);
  }

  worldTile(location) {
    return [location.getX() - this.area.getBaseX() + Common.data.sourceMin[0],
      location.getY() - this.area.getBaseY() + Common.data.sourceMin[1]];
  }

  enter() {
    const { data } = Common;
    this.area.enter(this.player);
    this.player.setAttribute(INSTANCE_ATTRIBUTE, true);
    this.player.moveTo(this.tile(data.arrival));
    const { GameObject, ObjectManager } = Common.core();
    this.exit = new GameObject(data.exit.id, this.tile(data.exit.tile), 10, data.exit.face, this.area);
    ObjectManager.register(this.exit, true);
    if (!this.spawnBoss()) {
      this.player.moveTo(Common.loc(data.outside));
      this.area.leave(this.player, false);
      return false;
    }
    return true;
  }

  spawnBoss() {
    if (this.ended || this.boss) return null;
    const spawn = this.tile(Common.data.bossSpawn);
    const boss = Common.api().spawnNpc({
      id: Common.core().NpcIdentifiers.MAGGOT_KING,
      x: spawn.getX(), y: spawn.getY(), z: spawn.getZ(),
      owner: this.player, ownerOnly: true, wanderRadius: 0,
    });
    if (!boss) return null;
    encounterBosses.add(boss);
    boss.__skipDefaultRespawn = true;
    boss.__maggotKingSession = this;
    this.area.add(boss);
    this.boss = boss;
    const { Fight } = require("./Fight.MaggotKing");
    this.fight = new Fight(this, boss);
    this.fight.start();
    return boss;
  }

  scheduleRespawn(ticks) {
    if (this.ended) return;
    this.respawnTask?.stop();
    const session = this;
    const { Task, TaskManager } = Common.core();
    const task = new (class extends Task {
      constructor() {
        super(Math.max(1, Math.trunc(ticks)), session, false);
      }

      execute() {
        this.stop();
        if (session.respawnTask === this) session.respawnTask = null;
        if (session.ended || session.boss) return;
        if (!session.spawnBoss()) session.scheduleRespawn(1);
      }
    })();
    this.respawnTask = task;
    TaskManager.submit(task);
  }

  close() {
    if (this.ended) return;
    this.ended = true;
    this.fight?.stop();
    this.fight = null;
    if (this.exit) Common.core().ObjectManager.deregister(this.exit, true);
    this.exit = null;
    this.respawnTask?.stop();
    this.respawnTask = null;
    sessions.delete(this.player);
    this.player.setAttribute(INSTANCE_ATTRIBUTE, null);
    if (this.boss) {
      this.boss.__maggotKingSession = null;
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
  try { return session.enter(); }
  catch (error) {
    player.moveTo(Common.loc(Common.data.outside));
    session.area.leave(player, false);
    throw error;
  }
}

function onBossDeath({ npc }) {
  const session = npc?.__maggotKingSession;
  if (!session || session.ended || session.boss !== npc) return;
  session.fight?.stop();
  session.fight = null;
  npc.__maggotKingSession = null;
  npc.__skipDefaultRespawn = true;
  session.boss = null;
  session.scheduleRespawn(npc.getDefinition().getRespawn());
}

function claimBossDrops(claim) {
  if (encounterBosses.has(claim.npc)) claim.handled = true;
}

module.exports = { enter, sessionOf, sessions, areaClass, onBossDeath, claimBossDrops, _test: { INSTANCE_ATTRIBUTE } };
