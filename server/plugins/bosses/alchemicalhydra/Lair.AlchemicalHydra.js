/**
 * The Alchemical Hydra's test chamber in Karuulm Slayer Dungeon (Wiki: Alchemical Hydra/Strategies),
 * one private copy per player, following the engine's PrivateArea pattern (as Vorkath's crater):
 * - the Alchemical door from the observation room takes the player into their own chamber, with
 *   their own Hydra; the world's spawn of it there stays out;
 * - the doors are jammed while the Hydra lives; teleporting out still works;
 * - leaving the chamber (the door after a kill, a teleport, death, logging out) ends it, the Hydra
 *   and its pools, currents and fires with it; a player logging out inside comes back outside;
 * - the Hydra only takes damage from a player on a hydra Slayer task.
 */
const Common = require("./Common.AlchemicalHydra");
const { Fight } = require("./Fight.AlchemicalHydra");

const LAIR_ATTRIBUTE = "alchemical-hydra:lair";

let LairClass = null;

class Lair {
  constructor(player) {
    this.player = player;
    const [minX, maxX, minY, maxY] = Common.data.room.bounds;
    this.bounds = { minX, maxX, minY, maxY };
    this.area = new LairClass(this);
    this.hydra = null;
    this.fight = null;
  }

  contains(location) {
    const { minX, maxX, minY, maxY } = this.bounds;
    const x = location.getX();
    const y = location.getY();
    return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
  }

  players() {
    return this.player.isRegistered?.() !== false && this.area.getPlayers().includes(this.player) ? [this.player] : [];
  }

  hydraAlive() {
    return Boolean(this.hydra && this.hydra.getHitpoints() > 0 && !this.hydra.isDyingFunction?.());
  }

  spawnHydra() {
    const { NPC, World } = Common.core;
    const hydra = NPC.create(Common.ids.npcs.serpentine, Common.toLocation(Common.data.room.spawn));
    hydra.__skipDefaultRespawn = true;
    hydra.__hydraLair = this;
    hydra.setFlag?.("combat:no-regen");
    hydra.getMovementCoordinator?.().setRadius?.(0);
    this.area.add(hydra);
    World.getAddNPCQueue().push(hydra);
    this.hydra = hydra;
    this.fight = new Fight(this, hydra);
    return hydra;
  }

  /** After a kill, another Hydra comes back in this chamber (Wiki infobox: 43 ticks). */
  respawnLater() {
    Common.later(Common.data.kill.respawnTicks, () => {
      if (this.area.isDestroyed?.() === true || this.hydraAlive()) return;
      if (this.players().length === 0) return;
      this.spawnHydra();
    });
  }

  destroy() {
    this.fight?.stop();
    this.fight = null;
    this.area.destroy();
    this.hydra = null;
  }
}

function defineAreaClass() {
  const { PrivateArea, Boundary } = Common.core;
  LairClass = class HydraLair extends PrivateArea {
    constructor(lair) {
      const [minX, maxX, minY, maxY] = Common.data.room.bounds;
      super([new Boundary(minX, maxX, minY, maxY, 0)]);
      this.lair = lair;
    }

    getName() {
      return "Alchemical Hydra";
    }

    destroy() {
      if (this.isDestroyed?.() === true) return;
      const addQueue = Common.core.World.getAddNPCQueue();
      const removeQueue = Common.core.World.getRemoveNPCQueue();
      for (const entity of this.entities ?? []) {
        if (!entity?.isNpc?.()) continue;
        const npc = entity.getAsNpc();
        npc.__hydraFight?.stop();
        for (let index = addQueue.indexOf(npc); index !== -1; index = addQueue.indexOf(npc)) addQueue.splice(index, 1);
        if (npc.isRegistered?.() && !removeQueue.includes(npc)) removeQueue.push(npc);
      }
      super.destroy();
    }

    process(mobile) {
      if (mobile !== this.lair.hydra) return;
      const fight = this.lair.fight;
      const players = this.lair.players();
      if (fight && players.length > 0 && mobile.getCombat().getTarget() !== players[0] && !fight.transitioning()) {
        mobile.getCombat().attack(players[0]);
      }
      fight?.tick(players);
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.() && mobile === this.lair.player) {
        if (logout) mobile.moveTo(Common.toLocation(Common.data.room.outside));
        leaveLair(mobile);
      }
      super.postLeave(mobile, logout);
    }

    isMulti() {
      return false;
    }

    canAttack(attacker, target) {
      if (!attacker?.isPlayer?.() || target !== this.lair.hydra) return null;
      if (!Common.onTask(attacker.getAsPlayer(), target)) {
        attacker.sendMessage(Common.message("noTask"));
        return false;
      }
      return null;
    }
  };
}

