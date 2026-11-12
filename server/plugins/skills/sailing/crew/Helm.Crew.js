// A crewmate at the helm, as live (rsprox, Cabin Boy Jenkins on a skiff): the helm is theirs from
// the order on, and the captain steers by clicking the sea and sets the sails from the sidepanel.
// Arrived, they face the bow and play the helm's loop (on themselves and the helm, every 10
// ticks); 3 ticks later they set full sail if the boat was at rest. Gusts they trim themselves
// (Trim.Helm.js), and the captain gets a share of the trim's XP by their Helmsmanship (Wiki:
// 40/50/60/70% at H1-H4) with "You gain some experience by watching your crew work."
const common = require("./Common.Crew");
const lines = require("./Lines.Crew");
const helm = require("../Helm.Sailing");
const { isTrimmed } = require("../Trim.Helm");
const { VARBIT, MOVE_MODE, getVarbit, animateSails } = require("../SailingContent.Sailing");

/** Ticks from reaching the helm to setting sail (rsprox: arrived 188, full sail 191). */
const SAIL_DELAY_TICKS = 3;
/** A crewmate setting sail (rsprox), in place of the player's raise sound. */
const SOUND_CREW_RAISE = 11089;
/** Share of a trim's XP by Helmsmanship 1-4 (Wiki, Crewmates). */
const TRIM_XP_SHARE = [0, 0.4, 0.5, 0.6, 0.7];
const WATCHING = "You gain some experience by watching your crew work.";
/** Now and then a crewmate at the helm says something (shortcut: no captured rate). */
const CHATTER_CHANCE = 1 / 300;

function sailState(moveMode) {
  if (moveMode === MOVE_MODE.FULL) return "full";
  if (moveMode === MOVE_MODE.HALF) return "half";
  return "down";
}

/** The order is given: the crewmate holds the helm from now (the captain lets go of it). */
function claimHelm(player, boat, member) {
  helm.crewTakesHelm(player, boat, member.npc);
}

/**
 * At the helm: the loop, the sails (`setSail`: on the order, not when back at the helm after
 * boarding), chatter. Returns the job, stopped when they leave it.
 */
function work(player, boat, member, { setSail = true } = {}) {
  const { npc, crew } = member;
  const { Task, TaskManager } = common.core();
  helm.faceBow(npc);
  helm.playHelm(player, boat, "loop", npc);
  const sails = sailState(getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE));
  animateSails(player, boat, sails, sails, { settle: false });
  let ticks = 0;
  const task = new (class extends Task {
    constructor() { super(1, npc, false); }
    execute() {
      if (boat.helmCrew !== npc || !npc.isRegistered?.()) return this.stop();
      ticks++;
      const moveMode = getVarbit(player, VARBIT.SIDEPANEL_BOAT_MOVE_MODE);
      if (setSail && ticks === SAIL_DELAY_TICKS && (moveMode === MOVE_MODE.STOPPED || moveMode === MOVE_MODE.MOORED)) {
        helm.setSailMode(player, boat, "full", { raiseSound: SOUND_CREW_RAISE });
      }
      if (ticks % helm.HELM_LOOP_TICKS === 0 && !isTrimmed(boat)) helm.playHelm(player, boat, "loop", npc);
      if (Math.random() < CHATTER_CHANCE) lines.say(npc, crew, "helm");
    }
  })();
  TaskManager.submit(task);
  return { stop: () => task.stop() };
}

/**
 * The crewmate leaves the helm. Given another job (`stop`), the boat stops as when a player lets
 * go; the captain taking over leaves the sails as they are.
 */
function release(player, boat, member, { stop = true } = {}) {
  if (boat.helmCrew !== member.npc) return;
  boat.helmCrew = undefined;
  member.npc.performAnimation(common.core().Animation.DEFAULT_RESET_ANIMATION);
  if (stop && boat.helmPlayerId === undefined) helm.stopNavigating(player, boat);
}

/** A crewmate's trim: the captain's share of the XP, the message, and the crewmate's line. */
function crewTrimmed({ player, npc, xp }) {
  const found = common.memberFor(npc);
  if (!found) return;
  const { crew } = found.member;
  const owned = common.core().Sailing.activeBoat(player);
  const share = TRIM_XP_SHARE[common.statOf(owned, crew, common.STAT.HELMSMANSHIP)] ?? 0;
  if (xp > 0 && share > 0) {
    player.getSkillManager().addExperiences(common.core().Skill.SAILING, xp * share);
    player.getPacketSender().sendTypedMessage(common.core().ChatType.SPAM, WATCHING);
  }
  lines.say(npc, crew, "trim");
}

function attach(api) {
  common.init(api);
  api.onCustomEvent("sailing:crew-trim", crewTrimmed);
}

module.exports = attach;
module.exports.claimHelm = claimHelm;
module.exports.work = work;
module.exports.release = release;
module.exports.TRIM_XP_SHARE = TRIM_XP_SHARE;
module.exports.WATCHING = WATCHING;
