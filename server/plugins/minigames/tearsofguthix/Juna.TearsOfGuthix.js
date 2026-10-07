"use strict";

/**
 * Juna after the quest: her "Transcript:Juna" words, with this file answering the conditions and
 * running the stage directions. Entry needs the quest, empty hands, a week since the last
 * drink (from the start of the 7th day) and either a quest point or 100,000 XP gained since
 * entering then; the first visit is free (https://oldschool.runescape.wiki/w/Tears_of_Guthix_(minigame)).
 * Right-click "Story" goes straight to her verdict, and is only on her multiloc once the
 * quest is done (varbit 451).
 *
 * The transcript's own step ids name the branches: they are stable across dumps of the page.
 */

const Cave = require("./Cave.TearsOfGuthix");

const JUNA_LOC_NAME = "<col=ffff00>Juna</col>";
const QUEST_COMPLETE_VARBIT = 451;
const QUEST_COMPLETE = 2;
/** tog_juna_stories: how many of her own stories Juna has told (0-3). */
const STORIES_VARBIT = 452;
const STORIES_ATTRIBUTE = "tears-of-guthix:stories";
const REMINDERS_ATTRIBUTE = "tears-of-guthix:reminders";
/** Set while a conversation came from right-click "Story" rather than Talk-to. */
const VIA_STORY_ATTRIBUTE = "tears-of-guthix:via-story";

const COOLDOWN_DAYS = 7;
const XP_SINCE_LAST_VISIT = 100000;

const STANDARD = "standard-dialogue";
const IN_CAVE = "standard-dialogue-talking-to-juna-while-collecting-tears";
const STORY_IN_CAVE = "right-click-story-option-story-option-while-collecting-tears";

const STEP = {
  HANDS: "xVIAF8",
  NO_ADVENTURES_TALK: "PlgV_M",
  TOO_SOON: "ZcrLIs",
  NO_ADVENTURES_STORY: "gbeW2g",
  NO_ADVENTURES_TOO_SOON: "OHiPEk",
  ELIGIBLE: "xCJjUs",
  SAILING_EMBARGO: "FM5Dok",
  ENTER: "1SFGWK",
  LEAVE: "2mFJse",
  FIRST_STORY: "ucFMWH",
  HAS_ICON: "AsLW9B",
};
const NOT_ENOUGH_XP_MESSAGES = new Set(["mr8z1y", "Y7mXMq", "3rfO2n"]);
const OKAY_OPTION = "Okay...";
const NEW_STORY_OPTION = "Tell me a new story.";
const REMINDERS_ON_OPTION = "I'd like to receive messages prompting me to return here.";
const REMINDERS_OFF_OPTION = "I don't want any messages reminding me to return here.";

let api;
let junaNpcId;

const sender = (player) => player.getPacketSender();
const isJuna = (event) => event.npcId === junaNpcId;
const stories = (player) => Number(player.getAttribute(STORIES_ATTRIBUTE)) || 0;

function questDone(player) {
  return sender(player).getVarbit(QUEST_COMPLETE_VARBIT) >= QUEST_COMPLETE;
}

/** What Juna weighs: days to wait and XP still due since the last visit. */
function eligibility(player) {
  const last = player.getAttribute(Cave.LAST_VISIT_ATTRIBUTE);
  if (!last || typeof last !== "object") return { daysLeft: 0, adventures: true, xpDue: 0 };
  const daysLeft = Math.max(0, COOLDOWN_DAYS - (Cave.today() - (Number(last.day) || 0)));
  const gained = Cave.totalXp(player) - (Number(last.totalXp) || 0);
  const adventures = Cave.questPoints(player) > (Number(last.questPoints) || 0) || gained >= XP_SINCE_LAST_VISIT;
  return { daysLeft, adventures, xpDue: Math.max(0, XP_SINCE_LAST_VISIT - gained) };
}

function emptyHands(player) {
  const { Equipment } = api.core;
  const equipment = player.getEquipment();
  return equipment.getSlot(Equipment.WEAPON_SLOT) === -1 && equipment.getSlot(Equipment.SHIELD_SLOT) === -1;
}

// --- Variant and conditions

function selectVariant({ npcId, player }) {
  if (npcId !== junaNpcId) return null;
  return Cave.isPlaying(player) ? IN_CAVE : null;
}

