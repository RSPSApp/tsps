/**
 * Varrock Museum natural history quiz (basement): Orlando Smith asks the player to check
 * the 14 display plaques, three questions each.
 *
 * From rsprox captures (recording 1723, the whole quiz): "Study" on a plaque plays
 * vm_display_case_ponder and opens vm_natural_history with the case's title, number,
 * model(s), question and three answers. A right answer plays sound 3648, raises the case's
 * vm_nathis_*_display varbit (0-3) and has Orlando say so; continuing reopens the case on
 * its next question. The third gives 2 Kudos ("You have earned Kudos with the Museum!",
 * sound 3653) and Orlando's "that's all of them" line instead. Talking to him once every
 * case is done sets vm_nathis_reward_given, with "You have gained 1000xp in Slayer and
 * Hunter.", after his "chat to me boss" line; the XP itself lands once the chat is over.
 *
 * From the OSRS Wiki (Natural history quiz), not captured: the plaque message before
 * agreeing to help, the wrong-answer reply (the question then shows again), and a finished
 * case's plaque showing the display without the quiz. The captured last case ends on the
 * ordinary "that's all of them" lines, not the Wiki's longer last-case variant.
 *
 * Models: recording 1723 sends IF_SETROTATESPEED for interface 533 components 2, 3, 7-12
 * and 17-20 (xSpeed 0, ySpeed 5) each time a case opens. The dragon (4-6) and seaslug
 * (13-16) model components got no rotate-speed packet in that capture, so they are left
 * still rather than spun by guess. The vm_kudos HUD is mounted by the museum plugin.
 */
"use strict";

const runtime = require("../../quests/QuestRuntime");
const QUIZ = require("../data/natural-history-quiz.json");

const STATE_ATTRIBUTE = "museum:natural-history";
const AWARD_KUDOS_EVENT = "museum:award-kudos";
const ORLANDO_PAGE = "Orlando Smith";
const VARIANT = Object.freeze({
  INTRO: "before-starting-the-natural-history-quiz",
  NOT_STARTED: "after-accepting-to-help-with-the-natural-history-quiz-prior-to-correcting-any-display-cases",
  WRONG: "after-accepting-to-help-with-the-natural-history-quiz-upon-selecting-an-incorrect-answer-at-a-display-case",
  RIGHT: "after-accepting-to-help-with-the-natural-history-quiz-upon-selecting-a-correct-answer-at-a-display-case",
  CASE_DONE: "after-accepting-to-help-with-the-natural-history-quiz-after-correcting-any-display-case",
  IN_PROGRESS: "after-accepting-to-help-with-the-natural-history-quiz-talking-to-him-after-correcting-at-least-one-display-case",
  HAND_IN: "after-accepting-to-help-with-the-natural-history-quiz-talking-to-him-after-completing-the-display-cases",
  FINISHED: "talking-to-him-after-completing-the-natural-history-quiz",
});
/** The intro's "Sure thing." option. */
const AGREE_OPTION = "Sure thing.";
/** The hand-in's "chat to me boss" line (its fifth step): the reward follows it, as captured. */
const REWARD_LINE_INDEX = 4;
const QUESTIONS_PER_CASE = 3;
const KUDOS_PER_CASE = 2;
const REWARD_XP = 1000;
const SOUND_RIGHT_ANSWER = 3648;
const SOUND_KUDOS = 3653;
/**
 * IF_SETROTATESPEED in recording 1723 rotates exactly these vm_natural_history (533) model
 * components, one per single-model case. Components 4-6 (dragon) and 13-16 (seaslugs) got no
 * rotate packet in the capture; do not spin them without evidence.
 */
const ROTATED_QUIZ_COMPONENTS = new Set([2, 3, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20]);
const ROTATE_SPEED_X = 0;
const ROTATE_SPEED_Y = 5;
const NOT_AGREED_MESSAGE = "This looks like some sort of quiz. I wonder if I can take part...";
const KUDOS_MESSAGE = "You have earned Kudos with the Museum!";
const REWARD_MESSAGE = "You have gained 1000xp in Slayer and Hunter.";

let api = null;
let core = null;
let ids = null;
/** Player -> the case whose quiz is open, so only its answer buttons count. */
const openQuiz = new WeakMap();

function gameval(lookup, kind, name) {
  const id = lookup(name);
  if (!Number.isInteger(id)) throw new Error(`[museum] unknown ${kind} gameval ${name}`);
  return id;
}

