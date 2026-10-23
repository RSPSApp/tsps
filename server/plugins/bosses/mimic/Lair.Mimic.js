"use strict";

/**
 * The Mimic's private arena (see ../Mimic.plugin.js for behaviour and sources).
 *
 * One PrivateArea over the real arena room per player, entered by presenting the mimic
 * casket (item 23184) to the strange casket upstairs in Watson's house. The challenge
 * casket (7979) is spawned for the fight and removed with the area; the open-world
 * 8633 spawn is untouched. Leaving (keyhole), logging out or dying ends the fight.
 */

const Shared = require("./Shared.Mimic");

let pluginApi = null;

/** Per area: { boss, minions: { warrior, ranger, mage }, stompCount, stompTick }. */
const sessions = new Map();

function sessionOf(area) {
  return sessions.get(area) ?? null;
}

function later(ticks, action) {
  const { Task, TaskManager } = Shared.core();
  TaskManager.submit(
    new (class extends Task {
      constructor() {
        super(Math.max(1, ticks), null, false);
      }
      execute() {
        this.stop();
        action();
      }
    })(),
  );
}

let AreaClass = null;

function areaClass() {
  if (AreaClass) return AreaClass;
  const { PrivateArea, Boundary } = Shared.core();
  const { minX, maxX, minY, maxY, z } = Shared.ARENA;
  AreaClass = class MimicArea extends PrivateArea {
    constructor(owner) {
      super([new Boundary(minX, maxX, minY, maxY, z)]);
      this.owner = owner;
    }

    getName() {
      return "The Mimic";
    }

    /**
     * Multicombat: the boss piles the player together with up to three minions.
     * Without this the engine's single-way busy check (CombatFactory.canAttackPermission:
     * TARGET_IN_COMBAT) lets only the first attacker ever land a hit — the minions
     * would walk up and never swing.
     */
    isMulti() {
      return true;
    }

    /** Stomp damage for a player standing under the boss (Wiki: escalating, resets away). */
    process(mobile) {
      if (!mobile?.isPlayer?.()) return;
      const session = sessionOf(this);
      const boss = session?.boss;
      if (!boss || !Shared.alive(boss)) {
        if (session) {
          session.stompCount = 0;
        }
        return;
      }
      const player = mobile.getAsPlayer();
      if (collides(boss, player)) {
        const count = session.stompCount ?? 0;
        session.stompCount = count + 1;
        const damage = Math.min(6, 1 + Math.floor(count / 3));
        const fight = require("./Fight.Mimic");
        fight.stompHit(boss, player, damage);
      } else {
        session.stompCount = 0;
      }
    }

    /**
     * The owner leaving with the fight on costs one roll, however they leave
     * (keyhole, teleport, logout, death respawn): every leave or death. With
     * the boss dead the exit is free, as is simultaneous death. Then the fight
     * ends and cleans up as before.
     */
    postLeave(mobile, logout) {
      if (mobile.isPlayer?.() && mobile.getAsPlayer?.() === this.owner) {
        const session = sessions.get(this);
        if (session?.boss && Shared.alive(session.boss)) Shared.spendRoll(mobile.getAsPlayer(), session.casketId);
        end(this);
      }
      super.postLeave(mobile, logout);
    }
  };
  return AreaClass;
}

/** Footprint overlap between the 5x5 boss and the player. */
function collides(boss, player) {
  const at = boss.getLocation?.();
  const to = player.getLocation?.();
  if (!at || !to || at.getZ() !== to.getZ()) return false;
  const size = Math.max(1, boss.getSize?.() ?? 5);
  return (
    to.getX() >= at.getX() &&
    to.getX() < at.getX() + size &&
    to.getY() >= at.getY() &&
    to.getY() < at.getY() + size
  );
}

