"use strict";

/**
 * All Settings > Display: the camera shake rows. Every camera shake the server sends goes through
 * `send(sender, effect, slot, random, sine, frequency)`, which names the effect it belongs to:
 * - "combat" and "atmospheric": a shake only the master row turns off ("Toggle all combat / atmospheric
 *   camera shake effects", settings 425 and 426).
 * - A named effect (e.g. "doom"): off when its group's master or its own row is off.
 * Each var is an `option_camera_effect_*_disabled` flag: 1 means the effect is off. The client's
 * settings scripts treat a sub-row as off and lock it while its master is off (struct param 1080
 * names the group); the sub-row keeps its own value for when the master is turned back on.
 * A shake with no amplitude stops one and is always sent.
 */
const COMBAT_MASTER = { settingId: 425, varbit: 16106 }; // option_camera_effect_combat_disabled
const ATMOSPHERIC_MASTER = { settingId: 426, varbit: 16110 }; // option_camera_effect_atmospherics_disabled

const EFFECTS = {
  combat: { master: COMBAT_MASTER },
  atmospheric: { master: ATMOSPHERIC_MASTER },
  doom: { master: COMBAT_MASTER, settingId: 445, varbit: 17776 }, // Doom of Mokhaiotl
  shamans: { master: COMBAT_MASTER, settingId: 427, varbit: 16107 }, // Lizardman shamans
  olm: { master: COMBAT_MASTER, settingId: 428, varbit: 16108 }, // the Great Olm
  apeAtollRockfall: { master: COMBAT_MASTER, settingId: 429, varbit: 16109 }, // Ape Atoll tunnels
  babaYaga: { master: ATMOSPHERIC_MASTER, settingId: 281, varbit: 14197 }, // Baba Yaga's house
  trawler: { master: ATMOSPHERIC_MASTER, settingId: 282, varbit: 4814 }, // Fishing Trawler
  barrows: { master: ATMOSPHERIC_MASTER, settingId: 283, varbit: 14198 }, // after looting the Barrows chest
};

function disabled(sender, varbit) {
  return sender.getVarbit?.(varbit) === 1;
}

/** Whether the player's settings allow this effect's camera shake. */
function allowed(sender, effect) {
  const entry = EFFECTS[effect];
  if (!entry) throw new Error(`Unknown camera shake effect: ${effect}`);
  if (disabled(sender, entry.master.varbit)) return false;
  return entry.varbit === undefined || !disabled(sender, entry.varbit);
}

/**
 * Sends a camera shake (slot, random amplitude, sine amplitude, sine frequency) if the player's
 * settings allow `effect`; returns the sender for chaining.
 */
function send(sender, effect, ...shake) {
  const [, randomAmplitude, sineAmplitude] = shake;
  const stopping = !randomAmplitude && !sineAmplitude;
  if ((allowed(sender, effect) || stopping) && sender.sendCameraShake) sender.sendCameraShake(...shake);
  return sender;
}

/** Ours: a sub-row clicked while its master is off stays as it is, as the client shows it locked. */
function settingClicked(request) {
  const entry = Object.values(EFFECTS).find((e) => e.settingId === request.settingId);
  if (!entry || !disabled(request.player.getPacketSender(), entry.master.varbit)) return;
  request.handled = true;
}

module.exports = {
  name: "CameraShake",
  description: "Camera shake effects, sent only when the player's combat and atmospheric camera shake settings allow them.",
  EFFECTS,
  allowed,
  send,
  register(api) {
    api.onCustomEvent("settings:setting-clicked", settingClicked);
  },
  _test: { settingClicked },
};
