"use strict";

/**
 * A prayer trainer. Content announces each attack as it is decided with
 *   "tfa:prayer-cue" { player, prayer: "melee" | "magic" | "ranged" | "none", ticks }
 * (the Fractured Archive's bosses: plugins/minigames/tfa/Shared.FracturedArchive.js prayerCue).
 * With the helper on, the player gets the call above their head ("Mage!"), a chat warning when
 * their overhead is wrong for it, and a grade when it lands: right or missed, kept as a score.
 *
 *   ::prayerhelper            on / off
 *   ::prayerhelper stats      the score
 *   ::prayerhelper reset      clear the score
 */

const ENABLED_ATTRIBUTE = "prayer-helper:enabled";
const STATS_ATTRIBUTE = "prayer-helper:stats";
const CALLS = { melee: "Melee!", magic: "Mage!", ranged: "Range!", none: "Prayers off!" };
const PRAYER_NAMES = { melee: "Protect from Melee", magic: "Protect from Magic", ranged: "Protect from Missiles", none: "no overhead prayer" };
const PROTECTS = { melee: "PROTECT_FROM_MELEE", magic: "PROTECT_FROM_MAGIC", ranged: "PROTECT_FROM_MISSILES" };
const OVERHEADS = ["PROTECT_FROM_MELEE", "PROTECT_FROM_MISSILES", "PROTECT_FROM_MAGIC", "RETRIBUTION", "REDEMPTION", "SMITE"];
const CHANNEL = "prayer-helper";
const WARN_COLOUR = "ff3030";
const GOOD_COLOUR = "30c030";

let pluginApi;

function core() {
  return pluginApi.core;
}

function enabled(player) {
  return player.getAttribute(ENABLED_ATTRIBUTE) === true;
}

function stats(player) {
  const saved = player.getAttribute(STATS_ATTRIBUTE);
  return { correct: Number(saved?.correct) || 0, missed: Number(saved?.missed) || 0 };
}

function active(player, name) {
  const { PrayerHandler } = core();
  return PrayerHandler[name] !== undefined && PrayerHandler.isActivated(player, PrayerHandler[name]);
}

/** Whether the player is praying as the attack needs. */
function prayingRight(player, prayer) {
  if (prayer === "none") return !OVERHEADS.some((name) => active(player, name));
  return active(player, PROTECTS[prayer]);
}

function later(ticks, action) {
  if (ticks <= 0) return action();
  pluginApi.getTaskManager().submit(new (class extends core().Task {
    constructor() { super(ticks); }
    execute() { this.stop(); action(); }
  })());
}

/** The client's overlay (client/game/plugins/prayertrainer) on the "prayer-helper" channel. */
function toOverlay(player, data) {
  player.getSession?.()?.sendClientPacket(core().encodePluginMessage(CHANNEL, data));
}

function grade(player, prayer) {
  if (!player.isRegistered?.() || !enabled(player)) return;
  const score = stats(player);
  const ok = prayingRight(player, prayer);
  if (ok) score.correct++;
  else {
    score.missed++;
    player.sendMessage(`<col=${WARN_COLOUR}>[Prayer] Missed: that one needed ${PRAYER_NAMES[prayer]}.</col>`);
  }
  player.setAttribute(STATS_ATTRIBUTE, score);
  toOverlay(player, { type: "grade", ok, ...score });
}

/** `ticks` until the prayer is checked (0: as it is thrown), `lands` until the hit. */
function onCue({ player, prayer, ticks, lands = ticks }) {
  if (!player || !enabled(player) || !(prayer in CALLS)) return;
  toOverlay(player, { type: "cue", prayer, ticks, lands });
  player.forceChat(CALLS[prayer]);
  if (ticks > 0 && !prayingRight(player, prayer)) {
    player.sendMessage(`<col=${WARN_COLOUR}>[Prayer] ${PRAYER_NAMES[prayer]} within ${ticks} tick${ticks === 1 ? "" : "s"}.</col>`);
  }
  later(ticks, () => grade(player, prayer));
}

function describe(player) {
  const { correct, missed } = stats(player);
  const total = correct + missed;
  const rate = total ? Math.round((correct / total) * 100) : 0;
  return `<col=${GOOD_COLOUR}>[Prayer]</col> ${correct}/${total} prayed right (${rate}%), ${missed} missed.`;
}

/** At login and on toggling: the overlay's on/off and the score. */
function syncOverlay({ player }) {
  toOverlay(player, { type: "enabled", on: enabled(player) });
  toOverlay(player, { type: "grade", ok: true, ...stats(player) });
}

function prayerHelperCommand({ player, parts }) {
  const action = String(parts?.[1] ?? "").toLowerCase();
  if (action === "stats") {
    player.sendMessage(describe(player));
  } else if (action === "reset") {
    player.setAttribute(STATS_ATTRIBUTE, { correct: 0, missed: 0 });
    toOverlay(player, { type: "grade", ok: true, correct: 0, missed: 0 });
    player.sendMessage("[Prayer] Score cleared.");
  } else {
    const on = action === "on" ? true : action === "off" ? false : !enabled(player);
    player.setAttribute(ENABLED_ATTRIBUTE, on);
    syncOverlay({ player });
    player.sendMessage(on
      ? "[Prayer] Helper on: attacks are called above your head, wrong prayers warned and graded. ::prayerhelper stats for your score."
      : "[Prayer] Helper off.");
  }
  return true;
}

module.exports = {
  name: "PrayerHelper",
  description: "A prayer trainer: calls each incoming boss attack's style, warns about wrong overheads and keeps a score (::prayerhelper).",
  register(api) {
    pluginApi = api;
    api.persistAttribute(ENABLED_ATTRIBUTE, false);
    api.persistAttribute(STATS_ATTRIBUTE, { correct: 0, missed: 0 });
    api.onCustomEvent("tfa:prayer-cue", onCue);
    api.onPlayerLogin(syncOverlay);
    api.registerCommand("prayerhelper", prayerHelperCommand, api.core.PlayerRights.NONE, "Prayer trainer: ::prayerhelper [on|off|stats|reset]");
  },
  _test: { onCue, grade, prayingRight, prayerHelperCommand },
};
