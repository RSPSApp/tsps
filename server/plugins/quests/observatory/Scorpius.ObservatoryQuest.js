/**
 * The Spirit of Scorpius at the Grave of Scorpius, north of the Observatory: after Observatory Quest he
 * gives an unholy mould and blesses unholy symbols (https://oldschool.runescape.wiki/w/Spirit_of_Scorpius;
 * docs/quests/observatory-quest/README.md).
 *
 * - Talk-to without an amulet of ghostspeak first sends the Wiki's game message "This powerful spirit seems
 *   capable of speaking to you even though you are not wearing an Amulet of Ghostspeak." (its trivia).
 * - Before the quest is complete he says "Who treads upon my grave?" and "How dare you disturb me!", and
 *   nothing else.
 * - After it, the first conversation is the transcript's "speaking to him for the first time", where
 *   "I seek your wisdom." gets the mould. Until then he offers nothing else: the Wiki says the mould
 *   "must be claimed from him before he will bless any unholy symbols". He "will not give the player an
 *   unholy mould if there is one already in their inventory" (Wiki), so a carried mould counts as claimed.
 * - Every later conversation is the standard dialogue: a blessing turns one unpowered symbol into an
 *   unholy symbol, and a lost mould is replaced unless one is already in the inventory.
 * - The grave's Read shows its inscription in a message box.
 *
 * Every other word is the generated transcript's (Transcript:Spirit of Scorpius). Its four box lines (the mutter,
 * the blessing and both hand-outs) are game messages, where the Wiki marks boxes: both conversations at the end
 * of a video of the quest (https://www.youtube.com/watch?v=v3q37wl-hCM) show three of them in the chat, and Lost City sends all four as
 * messages. The blessing's two arrive as the player continues past "I will bless it for you.", then the chatbox
 * closes until his next line (about three seconds in the video).
 *
 * Not from OSRS (server/AGENTS.md rule 10): no OSRS source covers these, so they come from Lost City's 2004
 * scripts (spirit_of_scorpius.rs2 and grave_of_scorpius.rs2 in
 * https://github.com/LostCityRS/Content/tree/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/quests/quest_itgronigen/scripts):
 * the two lines before the quest (the second is also RuneScape Classic's,
 * https://classic.runescape.wiki/w/Transcript:Spirit_of_Scorpius); an unpowered symbol is blessed even
 * beside an unholy one (the Wiki lists the conditions without saying which wins); the five ticks after the
 * blessing before he speaks again; each line's chat-head mood; and the grave's inscription.
 */
const PAGE = "Spirit of Scorpius";
const FIRST_VARIANT = "standard-dialogue-speaking-to-him-for-the-first-time";
const STANDARD_VARIANT = "standard-dialogue";
const PRE_QUEST_LINES = Object.freeze(["Who treads upon my grave?", "How dare you disturb me!"]);
/** Lost City's grave_of_scorpius.rs2. */
const GRAVE_INSCRIPTION = "Here lies Scorpius: Only those who have seen beyond the stars may seek his counsel.";
const GRAVE_NAME = "Grave of Scorpius";
const MOULD_GIVEN_ATTRIBUTE = "observatory-quest:scorpius-mould-given";
/** "The ghost gives you a casting mould." (first conversation). */
const FIRST_MOULD_STEP = "Z094Db";
/** "The ghost mutters in a strange voice." */
const MUTTER_STEP = "H5RmVl";
/** "The unholy symbol throbs with power." */
const BLESS_STEP = "yNXit1";
/** "The ghost hands you another mould." */
const REPLACE_MOULD_STEP = "6mB7Eb";
/** Lost City's p_delay(5) between the blessing and "The symbol of our Lord has been blessed with power!". */
const BLESS_PAUSE_TICKS = 5;
/** The line whose continue blesses: Lost City's two messages, the swap, then the pause. */
const WILL_BLESS_LINE = "I see you have the unholy symbol of our Lord. I will bless it for you.";
const GHOSTSPEAK_MESSAGE = "This powerful spirit seems capable of speaking to you even though you are not wearing an Amulet of Ghostspeak.";
const MUTTER_MESSAGE = "The ghost mutters in a strange voice.";
const BLESS_MESSAGE = "The unholy symbol throbs with power.";

