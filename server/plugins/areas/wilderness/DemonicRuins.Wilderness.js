"use strict";

// The OSRS prayer area is 24x32 tiles around the ruins (map location 3294, 3889).
// It restores one point every five game ticks; the Annakarl teleport landing is inside it.
const AREA = { minX: 3282, maxX: 3305, minY: 3873, maxY: 3904, z: 0 };
const RESTORE_TICKS = 5;
const RESTORE_MESSAGE = "A dark and ancient energy is emitted from the ruins granting you faster prayer restoration.";
const DIARY_TASK = "restore-some-prayer-points-at-the-demonic-ruins";
const playersInArea = new WeakMap();

let api;
let core;
let wildernessRules;

function rules() {
  if (!wildernessRules) {
    const request = { rules: null };
    api.emitCustomEvent("wilderness:rules", request);
    wildernessRules = request.rules;
  }
  return wildernessRules;
}

function playerFor(mobile) {
  return mobile?.isPlayer?.() ? mobile.getAsPlayer() : null;
}

function enterRuins(player) {
  player.sendMessage(RESTORE_MESSAGE);
  playersInArea.set(player, { nextRestoreAt: core.World.getProcessCycle() + RESTORE_TICKS });
}

function leaveRuins(mobile) {
  const player = playerFor(mobile);
  if (player) playersInArea.delete(player);
}

function processRuins(mobile) {
  rules()?.process(mobile);
  const player = playerFor(mobile);
  if (!player) return;
  if (player.getPrivateArea?.() != null) {
    playersInArea.delete(player);
    return;
  }

  let state = playersInArea.get(player);
  if (!state) {
    enterRuins(player);
    return;
  }

  const now = core.World.getProcessCycle();
  if (now < state.nextRestoreAt) return;
  state.nextRestoreAt = now + RESTORE_TICKS;

  const skills = player.getSkillManager();
  const prayer = skills.getCurrentLevel(core.Skill.PRAYER);
  if (prayer >= skills.getMaxLevel(core.Skill.PRAYER)) return;

  skills.setCurrentLevels(core.Skill.PRAYER, prayer + 1);
  skills.updateSkill(core.Skill.PRAYER);
  api.emitCustomEvent("diary:task", {
    player,
    diary: "wilderness",
    task: DIARY_TASK,
  });
}

function createRuinsArea() {
  class DemonicRuinsArea extends core.Area {
    postEnter(mobile) {
      rules()?.postEnter(mobile);
      const player = playerFor(mobile);
      if (player) enterRuins(player);
    }

    postLeave(mobile, logout) {
      rules()?.postLeave(mobile, logout);
      leaveRuins(mobile);
    }

    process(mobile) {
      processRuins(mobile);
    }

    canAttack(attacker, target, method) {
      return rules()?.canAttack(attacker, target, method) ?? null;
    }

    canTeleport(player, wildernessLevelLimit) {
      return rules()?.canTeleport(player, wildernessLevelLimit) ?? null;
    }

    npcAggressionTolerance(player, npc) {
      return rules()?.npcAggressionTolerance(player, npc) ?? null;
    }
  }

  return new DemonicRuinsArea([
    new core.Boundary(AREA.minX, AREA.maxX, AREA.minY, AREA.maxY, AREA.z),
  ]);
}

module.exports = function attachDemonicRuins(pluginApi) {
  api = pluginApi;
  core = api.core;
  wildernessRules = null;
  api.registerArea(createRuinsArea());
};

Object.assign(module.exports, { AREA, processRuins, rules });
