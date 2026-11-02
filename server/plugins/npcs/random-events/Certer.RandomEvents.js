"use strict";

// Question flow from the captured interface setup (552 ticks 20007-20013, 1858, 1704, 1105)
// and the Wiki's Certer page and Niles/Miles/Giles transcripts. See SOURCES.md.
const Gift = require("./GiftRewards.RandomEvents");
const Flow = require("./DialogueFlow.RandomEvents");
const GROUP = 184;
const MODEL = (GROUP << 16) | 7;
const FIRST_OPTION = 8;
const SELECT_ACTION = 1;
// Client script 65 starts the question model's spin (script 66 on a timer); live sends a fresh
// random x and y speed each time: 5,-10 / -10,-3 / 5,2 / 6,9 / -7,-5.
const SPIN_SCRIPT = 65;
const MAX_SPIN = 10;
const MODAL_SCRIPT = 2524;
// Raw models of the macro quiz items 6189-6198 (cache obj op 44). Five of the labels are captured
// with their model: axe 8828, fish 8829, helmet 8833, sword 8836, spade 8837. The two fish models
// share an answer. "A shield." and "A pair of shears." are captured as labels only; the ring and
// necklace wordings follow the same pattern but are not captured.
const QUESTIONS = [[8828, "An axe."], [8829, "A fish."], [8830, "A fish."], [8831, "A necklace."],
  [8832, "A shield."], [8833, "A helmet."], [8834, "A ring."], [8835, "A pair of shears."],
  [8836, "A sword."], [8837, "A spade."]];
// Only ever a wrong answer in the captures (1105 tick 16008).
const LABELS = [...new Set(QUESTIONS.map(question => question[1])), "A bowl."];
const THANKS = "Thank you, I hope you like your present. I must be<br>leaving now though.";
const THANKS_EXPRESSION = 568;
const WRONG = "Sorry, that's just not the right answer!";
const WRONG_EXPRESSION = 567;

function spin() {
  return Math.floor(Math.random() * (2 * MAX_SPIN + 1)) - MAX_SPIN;
}

/** Every click on the NPC asks a new question: 552 ticks 20007-20008 re-roll all of it. */
function ask() {
  const [model, answer] = QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
  const alternatives = LABELS.filter(label => label !== answer);
  const choices = [answer];
  while (choices.length < 3) choices.push(alternatives.splice(Math.floor(Math.random() * alternatives.length), 1)[0]);
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { model, answer, choices };
}

function open(api, active) {
  active.question = ask();
  active.interfaceId = GROUP;
  const sender = active.player.getPacketSender();
  if (active.player.getInterfaceId() === GROUP) sender.sendInterfaceRemoval();
  // Live fills the widgets before opening them (552); this client needs the group open first.
  sender.sendClientScript(MODAL_SCRIPT, -1, -1);
  sender.sendInterface(GROUP);
  active.question.choices.forEach((label, index) => sender.sendString(label, (GROUP << 16) | (1 + index)));
  sender.sendInterfaceRawModel(MODEL, active.question.model);
  sender.sendClientScript(SPIN_SCRIPT, spin(), spin(), 0, MODEL);
}

function choose(api, active, event, { valid, serve, leave }) {
  const index = (event.buttonId & 0xffff) - FIRST_OPTION;
  if ((event.buttonId >>> 16) !== GROUP || index < 0 || index > 2) return;
  event.handled = true;
  if (event.action !== SELECT_ACTION || !active?.question || active.definition.kind !== "certer" ||
      active.player.getInterfaceId() !== GROUP || !valid(active, event.player)) return;
  const player = active.player, npcId = active.npc.getId();
  if (active.question.choices[index] !== active.question.answer) {
    leave(active);
    Flow.chat(api, { player, npcId, lines: [{ text: WRONG, expression: WRONG_EXPRESSION }] });
    return;
  }
  active.gift ??= Gift.roll(api);
  if (serve(active, [active.gift])) {
    Flow.chat(api, { player, npcId, lines: [{ text: THANKS, expression: THANKS_EXPRESSION }] });
  }
}

module.exports = { open, choose };