function resolveIds() {
  const defs = core.CacheDefinitions;
  const component = (name) => gameval((value) => defs.getComponentId(value), "component", name);
  const varbit = (name) => gameval((value) => defs.getVarbitId(value), "varbit", name);
  return {
    interfaceId: gameval((value) => defs.getInterfaceId(value), "interface", "vm_natural_history"),
    title: component("vm_natural_history:vm_nathis_text"),
    number: component("vm_natural_history:vm_nathis_display_num"),
    quizText: component("vm_natural_history:vm_nathis_quiz_text"),
    question: component("vm_natural_history:vm_nathis_question"),
    answers: [1, 2, 3].map((n) => component(`vm_natural_history:vm_nathis_answer_0${n}`)),
    agreedVarbit: varbit("vm_nathis_agreed"),
    rewardVarbit: varbit("vm_nathis_reward_given"),
    ponder: gameval((value) => defs.getSeqId(value), "seq", "vm_display_case_ponder"),
    happy: gameval((value) => defs.getSeqId(value), "seq", "chathap1"),
    orlando: gameval((value) => defs.getNpcId(value), "npc", "vm_nathis_apprentice"),
    cases: QUIZ.cases.map((entry) => ({
      ...entry,
      plaqueId: gameval((value) => defs.getLocId(value), "loc", entry.plaque),
      varbitId: varbit(entry.varbit),
      models: entry.models.map((model) => ({ uid: component(model.component), model: model.model })),
    })),
  };
}

function stateOf(player) {
  const raw = player.getAttribute(STATE_ATTRIBUTE);
  return raw && typeof raw === "object" ? raw : {};
}

function progressOf(player, entry) {
  const value = Number(stateOf(player).cases?.[entry.varbit]) || 0;
  return Math.max(0, Math.min(QUESTIONS_PER_CASE, value));
}

function casesDone(player) {
  return ids.cases.filter((entry) => progressOf(player, entry) === QUESTIONS_PER_CASE).length;
}

function writeState(player, changes) {
  const state = stateOf(player);
  player.setAttribute(STATE_ATTRIBUTE, { ...state, ...changes });
}

function setProgress(player, entry, value) {
  const state = stateOf(player);
  writeState(player, { cases: { ...(state.cases ?? {}), [entry.varbit]: value } });
  player.getPacketSender().sendVarbit(entry.varbitId, value);
}

function sendQuizVarbits({ player }) {
  const state = stateOf(player);
  const sender = player.getPacketSender();
  if (state.agreed) sender.sendVarbit(ids.agreedVarbit, 1);
  if (state.rewarded) sender.sendVarbit(ids.rewardVarbit, 1);
  for (const entry of ids.cases) {
    const progress = progressOf(player, entry);
    if (progress > 0) sender.sendVarbit(entry.varbitId, progress);
  }
}

/**
 * The case on its next question, or the finished display without the quiz. Live sends the
 * text before opening; here a mounted group starts from its cache text, so it follows.
 */
function openCase(player, entry) {
  const sender = player.getPacketSender();
  const progress = progressOf(player, entry);
  sender.sendInterface(ids.interfaceId);
  sender.sendString(entry.title, ids.title);
  sender.sendString(String(entry.number), ids.number);
  for (const model of entry.models) {
    sender.sendInterfaceRawModel(model.uid, model.model);
    if (ROTATED_QUIZ_COMPONENTS.has(model.uid & 0xffff)) {
      sender.sendInterfaceRotateSpeed(model.uid, ROTATE_SPEED_X, ROTATE_SPEED_Y);
    }
  }
  if (progress < QUESTIONS_PER_CASE) {
    const question = entry.questions[progress];
    sender.sendString(question.question, ids.question);
    question.answers.forEach((answer, index) => sender.sendString(answer, ids.answers[index]));
    sender.sendInterfaceDisplayState(ids.quizText, false);
    openQuiz.set(player, entry);
  } else {
    sender.sendInterfaceDisplayState(ids.quizText, true);
    openQuiz.delete(player);
  }
}

function studyPlaque({ player, objectId }) {
  const entry = ids.cases.find((candidate) => candidate.plaqueId === objectId);
  if (!entry) return false;
  player.performAnimation(new core.Animation(ids.ponder));
  if (!stateOf(player).agreed) {
    player.sendMessage(NOT_AGREED_MESSAGE);
    return true;
  }
  openCase(player, entry);
  return true;
}

function orlandoLines(variant) {
  const steps = runtime.loadTranscripts(api)?.[ORLANDO_PAGE]?.variants?.[variant];
  return (Array.isArray(steps) ? steps : []).filter((step) => typeof step.npc === "string").map((step) => step.npc);
}

/** Orlando's reply over the player's shoulder, then `next` once the player continues. */
function orlandoSays(player, variant, next) {
  const { DialogueChainBuilder, NpcDialogue, ActionDialogue } = core;
  const builder = new DialogueChainBuilder();
  const lines = orlandoLines(variant);
  lines.forEach((line, index) => builder.add(new NpcDialogue(index, ids.orlando, line, undefined, ids.happy)));
  builder.add(new ActionDialogue(lines.length, { execute: next }));
  player.getDialogueManager().startDialogues(builder);
}

function reopenCase(player, entry) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
  openCase(player, entry);
}

