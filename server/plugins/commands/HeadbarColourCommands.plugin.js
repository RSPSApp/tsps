"use strict";

/**
 * Developer commands to try headbars and component colours.
 *
 * ::headbar [npcId] [barId] [cycles] - spawns an NPC (the Doom of Mokhaiotl by default) three
 *   tiles north of you and shows a headbar over it (81, its charge bar, by default): filling from
 *   empty to full over `cycles` client cycles (390, its melee charge), then held at half for 3
 *   ticks, then taken away. The NPC goes 3 ticks later.
 * ::ifcolour <groupId> <childId> <rgb15> - recolours a component (IF_SETCOLOUR, 15-bit RGB as the
 *   game sends it). The boss HUD's bar is 303:13-15: 25600, 576, 800 normally; the Doom's shield
 *   makes them 132, 623, 853.
 */

const DEFAULT_NPC = 14707;
const DEFAULT_BAR = 81;
const DEFAULT_CYCLES = 390;
/** Headbar widths from the cache (the definition's opcode 14; 30 when unset). */
const WIDTHS = { 11: 120, 20: 120, 81: 100 };
const HOLD_TICKS = 3;

let pluginApi;

function argument(parts, index, fallback, max) {
  const value = Number.parseInt(parts?.[index], 10);
  return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}

function headbar({ player, parts }) {
  const { Task, TaskManager } = pluginApi.core;
  const npcId = argument(parts, 1, DEFAULT_NPC, 0x3fff);
  const barId = argument(parts, 2, DEFAULT_BAR, 0x7ffe);
  const cycles = Math.max(1, argument(parts, 3, DEFAULT_CYCLES, 6000));
  const width = WIDTHS[barId] ?? 30;
  const at = player.getLocation();
  const npc = pluginApi.spawnNpc({ id: npcId, x: at.getX(), y: at.getY() + 3, z: at.getZ(), wanderRadius: 0 });
  if (!npc) {
    player.sendMessage(`Couldn't spawn NPC ${npcId}.`);
    return true;
  }
  npc.__skipDefaultRespawn = true;
  npc.setFlag?.("combat:no-retaliate");
  npc.getMovementQueue().setBlockMovement(true);
  const fillTicks = Math.ceil(cycles / 30);
  // Tick 2 starts the fill; it is held at half once full, then taken away.
  const half = 2 + fillTicks + 1;
  const removed = half + HOLD_TICKS;
  const gone = removed + HOLD_TICKS;
  player.sendMessage(`Headbar ${barId} (${width} wide) over NPC ${npcId}: filling over ${cycles} cycles.`);
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, npc, false);
    }

    execute() {
      tick++;
      if (!npc.isRegistered?.()) {
        this.stop();
        return;
      }
      if (tick === 2) npc.showHeadbar(barId, { fill: 0, endFill: width, duration: cycles });
      else if (tick === half) npc.showHeadbar(barId, { fill: Math.round(width / 2) });
      else if (tick === removed) npc.removeHeadbar(barId);
      else if (tick >= gone) {
        pluginApi.removeNpc(npc);
        this.stop();
      }
    }
  })());
  return true;
}

function ifColour({ player, parts }) {
  const groupId = Number.parseInt(parts?.[1], 10);
  const childId = Number.parseInt(parts?.[2], 10);
  const colour = Number.parseInt(parts?.[3], 10);
  if (![groupId, childId, colour].every(Number.isInteger)) {
    player.sendMessage("Usage: ::ifcolour <groupId> <childId> <rgb15>");
    return true;
  }
  player.getPacketSender().sendInterfaceColour((groupId << 16) | childId, colour);
  player.sendMessage(`Coloured ${groupId}:${childId} ${colour}.`);
  return true;
}

module.exports = {
  name: "HeadbarColourCommands",
  register(api) {
    pluginApi = api;
    api.registerCommand("headbar", headbar, api.core.PlayerRights.DEVELOPER);
    api.registerCommand("ifcolour", ifColour, api.core.PlayerRights.DEVELOPER);
  },
};

Object.assign(module.exports, { headbar, ifColour });
