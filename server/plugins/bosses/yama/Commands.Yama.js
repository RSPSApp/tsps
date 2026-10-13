/**
 * Developer commands for testing Yama: ::yamahp <hitpoints> sets the player's own Yama's
 * hitpoints (1666 or 833 to reach a phase change at his next attack, a few to finish him off);
 * ::yamajudgehp <hitpoints> sets the Judge of Yama's; ::yamajudgekill deals it its remaining
 * hitpoints past its prayers; ::yamakill lands a hit of Yama's remaining hitpoints from the player
 * (in phase 3; earlier the next phase change comes first).
 */
const Common = require("./Common.Yama");
const Domain = require("./Domain.Yama");

function setYamaHitpoints({ player, parts }) {
  const yama = Domain.sessionOf(player)?.fight?.yama;
  const hitpoints = Number(parts?.[1]);
  if (!yama || yama.getHitpoints() <= 0) {
    player.sendMessage("You are not fighting Yama.");
    return true;
  }
  if (!Number.isInteger(hitpoints) || hitpoints < 1) {
    player.sendMessage("Use ::yamahp <hitpoints>.");
    return true;
  }
  yama.setHitpoints(hitpoints);
  player.sendMessage(`Yama now has ${hitpoints} hitpoints.`);
  return true;
}

function setJudgeHitpoints({ player, parts }) {
  const judge = Domain.sessionOf(player)?.fight?.judge?.npc;
  const hitpoints = Number(parts?.[1]);
  if (!judge || judge.getHitpoints() <= 0) {
    player.sendMessage("You are not facing the Judge of Yama.");
    return true;
  }
  if (!Number.isInteger(hitpoints) || hitpoints < 1) {
    player.sendMessage("Use ::yamajudgehp <hitpoints>.");
    return true;
  }
  judge.setHitpoints(hitpoints);
  player.sendMessage(`The Judge of Yama now has ${hitpoints} hitpoints.`);
  return true;
}

function killJudge({ player }) {
  const judge = Domain.sessionOf(player)?.fight?.judge?.npc;
  if (!judge || judge.getHitpoints() <= 0) {
    player.sendMessage("You are not facing the Judge of Yama.");
    return true;
  }
  const { HitDamage, HitMask } = Common.core;
  judge.getCombat().getHitQueue().addPendingDamage([new HitDamage(judge.getHitpoints(), HitMask.RED)]);
  return true;
}

function killYama({ player }) {
  const yama = Domain.sessionOf(player)?.fight?.yama;
  if (!yama || yama.getHitpoints() <= 0) {
    player.sendMessage("You are not fighting Yama.");
    return true;
  }
  const { PendingHit, CombatFactory, World } = Common.core;
  const hit = new PendingHit(player, yama, CombatFactory.MELEE_COMBAT, { delay: 0, rollAccuracy: false });
  for (const part of hit.getHits()) part.setDamage(yama.getHitpoints());
  hit.updateTotalDamage();
  yama.getCombat().getHitQueue().addPendingHit(hit, World.getProcessCycle());
  return true;
}

module.exports = function attachCommands(api) {
  api.registerCommand("yamahp", setYamaHitpoints, api.core.PlayerRights.DEVELOPER, "Set your Yama's hitpoints");
  api.registerCommand("yamajudgehp", setJudgeHitpoints, api.core.PlayerRights.DEVELOPER, "Set the Judge of Yama's hitpoints");
  api.registerCommand("yamajudgekill", killJudge, api.core.PlayerRights.DEVELOPER, "Kill the Judge of Yama");
  api.registerCommand("yamakill", killYama, api.core.PlayerRights.DEVELOPER, "Finish your Yama off");
};
