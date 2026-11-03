"use strict";

// Clue NPCs speak their own Wiki transcript (npc-dialogues.json, read through NpcDialogues'
// "npc-dialogue:start" with a `select` that only captures the steps). The trail decides what
// happens; the transcript supplies the words, with the wording most transcripts share as a fallback.
// The transcripts name the "talk again with the scroll" variant several ways.
// Master's light-or-puzzle-box NPCs add their own names for it, some with no tier in them.
const PUZZLE_HOLDING_SUFFIXES = ["while-holding-the-puzzle-box", "when-holding-the-puzzle-box", "talking-again-while-holding-the-puzzle-box",
  "while-holding-the-light-or-puzzle-box", "talking-while-holding-the-light-or-puzzle-box", "while-holding-the-light-puzzle-box",
  "talking-again", "with-inventory-space-available-talking-again"];
const UNTIERED_PUZZLE_HOLDING = ["treasure-trails-talking-again-while-holding-the-light-or-puzzle-box", "treasure-trails-talking-again"];
const AGAIN_SUFFIXES = ["when-talked-to-again", "when-spoken-to-again", "talking-again", "spoken-to-again", "talked-to-again",
  "talked-to-when-talked-to-again", "speaking-to-him-again-with-the-challenge-scroll-in-the-inventory", "answering-the-clue", "solving-the-challenge"];
let api;
let core;

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
}

/** The steps of one variant of the NPC's transcript, or null when it has none. */
function transcript(player, npc, npcId, variant) {
  let found = null;
  // `exact`: an NPC without this variant has nothing to say here, not its everyday chat.
  api.emitCustomEvent("npc-dialogue:start", { player, npc, npcId, variant, exact: true, handled: false,
    select: steps => { found = steps; return []; } });
  return Array.isArray(found) && found.length ? found : null;
}

/** The first of `variants` the NPC's transcript has. */
function firstTranscript(player, npc, npcId, variants) {
  for (const variant of variants) {
    const steps = transcript(player, npc, npcId, variant);
    if (steps) return steps;
  }
  return null;
}

function againTranscript(player, npc, npcId, tier) {
  return firstTranscript(player, npc, npcId, AGAIN_SUFFIXES.map(suffix => `treasure-trails-${tier}-${suffix}`));
}

/** Spoken lines up to the first action, message, condition or end; a random step picks one option. */
function lines(steps, random = Math.random, npcName) {
  const spoken = [];
  for (const step of steps ?? []) {
    if (typeof step.npc === "string") spoken.push({ npc: step.npc });
    else if (typeof step.player === "string") spoken.push({ player: step.player });
    else if (step.type === "line" && typeof step.text === "string") {
      if (/^player$/i.test(step.speaker ?? "")) spoken.push({ player: step.text });
      else if (!step.speaker || !npcName || step.speaker === npcName) spoken.push({ npc: step.text });
      else break;
    }
    else if (step.type === "random" && step.options?.length) {
      spoken.push(...lines(step.options[Math.floor(random() * step.options.length)].steps, random, npcName));
      break;
    } else break;
  }
  return spoken;
}

/** A hand-over's spoken lines around its receive action and message, up to a condition or end. */
function speech(steps, random = Math.random) {
  const spoken = [];
  for (const step of steps ?? []) {
    if (typeof step.npc === "string") spoken.push({ npc: step.npc });
    else if (typeof step.player === "string") spoken.push({ player: step.player });
    else if (step.type === "line" && typeof step.text === "string") spoken.push({ npc: step.text });
    else if (step.type === "random" && step.options?.length) spoken.push(...lines(step.options[Math.floor(random() * step.options.length)].steps, random));
    else if (step.type !== "action" && step.type !== "message") break;
  }
  return spoken;
}

/**
 * The NPC's words with a puzzle box in hand, solved or not: its own "having solved" /
 * "without having solved" variant, or the matching branch of a "holding the puzzle box" one.
 */
