// Recruiting crewmates through their Wiki transcripts (data/definitions/npc-dialogues.json): the
// variant each crewmate plays, the transcript's prose conditions (levels, quests, a free crew
// slot, a ghostspeak amulet) and its recruit messages, which run the recruitment as live does
// (rsprox, Jobless Jim at Port Sarim, Captain Siad at the mining camp):
//   met varbit as the offer is reached; then after the crewmate's last line the unlocked
//   varbit, "You have recruited X as a crew member." (highlighted green), the crew slot, and a
//   message box "You recruit X as a crew member. He heads off in search of your boat." over a
//   fade, with no continue until the screen fades back in, while the crewmate leaves their
//   recruit spot. With no crew slot free they "depart for the Pandemonium" instead, whatever
//   the Wiki transcript says (live recruits Captain Siad to the boat; his transcript doesn't).
const common = require("./Common.Crew");
const { fade } = require("../SailingContent.Sailing");

/** "You recruit X as a crew member." and where they go: to the boat, or the Pandemonium (Ada's names neither). */
const RECRUITED_PATTERN = /^You recruit (.+?) as a crew member\.(?: (?:He|She) (heads off in search of your boat|departs for the Pandemonium)\.)?$/;
const HAVE_RECRUITED_PATTERN = /^You have recruited .+ as a crew member\.$/;
/** The recruit leaves their spot 3 ticks after the fade starts; it fades back in a tick later (rsprox). */
const LEAVE_TICKS = 3;
const FADE_TICKS = 4;
/** The recruitment's fade: live fades over 50 client cycles here. */
const FADE_CYCLES = 50;
/** chatbox_transparency: live colours highlighted messages by it (@mes_hl_gre@). */
const VARBIT_CHATBOX_TRANSPARENCY = 4608;

function highlightGreen(player, text) {
  const transparent = player.getPacketSender().getVarbit(VARBIT_CHATBOX_TRANSPARENCY) === 1;
  return `<col=${transparent ? "229628" : "06600c"}>${text}</col>`;
}

/** The crewmate a dialogue is with and where they are: recruit spot, Pandemonium or dock. */
function crewAt(player, npcId) {
  const found = common.byNpc(npcId);
  if (!found || found.at === "ship") return undefined;
  if (found.at !== "world") return found;
  return { crew: found.crew, at: common.isRecruited(player, found.crew.id) ? "pandemonium" : "recruit" };
}

function ruleMatches(player, crew, at, rule) {
  const facts = {
    at,
    recruited: common.isRecruited(player, crew.id),
    met: common.hasMet(player, crew.id),
    pandemonium: common.pandemoniumDone(player),
    sailing40: common.sailingLevel(player) >= 40,
    ghostspeak: common.hearsGhosts(player),
    quests: (crew.quests ?? []).every((key) => common.questComplete(player, key)),
  };
  return Object.entries(rule).every(([key, wanted]) => key === "variant" || key === "page" || facts[key] === wanted);
}

/** Which transcript variant a crewmate plays (sailing-crew.json `variants`, first match). */
function selectVariant({ player, npcId }) {
  const found = crewAt(player, npcId);
  if (!found) return null;
  const rule = found.crew.variants.find((candidate) => ruleMatches(player, found.crew, found.at, candidate));
  if (!rule) return null;
  return { page: rule.page ?? found.crew.page, variant: rule.variant };
}