function answerCondition({ npcId, player, text, stepId }) {
  if (npcId !== junaNpcId || !questDone(player)) return null;
  const viaStory = player.getAttribute(VIA_STORY_ATTRIBUTE) === true;
  const { daysLeft, adventures } = eligibility(player);
  switch (stepId) {
    case STEP.HANDS: return !emptyHands(player);
    case STEP.NO_ADVENTURES_TALK: return !viaStory && !adventures;
    case STEP.TOO_SOON: return adventures && daysLeft > 0;
    case STEP.NO_ADVENTURES_STORY: return !adventures && daysLeft === 0;
    case STEP.NO_ADVENTURES_TOO_SOON: return !adventures && daysLeft > 0;
    case STEP.ELIGIBLE: return adventures && daysLeft === 0;
    case STEP.SAILING_EMBARGO: return false;
    case STEP.HAS_ICON: return player.getInventory().contains(api.core.ItemIdentifiers.GUTHIXIAN_ICON);
  }
  return answerProse(player, String(text ?? ""));
}

/** Her own stories ("asked ... once before") and the reminder toggle. */
function answerProse(player, text) {
  const told = stories(player);
  if (/has not asked Juna to tell them a story before/.test(text)) return told === 0;
  if (/tell them a story once before/.test(text)) return told === 1;
  if (/tell them a new story twice before/.test(text)) return told === 2;
  if (/tell them a new story thrice before/.test(text)) return told >= 3;
  const reminders = player.getAttribute(REMINDERS_ATTRIBUTE) === true;
  if (/turned off the weekly reminders/.test(text)) return !reminders;
  if (/turned on the weekly reminders/.test(text)) return reminders;
  return null;
}

// --- What the conversation does

function setStories(player, count) {
  player.setAttribute(STORIES_ATTRIBUTE, count);
  sender(player).sendVarbit(STORIES_VARBIT, count);
}

function onChoice({ npcId, player, option }) {
  if (npcId !== junaNpcId) return;
  if (option === OKAY_OPTION) player.setAttribute(VIA_STORY_ATTRIBUTE, false);
  else if (option === NEW_STORY_OPTION) setStories(player, Math.min(3, stories(player) + 1));
  else if (option === REMINDERS_ON_OPTION) player.setAttribute(REMINDERS_ATTRIBUTE, true);
  else if (option === REMINDERS_OFF_OPTION) player.setAttribute(REMINDERS_ATTRIBUTE, false);
}

function onConditionChosen({ npcId, player, stepId }) {
  if (npcId === junaNpcId && stepId === STEP.FIRST_STORY && stories(player) === 0) setStories(player, 1);
}

function onAction(event) {
  if (!isJuna(event)) return;
  const { player, stepId } = event;
  if (stepId === STEP.ENTER) {
    Cave.enter(player);
    event.handled = true;
    event.end = true;
  } else if (stepId === STEP.LEAVE) {
    Cave.finish(player);
    event.handled = true;
    event.end = true;
  } else if (NOT_ENOUGH_XP_MESSAGES.has(stepId)) {
    const { xpDue } = eligibility(player);
    player.sendMessage(String(event.text).replace("[experience due]", xpDue.toLocaleString("en-US")));
    event.handled = true;
  }
}

/** "Come back [tomorrow/in [amount] days]." */
function fillLine(request) {
  if (request.npcId !== junaNpcId || !String(request.text).includes("[tomorrow/in [amount] days]")) return;
  const { daysLeft } = eligibility(request.player);
  request.text = request.text.replace("[tomorrow/in [amount] days]", daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`);
}

// --- Right-click Story

/** The verdict half of "Okay...": every condition after the stories are told. */
function verdictSteps(steps) {
  const menu = steps.find((step) => step.type === "choice");
  const okay = menu?.options?.find((option) => option.text === OKAY_OPTION);
  return (okay?.steps ?? []).filter((step) => step.type === "condition");
}

function tellStory({ player }) {
  if (Cave.isPlaying(player)) {
    api.emitCustomEvent("npc-dialogue:start", { player, npcId: junaNpcId, variant: STORY_IN_CAVE });
    return;
  }
  player.setAttribute(VIA_STORY_ATTRIBUTE, true);
  api.emitCustomEvent("npc-dialogue:start", { player, npcId: junaNpcId, variant: STANDARD, select: verdictSteps });
}

function login({ player }) {
  if (stories(player) > 0) sender(player).sendVarbit(STORIES_VARBIT, stories(player));
}

module.exports = function registerJuna(pluginApi) {
  api = pluginApi;
  junaNpcId = api.core.NpcIdentifiers.JUNA;
  api.persistAttribute(STORIES_ATTRIBUTE);
  api.persistAttribute(REMINDERS_ATTRIBUTE);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", onChoice);
  api.onCustomEvent("npc-dialogue:condition", onConditionChosen);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onCustomEvent("npc-dialogue:line", fillLine);
  api.onObjectInteraction(JUNA_LOC_NAME, { Story: tellStory });
  api.onPlayerLogin(login);
};

module.exports._test = { eligibility, answerCondition, verdictSteps, setApi: (value) => { api = value; junaNpcId = value.core.NpcIdentifiers.JUNA; } };