function puzzleTranscript(player, npc, npcId, tier, solved) {
  const having = solved ? "having" : "without-having";
  const own = firstTranscript(player, npc, npcId, [`treasure-trails-${tier}-when-talked-to-${having}-solved-the-puzzle-box`,
    `treasure-trails-${tier}-if-talked-to-${having}-solved-the-puzzle-box`]);
  if (own) return own;
  const holding = firstTranscript(player, npc, npcId, [...PUZZLE_HOLDING_SUFFIXES.map(suffix => `treasure-trails-${tier}-${suffix}`), ...UNTIERED_PUZZLE_HOLDING]);
  return branch(holding, text => /solved/i.test(text) && /\bnot\b/i.test(text) !== solved);
}

function branch(steps, test) {
  return (steps ?? []).find(step => step.type === "condition" && test(step.text ?? ""))?.steps ?? null;
}

const wrongBranch = steps => branch(steps, text => /wrong|incorrect/i.test(text));
const correctBranch = steps => branch(steps, text => /correct/i.test(text) && !/incorrect/i.test(text));

/**
 * The hand-over message for a clue or (with `casket`) a casket: "[a/b]" choices resolved, and
 * nested "another clue scroll" / "casket" conditions followed only on the matching side.
 */
function message(steps, casket = false) {
  for (const step of steps ?? []) {
    if (step.type === "message" && typeof step.text === "string") return step.text.replace(/\[([^\]/]+)\/([^\]]+)\]/g, (_, a, b) => casket ? b : a);
    if (step.type === "condition" && (/casket/i.test(step.text ?? "") ? !casket : /clue scroll/i.test(step.text ?? "") && casket)) continue;
    const nested = message(step.steps, casket);
    if (nested) return nested;
  }
  return null;
}

// The transcripts' name placeholder, as NpcDialogues fills it ("Thanks [player name]!").
// Falo's "[Fremennik name]" is the player's name too, as Royal Trouble fills it.
const PLAYER_NAME = /\[(?:player name|playername|player|Fremennik name)(\.?)\]|<player name>/gi;

function named(text, player) {
  const name = player.getDisplayName?.();
  return name ? String(text).replace(PLAYER_NAME, (_, period) => `${name}${period ?? ""}`) : String(text);
}

/** Plays spoken lines, then `onEnd` (if any) once the player has continued past them. */
function play(player, npcId, spoken, onEnd) {
  // A dialogue of only an action never shows, so its action would never run.
  if (!spoken.length) { onEnd?.(); return; }
  const chain = new core.DialogueChainBuilder();
  spoken.forEach((line, index) => chain.add(line.player != null ? new core.PlayerDialogue(index, named(line.player, player)) :
    new core.NpcDialogue(index, npcId, named(line.npc, player))));
  if (onEnd) chain.add(new core.ActionDialogue(spoken.length, { execute: onEnd }));
  chain.add(new core.EndDialogue(spoken.length + 1));
  player.getDialogueManager().startDialogues(chain);
}

/**
 * Lines, then `give` with an item box of what was given, then more lines: an NPC handing something
 * over mid-speech (master's torn parts: "Here you go.", the part, then their compliment).
 */
function playHandOver(player, npcId, before, give, itemId, text, after = []) {
  const chain = new core.DialogueChainBuilder();
  let index = 0;
  const say = line => chain.add(line.player != null ? new core.PlayerDialogue(index++, named(line.player, player)) :
    new core.NpcDialogue(index++, npcId, named(line.npc, player)));
  before.forEach(say);
  chain.add(new core.ActionDialogue(index++, { execute: give }));
  chain.add(new core.ItemStatementDialogue(index++, itemId, text));
  after.forEach(say);
  chain.add(new core.EndDialogue(index));
  player.getDialogueManager().startDialogues(chain);
}

/** A plain message box, as live sends for a solved puzzle or light box. */
function mesbox(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.StatementDialogue(0, text)).add(new core.EndDialogue(1)));
}

function itemBox(player, itemId, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, itemId, text)).add(new core.EndDialogue(1)));
}

module.exports = { attach, transcript, againTranscript, puzzleTranscript, lines, speech, branch, wrongBranch, correctBranch, message, play, playHandOver, itemBox, mesbox };
