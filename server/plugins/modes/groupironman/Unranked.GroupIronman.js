"use strict";

/**
 * Becoming an Unranked Group Ironman away from Tutorial Island (Wiki, Group Ironman Mode:
 * Unranked): any Ironman (standard, Ultimate, Hardcore, or a Group Ironman out of a group) asks
 * the Ironman tutor in Lumbridge; the change takes effect after a 7-day grace period, and choosing
 * it again in that time calls it off. It can't be undone. On the island the choice is immediate.
 * The wait is saved (UNRANKED_AT_ATTRIBUTE) and checked at login and every SETTLE_TICKS.
 */

const Common = require("./Common.GroupIronman");

const UNRANKED_AT_ATTRIBUTE = "group-ironman:unranked-at";
const DAY_MS = 24 * 60 * 60 * 1000;
const SETTLE_TICKS = 100;
let started = false;

/** "ironman:change-mode" to Unranked Group Ironman, off the island: a 7-day wait instead. */
function changeMode(change) {
  const unranked = Common.modeOfVariant("unranked");
  if (change.to !== unranked || change.allowed === false || change.upgrades === true) return;
  const { player } = change;
  change.allowed = false;
  if (change.from === "none") {
    change.reason = Common.message("unrankedOnlyIron");
    return;
  }
  if (Common.groupOf(player).group) {
    change.reason = Common.message("unrankedInGroup");
    return;
  }
  if (Number(player.getAttribute(UNRANKED_AT_ATTRIBUTE)) > 0) {
    player.setAttribute(UNRANKED_AT_ATTRIBUTE, 0);
    change.reason = Common.message("unrankedSwitchCancelled");
    return;
  }
  const days = Common.data.unrankedSwitchDays;
  player.setAttribute(UNRANKED_AT_ATTRIBUTE, Date.now() + days * DAY_MS);
  change.reason = Common.message("unrankedSwitchPending", { days });
}

/** Makes the change once its wait is over (and the player is still out of any group). */
function settle(player, now = Date.now()) {
  const at = Number(player.getAttribute?.(UNRANKED_AT_ATTRIBUTE)) || 0;
  if (!at || at > now) return;
  player.setAttribute(UNRANKED_AT_ATTRIBUTE, 0);
  if (Common.groupOf(player).group || Common.modeOf(player) === "none") return;
  Common.setMode(player, Common.modeOfVariant("unranked"));
  Common.tell(player, "unrankedSwitchDone");
}

function login({ player }) {
  settle(player);
}

/** Settles every logged-in player's wait every SETTLE_TICKS from server start. */
function start() {
  if (started) return;
  started = true;
  const { Task, TaskManager, World } = Common.api.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(SETTLE_TICKS, false);
    }
    execute() {
      World.getPlayers().forEach((player) => player && settle(player));
    }
  })());
}

module.exports = { UNRANKED_AT_ATTRIBUTE, changeMode, settle, login, start };