function lairOf(player) {
  const lair = player.getAttribute?.(LAIR_ATTRIBUTE);
  return lair instanceof Lair && lair.area.isDestroyed?.() !== true ? lair : null;
}

function leaveLair(player) {
  const lair = player.getAttribute?.(LAIR_ATTRIBUTE);
  player.setAttribute?.(LAIR_ATTRIBUTE, null);
  if (lair instanceof Lair) lair.destroy();
}

function enterLair(player) {
  leaveLair(player);
  const lair = new Lair(player);
  player.setAttribute(LAIR_ATTRIBUTE, lair);
  player.moveTo(Common.toLocation(Common.data.room.entry));
  const current = player.getArea?.();
  if (current && current !== lair.area) current.leave(player, false);
  lair.area.enter(player);
  lair.spawnHydra();
  return lair;
}

/** The Alchemical door: in from the observation room, out (once the Hydra is dead) from inside. */
function openDoor({ player, objectId }) {
  if (!Common.ids.locs.door.includes(objectId)) return false;
  const [minX, maxX, minY, maxY] = Common.data.room.bounds;
  const at = player.getLocation();
  const inside = at.getX() >= minX && at.getX() <= maxX && at.getY() >= minY && at.getY() <= maxY;
  if (!inside) {
    enterLair(player);
    return true;
  }
  const lair = lairOf(player);
  if (lair?.hydraAlive()) {
    player.sendMessage(Common.message("doorLocked"));
    return true;
  }
  player.moveTo(Common.toLocation(Common.data.room.outside));
  leaveLair(player);
  return true;
}

/** The world's own Hydra in the chamber stays out: each player gets theirs. */
function blockWorldSpawn(event) {
  if (event.npcId !== Common.ids.npcs.serpentine || !event.location) return;
  const [minX, maxX, minY, maxY] = Common.data.room.bounds;
  const x = event.location.getX?.() ?? event.location.x;
  const y = event.location.getY?.() ?? event.location.y;
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) event.allow = false;
}

/** A hit on the Hydra: off task it does nothing; shielded it does a quarter; past a threshold it changes phase. */
function hydraHit({ npc, hit }) {
  if (!Common.isHydra(npc)) return;
  const fight = npc.__hydraFight;
  const attacker = hit.getAttacker?.();
  const parts = hit.getHits?.() ?? [];
  const offTask = attacker?.isPlayer?.() && !Common.onTask(attacker.getAsPlayer(), npc);
  for (const part of parts) part.setDamage(offTask || !fight ? (offTask ? 0 : part.getDamage()) : fight.reduce(part.getDamage()));
  hit.updateTotalDamage?.();
  if (fight && !fight.enraged) {
    const total = parts.reduce((sum, part) => sum + part.getDamage(), 0);
    // All due hits are resolved before their queued damage is applied.
    const queued = npc.getCombat().getHitQueue().getQueuedDamage();
    const room = Math.max(0, npc.getHitpoints() - queued - 1);
    if (total > room) {
      let over = total - room;
      for (const part of [...parts].reverse()) {
        const cut = Math.min(over, part.getDamage());
        part.setDamage(part.getDamage() - cut);
        over -= cut;
      }
      hit.updateTotalDamage?.();
    }
  }
}

/**
 * `combat:damage-apply`: a thrall's, recoil's or vengeance's hit skips hydraHit, so its shield
 * applies as the hit lands (Wiki, Alchemical Hydra/Strategies: it "reduces incoming damage by 75%").
 * The pre-enrage death guard already covers these hits (Kills.AlchemicalHydra.js).
 */
function directHydraHit({ target, hit }) {
  if (!hit?.getOrigin?.() || !Common.isHydra(target)) return;
  const fight = target.__hydraFight;
  if (fight) hit.setDamage(fight.reduce(hit.getDamage()));
}

function leaveWorld({ player }) {
  if (lairOf(player)) player.moveTo(Common.toLocation(Common.data.room.outside));
  leaveLair(player);
}

function attach(api) {
  defineAreaClass();
  api.onObjectInteraction("Alchemical door", { Open: openDoor, "Quick-open": openDoor });
  api.onCanSpawnNpc(blockWorldSpawn);
  api.onNpcHitModify(hydraHit);
  api.onCustomEvent("combat:damage-apply", directHydraHit);
  api.onPlayerLogout(leaveWorld);
  api.onPlayerDisconnect(leaveWorld);
}

module.exports = { attach, Lair, lairOf, enterLair, leaveLair, openDoor, blockWorldSpawn, hydraHit, LAIR_ATTRIBUTE };
