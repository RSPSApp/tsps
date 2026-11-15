"use strict";

/**
 * Rotten potato > Eat (Wiki: Rotten potato): Set all stats, Wipe inventory, Setup POH, Teleport to
 * player and Spawn aggressive NPC.
 */
const Common = require("./Common.RottenPotato");

const TITLE = "Eat";
const MAX_LEVEL = 99;
const MIN_HITPOINTS = 10;
/** "one skill per tick, in the following order" (Wiki). Sailing came after the page; it goes last before Hitpoints. */
const STAT_ORDER = [
  "ATTACK", "STRENGTH", "RANGED", "MAGIC", "DEFENCE", "PRAYER", "AGILITY", "HERBLORE", "THIEVING", "CRAFTING",
  "RUNECRAFTING", "MINING", "SMITHING", "FISHING", "COOKING", "FIREMAKING", "WOODCUTTING", "FLETCHING", "SLAYER",
  "FARMING", "CONSTRUCTION", "HUNTER", "SAILING", "HITPOINTS",
];
const SET_STATS_TASK = "rotten-potato:set-stats";

function eat({ player }) {
  if (!Common.permitted(player)) return;
  Common.menu(player, TITLE, [
    ["Set all stats", askLevel],
    ["Wipe inventory", wipeInventory],
    ["Setup POH", setupHouse],
    ["Teleport to player", askPlayer],
    ["Spawn aggressive NPC", askNpc],
  ]);
}

function askLevel(player) {
  Common.askNumber(player, "Enter a level:", (level) => setAllStats(player, level));
}

/** Sets one skill a tick, each with its "setstat" line, then "... finished cheating." */
function setAllStats(player, level) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
    player.sendMessage(`Enter a level from 1 to ${MAX_LEVEL}.`);
    return;
  }
  const core = Common.getCore();
  const skills = STAT_ORDER.map((key) => core.Skill[key]).filter(Boolean);
  core.TaskManager.cancelTasks(`${SET_STATS_TASK}:${player.getUsername()}`);
  let next = 0;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, `${SET_STATS_TASK}:${player.getUsername()}`, true); }
    execute() {
      if (!player.isRegistered()) return this.stop();
      if (next >= skills.length) {
        player.sendMessage("... finished cheating.");
        return this.stop();
      }
      setStat(player, skills[next++], level);
    }
  })());
}

function setStat(player, skill, level) {
  const { SkillManager, WeaponInterfaceManager, Flag, Skill } = Common.getCore();
  const value = skill === Skill.HITPOINTS ? Math.max(MIN_HITPOINTS, level) : level;
  player.getSkillManager()
    .setCurrentLevels(skill, value)
    .setMaxLevel(skill, value)
    .setExperience(skill, SkillManager.getExperienceForLevel(value));
  WeaponInterfaceManager.assign(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  player.sendMessage(`setstat ${skill.getName().toLowerCase()} ${value}`);
}

/** "deletes all items in the player's inventory except for the rotten potato" (Wiki). */
function wipeInventory(player) {
  const inventory = player.getInventory();
  const potato = Common.potatoId();
  inventory.getItems().forEach((item, slot) => {
    if (item && item.getId() > 0 && item.getId() !== potato) inventory.deleteAtSlot(slot, item.getAmount(), false);
  });
  inventory.refreshItems();
  Common.getApi().emitCustomEvent("persistence:save", { player, reason: "inventory-clear" });
}

/** "Creates a player-owned house with a random layout" (Wiki), through the Construction plugin. */
function setupHouse(player) {
  const request = { player, handled: false };
  Common.getApi().emitCustomEvent("construction:random-house", request);
  if (!request.handled) player.sendMessage("Your house couldn't be set up.");
}

function askPlayer(player) {
  Common.askText(player, "Enter name of player to teleport to:", (name) => teleportToPlayer(player, name));
}

function teleportToPlayer(player, name) {
  const target = Common.onlinePlayer(name);
  if (!target || target === player) {
    player.sendMessage(target ? "You are already there." : `${name || "That player"} is not online.`);
    return;
  }
  player.moveTo(target.getLocation().clone());
}

function askNpc(player) {
  Common.askNumber(player, "Enter NPC id:", (id) => spawnAggressiveNpc(player, id));
}

/** An NPC beside the player that attacks them at once. The Wiki names the option only. */
function spawnAggressiveNpc(player, id) {
  const name = Common.npcName(id);
  if (!name) {
    player.sendMessage(`There is no NPC ${id}.`);
    return;
  }
  if (!Common.canFight(id)) {
    player.sendMessage(`The ${name} can't fight.`);
    return;
  }
  const tile = Common.freeTilesAround(player)[0];
  if (!tile) {
    player.sendMessage("There's no room beside you.");
    return;
  }
  const npc = Common.getApi().spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: tile.getZ(), wanderRadius: 0 });
  if (!npc) {
    player.sendMessage(`The ${name} couldn't be spawned.`);
    return;
  }
  if (!(npc.getHitpoints?.() > 0)) npc.setHitpoints(MIN_HITPOINTS);
  player.getPrivateArea?.()?.add?.(npc);
  npc.getCombat().attack(player);
}

module.exports = function attach(api) {
  api.onItemAction(Common.POTATO_NAME, { Eat: eat });
};
