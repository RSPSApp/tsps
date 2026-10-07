/**
 * Ardeaglais, as captured:
 * - the front doors: the player drags a door open (and through) a tile at a time;
 * - the broken pew: Climb copies the cathedral for the player (Instance.MadAngel) behind a fade,
 *   "You climb over the broken pew..."; inside, Exit asks "Are you sure you want to leave?"
 *   (Yes!/No.) and Quick-exit doesn't, then back out behind the fade;
 * - Wake on the dormant angel starts the fight (Fight.MadAngel).
 * Every other door and pew falls through to its own plugin.
 */
const Common = require("./Common.MadAngel");
const Instance = require("./Instance.MadAngel");
const { Fight } = require("./Fight.MadAngel");

/** As captured: in, the move 2 ticks after the fade-out and the fade-in a tick later; out, 2 later. */
const ENTER_FADE = { moveTicks: 2, inTicks: 3, closeTicks: 6 };
const EXIT_FADE = { moveTicks: 2, inTicks: 4, closeTicks: 6 };

function openDoor({ player, objectId }) {
  const { doors } = Common.data;
  if (!doors.ids.includes(objectId)) return false;
  const { Animation } = Common.core;
  const at = player.getLocation();
  const toX = at.getX() >= doors.outsideX ? doors.insideX : doors.outsideX;
  player.getMovementQueue().reset();
  player.performAnimation(new Animation(doors.anim));
  player.getPacketSender().sendSoundEffect(doors.sound.id, 1, doors.sound.delay);
  Common.later(1, () => player.isRegistered() && player.moveTo(new Common.core.Location(toX, at.getY(), at.getZ())));
  return true;
}

function climbPew({ player, objectId, object }) {
  const { pew } = Common.data;
  if (objectId !== pew.climbId || Instance.sessionOf(player)) return false;
  const { Animation, DialogueChainBuilder, StatementDialogue } = Common.core;
  player.getMovementQueue().reset();
  player.setPositionToFace(object.getLocation());
  player.performAnimation(new Animation(pew.anim, pew.animDelay));
  const session = Instance.open(player);
  Common.travel(player, ENTER_FADE, () => Instance.enter(session), () => {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, pew.message)));
  });
  return true;
}

function leaveCathedral(player) {
  Common.travel(player, EXIT_FADE, () => Instance.leave(player));
}

/** Exit asks first. */
function exitPew({ player, objectId }) {
  const { pew } = Common.data;
  if (objectId !== pew.exitId || !Instance.sessionOf(player)) return false;
  Common.api.sendMultiChatboxPrompt(player, pew.leaveQuestion, pew.leaveYes, () => {
    player.getPacketSender().sendInterfaceRemoval();
    leaveCathedral(player);
  }, pew.leaveNo, () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

/** Quick-exit leaves straight away. */
function quickExitPew({ player, objectId }) {
  if (objectId !== Common.data.pew.exitId || !Instance.sessionOf(player)) return false;
  leaveCathedral(player);
  return true;
}

/** Wakes the player's own dormant angel; the fight runs on its own tick task. */
function wakeAngel({ player, npc }) {
  const session = npc?.__madAngel;
  if (!session || session.player !== player || session.fight) return false;
  const fight = new Fight(session, npc);
  session.fight = fight;
  const { Task, TaskManager } = Common.core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (fight.stopped || session.ended) {
        this.stop();
        return;
      }
      fight.process();
    }
  })());
  fight.wake();
  return true;
}

module.exports = function attachCathedral(api) {
  api.onObjectInteraction("Cathedral door", { Open: openDoor });
  api.onObjectInteraction("Church pew", { Climb: climbPew, Exit: exitPew, "Quick-exit": quickExitPew });
  api.onNpcInteraction("Mad Angel", { Wake: wakeAngel });
};