const NEGATIVE = /\b(not|without|before|under|less than|doesn't)\b/;

/**
 * Answers a crewmate transcript's prose conditions. A level of 40 is the crew management level
 * (and reaching that offer is meeting them); the crewmate's own level stands for all their
 * requirements, as the transcripts' failure messages list them together.
 */
function answerCondition({ player, npcId, text }) {
  const found = crewAt(player, npcId);
  if (!found) return null;
  const { crew } = found;
  const condition = String(text ?? "").toLowerCase();
  const negative = NEGATIVE.test(condition);
  const answer = (value) => (negative ? !value : value);
  if (/crew is full|crew slot|space in their crew/.test(condition)) {
    const free = common.freeSlot(player) >= 0;
    return /full|does not have/.test(condition) ? !free : free;
  }
  if (/ghostspeak/.test(condition)) return answer(common.hearsGhosts(player));
  if (/cargo hold/.test(condition)) return null;
  const level = /(\d+)\s*sailing|sailing level is (?:under|at least) (\d+)/.exec(condition);
  if (level) {
    const required = Number(level[1] ?? level[2]);
    if (required === 40) {
      if (common.pandemoniumDone(player)) common.setMet(player, crew.id);
      return answer(common.sailingLevel(player) >= 40);
    }
    return answer(common.meetsRequirements(player, crew));
  }
  if (/pandemonium/.test(condition)) return answer(common.pandemoniumDone(player));
  return null;
}

/**
 * Shows the recruitment's message box over a fade: without "Click here to continue" while the
 * crewmate leaves, then again with it as the screen fades back in (rsprox).
 */
function showRecruitment(player, text) {
  const { ActionDialogue, CountdownTask, DialogueChainBuilder, StatementDialogue, TaskManager } = common.core();
  fade(player, true, FADE_CYCLES);
  // The box replaces the conversation, so the transcript doesn't carry on (or close it).
  const waiting = new ActionDialogue(0, { execute: () => StatementDialogue.send(player, text, false) }, true);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(waiting));
  TaskManager.submit(new CountdownTask(player, LEAVE_TICKS, () => common.sendVarbits(player)));
  TaskManager.submit(new CountdownTask(player, FADE_TICKS, () => {
    if (player.getDialogueManager().getCurrent?.() !== waiting) return;
    fade(player, false, FADE_CYCLES);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }));
}

/**
 * A transcript's recruit message: recruits the crewmate and shows it as live does. They take a
 * free slot if there is one; the name is the one the message gives (live: "Captain Siad").
 */
function recruitFromMessage(event, crew, match) {
  const { player } = event;
  event.handled = true;
  if (!common.meetsRequirements(player, crew)) {
    event.end = true;
    return;
  }
  const name = match[1];
  const slot = common.recruit(player, crew, true);
  player.sendMessage(highlightGreen(player, `You have recruited ${name} as a crew member.`));
  const pronoun = /\. (He|She) /.exec(event.text)?.[1];
  const destination = slot >= 0 ? "heads off in search of your boat" : "departs for the Pandemonium";
  const text = pronoun ? `You recruit ${name} as a crew member. ${pronoun} ${destination}.` : event.text;
  showRecruitment(player, text);
}

/**
 * Steps under a marker that's skipped. The conversation plays a marker's own steps after it
 * whatever its handler does, so they're dropped as they come (npc-dialogue:line's `skip`).
 */
const skipped = new WeakSet();

function skipAll(steps) {
  for (const step of steps ?? []) {
    skipped.add(step);
    skipAll(step.steps);
    for (const option of step.options ?? []) skipAll(option.steps);
  }
}

/**
 * Markers the Wiki export left where a line was missing (sailing-crew.json `markers`): `play` lets
 * their steps play, `skip` (and an unlisted marker) drops them so the conversation carries on,
 * and `below40` plays them and ends the conversation only before 40 Sailing.
 */
function resolveMarker(event, marker) {
  const children = event.step.steps ?? [];
  event.handled = true;
  if (marker === "play") return;
  skipAll(children);
  if (marker === "below40" && common.sailingLevel(event.player) < 40) {
    event.steps = [...children.map((step) => ({ ...step })), { type: "end" }];
  }
}

function onLine(request) {
  if (skipped.has(request.step)) request.skip = true;
}

/** Transcript steps for crewmates: the recruit messages and the export's markers. */
function onAction(event) {
  const found = crewAt(event.player, event.npcId);
  if (!found) return;
  if (skipped.has(event.step)) {
    event.handled = true;
    return;
  }
  const text = String(event.text ?? "");
  const recruited = RECRUITED_PATTERN.exec(text);
  if (event.kind === "message" && recruited) return recruitFromMessage(event, found.crew, recruited);
  if (event.kind === "message" && HAVE_RECRUITED_PATTERN.test(text)) {
    // Sent with the recruitment, highlighted, as live orders it.
    event.handled = true;
    event.end = true;
    return;
  }
  const type = event.step?.type;
  if (type !== "missing" && type !== "unavailable") return;
  resolveMarker(event, found.crew.markers?.[event.stepId]);
}

function attach(api) {
  common.init(api);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onCustomEvent("npc-dialogue:line", onLine);
}

module.exports = attach;
module.exports.selectVariant = selectVariant;
module.exports.answerCondition = answerCondition;
module.exports.crewAt = crewAt;
