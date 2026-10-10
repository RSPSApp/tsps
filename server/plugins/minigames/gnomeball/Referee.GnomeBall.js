"use strict";

/**
 * The Gnome ball referee (NPC 3157, at 2384,3488). The transcript lives in
 * npc-dialogues.json (transcripts: standard-dialogue-first-talk,
 * standard-dialogue-without-a-gnomeball-equipped, standard-dialogue-with-a-gnomeball-equipped,
 * standard-dialogue-if-the-gnomeball-is-out-of-play); this unit picks the variant, answers
 * its "If the player has a gnomeball in their inventory:" prose conditions, and handles the
 * "receive" stage direction that hands the ball over. The out-of-play variant has no action
 * step, so its "Have a new ball!" line is the hand-out.
 */

const Pitch = require("./Pitch.GnomeBall");

const FIRST_TALK_ATTRIBUTE = "gnomeball:met-referee";
const FIRST_TALK = "standard-dialogue-first-talk";
const WITHOUT_BALL = "standard-dialogue-without-a-gnomeball-equipped";
const WITH_BALL = "standard-dialogue-with-a-gnomeball-equipped";
const OUT_OF_PLAY = "standard-dialogue-if-the-gnomeball-is-out-of-play";
const NEW_BALL_LINE = "Have a new ball!";

let core;

function selectVariant(event) {
  if (!event.player || event.npcId !== core.NpcIdentifiers.GNOME_BALL_REFEREE) return null;
  const { player } = event;
  if (Pitch.isCarrying(player)) return WITH_BALL;
  if (Pitch.isPlaying(player)) return OUT_OF_PLAY;
  if (player.getAttribute(FIRST_TALK_ATTRIBUTE) !== true) {
    // The intro plays once per session; only "I'll have a go" hands over a ball.
    player.setAttribute(FIRST_TALK_ATTRIBUTE, true);
    return FIRST_TALK;
  }
  return null; // the transcript default, without-a-gnomeball-equipped
}

function answerCondition(event) {
  if (!event.player || event.npcId !== core.NpcIdentifiers.GNOME_BALL_REFEREE) return null;
  if (String(event.text ?? "").toLowerCase().includes("gnomeball in their inventory")) {
    return event.player.getInventory().getAmount(Pitch.GNOMEBALL) > 0;
  }
  return null;
}

/** The "receive" stage direction ("Peeeeeeeeep" hands the ball over). */
function handleAction(event) {
  if (event.handled || !event.player || event.action !== "receive") return;
  if (event.npcId !== core.NpcIdentifiers.GNOME_BALL_REFEREE) return;
  Pitch.beginGame(event.player);
  event.handled = true;
}

/** "Have a new ball!" from the out-of-play variant, which carries no action step. */
function handleLine(event) {
  if (!event.player || event.npcId !== core.NpcIdentifiers.GNOME_BALL_REFEREE) return;
  if (event.text !== NEW_BALL_LINE) return;
  Pitch.beginGame(event.player);
}

function attach(pluginApi) {
  core = pluginApi.core;
  pluginApi.onNpcDialogueVariant(selectVariant);
  pluginApi.onNpcDialogueCondition(answerCondition);
  pluginApi.onCustomEvent("npc-dialogue:action", handleAction);
  pluginApi.onCustomEvent("npc-dialogue:line", handleLine);
}

module.exports = {
  attach,
  FIRST_TALK_ATTRIBUTE,
  variants: { FIRST_TALK, WITHOUT_BALL, WITH_BALL, OUT_OF_PLAY },
  _test: {
    selectVariant,
    answerCondition,
    handleAction,
    handleLine,
    setCore: (value) => {
      core = value;
    },
  },
};
