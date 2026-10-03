"use strict";

const Rules = require("./GodWarsRules");
const Shared = require("./GodWarsShared");

const AREA_ATTRIBUTE = "gwd:boss_area";
const RESPAWN_TICKS = 150;

module.exports = function registerGodWarsEncounters(api) {
  const { Boundary, Location, ItemIdentifiers, NPC, PrivateArea, Task, TaskManager, World } = api.core;
  const factions = Shared.buildFactions(api.core);

  function isLiveGeneral(area, faction) {
    return area.getNpcs().some(
      (npc) =>
        npc.getHitpoints() > 0 &&
        (faction.generalIds.includes(npc.getId()) || faction.generalIds.includes(npc.getRealId?.()))
    );
  }

  function spawnAdventurer(area, faction, definition) {
    const npc = NPC.create(definition.id, new Location(definition.x, definition.y, definition.z));
    npc.__skipDefaultRespawn = true;
    npc.getMovementCoordinator?.().setRadius?.(4);
    area.add(npc);
    World.getAddNPCQueue().push(npc);
    return npc;
  }

  function ensureEncounterSpawned(area) {
    if (area.isDestroyed?.() === true) {
      return;
    }
    const faction = area.getFaction();
    if (isLiveGeneral(area, faction)) {
      return;
    }
    const generalId = faction.generalIds[0];
    const general = faction.spawns.general;
    spawnAdventurer(area, faction, { id: generalId, ...general });
    for (const guard of faction.spawns.guards) {
      const alive = area
        .getNpcs()
        .some((npc) => npc.getId() === guard.id && npc.getHitpoints() > 0);
      if (!alive) {
        spawnAdventurer(area, faction, guard);
      }
    }
  }

  class GodWarsBossArea extends PrivateArea {
    constructor(faction) {
      const room = faction.room;
      super([new Boundary(room.minX, room.maxX, room.minY, room.maxY, room.z)]);
      this.faction = faction;
    }

    getFaction() {
      return this.faction;
    }

    destroy() {
      if (this.isDestroyed?.() === true) {
        return;
      }
      const addQueue = World.getAddNPCQueue();
      for (const entity of this.entities ?? []) {
        if (!entity?.isNpc?.()) {
          continue;
        }
        for (let index = addQueue.indexOf(entity); index !== -1; index = addQueue.indexOf(entity)) {
          addQueue.splice(index, 1);
        }
      }
      super.destroy();
    }

    postLeave(mobile, logout) {
      if (mobile?.isPlayer?.() && mobile.getAttribute(AREA_ATTRIBUTE) === this) {
        mobile.setAttribute(AREA_ATTRIBUTE, null);
      }
      super.postLeave(mobile, logout);
    }
  }

  function movePlayerIntoArea(player, area) {
    const current = player.getArea?.();
    if (current && current !== area) {
      current.leave(player, false);
    }
    if (player.getArea?.() !== area) {
      area.enter(player);
    }
  }

  function enterBossRoom(player, faction) {
    let area = player.getAttribute(AREA_ATTRIBUTE);
    if (
      !(area instanceof GodWarsBossArea) ||
      area.isDestroyed?.() === true ||
      area.getFaction().key !== faction.key
    ) {
      area = new GodWarsBossArea(faction);
      player.setAttribute(AREA_ATTRIBUTE, area);
    }
    movePlayerIntoArea(player, area);
    ensureEncounterSpawned(area);
    player.smartMove(Shared.toLocation(api.core, faction.inside), 2);
    player.sendMessage(`You open the door and enter ${faction.name}'s chamber.`);
  }

  function openBossDoor({ player, object }) {
    const faction = Shared.factionForDoor(factions, object?.getId?.());
    if (!faction) {
      return;
    }
    const result = Rules.canOpenBossDoor({
      hasGodItem: Shared.godItemEquipped(api.core, player, faction),
      killCount: Shared.getKillCount(player, faction),
      hasKey: Shared.hasEcumenicalKey(api.core, player),
    });
    if (!result.ok) {
      player.sendMessage(result.reason);
      return true;
    }
    if (result.consumesKey) {
      player.getInventory().delete(ItemIdentifiers.ECUMENICAL_KEY, 1);
      player.sendMessage("Your ecumenical key unlocks the door.");
    }
    // Entering consumes the essence, as the boss room doors do on OSRS.
    Shared.setKillCount(player, faction, 0);
    enterBossRoom(player, faction);
    return true;
  }

  function peekBossDoor({ player, object }) {
    const faction = Shared.factionForDoor(factions, object?.getId?.());
    if (!faction) {
      return;
    }
    const area = player.getAttribute(AREA_ATTRIBUTE);
    const players =
      area instanceof GodWarsBossArea && area.isDestroyed?.() !== true
        ? area.getPlayers().length
        : 0;
    player.sendMessage(
      `${faction.name} essence: ${Shared.getKillCount(player, faction)}/${Rules.REQUIRED_KILL_COUNT}.`
    );
    if (players > 0) {
      player.sendMessage(`Players in your chamber: ${players}.`);
    }
    return true;
  }

  function useAltar({ player, object }) {
    const faction = Shared.factionForAltar(factions, object?.getId?.());
    if (!faction) {
      return;
    }
    const area = player.getAttribute(AREA_ATTRIBUTE);
    if (area instanceof GodWarsBossArea && area.isDestroyed?.() !== true) {
      area.leave(player, false);
    } else {
      player.setAttribute(AREA_ATTRIBUTE, null);
    }
    player.smartMove(Shared.toLocation(api.core, faction.outside), 2);
    player.sendMessage("You step outside the chamber.");
    return true;
  }

  class BossRespawnTask extends Task {
    constructor(area) {
      super(RESPAWN_TICKS, area);
    }

    execute() {
      const area = this.key;
      if (area.isDestroyed?.() === true || area.getPlayers().length === 0) {
        this.stop();
        return;
      }
      ensureEncounterSpawned(area);
      this.stop();
    }
  }

  function handleEncounterDeath({ npc }) {
    const area = npc?.getArea?.();
    if (!(area instanceof GodWarsBossArea)) {
      return;
    }
    npc.__skipDefaultRespawn = true;
    const faction = area.getFaction();
    const isGeneral =
      faction.generalIds.includes(npc.getId()) || faction.generalIds.includes(npc.getRealId?.());
    if (isGeneral) {
      TaskManager.submit(new BossRespawnTask(area));
    }
  }

  // Wipe, teleport or disconnect: the area destroys itself once empty, which
  // pushes every general and bodyguard out with it.
  function leaveEncounter({ player }) {
    if (!player) {
      return;
    }
    const area = player.getAttribute(AREA_ATTRIBUTE);
    if (area instanceof GodWarsBossArea && area.isDestroyed?.() !== true) {
      area.leave(player, true);
    } else {
      player.setAttribute(AREA_ATTRIBUTE, null);
    }
  }

  api.onObjectFirstClick(
    [Shared.DOOR_BANDOS, Shared.DOOR_ARMADYL, Shared.DOOR_SARADOMIN, Shared.DOOR_ZAMORAK],
    openBossDoor
  );
  api.onObjectThirdClick(
    [Shared.DOOR_BANDOS, Shared.DOOR_ARMADYL, Shared.DOOR_SARADOMIN, Shared.DOOR_ZAMORAK],
    peekBossDoor
  );
  api.onObjectSecondClick(
    [Shared.ALTAR_BANDOS, Shared.ALTAR_ARMADYL, Shared.ALTAR_SARADOMIN, Shared.ALTAR_ZAMORAK],
    useAltar
  );
  api.onNpcDeath(handleEncounterDeath);
  api.onPlayerDeath(leaveEncounter);
  api.onPlayerLogout(leaveEncounter);
  api.onPlayerDisconnect(leaveEncounter);
};
