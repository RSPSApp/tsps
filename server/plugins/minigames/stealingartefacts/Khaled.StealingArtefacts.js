"use strict";

/**
 * Captain Khaled: which transcript he plays (standard / task assigned / delivering / after a
 * loss), the Wiki's missing assignment step (id RK5KyB, after "We'll see about that.") and the
 * delivery stage direction (id slk6Qf). The right-click Task option starts the same
 * conversation.
 *
 * Wiki: https://oldschool.runescape.wiki/w/Transcript:Captain_Khaled
 */

const Common = require("./Common.StealingArtefacts");

/** Transcript step anchors from npc-dialogues.json. */
const ASSIGN_STEP = "RK5KyB";
const DELIVER_STEP = "slk6Qf";

function onDialogueVariant(context) {
  return Common.isKhaled(context.npcId) ? Common.variantFor(context.player) : null;
}

function talk({ player, npc, npcId }) {
  Common.getApi().emitCustomEvent("npc-dialogue:start", {
    player, npc, npcId, variant: Common.variantFor(player), handled: false,
  });
}

/** RK5KyB: the missing assignment line. Under 49 the level line plays instead. */
function assignStep(request) {
  request.handled = true;
  request.steps = [{
    npc: Common.thievingLevel(request.player) < Common.THIEVING_LEVEL
      ? Common.MESSAGES.level
      : Common.taskLine(Common.assignTask(request.player)),
  }];
}

/** slk6Qf: "Captain Khaled takes the stolen item and hands the player some coins." */
function deliverStep(request, random) {
  request.handled = true;
  Common.handIn(request.player, random);
}

function onDialogueAction(request) {
  if (!Common.isKhaled(request.npcId)) return;
  if (request.stepId === ASSIGN_STEP) assignStep(request);
  else if (request.stepId === DELIVER_STEP) deliverStep(request);
}

/** Fill the transcript's "[location]" with the assigned house. */
function fillLocation(request) {
  if (!Common.isKhaled(request.npcId) || typeof request.text !== "string" || !request.text.includes("[location]")) return;
  const house = Common.houseByName(Common.taskOf(request.player)?.house);
  if (house) request.text = request.text.replace("[location]", house.label);
}

module.exports = function registerKhaled(api) {
  Common.bind(api);
  api.onNpcInteraction("Captain Khaled", { "Talk-to": talk, Task: talk });
  api.onNpcDialogueVariant(onDialogueVariant);
  api.onCustomEvent("npc-dialogue:action", onDialogueAction);
  api.onCustomEvent("npc-dialogue:line", fillLocation);
};

module.exports._test = {
  ASSIGN_STEP,
  DELIVER_STEP,
  onDialogueVariant,
  talk,
  assignStep,
  deliverStep,
  onDialogueAction,
  fillLocation,
};