/** Lost City's mood for each line (spirit_of_scorpius.rs2); the chat-head animation also follows its line count. */
const MOODS = Object.freeze({
  "Who treads upon my grave?": "chatang",
  "How dare you disturb me!": "chatang",
  "I seek your wisdom.": "chatneu",
  "Indeed, I feel you have beheld the far places in the heavens.": "chatneu",
  "My Lord instructs me to help you.": "chatneu",
  "Here is a mould to make a token for our Lord; a mould for the unholy symbol of Zamorak.": "chatneu",
  "I have come to seek a blessing.": "chatneu",
  "I see you have the unholy symbol of our Lord. I will bless it for you.": "chathap",
  "The symbol of our Lord has been blessed with power!": "chatneu",
  "My master calls.": "chatneu",
  "I see you have the unholy symbol of our Lord. It is blessed with the Lord Zamorak's power.": "chathap",
  "Come to me when your faith weakens.": "chathap",
  "No blessings will be given to those who have no symbol of our Lord's love.": "chatang",
  "I need another mould for the unholy symbol.": "chatneu",
  "One you already have, another is not needed.": "chatneu",
  "Leave me be.": "chathap",
  "To lose an object is easy to replace. To lose the affections of our Lord is impossible to forgive.": "chatneu",
  "I have come to kill you.": "chatang",
  "The might of mortals, to me, is as the dust to the sea.": "chatneu",
});

let api = null;
let questComplete = null;

const ids = () => api.core.ItemIdentifiers;
const spiritId = () => api.core.NpcIdentifiers.SPIRIT_OF_SCORPIUS;
const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;
const mouldGiven = (player) => player.getAttribute(MOULD_GIVEN_ATTRIBUTE) === true;

/** The chat-head animation for a line: its mood, 1-4 by the chatbox lines it wraps to (chatang1..chatang4). */
function expressionFor(text) {
  const mood = MOODS[String(text)];
  if (!mood) return undefined;
  const lines = api.core.ChatTextLayout?.wrap?.(String(text)).length ?? 1;
  return api.core.CacheDefinitions.getSeqId(`${mood}${Math.min(Math.max(lines, 1), 4)}`) ?? undefined;
}

/**
 * Wiki (Ghostspeak amulet): Morytania legs 2 or better stand in for the amulet. That they also count
 * here is inferred from the message's wording.
 */
function wearsGhostspeak(player) {
  const { Equipment, ItemIdentifiers: I } = api.core;
  const equipment = player.getEquipment();
  const amulet = equipment.get(Equipment.AMULET_SLOT)?.getId?.();
  const legs = equipment.get(Equipment.LEG_SLOT)?.getId?.();
  return amulet === I.GHOSTSPEAK_AMULET || amulet === I.GHOSTSPEAK_AMULET_2
    || [I.MORYTANIA_LEGS_2, I.MORYTANIA_LEGS_3, I.MORYTANIA_LEGS_4].includes(legs);
}

/** Talk-to: the ghostspeak message, then his two lines before the quest; after it, the transcript (return false). */
function talk({ player }) {
  if (!wearsGhostspeak(player)) player.sendMessage(GHOSTSPEAK_MESSAGE);
  if (questComplete(player)) return false;
  const { DialogueChainBuilder, NpcDialogue } = api.core;
  const chain = new DialogueChainBuilder();
  PRE_QUEST_LINES.forEach((line, index) => chain.add(new NpcDialogue(index, spiritId(), line, undefined, expressionFor(line))));
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function readGrave({ player }) {
  const { DialogueChainBuilder, StatementDialogue } = api.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, GRAVE_INSCRIPTION)));
}

function selectVariant({ npcId, player }) {
  if (npcId !== spiritId() || !questComplete(player)) return null;
  return { page: PAGE, variant: mouldGiven(player) ? STANDARD_VARIANT : FIRST_VARIANT };
}

