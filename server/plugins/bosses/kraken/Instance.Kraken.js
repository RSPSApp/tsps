"use strict";

// Private room ownership, lifecycle and relocation on return.
const Shared = require("./Shared.Kraken");
const { COVE } = require("./Area.Kraken");
const INSTANCE_ATTRIBUTE = "kraken:private-instance";
const EXIT_TILE = [2280, 10016, 0];

const LAYOUT = [
  ["BOSS_WHIRLPOOL", 2278, 10034],
  ["TENTACLE_WHIRLPOOL", 2275, 10034],
  ["TENTACLE_WHIRLPOOL", 2275, 10038],
  ["TENTACLE_WHIRLPOOL", 2284, 10038],
  ["TENTACLE_WHIRLPOOL", 2284, 10034],
];
let InstanceArea;

function instanceClass() {
  if (InstanceArea) return InstanceArea;
  const { PrivateArea, Boundary } = Shared.core();
  InstanceArea = class KrakenInstance extends PrivateArea {
    constructor(owner) {
      super([new Boundary(COVE[0], COVE[2], COVE[1], COVE[3], 0)]);
      this.owner = owner;
      this.isKrakenInstance = true;
      this.owned = new Set();
    }

    getName() { return "Kraken Cove"; }
    isMulti() { return true; }
    // OSRS update, 17 August 2017: floor items last 30 minutes in the instance.
    groundItemDespawnDelay() { return 3000; }
    canAttack(attacker, target) {
      if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return null;
      return Shared.onTask(attacker.getAsPlayer(), target) ? null : false;
    }

    postLeave(mobile, logout) {
      if (mobile.isPlayer?.()) {
        try {
          mobile.setAttribute(INSTANCE_ATTRIBUTE, logout === true);
          this.cleanup();
        } finally {
          super.postLeave(mobile, logout);
        }
      } else {
        try { super.postLeave(mobile, logout); }
        finally { if (mobile.isNpc?.()) this.owned.delete(mobile); }
      }
    }

    spawn(id, at) {
      if (this.isDestroyed()) return null;
      const npc = Shared.api().spawnNpc({ id, x: at[0], y: at[1], z: at[2] ?? 0, wanderRadius: 0 });
      if (!npc) return null;
      npc.__skipDefaultRespawn = true;
      this.owned.add(npc);
      // A queued actor has no stable area index and cannot be admitted safely.
      if (!npc.isRegistered?.()) {
        Shared.api().removeNpc(npc);
        this.owned.delete(npc);
        return null;
      }
      try {
        this.enter(npc);
      } catch (error) {
        try {
          if (this.hasMember(npc)) this.leave(npc, false);
        } finally {
          Shared.api().removeNpc(npc);
          this.owned.delete(npc);
        }
        throw error;
      }
      return npc;
    }

    removeSpawned(npc) {
      if (this.hasMember(npc)) this.leave(npc, false);
      this.owned.delete(npc);
      Shared.api().removeNpc(npc);
    }

    spawnBatch(entries) {
      const admitted = [];
      try {
        for (const { id, at } of entries) {
          const npc = this.spawn(id, [at.getX(), at.getY(), at.getZ()]);
          if (!npc) throw new Error("Kraken instance spawn admission failed");
          admitted.push(npc);
        }
        return true;
      } catch (error) {
        for (const npc of admitted) this.removeSpawned(npc);
        return false;
      }
    }

    cleanup() {
      Shared.core().TaskManager.cancelTasks(this);
      require("./Respawn.Kraken").releaseArea(this);
      const combat = this.owner.getCombat?.();
      if (this.owned.has(combat?.getTarget?.())) combat.reset();
      if (this.owned.has(combat?.getAttacker?.())) combat.setUnderAttack(null);
      for (const npc of this.owned) {
        npc.getCombat?.().reset?.();
        npc.getCombat?.().setUnderAttack?.(null);
        // The plugin API removes both registered actors and pending additions.
        Shared.api().removeNpc(npc);
      }
      this.owned.clear();
    }
  };
  return InstanceArea;
}

function create(owner) {
  const room = new (instanceClass())(owner);
  try {
    for (const [type, x, y] of LAYOUT) {
      if (!room.spawn(Shared.ids()[type], [x, y, 0])) throw new Error("Kraken instance spawn failed");
    }
    return room;
  } catch (error) {
    discard(room);
    return null;
  }
}

function discard(room) {
  try { room.cleanup(); }
  finally { room.destroy(); }
}

function enter(room, player) {
  room.enter(player);
  player.setAttribute(INSTANCE_ATTRIBUTE, true);
}

function leave(player) {
  const room = player.getPrivateArea?.();
  if (room?.isKrakenInstance !== true || room.owner !== player) return false;
  room.leave(player, false);
  return true;
}

function onTeleportLanded({ player }) {
  // TSPS policy: a completed teleport ends the private room; a query or
  // cancelled cast does not. No retail internal-teleport parity is claimed.
  if (player) leave(player);
}

function onLogin({ player }) {
  if (player.getAttribute(INSTANCE_ATTRIBUTE) !== true) return;
  player.setAttribute(INSTANCE_ATTRIBUTE, false);
  player.moveTo(new (Shared.core().Location)(...EXIT_TILE));
}

function onDropClaim(event) {
  const room = event.npc?.getPrivateArea?.();
  if (room?.isKrakenInstance === true && room.isDestroyed()) event.handled = true;
}

function onGraveLocation(event) {
  const room = event.player?.getPrivateArea?.();
  if (room?.isKrakenInstance !== true || room.owner !== event.player) return;
  const [x, y, z] = EXIT_TILE;
  event.tile = { x, y, z };
}

function attach(api) {
  api.persistAttribute(INSTANCE_ATTRIBUTE, false);
  api.onPlayerLogin(onLogin);
  api.onCustomEvent("teleport:landed", onTeleportLanded);
  api.onCustomEvent("npc-drops:claim", onDropClaim);
  api.onCustomEvent("gravestones:grave-location", onGraveLocation);
}

module.exports = { LAYOUT, INSTANCE_ATTRIBUTE, EXIT_TILE, instanceClass, create, discard, enter, leave, attach };
