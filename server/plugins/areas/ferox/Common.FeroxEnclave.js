/**
 * Ferox Enclave: what the barriers, the pools and the free-for-all share - the plugin api, tick
 * timing, the busy varbit and the full restore.
 */
const BUSY_VARBIT = 12393;
const DISEASE_VARP = 456;

let api = null;
let core = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

/** Runs `action` `ticks` ticks from now, unless the player has logged out. */
function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(ticks, player, false);
    }

    execute() {
      this.stop();
      if (player.isRegistered?.() !== false) action();
    }
  })());
}

/** Hitpoints, prayer, run energy and every skill back to base; poison, venom and disease cured. */
function restore(player, { prayersOff }) {
  const skills = player.getSkillManager();
  for (const skill of core.Skill.values()) skills.setCurrentLevels(skill, skills.getMaxLevel(skill));
  player.setPoisonDamage(0);
  player.setVenomed(false);
  player.setRunEnergy(100);
  const sender = player.getPacketSender();
  sender.sendPoisonType(0).sendRunEnergy().sendConfig(DISEASE_VARP, -1);
  if (prayersOff) core.PrayerHandler.deactivatePrayers(player);
}

module.exports = {
  init, later, restore, BUSY_VARBIT,
  get api() { return api; },
  get core() { return core; },
};
