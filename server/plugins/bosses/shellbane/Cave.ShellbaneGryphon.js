/**
 * The Shellbane Gryphon Cave under the Great Conch (Wiki: Shellbane_Gryphon_Cave, Elder_Nama,
 * Cave_entrance_(Troubled_Tortugans)), a private copy for each player (the PrivateArea pattern):
 * - the cave entrance by Elder Nama takes a player who has finished Troubled Tortugans, has 51
 *   Slayer and a gryphon or Shellbane task; anyone else is turned away;
 * - the gryphon is waiting; after a kill it comes back 20 ticks later, but only while the task
 *   still wants more;
 * - the cave exit, a teleport, death or logging out ends the copy (logging out puts the player
 *   back outside, Wiki).
 */
const Common = require("./Common.ShellbaneGryphon");
const { Fight } = require("./Fight.ShellbaneGryphon");

const CAVE_ATTRIBUTE = "shellbane-gryphon:cave";

let CaveArea = null;

class Cave {
  constructor(player) {
    this.player = player;
    this.area = new CaveArea(this);
    this.boss = null;
    this.fight = null;
    this.respawning = false;
    const area = this.area;
    /** The whirlwinds: objects in this copy only. */
    this.world = {
      placeObject(id, tile) {
        const { GameObject, ObjectManager } = Common.core;
        const object = new GameObject(id, tile, 10, 0, area);
        ObjectManager.register(object, true);
        return object;
      },
      removeObject(object) {
        if (object) Common.core.ObjectManager.deregister(object, true);
      },
    };
  }

  players() {
    return this.player.isRegistered?.() !== false && this.area.getPlayers().includes(this.player) ? [this.player] : [];
  }

  contains(location) {
    return Common.inBox(location, Common.data.cave.floor);
  }

  /** The gryphon on its nest, ready for the player. */
  spawnBoss() {
    const { NPC, World, Animation } = Common.core;
    const npc = NPC.create(Common.ids.npcs.boss, Common.toLocation(Common.data.cave.boss));
    npc.__skipDefaultRespawn = true;
    npc.__sgCave = this;
    this.area.add(npc);
    World.getAddNPCQueue().push(npc);
    npc.performAnimation(new Animation(Common.ids.seqs.spawn));
    this.boss = npc;
    this.fight = new Fight(this, npc);
    return npc;
  }

  /** After a kill: back in 20 ticks while the task wants more. */
  bossDied() {
    this.fight?.stop();
    this.fight = null;
    this.boss = null;
    this.respawning = true;
    Common.later(Common.data.cave.respawnTicks, () => {
      this.respawning = false;
      if (this.area.isDestroyed?.() === true || !this.players().length) return;
      if (Common.onTask(this.player)) this.spawnBoss();
    });
  }

  destroy() {
    this.fight?.stop();
    this.fight = null;
    this.area.destroy();
  }
}

function defineArea() {
  const { PrivateArea, Boundary } = Common.core;
  const [minX, maxX, minY, maxY] = Common.data.cave.bounds;
  CaveArea = class ShellbaneGryphonCave extends PrivateArea {
    constructor(cave) {
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.cave = cave;
    }

    getName() {
      return "Shellbane Gryphon Cave";
    }

    destroy() {
      if (this.isDestroyed?.() === true) return;
      const { World } = Common.core;
      const addQueue = World.getAddNPCQueue();
      const removeQueue = World.getRemoveNPCQueue();
      for (const entity of this.entities ?? []) {
        if (!entity?.isNpc?.()) continue;
        const npc = entity.getAsNpc();
        for (let i = addQueue.indexOf(npc); i !== -1; i = addQueue.indexOf(npc)) addQueue.splice(i, 1);
        if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
      }
      super.destroy();
    }

    /** The fight runs on the player's tick (an idle NPC isn't processed until something wakes it). */
    process(mobile) {
      const cave = this.cave;
      if (mobile !== cave.player || !cave.fight) return;
      const boss = cave.boss;
      if (boss && boss.getHitpoints() > 0 && boss.getCombat().getTarget() !== mobile) boss.getCombat().attack(mobile);
      cave.fight.tick();
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.() && mobile === this.cave.player) {
        if (logout) mobile.moveTo(Common.toLocation(Common.data.cave.outside));
        leaveCave(mobile);
      }
      super.postLeave(mobile, logout);
    }

    canTeleport() {
      return null;
    }

    /** Multicombat (Wiki). */
    isMulti() {
      return true;
    }
  };
}

function caveOf(player) {
  const cave = player.getAttribute?.(CAVE_ATTRIBUTE);
  return cave instanceof Cave && cave.area.isDestroyed?.() !== true ? cave : null;
}

function leaveCave(player) {
  const cave = player.getAttribute?.(CAVE_ATTRIBUTE);
  player.setAttribute?.(CAVE_ATTRIBUTE, null);
  if (cave instanceof Cave) cave.destroy();
}

function goIn(player) {
  leaveCave(player);
  const cave = new Cave(player);
  player.setAttribute(CAVE_ATTRIBUTE, cave);
  player.moveTo(Common.toLocation(Common.data.cave.arrive));
  const current = player.getArea?.();
  if (current && current !== cave.area) current.leave(player, false);
  cave.area.enter(player);
  cave.spawnBoss();
  return cave;
}

/**
 * The cave entrance: 51 Slayer and the task (Elder Nama's rule). Before Troubled Tortugans is
 * done the cave is the quest's (TroubledTortugans.Quest.js), so it is left to it.
 */
function enter({ player, objectId }) {
  if (objectId !== Common.ids.locs.entrance) return false;
  if (!Common.questComplete(player)) return false;
  if (player.getSkillManager().getCurrentLevel(Common.core.Skill.SLAYER) < Common.data.slayerLevel) {
    player.sendMessage(Common.message("noLevel"));
    return true;
  }
  if (!Common.onTask(player)) {
    player.sendMessage(Common.message("noTask"));
    return true;
  }
  goIn(player);
  return true;
}

function exit({ player, objectId }) {
  if (objectId !== Common.ids.locs.exit || !caveOf(player)) return false;
  player.moveTo(Common.toLocation(Common.data.cave.outside));
  leaveCave(player);
  return true;
}

function leaveWorld({ player }) {
  if (caveOf(player)) player.moveTo(Common.toLocation(Common.data.cave.outside));
  leaveCave(player);
}

/** A player attacking the gryphon while it is stunned beats the knockback (Wiki). */
function onAttackStarted({ attacker, target }) {
  const npc = target?.isNpc?.() ? target.getAsNpc() : null;
  npc?.__sgCave?.fight?.counterKnockback?.(attacker);
}

function attach(api) {
  defineArea();
  api.onObjectInteraction("Cave entrance", { Enter: enter });
  api.onObjectInteraction("Cave exit", { Exit: exit });
  api.onPlayerLogout(leaveWorld);
  api.onPlayerDisconnect(leaveWorld);
  api.onCustomEvent("combat:attack-started", onAttackStarted);
}

module.exports = { attach, Cave, caveOf, goIn, leaveCave, enter, exit, onAttackStarted, CAVE_ATTRIBUTE };