/** Start a private fight for `player` (who must carry the mimic casket). */
function enterArena(player) {
  const { Location } = Shared.core();
  const ids = Shared.ids();
  if (!player || !Shared.alive(player)) return false;
  const casketSlot = player.getInventory?.()?.getSlotForItemId?.(Shared.ids().CASKET_ITEM);
  if (!Number.isInteger(casketSlot) || casketSlot < 0) {
    player.sendMessage("You need the mimic casket to fight the Mimic.");
    return false;
  }
  const casket = Shared.casketState(player);
  if (casket.defeated || casket.rolls < 1) {
    player.sendMessage(casket.defeated ? "You have already defeated the Mimic in this casket. Open it outside the arena." : "This Mimic has no attempts remaining.");
    return false;
  }
  const area = new (areaClass())(player);
  pluginApi.registerArea(area);
  area.enter(player);
  const [x, y, z] = Shared.ENTRANCE_TILE;
  player.moveTo(new Location(x, y, z));
  const [cx, cy, cz] = Shared.CASKET_TILE;
  const npc = spawnNpc(ids.CHALLENGE, cx, cy, cz, player);
  if (!npc) {
    // No casket, no fight: send the player back out instead of stranding them
    // in a sessionless arena whose keyhole would do nothing.
    const [wx, wy, wz] = Shared.WATSON_TILE;
    player.moveTo(new Location(wx, wy, wz));
    try {
      area.destroy();
    } catch {
      // Post-leave cleanup may already have destroyed it.
    }
    return false;
  }
  area.add(npc);
  sessions.set(area, { boss: null, casket: npc, minions: {}, stompCount: 0, owner: player, casketId: casket.id });
  return true;
}

/** Owner-only spawn that never auto-respawns (Vorkath's sleeper pattern). */
function spawnNpc(id, x, y, z, player) {
  try {
    const npc = pluginApi.spawnNpc({ id, x, y, z, owner: player, ownerOnly: true });
    if (npc) npc.__skipDefaultRespawn = true;
    return npc ?? null;
  } catch {
    return null;
  }
}

/** End the fight: remove its NPCs and destroy the area. */
function end(area) {
  const session = sessions.get(area);
  sessions.delete(area);
  const { World } = Shared.core();
  for (const npc of [session?.boss, session?.casket, ...(Object.values(session?.minions ?? {}))]) {
    if (npc?.isRegistered?.()) {
      try {
        World.getRemoveNPCQueue().push(npc);
      } catch {
        // Already gone; the area destroy covers the rest.
      }
    }
  }
  try {
    area.destroy();
  } catch {
    // Already destroyed on logout paths.
  }
}

/** The keyhole out: back to Watson's house, by the strange casket. */
function doLeave(player) {
  const { Location } = Shared.core();
  const [x, y, z] = Shared.WATSON_TILE;
  player.moveTo(new Location(x, y, z));
  return true;
}

/**
 * Using/exiting the keyhole asks first, verbatim from the game:
 * "Are you sure you wish to leave?" / "Yes, leave this place." /
 * "No, stay here." Only inside a fight; the open-world keyhole is untouched.
 */
function leave({ player, object }) {
  if (!player || !Shared.alive(player)) return false;
  const area = player.getArea?.();
  if (!(area instanceof areaClass()) || !sessions.has(area)) return false;
  const { DialogueChainBuilder, OptionDialogue } = Shared.core();
  const built = new DialogueChainBuilder();
  // Clicks arrive one-based via DialogueManager.handleResume (1 = first option).
  built.add(new OptionDialogue(0, { executeOption: (option) => {
    if (Number(option) === 1) {
      doLeave(player);
      // Answer the click, or the box sits on "Please wait..." after leaving.
      // (The roll, if any is owed, is spent by postLeave on the way out.)
      player.getPacketSender?.()?.sendInterfaceRemoval?.();
    } else player.getPacketSender?.()?.sendInterfaceRemoval?.();
  } }, "Yes, leave this place.", "No, stay here.").setTitle("Are you sure you wish to leave?"));
  player.getDialogueManager().startDialogues(built);
  return true;
}

/** A death in the arena leaves its grave outside, by the strange casket: the
 * instance is destroyed on exit, so nothing recoverable may stay inside. */
function graveOutside(request) {
  const player = request?.player;
  if (!player) return;
  const area = player.getArea?.();
  if (!(area instanceof areaClass()) || !sessions.has(area)) return;
  const [x, y, z] = Shared.WATSON_TILE;
  request.tile = { x, y, z };
}

function attach(api) {
  pluginApi = api;
  api.onObjectInteraction("Keyhole", { Use: leave, Exit: leave });
  api.onCustomEvent("gravestones:grave-location", graveOutside);
}

module.exports = { attach, enterArena, leave, end, sessionOf, areaClass, spawnNpc };
