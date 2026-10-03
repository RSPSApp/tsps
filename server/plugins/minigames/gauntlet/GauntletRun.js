"use strict";

/**
 * One player's run through the Gauntlet: the maze, the preparation timer, the boss phase and
 * the way out. The run owns everything the player carries inside; leaving it - by the exit,
 * the barrier's Escape, death, a disconnect, or the timer running out on the Hunllef - takes
 * all of it and puts them back in the lobby.
 *
 * Wiki: you start with a crystal sceptre (wielded), axe, pickaxe, harpoon, pestle and mortar
 * and a teleport crystal; you have 10 minutes (Corrupted 7:30) to prepare, then you are taken
 * into the boss room.
 */

const Shared = require("./GauntletShared");
const GauntletMap = require("./GauntletMap");
const Resources = require("./GauntletResources");
const Monsters = require("./GauntletMonsters");
const { HunllefFight } = require("./GauntletHunllef");
const Rewards = require("./GauntletRewards");
const Scoreboard = require("./GauntletScoreboard");

const ATTR_RUN = "gauntlet:run";
const ATTR_STATS = "gauntlet:stats";

const runs = new Map();

function items() {
  const I = Shared.core().ItemIdentifiers;
  return {
    regular: {
      sceptre: I.CRYSTAL_SCEPTRE,
      tools: [I.CRYSTAL_AXE_3, I.CRYSTAL_PICKAXE_3, I.CRYSTAL_HARPOON_3, I.PESTLE_AND_MORTAR_3, I.TELEPORT_CRYSTAL],
      teleportCrystal: I.TELEPORT_CRYSTAL,
    },
    corrupted: {
      sceptre: I.CORRUPTED_SCEPTRE,
      tools: [I.CORRUPTED_AXE, I.CORRUPTED_PICKAXE, I.CORRUPTED_HARPOON, I.PESTLE_AND_MORTAR_3, I.CORRUPTED_TELEPORT_CRYSTAL],
      teleportCrystal: I.CORRUPTED_TELEPORT_CRYSTAL,
    },
  };
}

function runOf(player) {
  return runs.get(player.getUsername?.()) ?? null;
}

/** The player's run, while they are in its maze. */
function runInside(player) {
  const run = runOf(player);
  return run && player.getArea?.() === run.map ? run : null;
}

// Nodes beside a lit neighbour show lit (the unclickable version two ids on).
const NODES = { regular: [36101, 36102], corrupted: [35998, 35999] };
const LIT_NODE_OFFSET = 2;

function savePlayer(player) {
  try {
    Shared.core().GameConstants.PLAYER_PERSISTENCE?.save(player);
  } catch (error) {
    console.warn("[gauntlet] could not save", player.getUsername?.(), error);
  }
}

function statsOf(player) {
  const saved = player.getAttribute(ATTR_STATS);
  return {
    completions: { regular: 0, corrupted: 0, ...(saved?.completions ?? {}) },
    deaths: { regular: 0, corrupted: 0, ...(saved?.deaths ?? {}) },
    // Fastest completions, start to kill, in ticks (-1 none yet).
    bestTicks: { regular: -1, corrupted: -1, ...(saved?.bestTicks ?? {}) },
  };
}

/** Records a completion's time; true when it is a personal best. */
function recordBest(player, mode, ticks) {
  const stats = statsOf(player);
  const best = stats.bestTicks[mode];
  if (best > 0 && best <= ticks) return false;
  stats.bestTicks[mode] = ticks;
  player.setAttribute(ATTR_STATS, stats);
  return true;
}

function recordStat(player, kind, mode) {
  const stats = statsOf(player);
  stats[kind][mode]++;
  player.setAttribute(ATTR_STATS, stats);
}

function hasCompleted(player) {
  const { completions } = statsOf(player);
  return completions.regular + completions.corrupted > 0;
}

