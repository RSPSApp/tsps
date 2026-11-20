/**
 * Ardeaglais, as captured:
 * - the front doors: the player drags a door open (and through) a tile at a time;
 * - the broken pew: Climb copies the cathedral for the player (Instance.MadAngel) behind a fade,
 *   "You climb over the broken pew..."; inside, Exit asks "Are you sure you want to leave?"
 *   (Yes!/No.) and Quick-exit doesn't, then back out behind the fade;
 * - Wake on the dormant angel starts the fight (Fight.MadAngel).
 * Fallen From Grace (rsprox P2, ticks 314-322 and 431-469) asks "Climb over the pew?" (Yes./No.)
 * first (`madangel:pew-climb`), and its angel wakes by itself 3 ticks after the player lands, with
 * no Wake click. Once that angel is dead the pew inside is the climbable one again, and climbing
 * it takes the player straight out (no question).
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
  const request = { player, objectId, handled: false };
  Common.api.emitCustomEvent("madangel:cathedral-door", request);
  if (request.handled) return true;
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
  if (objectId !== pew.climbId) return false;
  const inside = Instance.sessionOf(player);
  if (inside) {
    if (!inside.defeated) return false;
    // The quest's angel is dead: the climbable pew is the way out (P2 tick 465), with no question.
    player.getMovementQueue().reset();
    player.performAnimation(new Common.core.Animation(pew.anim, pew.animDelay));
    leaveCathedral(player);
    return true;
  }
  const request = { player, prompt: false };
  Common.api.emitCustomEvent("madangel:pew-climb", request);
  if (request.prompt !== true) {
    enterCathedral(player, object);
    return true;
  }
  player.getMovementQueue().reset();
  Common.api.sendMultiChatboxPrompt(player, pew.questClimbQuestion, pew.questClimbYes, () => {
    player.getPacketSender().sendInterfaceRemoval();
    enterCathedral(player, object);
  }, pew.questClimbNo, () => player.getPacketSender().sendInterfaceRemoval());
  return true;
}

function enterCathedral(player, object) {
  const { pew } = Common.data;
  const { Animation, DialogueChainBuilder, StatementDialogue } = Common.core;
  player.getMovementQueue().reset();
  if (object) player.setPositionToFace(object.getLocation());
  player.performAnimation(new Animation(pew.anim, pew.animDelay));
  const session = Instance.open(player);
  Common.travel(player, ENTER_FADE, () => {
    Instance.enter(session);
    if (session.variant === "quest" && !session.defeated) {
      Common.later(pew.questWakeTicks, () => {
        if (session.ended || session.fight || !session.boss || Instance.sessionOf(player) !== session) return;
        wakeAngel({ player, npc: session.boss });
      });
    }
  }, () => {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, pew.message)));
  });
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
  if (!session || session.player !== player || session.fight || session.defeated) return false;
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
