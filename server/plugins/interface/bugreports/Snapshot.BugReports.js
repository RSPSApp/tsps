"use strict";

// The server's side of a report: the character as the server has it (a desync shows up as a
// difference from the client's view) and the world it's on.

const { execFileSync } = require("node:child_process");

let commit;

/** The checkout's commit, read once; a deployment without git has none. */
function serverCommit() {
  if (commit === undefined) {
    try {
      commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
        cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
      }).trim();
    } catch {
      commit = "";
    }
  }
  return commit || undefined;
}

function items(core, container) {
  return container.getItems()
    .map((item, slot) => item && item.getId() > 0 && item.getAmount() > 0
      ? { slot, id: item.getId(), name: core.ItemDefinition.forId(item.getId()).getName(), amount: item.getAmount() }
      : null)
    .filter(Boolean);
}

function playerSnapshot(core, player) {
  const location = player.getLocation();
  const area = player.getArea?.();
  const skillManager = player.getSkillManager();
  const skills = {};
  for (const skill of core.Skill.values()) {
    skills[skill.getName()] = {
      level: skillManager.getCurrentLevel(skill),
      max: skillManager.getMaxLevel(skill),
      xp: skillManager.getExperience(skill),
    };
  }
  return {
    rights: player.getRights().getId(),
    position: { x: location.getX(), y: location.getY(), z: location.getZ() },
    area: area ? { name: area.getName(), plugin: area.pluginName ?? null, instance: !!player.getPrivateArea?.() } : null,
    interfaceId: player.getInterfaceId(),
    wildernessLevel: player.getWildernessLevel(),
    hitpoints: player.getHitpoints(),
    combatLevel: skillManager.getCombatLevel(),
    skills,
    inventory: items(core, player.getInventory()),
    equipment: items(core, player.getEquipment()),
  };
}

function worldSnapshot(core) {
  let cache;
  try {
    cache = core.CachePipeline.getActive().name;
  } catch {}
  return {
    cache,
    commit: serverCommit(),
    production: core.Server.PRODUCTION,
    members: core.WorldDefinition.isMembersWorld(),
    experienceMultiplier: core.GameConstants.EXPERIENCE_MULTIPLIER,
    playersOnline: core.World.getNetworkPlayerCount(),
    tick: core.World.getProcessCycle(),
    uptimeSeconds: Math.round(process.uptime()),
  };
}

/** The player's details only with the player's consent (`withPlayer`); the world always. */
function serverSnapshot(core, player, withPlayer) {
  return { world: worldSnapshot(core), player: withPlayer ? playerSnapshot(core, player) : undefined };
}

module.exports = { serverSnapshot };