/** The entrance offers Enter-corrupted once any Gauntlet is completed (varp 2353). */
function sendCompletionVarp(player) {
  player.getPacketSender().sendConfig(Shared.VARP.COMPLETED, hasCompleted(player) ? 1 : 0);
}

class GauntletRun {
  constructor(player, { corrupted = false, random = Math.random } = {}) {
    this.player = player;
    this.corrupted = corrupted;
    this.mode = corrupted ? "corrupted" : "regular";
    this.random = random;
    this.map = GauntletMap.createMap({ corrupted, random });
    this.map.run = this;
    this.stage = "prep";
    this.prepTicks = Shared.PREP_TICKS[this.mode];
    this.prepLeft = this.prepTicks;
    this.startCycle = 0;
    this.bossCycle = 0;
    this.timer = null;
    this.room = null;
    // Kills by tier and the weapon components dropped, for the drop rules (GauntletMonsters).
    this.kills = { weak: 0, strong: 0, demi: 0 };
    // Reward points for a run that doesn't kill the Hunllef (GauntletRewards).
    this.points = 0;
    this.strongFrame = false;
    this.components = new Set();
    runs.set(player.getUsername(), this);
  }

  /** Takes the player in: fade, starting kit, the timer, and the maze varbits. */
  start() {
    const player = this.player;
    // Saved as they step in (in the lobby, empty-handed), so nothing is lost if the server stops.
    savePlayer(player);
    player.setAttribute(ATTR_RUN, this.mode);
    Shared.fadeMove(player, () => {
      if (this.stage === "ended") return;
      Shared.clearItems(player);
      this.giveStartingItems();
      player.resetAttributes();
      this.map.enter(player);
      this.lightNodesAround(this.map.room(this.map.start.x, this.map.start.y));
      // The Hunllef waits in its room from the start (the room is lit and can be seen into).
      this.hunllef = new HunllefFight(this);
      player.moveTo(this.map.startTile(this.random));
      player.sendMessage("You enter the Gauntlet.");
      this.startCycle = Shared.core().World.getProcessCycle();
      this.sendMazeVarbits();
      const sender = player.getPacketSender();
      sender.sendSubInterface(Shared.OVERLAY_HUD_UID, Shared.INTERFACE.TIMER, 1);
      sender.sendClientScript(Shared.SCRIPT.TIMER_START, this.prepLeft);
      this.timer = Shared.repeat(this, 1, () => this.tick());
    });
  }

  giveStartingItems() {
    const { Item, Equipment } = Shared.core();
    const kit = items()[this.mode];
    const equipment = this.player.getEquipment();
    equipment.setItem(Equipment.WEAPON_SLOT, new Item(kit.sceptre));
    equipment.refreshItems();
    for (const id of kit.tools) this.player.getInventory().adds(id, 1);
    this.player.getInventory().refreshItems();
  }

