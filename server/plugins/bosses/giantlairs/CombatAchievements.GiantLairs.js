"use strict";

/**
 * Obor's and Bryophyta's Combat Achievements (plugins/achievements/combatachievements/): their kill-count
 * tasks count chests opened ("Open Obor's chest 5 times."), the lairs' own count, and beating
 * either on a free-to-play world is a task of its own. The rest are fight rules
 * (plugins/achievements/combatachievements/tasks/).
 */

const Common = require("./Common.GiantLairs");

const ON_A_FREE_WORLD = { Obor: "Fighting as Intended", Bryophyta: "Fighting as Intended II" };

let api;

function chestOpened(player, lair, opened) {
  api.emitCustomEvent("combat-achievements:kill", { player, monster: lair.name, count: opened });
}

function bossKilled(player, lair, npc) {
  if (!api.core.WorldDefinition.isMembersWorld()) {
    api.emitCustomEvent("combat-achievements:complete", { player, task: ON_A_FREE_WORLD[lair.name] });
  }
  const killingBlow = npc?.getCombat?.().getHitQueue?.().getLastAppliedHit?.();
  if (lair.slug === "bryophyta" && killingBlow?.getHitmask?.() === api.core.HitMask.GREEN) {
    api.emitCustomEvent("combat-achievements:complete", { player, task: "A Slow Death" });
  }
}

function answerKillCount({ player, counts }) {
  for (const lair of Common.lairs) {
    const opened = Number(player.getAttribute(Common.CHESTS_ATTRIBUTE[lair.slug])) || 0;
    if (opened > 0) counts[lair.name] = opened;
  }
}

module.exports = function registerGiantLairsCombatAchievements(pluginApi) {
  api = pluginApi;
  pluginApi.onCustomEvent("combat-achievements:kill-count", answerKillCount);
};
Object.assign(module.exports, { chestOpened, bossKilled });
