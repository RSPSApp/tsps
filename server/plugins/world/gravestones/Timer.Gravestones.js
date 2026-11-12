"use strict";

/**
 * The grave's 15 minutes. As captured, gravestone_duration counts down by 3 every 3 ticks while
 * the player is online. It pauses while the grave interface is open, while the player is
 * inactive ("in case you have lost your connection", Death) and through the first-death
 * tutorial. At 0 the grave collapses and its items go to Death's Office.
 *
 * Clicking the HUD timer prints where the items are and the time left ("In 13 minutes, 55
 * seconds it will expire" at 1392 ticks: whole seconds of the ticks left).
 */
const Common = require("./Common.Gravestones");
const Storage = require("./Storage.Gravestones");
const Grave = require("./Grave.Gravestones");

const INTERVAL = 3;
/**
 * Ticks without a click or key press before the timer pauses. UNVERIFIED: live paused 17 ticks
 * after a click, so 16 or 17.
 */
const IDLE_TICKS = 16;
const TICK_MS = 600;

const MESSAGE = {
  expired: "<col=ef1020>Your gravestone has expired.</col> Items held there can now be reclaimed at <col=ef1020>Death's Office</col>, accessed from near the respawn points.",
  loginWarning: "<col=ef1020>You have items stored in an item retrieval service. Please visit the last location you died. If you die again before retrieving them, they will be lost.</col>",
  info: "A <col=ef1020>gravestone</col> contains some of your recently dropped items; you can retrieve them by visiting it. The <col=ef1020>World Map</col> will show its location if the area has a map.",
};

/** Online players who have a grave. */
const active = new Set();
let task = null;

function isIdle(player) {
  return player.lastInputCycle > 0 && Common.cycle() - player.lastInputCycle > IDLE_TICKS;
}

function track(player) {
  active.add(player);
  if (task) return;
  const { Task, TaskManager } = Common.core();
  task = new (class extends Task {
    constructor() {
      super(INTERVAL, "gravestones:timer", false);
    }
    execute() {
      for (const each of [...active]) tick(each);
      if (active.size === 0) {
        this.stop();
        task = null;
      }
    }
  })();
  TaskManager.submit(task);
}

function tick(player) {
  const held = Storage.grave(player);
  if (!held || !player.isRegistered?.()) {
    active.delete(player);
    return;
  }
  Grave.pointAt(player);
  if (Storage.inTutorial(player) || Grave.isOpen(player) || isIdle(player)) return;
  countDown(player, held, INTERVAL);
}

function countDown(player, held, ticks) {
  held.duration = Math.max(0, held.duration - ticks);
  Storage.setGrave(player, held);
  Common.setVarbit(player, "duration", held.duration);
  if (held.duration === 0) expire(player);
}

/** The grave collapses; Death's Office takes what it held (also when Death collects it early). */
function expire(player) {
  const held = Storage.grave(player);
  if (!held) return;
  player.sendMessage(MESSAGE.expired);
  Storage.sendToOffice(player, held.items);
  Grave.remove(player);
  active.delete(player);
}

/** On the tick the first-death tutorial ends, the countdown starts. */
function startCountdown(player) {
  Storage.setTutorial(player, false);
  const held = Storage.grave(player);
  if (!held) return;
  countDown(player, held, held.duration > Grave.DURATION ? held.duration - Grave.DURATION + INTERVAL : INTERVAL);
  track(player);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** UNVERIFIED: the singular forms and the wording under a minute. */
function timerInfo({ player }) {
  const held = Storage.grave(player);
  if (!held) return;
  const seconds = Math.floor((held.duration * TICK_MS) / 1000);
  const left = `${plural(Math.floor(seconds / 60), "minute")}, ${plural(seconds % 60, "second")}`;
  player.sendMessage(MESSAGE.info);
  player.sendMessage(`In <col=ef1020>${left}</col> it will expire, after which your items can be retrieved from <col=ef1020>Death's Office</col> instead.`);
}

/**
 * Logging in with a grave: the warning, the grave back in the world, and its timer. The warning
 * shows unless the player turned off All Settings' "Display a warning on login if there are items
 * stored in an item retrieval service".
 */
function login({ player }) {
  if (!Storage.grave(player) && Storage.office(player).length === 0) return;
  if (Common.getVarbit(player, "retrievalWarningDisabled") !== 1) player.sendMessage(MESSAGE.loginWarning);
  if (!Storage.grave(player)) return;
  Grave.spawn(player);
  Grave.sync(player);
  track(player);
}

function logout({ player }) {
  Grave.despawn(player);
  active.delete(player);
}

/** agent:advance-time: the grave's timer moves on as if the player had been active. */
function advanceTime(event) {
  const held = Storage.grave(event.player);
  if (!held || Storage.inTutorial(event.player)) return;
  countDown(event.player, held, Math.floor(event.ms / TICK_MS));
  event.handledBy.push("Gravestones");
}

function attach(api) {
  Common.bind(api);
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onInterfaceActionButton(Common.HUD_COMPONENTS, timerInfo);
  api.onCustomEvent("agent:advance-time", advanceTime);
}

module.exports = { attach, track, expire, startCountdown };