  sendMazeVarbits() {
    const sender = this.player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.CORRUPTED, this.corrupted ? 1 : 0);
    sender.sendVarbit(Shared.VARBIT.MAZE_MAP, 1);
    sender.sendVarbit(Shared.VARBIT.BOSS_PHASE, 0);
    sender.sendVarbit(Shared.VARBIT.START_ROOM, this.map.start.y * GauntletMap.GRID + this.map.start.x);
    for (const room of this.map.rooms.flat()) {
      sender.sendVarbit(Shared.VARBIT.ROOM_LIT_FIRST + room.gridY * GauntletMap.GRID + room.gridX, room.lit ? 1 : 0);
    }
    this.updateRoom();
  }

  /** The maze map marks the room the player stands in. */
  updateRoom() {
    const room = this.map.roomAt(this.player.getLocation());
    if (!room || room === this.room) return;
    this.room = room;
    const sender = this.player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.CURRENT_ROOM_X, room.gridX);
    sender.sendVarbit(Shared.VARBIT.CURRENT_ROOM_Y, room.gridY);
  }

  tick() {
    if (this.stage !== "prep") return false;
    this.prepLeft--;
    // The overlay counts down on its own; keep it in step now and then, and closely at the end.
    if (this.prepLeft % 50 === 0 || this.prepLeft < 15) {
      this.player.getPacketSender().sendClientScript(Shared.SCRIPT.TIMER_START, Math.max(0, this.prepLeft));
    }
    if (this.prepLeft <= 0) {
      this.startBossPhase({ forced: true });
      return false;
    }
    return true;
  }

  /** Lights the room next to a node; false when there is none or it is already lit. */
  lightRoom(gridX, gridY) {
    if (this.stage !== "prep") return false;
    if (!this.map.lightRoom(gridX, gridY)) return false;
    this.player.getPacketSender().sendVarbit(Shared.VARBIT.ROOM_LIT_FIRST + gridY * GauntletMap.GRID + gridX, 1);
    const room = this.map.room(gridX, gridY);
    Resources.stockRoom(this.map, room, this.random);
    Monsters.populateRoom(this, room, this.random);
    this.lightNodesAround(room);
    return true;
  }

  /** Lights the nodes on both sides of every passage between this room and a lit neighbour. */
  lightNodesAround(room) {
    for (const side of GauntletMap.SIDES) {
      const next = this.map.room(room.gridX + side.dx, room.gridY + side.dy);
      if (!next?.lit) continue;
      this.lightNodes(room, side);
      this.lightNodes(next, GauntletMap.SIDES.find((other) => other.dx === -side.dx && other.dy === -side.dy));
    }
  }

  lightNodes(room, side) {
    const ids = NODES[this.mode];
    const last = GauntletMap.ROOM_TILES - 1;
    for (let i = 0; i <= last; i++) {
      for (const depth of [0, 1]) {
        const x = side.dx > 0 ? last - depth : side.dx < 0 ? depth : i;
        const y = side.dy > 0 ? last - depth : side.dy < 0 ? depth : i;
        const tile = this.map.roomTile(room, x, y);
        const spawned = this.map.getObjects().some((object) => object.getLocation().equals(tile) && object.getType() === 10);
        if (spawned) continue;
        const node = this.map.getTemplateObjects(tile).find((object) => ids.includes(object.getId()));
        if (node) Resources.replaceObject(this.map, node, node.getId() + LIT_NODE_OFFSET);
      }
    }
  }

  addPoints(points) {
    if (this.stage !== "ended") this.points += points;
  }

  /** Back to the start room, as the teleport crystal does. */
  teleportToStart() {
    if (this.stage !== "prep") return false;
    this.player.moveTo(this.map.startTile(this.random));
    return true;
  }

  inStartRoom(location) {
    return this.map.roomAt(location) === this.map.room(this.map.start.x, this.map.start.y);
  }

  /** Through the barrier, or dragged in when the timer runs out. */
  startBossPhase({ forced = false } = {}) {
    if (this.stage !== "prep") return false;
    this.stage = "boss";
    this.bossCycle = Shared.core().World.getProcessCycle();
    this.timer?.stop?.();
    const player = this.player;
    const sender = player.getPacketSender();
    sender.sendVarbit(Shared.VARBIT.BOSS_PHASE, 1);
    sender.sendClientScript(Shared.SCRIPT.TIMER_BOSS);
    this.hunllef?.start();
    if (forced) {
      player.getCombat().reset();
      player.getMovementQueue().reset();
      player.moveTo(this.map.roomTile(this.map.room(GauntletMap.CENTRE, GauntletMap.CENTRE), 4, 4));
      player.sendMessage("You have run out of time, and are taken to face the Hunllef.");
    }
    Shared.api()?.emitCustomEvent?.("gauntlet:boss-phase", { run: this, player, forced });
    return true;
  }

  /** The Hunllef's 12x12 floor, inside the boss room's walls and barriers. */
  inArena(location) {
    const corner = this.map.roomTile(this.map.room(GauntletMap.CENTRE, GauntletMap.CENTRE), 0, 0);
    const x = location.getX() - corner.getX();
    const y = location.getY() - corner.getY();
    return location.getZ() === corner.getZ() && x >= 2 && x <= 13 && y >= 2 && y <= 13;
  }

  /**
   * Ends the run. `reason`: "exit", "escape", "death", "logout", "left", "completed".
   * Everything carried is taken; the player is put back in the lobby. `fromArea` when the maze
   * itself is being left (a logout), which then needs no leaving.
   */
  end(reason, { fade = reason === "exit" || reason === "escape" || reason === "completed", fromArea = false } = {}) {
    if (this.stage === "ended") return;
    this.stage = "ended";
    this.timer?.stop?.();
    this.hunllef?.stop();
    Resources.stopGathering(this.player);
    runs.delete(this.player.getUsername());
    const player = this.player;
    player.setAttribute(ATTR_RUN, null);
    const now = Shared.core().World.getProcessCycle();
    if (reason === "death") {
      recordStat(player, "deaths", this.mode);
      Scoreboard.recordGlobal(this.mode, "death");
    }
    const messages = reason === "completed" ? this.completionMessages(now) : [];
    const reward = Rewards.rewardFor(this, reason);
    Shared.api()?.emitCustomEvent?.("gauntlet:end", { run: this, player, reason, reward });

    const leave = () => {
      Shared.clearItems(player);
      player.resetAttributes();
      const sender = player.getPacketSender();
      sender.closeSubInterface(Shared.OVERLAY_HUD_UID);
      sender.sendVarbit(Shared.VARBIT.BOSS_PHASE, 0);
      sender.sendVarbit(Shared.VARBIT.MAZE_MAP, 0);
      sendCompletionVarp(player);
      // Leave before moving, so the scene goes straight back to the normal map.
      if (!fromArea && player.getArea?.() === this.map) this.map.leave(player, reason === "logout");
      player.moveTo(Shared.loc(Shared.LOBBY));
      // Saved back in the lobby; a logout saves on its own right after.
      if (reason !== "logout") savePlayer(player);
      if (reason === "death") player.sendMessage("Oh dear, you are dead!");
      else if (reason !== "logout" && reason !== "completed") player.sendMessage("You leave the Gauntlet.");
      for (const message of messages) player.sendMessage(message);
      Rewards.setReward(player, this.mode, reward);
      if (reward) player.sendMessage("Your reward awaits you in the nearby chest.");
    };
    if (fade) Shared.fadeMove(player, leave);
    else leave();
  }
}