function answer(player, choice) {
  const entry = openQuiz.get(player);
  if (!entry || player.getInterfaceId() !== ids.interfaceId) return false;
  openQuiz.delete(player);
  const progress = progressOf(player, entry);
  if (progress >= QUESTIONS_PER_CASE) return true;
  const sender = player.getPacketSender();
  player.performAnimation(new core.Animation(-1));
  sender.sendInterfaceRemoval();
  if (choice !== entry.questions[progress].correct) {
    orlandoSays(player, VARIANT.WRONG, () => reopenCase(player, entry));
    return true;
  }
  sender.sendSound(SOUND_RIGHT_ANSWER, 255, 0);
  setProgress(player, entry, progress + 1);
  if (progress + 1 < QUESTIONS_PER_CASE) {
    orlandoSays(player, VARIANT.RIGHT, () => reopenCase(player, entry));
    return true;
  }
  sender.sendSound(SOUND_KUDOS, 255, 0);
  api.emitCustomEvent(AWARD_KUDOS_EVENT, { player, amount: KUDOS_PER_CASE, source: `natural-history:${entry.varbit}` });
  player.sendMessage(KUDOS_MESSAGE);
  orlandoSays(player, VARIANT.CASE_DONE, () => sender.sendInterfaceRemoval());
  return true;
}

const answerFirst = ({ player }) => answer(player, 0);
const answerSecond = ({ player }) => answer(player, 1);
const answerThird = ({ player }) => answer(player, 2);

function selectOrlandoVariant({ npcId, player }) {
  if (npcId !== ids.orlando) return undefined;
  const state = stateOf(player);
  if (!state.agreed) return VARIANT.INTRO;
  if (state.rewarded) return VARIANT.FINISHED;
  const done = casesDone(player);
  if (done === ids.cases.length) return VARIANT.HAND_IN;
  return done > 0 ? VARIANT.IN_PROGRESS : VARIANT.NOT_STARTED;
}

function agreeToHelp({ player, npcId, option }) {
  if (npcId !== ids.orlando || option !== AGREE_OPTION || stateOf(player).agreed) return;
  writeState(player, { agreed: true });
  player.getPacketSender().sendVarbit(ids.agreedVarbit, 1);
}

function rewardLine(request) {
  const { player, npcId, step } = request;
  if (npcId !== ids.orlando || typeof step?.npc !== "string") return;
  const handIn = runtime.loadTranscripts(api)?.[ORLANDO_PAGE]?.variants?.[VARIANT.HAND_IN];
  if (!Array.isArray(handIn) || step.npc !== handIn[REWARD_LINE_INDEX]?.npc) return;
  request.after = () => giveReward(player);
}

function giveReward(player) {
  const state = stateOf(player);
  if (!state.agreed || state.rewarded || casesDone(player) !== ids.cases.length) return;
  writeState(player, { rewarded: true, xpPending: true });
  player.getPacketSender().sendVarbit(ids.rewardVarbit, 1);
  player.sendMessage(REWARD_MESSAGE);
  core.TaskManager.submit(rewardXpTask(player));
}

/**
 * Live levels the player up only once the conversation is over (the capture's level-up
 * messages follow "Goodbye."). Here the level-up pop-up would replace Orlando's remaining
 * lines, so the XP waits until no dialogue is open; `xpPending` survives a logout.
 */
function grantPendingXp(player) {
  if (!stateOf(player).xpPending) return;
  writeState(player, { xpPending: false });
  const skills = player.getSkillManager();
  skills.addExperience(core.Skill.SLAYER, REWARD_XP, false);
  skills.addExperience(core.Skill.HUNTER, REWARD_XP, false);
}

function rewardXpTask(player) {
  return new (class extends core.Task {
    constructor() { super(1, player); }
    execute() {
      if (!player.isRegistered()) return this.stop();
      if (player.getDialogueManager().isActive()) return;
      this.stop();
      grantPendingXp(player);
    }
  })();
}

function restoreQuiz({ player }) {
  sendQuizVarbits({ player });
  grantPendingXp(player);
}

module.exports = function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  ids = resolveIds();
  pluginApi.persistAttribute(STATE_ATTRIBUTE, null);
  pluginApi.onObjectInteraction("Plaque", { Study: studyPlaque });
  pluginApi.onInterfaceActionButton(ids.answers[0], answerFirst);
  pluginApi.onInterfaceActionButton(ids.answers[1], answerSecond);
  pluginApi.onInterfaceActionButton(ids.answers[2], answerThird);
  pluginApi.onNpcDialogueVariant(selectOrlandoVariant);
  pluginApi.onCustomEvent("npc-dialogue:choice", agreeToHelp);
  pluginApi.onCustomEvent("npc-dialogue:line", rewardLine);
  pluginApi.onPlayerLogin(restoreQuiz);
};
