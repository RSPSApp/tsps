/**
 * Ferox Enclave's barriers, from OSRS captures (docs/ferox-enclave.md):
 *
 * - Leaving warns once (teleblock warning, then "Continue through the Barrier?"); crossing plays
 *   the drag animation and steps through a tick later. A teleblocked player can't come back in.
 * - The town is safe from other players unless one of them is teleblocked; the buffer outside the
 *   barriers too. Inside, varbit 6549 is set; in the buffer, varbit 10530.
 */
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const Bounds = require("./Bounds.FeroxEnclave");
const Ferox = require("./Common.FeroxEnclave");

const INSIDE_VARBIT = 6549; // pvp_adjacent_area_client
const BUFFER_VARBIT = 10530; // wildy_hub_buffer
const WARNING_VARBIT = 10532; // wildy_hub_warning
const DONT_ASK_ATTRIBUTE = "ferox:barrier-dont-ask";

const CROSS_ANIMATION = 4282; // sos_security_door_drag
const CROSS_SOUND = 4193;

const BARRIER_WARNING = "When returning to the Enclave, if you are teleblocked, you will not<br>be allowed to enter the Enclave until the teleblock has worn off.<br><col=ef1020>You will also be attackable in the safe zone outside the Enclave if<br><col=ef1020>you are teleblocked.</col>";

/** The last varbit pair sent per player: "inside,buffer". */
const lastState = new WeakMap();

function isTeleblocked(player) {
  return player?.getCombat?.()?.getTeleblockTimer?.()?.finished?.() === false;
}

/** Tick 0: face the way through, drag; tick 1: through (as captured). */
function cross(player, crossing) {
  const sender = player.getPacketSender();
  const target = new Location(crossing.target.x, crossing.target.y, crossing.target.z);
  sender.sendVarbit(Ferox.BUSY_VARBIT, 1);
  player.setPositionToFace(target);
  player.performAnimation(new Ferox.core.Animation(CROSS_ANIMATION));
  sender.sendSoundEffect(CROSS_SOUND, 2, 30, 255);
  Ferox.later(player, 1, () => {
    sender.sendVarbit(Ferox.BUSY_VARBIT, 0);
    player.moveTo(target);
    player.performAnimation(Ferox.core.Animation.DEFAULT_RESET_ANIMATION);
  });
}

function warnThenCross(player, crossing) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Ferox.core;
  player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 1);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, BARRIER_WARNING),
    new ActionDialogue(1, {
      execute: () => Ferox.api.sendMultiChatboxPrompt(player, "Continue through the Barrier?",
        "Yes.", () => cross(player, crossing),
        "Yes, and don't ask again.", () => {
          player.setAttribute(DONT_ASK_ATTRIBUTE, true);
          player.getPacketSender().sendVarbit(WARNING_VARBIT, 1);
          cross(player, crossing);
        },
        "No.", () => player.getPacketSender().sendVarbit(Ferox.BUSY_VARBIT, 0)),
    }),
  ));
}

function passThrough({ player, object }) {
  const crossing = Bounds.crossingTarget(player.getLocation?.(), object);
  if (!crossing) return true;
  if (crossing.entering) {
    if (isTeleblocked(player)) {
      player.sendMessage("A magical force prevents you from entering the Ferox Enclave while teleblocked.");
      return true;
    }
    cross(player, crossing);
    return true;
  }
  if (player.getAttribute(DONT_ASK_ATTRIBUTE) === true) cross(player, crossing);
  else warnThenCross(player, crossing);
  return true;
}

/** Safe from other players in the town and its buffer, unless either of them is teleblocked. */
function denySafeZoneAttack(event) {
  if (event.allow !== null || event.attacker?.isPlayer?.() !== true || event.target?.isPlayer?.() !== true) return;
  if (!Bounds.isSafeLocation(event.attacker.getLocation()) && !Bounds.isSafeLocation(event.target.getLocation())) return;
  if (!isTeleblocked(event.attacker) && !isTeleblocked(event.target)) event.allow = false;
}

function syncState({ player }) {
  const location = player.getLocation();
  const near = location.getZ() === 0 && location.getX() >= 3110 && location.getX() <= 3170
    && location.getY() >= 3605 && location.getY() <= 3660;
  const inside = near && Bounds.isInsideEnclave(location) ? 1 : 0;
  const buffer = near && !inside && Bounds.isInBuffer(location) ? 1 : 0;
  const state = `${inside},${buffer}`;
  if (lastState.get(player) === state) return;
  lastState.set(player, state);
  player.getPacketSender().sendVarbit(INSIDE_VARBIT, inside).sendVarbit(BUFFER_VARBIT, buffer);
}

function sendWarningVarbit({ player }) {
  if (player.getAttribute(DONT_ASK_ATTRIBUTE) === true) player.getPacketSender().sendVarbit(WARNING_VARBIT, 1);
}

module.exports = function attachBarriers(api) {
  api.persistAttribute(DONT_ASK_ATTRIBUTE);
  api.onObjectFirstClick(Bounds.BARRIER_IDS, passThrough);
  api.onCanAttack(denySafeZoneAttack);
  api.onPlayerProcess(syncState);
  api.onPlayerLogin(sendWarningVarbit);
};

Object.assign(module.exports, { passThrough, cross, denySafeZoneAttack, syncState, DONT_ASK_ATTRIBUTE, BARRIER_WARNING });
