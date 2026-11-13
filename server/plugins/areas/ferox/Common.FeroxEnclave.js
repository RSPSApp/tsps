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

/** Players whose busy varbit is held by a Ferox warning, question or reply in the chatbox. */
const busyHeld = new WeakSet();

/**
 * Busy for as long as a warning or question is up. Live clears it as the chatbox closes by any
 * route, a walk-away too (rsprox_transcripts/238/04168.txt), so `chatboxClosed` clears it then.
 */
function holdBusy(player) {
  busyHeld.add(player);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
}

/** The answer takes busy over: it keeps it for a move or clears it a tick later itself. */
function releaseBusy(player) {
  busyHeld.delete(player);
}

/** An answer that ends it: busy off now. */
function clearBusy(player) {
  busyHeld.delete(player);
  player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
}

/**
 * "interface:closed": an answer closes the menu before its callback runs, and a Continue may
 * open the next chatbox, so look once both have had their turn: still held with no chatbox up
 * means the player walked away, closed it or was interrupted.
 */
function chatboxClosed({ player }) {
  if (!busyHeld.has(player)) return;
  later(player, 0, () => {
    if (busyHeld.has(player) && !(player.getPacketSender().getChatboxGroupId?.() >= 0)) clearBusy(player);
  });
}

/** Hitpoints, prayer, run energy and every skill back to base; poison, venom and disease cured. */
function restore(player, { prayersOff }) {
  const skills = player.getSkillManager();
  for (const skill of core.Skill.values()) skills.setCurrentLevels(skill, skills.getMaxLevel(skill));
  player.setPoisonDamage(0);
  player.setVenomed(false);
  player.setRunEnergy(100);
  const sender = player.getPacketSender();
  sender.sendRunEnergy().sendConfig(DISEASE_VARP, -1);
  if (prayersOff) core.PrayerHandler.deactivatePrayers(player);
}

module.exports = {
  init, later, restore, holdBusy, releaseBusy, clearBusy, chatboxClosed, BUSY_VARBIT,
  get api() { return api; },
  get core() { return core; },
};
