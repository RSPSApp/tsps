/**
 * Yama: what the units share - the plugin api, the data from plugins/bosses/data/yama.json, tick
 * timing, the captured fade, and the saved attributes.
 */
const fs = require("fs");
const path = require("path");

/** Set while the player is in the domain's instance, so a login there puts them by the Voice. */
const INSIDE_ATTRIBUTE = "yama:inside";
/** The Voice's progress (varbit chasm_voice_progress), kept for the next login. */
const VOICE_PROGRESS_ATTRIBUTE = "yama:voice-progress";
/** The contract: offered (Yama has asked for a signature) and signed. */
const CONTRACT_OFFERED_ATTRIBUTE = "yama:contract-offered";
const CONTRACT_SIGNED_ATTRIBUTE = "yama:contract-signed";
/** How the last fight ended ("victorious", "defeated" or "escaped"), for Yama's greeting. */
const LAST_RESULT_ATTRIBUTE = "yama:last-result";
/** Yama's "kill count" is a success count, and deaths to him are soul debt (Wiki). */
const SUCCESS_COUNT_ATTRIBUTE = "yama:success-count";
const SOUL_DEBT_ATTRIBUTE = "yama:soul-debt";
/** What the Voice holds from a death: { items: [[id, amount]], paid }. */
const HELD_ITEMS_ATTRIBUTE = "yama:held-items";

const BUSY_VARBIT = 12393;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;
const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

let api = null;
let core = null;
let data = null;

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "yama.json"), "utf8"));
}

/** Runs `action` `ticks` ticks from now (at least one). */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);

/** A Direction id by name, as api.spawnNpc takes it. */
const facing = (name) => core.Direction[name].getId();

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/**
 * The captured trip in or out of the domain: the fade out with `message` (no continue), the
 * minimap off a tick later, `move` two ticks in, then the fade back in with `message` again. The
 * fade and the busy flag clear once the player continues past it.
 */
function travel(player, message, move) {
  const { moveTicks, inTicks } = data.domain.fade;
  const { StatementDialogue, DialogueChainBuilder, ActionDialogue } = core;
  const sender = player.getPacketSender();
  sender.sendVarbit(BUSY_VARBIT, 1);
  fade(player, true);
  StatementDialogue.send(player, message, false);
  later(1, () => player.isRegistered() && sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  later(moveTicks, () => player.isRegistered() && move());
  later(inTicks, () => {
    if (!player.isRegistered()) return;
    sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
    fade(player, false);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, message),
      new ActionDialogue(1, { execute: () => arrived(player) }),
    ));
  });
}

function arrived(player) {
  const sender = player.getPacketSender();
  sender.sendInterfaceRemoval();
  sender.sendVarbit(BUSY_VARBIT, 0);
  sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
}

/** A track by its id: unlocked (with its message) and played, as entering an area plays it. */
function playMusic(player, trackId) {
  api.emitCustomEvent("music:unlock-track", { player, trackId });
  player.getPacketSender().sendSong(trackId);
}

const count = (player, key) => Math.max(0, Math.trunc(Number(player.getAttribute(key)) || 0));

module.exports = {
  init, later, toLocation, facing, travel, playMusic, count,
  INSIDE_ATTRIBUTE, VOICE_PROGRESS_ATTRIBUTE, CONTRACT_OFFERED_ATTRIBUTE, CONTRACT_SIGNED_ATTRIBUTE,
  LAST_RESULT_ATTRIBUTE, SUCCESS_COUNT_ATTRIBUTE, SOUL_DEBT_ATTRIBUTE, HELD_ITEMS_ATTRIBUTE,
  get api() { return api; },
  get core() { return core; },
  get data() { return data; },
};