const RED = (text) => `<col=ef1020>${text}</col>`;

GauntletRun.prototype.completionMessages = function completionMessages(now) {
  const player = this.player;
  const total = Math.max(1, now - this.startCycle);
  const prep = Math.max(0, (this.bossCycle || now) - this.startCycle);
  const kill = Math.max(0, now - (this.bossCycle || now));
  recordStat(player, "completions", this.mode);
  const best = recordBest(player, this.mode, total);
  Scoreboard.recordGlobal(this.mode, "completion", total);
  const stats = statsOf(player);
  const name = this.corrupted ? "Corrupted Gauntlet" : "Gauntlet";
  return [
    `Challenge duration: ${RED(Scoreboard.formatTicks(total))}.${best ? " (new personal best)" : ` Personal best: ${Scoreboard.formatTicks(stats.bestTicks[this.mode])}`}`,
    `Preparation time: ${RED(Scoreboard.formatTicks(prep))}. Hunllef kill time: ${RED(Scoreboard.formatTicks(kill))}.`,
    `Your ${name} completion count is: ${RED(stats.completions[this.mode])}.`,
  ];
};

function startRun(player, options) {
  const run = new GauntletRun(player, options);
  run.start();
  return run;
}

module.exports = {
  ATTR_RUN, ATTR_STATS, GauntletRun, runOf, runInside, startRun, statsOf, hasCompleted, sendCompletionVarp, items,
};
