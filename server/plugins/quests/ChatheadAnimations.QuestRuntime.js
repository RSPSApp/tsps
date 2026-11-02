/**
 * Chat-head animations for quest speech, from live OSRS captures. The Wiki transcripts behind
 * npc-dialogues.json carry the words but not the head's animation, so each captured line's
 * animation is looked up by speaker and exact text; anything uncaptured keeps the default head.
 * data/chathead-animations.json holds the lines of the rsprox captures each audited quest's
 * docs/quests page lists.
 */
const ANIMATIONS = require("./data/chathead-animations.json");
const PLAYER_SPEAKER = "player";

const normalize = (text) => String(text).replace(/\s+/g, " ").trim();

function speakerOf({ step, definition }) {
  if (typeof step.player === "string") return PLAYER_SPEAKER;
  return step.speaker ?? definition?.getName?.();
}

function setCapturedAnimation(event) {
  if (event.expression !== undefined) return;
  const speech = event.step.player ?? event.step.npc ?? event.step.text;
  const animation = ANIMATIONS[speakerOf(event)]?.[normalize(speech)];
  if (animation !== undefined) event.expression = animation;
}

module.exports = function registerChatheadAnimations(api) {
  api.onCustomEvent("npc-dialogue:line", setCapturedAnimation);
};
