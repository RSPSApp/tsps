"use strict";

/**
 * The Elite Western Provinces Diary's daily Zulrah resurrection (OSRS Wiki: Zulrah and Western
 * Provinces Diary). It prevents the death at the moment the fight would otherwise end, restores
 * every skill and lets the existing ZulrahFight continue.
 */

const Fight = require("./Fight.Zulrah");

const USED_ON = "zulrah:resurrected-on";
const LOGGED_IN_ON = "zulrah:logged-in-on";
const DAY_MS = 24 * 60 * 60 * 1000;

let api;

/** OSRS daily limits reset at 00:00 UTC; Zulrah requires a login after that reset. */
function today() {
  return Math.floor(Date.now() / DAY_MS);
}

function eliteDiaryComplete(player) {
  const request = { player, diary: "western", tier: "elite", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function loggedIn({ player }) {
  player.setAttribute(LOGGED_IN_ON, today());
}

function resurrect(event) {
  const { player } = event;
  const day = today();
  const fight = Fight.fightOf(player);
  // Zulrah's attacks already launched may still hit after its death, while the encounter remains open.
  if (!fight || !["fight", "won"].includes(fight.stage)) return;
  if (player.getAttribute(LOGGED_IN_ON) !== day || player.getAttribute(USED_ON) === day) return;
  if (!eliteDiaryComplete(player)) return;

  event.preventDeath = true;
  player.setAttribute(USED_ON, day);
  // Any queued attacks or lingering venom could immediately kill the player again.
  player.getCombat().getHitQueue().clear();
  player.setPoisonDamage(0);
  player.setVenomed(false);

  const skills = player.getSkillManager();
  for (const skill of api.core.Skill.values()) {
    skills.setCurrentLevels(skill, skills.getMaxLevel(skill));
    player.getPacketSender().sendSkill(skill);
  }
}

module.exports = function attachResurrection(pluginApi) {
  api = pluginApi;
  pluginApi.persistAttribute(USED_ON, -1);
  pluginApi.persistAttribute(LOGGED_IN_ON, -1);
  pluginApi.onPlayerLogin(loggedIn);
  pluginApi.onPlayerBeforeDeath(resurrect);
};

Object.assign(module.exports, { resurrect, today, eliteDiaryComplete, USED_ON, LOGGED_IN_ON });
