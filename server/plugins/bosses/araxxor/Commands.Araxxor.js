/**
 * Developer commands for testing Araxxor, following Commands.Zulrah / Commands.MadAngel:
 * ::araxxorkill finishes the player's active boss (to exercise the corpse, harvest and
 * destroy), and ::araxxorhp <hitpoints> sets its hitpoints (255 to see the enrage).
 */
const Shared = require("./Shared.Araxxor");
const Area = require("./Area.Araxxor");
const Combat = require("./Combat.Araxxor");

let core = null;

function activeBoss(player) {
  const session = Area.sessions.get(player);
  const boss = session?.npc ?? null;
  // The corpse is the same object at 1 HP: only the living boss counts.
  return boss?.getId?.() === Shared.BOSS_ID && boss?.isRegistered?.() && boss.getHitpoints?.() > 0 ? boss : null;
}

function killAraxxor({ player }) {
  const boss = activeBoss(player);
  if (!boss) {
    player.sendMessage("You have no active Araxxor.");
    return true;
  }
  boss.getCombat().getHitQueue().addPendingDamage([
    new core.HitDamage((boss.getHitpoints() ?? 0) + 1, core.HitMask.RED),
  ]);
  player.sendMessage("Araxxor has been defeated.");
  return true;
}

function setAraxxorHitpoints({ player, parts }) {
  const boss = activeBoss(player);
  const hitpoints = Number(parts?.[1]);
  if (!boss) {
    player.sendMessage("You have no active Araxxor.");
    return true;
  }
  if (!Number.isInteger(hitpoints) || hitpoints < 1 || hitpoints > Shared.MAX_HITPOINTS) {
    player.sendMessage(`Use ::araxxorhp <hitpoints 1-${Shared.MAX_HITPOINTS}>.`);
    return true;
  }
  boss.setHitpoints(hitpoints);
  // Setting HP below the threshold by hand must enrage exactly like a real hit:
  // attribute, venom legs, screech, 4-tick/cleave phase. Above it this no-ops.
  Combat.checkEnrage(boss);
  const enraged = boss.getAttribute?.(Shared.ATTR_ENRAGED) === true ? " (enraged)" : "";
  player.sendMessage(`Araxxor now has ${hitpoints} hitpoints${enraged}.`);
  return true;
}

module.exports = function attachCommands(api) {
  core = api.core;
  api.registerCommand("araxxorkill", killAraxxor, api.core.PlayerRights.DEVELOPER, "Defeat your active Araxxor");
  api.registerCommand("araxxorhp", setAraxxorHitpoints, api.core.PlayerRights.DEVELOPER, "Set your Araxxor's hitpoints");
};