function setMood(request) {
  if (request.npcId !== spiritId() || request.expression !== undefined) return;
  const expression = expressionFor(request.text);
  if (expression !== undefined) request.expression = expression;
}

/** Past "I will bless it for you.": the two messages and the blessing, then the chatbox closes for the pause. */
function blessAfterLine(request) {
  if (request.npcId !== spiritId() || request.text !== WILL_BLESS_LINE || !questComplete(request.player)) return;
  const { player } = request;
  request.pauseTicks = BLESS_PAUSE_TICKS;
  request.after = () => {
    const { UNHOLY_SYMBOL, UNPOWERED_SYMBOL } = ids();
    if (!has(player, UNPOWERED_SYMBOL)) return;
    player.sendMessage(MUTTER_MESSAGE);
    player.sendMessage(BLESS_MESSAGE);
    player.getInventory().deleteNumber(UNPOWERED_SYMBOL, 1);
    player.getInventory().adds(UNHOLY_SYMBOL, 1);
  };
}

function answerCondition({ npcId, player, text }) {
  if (npcId !== spiritId()) return null;
  const { UNHOLY_MOULD, UNHOLY_SYMBOL, UNPOWERED_SYMBOL } = ids();
  const value = String(text).toLowerCase();
  const unpowered = has(player, UNPOWERED_SYMBOL);
  if (value.includes("has an unpowered symbol")) return unpowered;
  if (value.includes("has an unholy symbol")) return !unpowered && has(player, UNHOLY_SYMBOL);
  if (value.includes("neither of the above")) return !unpowered && !has(player, UNHOLY_SYMBOL);
  if (value.includes("does not have an unholy mould")) return !has(player, UNHOLY_MOULD);
  if (value.includes("already has an unholy mould")) return has(player, UNHOLY_MOULD);
  return null;
}

function giveMould(player) {
  const { giveReward } = require("../QuestRuntime");
  giveReward(player, ids().UNHOLY_MOULD, 1);
}

function handleAction(event) {
  const { player, npcId, stepId } = event;
  if (npcId !== spiritId() || !questComplete(player)) return;
  const { UNHOLY_MOULD } = ids();
  // The runtime sends the hand-outs' lines as game messages.
  switch (stepId) {
    case FIRST_MOULD_STEP:
      // A carried mould: no second one, and no line saying he gives it.
      if (has(player, UNHOLY_MOULD)) event.handled = true;
      else giveMould(player);
      player.setAttribute(MOULD_GIVEN_ATTRIBUTE, true);
      return;
    case REPLACE_MOULD_STEP:
      if (!has(player, UNHOLY_MOULD)) giveMould(player);
      return;
    case MUTTER_STEP:
    case BLESS_STEP:
      // Sent by blessAfterLine, before the pause.
      event.handled = true;
      return;
    default:
  }
}

/** `isComplete(player)`: whether Observatory Quest is complete. */
module.exports = function attachSpiritOfScorpius(pluginApi, { isComplete }) {
  api = pluginApi;
  questComplete = isComplete;
  pluginApi.persistAttribute(MOULD_GIVEN_ATTRIBUTE, false);
  pluginApi.onNpcInteraction("Spirit of Scorpius", { "Talk-to": talk });
  pluginApi.onObjectInteraction(GRAVE_NAME, { Read: readGrave });
  pluginApi.onNpcDialogueVariant(selectVariant);
  pluginApi.onNpcDialogueCondition(answerCondition);
  pluginApi.onCustomEvent("npc-dialogue:line", setMood);
  pluginApi.onCustomEvent("npc-dialogue:line", blessAfterLine);
  pluginApi.onCustomEvent("npc-dialogue:action", handleAction);
};

module.exports._test = {
  PRE_QUEST_LINES, GRAVE_INSCRIPTION, GHOSTSPEAK_MESSAGE, MOULD_GIVEN_ATTRIBUTE, FIRST_VARIANT, STANDARD_VARIANT,
  BLESS_PAUSE_TICKS, WILL_BLESS_LINE, MOODS, STEPS: { FIRST_MOULD_STEP, MUTTER_STEP, BLESS_STEP, REPLACE_MOULD_STEP }, expressionFor,
};
