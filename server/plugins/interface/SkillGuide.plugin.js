"use strict";

const { hasQuestJournal, openQuestJournal } = require("../quests/QuestRuntime");

/**
 * The skill guide (skill_guide_v2, interface 860), as live OSRS opens it (rsprox captures, see
 * docs/skill-guide.md): "View <skill> guide" on a Skills tab stat opens the guide in the
 * floater, makes its tabs clickable and runs skill_guide_v2_init with the guide's number for
 * that skill. The guide's own scripts draw it and switch its tabs; the server only opens,
 * re-opens (a link to another skill's guide) and closes it, and opens a quest's journal from
 * the Quest XP tab.
 *
 * With All Settings' "Enable new-style skill guide interface" (row 360, varbit 15321
 * option_skill_guide, on by default) off, the stat opens the old guide (skill_guide, interface
 * 214) instead: the floater, its icons with no events, and skill_guide_content_init with the same
 * arguments. Its own scripts draw it; the server only closes it.
 *
 * Before opening, a click is offered to other plugins as `skills:stat-clicked` (payload
 * { player, childId, handled }): SetSkillLevel claims it on PvP worlds for its level prompt.
 *
 * Level-ups (rsprox captures, docs/skill-guide.md "New unlocks"): announcing one sets the skill's
 * levelup_list varbit to the first new level, unless one is already waiting, and flashes the
 * Skills tab (flashside 2) until it is clicked. The next "View guide" on that skill clears the
 * varbit and opens the guide with the range from that level to the current one, which the
 * guide's scripts highlight. Neither var is saved: live logs in with them clear.
 */

const STATS = 320;
const GUIDE = 860;
const FLOATER_UID = (161 << 16) | 18;
const OVERLAY = 1;
const VIEW_GUIDE_OP = 2;

const GUIDE_CLOSE = 4;
const GUIDE_TABS = 7;
const GUIDE_QUEST_LINK = 17;
const GUIDE_SKILL_LINK = 18;
const GUIDE_LIST = 21;
const TAB_SLOTS = 200;
const OP1 = 1 << 1;

const SKILL_GUIDE_V2_INIT = 1902;
/** skill_guide_v2_init's second argument whenever it highlights new unlocks, as captured. */
const NEW_UNLOCKS_MODE = 31;

/** Skills tab component -> the levelup_list varbit's skill, as gamevals name both. */
const LEVELUP_LIST_BY_STAT = new Map([
  [1, "attack"], [2, "strength"], [3, "defence"], [4, "ranged"], [5, "prayer"], [6, "magic"],
  [7, "runecraft"], [8, "construction"], [9, "hitpoints"], [10, "agility"], [11, "herblore"],
  [12, "thieving"], [13, "crafting"], [14, "fletching"], [15, "slayer"], [16, "hunter"],
  [17, "mining"], [18, "smithing"], [19, "fishing"], [20, "cooking"], [21, "firemaking"],
  [22, "woodcutting"], [23, "farming"], [24, "sailing"],
]);
/** Server Skill names that differ from the gameval's. */
const LEVELUP_LIST_BY_SKILL_NAME = new Map([["runecrafting", "runecraft"]]);
const FLASHSIDE_VARBIT = 3756;
/** flashside's value for the Skills tab (stone1): the tab index plus one. */
const FLASH_SKILLS_TAB = 2;
/** The Skills tab button (stone1) per gameframe root, as captured (161:60, 548:65, 164:53). */
const SKILLS_TAB_STONES = new Map([[161, 60], [548, 65], [164, 53]]);

const OLD_GUIDE = 214;
const OLD_GUIDE_CLOSE = 30;
const OLD_GUIDE_ICONS = 32;
const SKILL_GUIDE_CONTENT_INIT = 9340;
const NEW_STYLE_VARBIT = 15321;

/** Skills tab component -> the guide's number for its skill: the fourth argument each
 * component gives script 393 in the cache. */
const GUIDE_SKILL_BY_STAT = new Map([
  [1, 1], [2, 2], [3, 5], [4, 3], [5, 7], [6, 4], [7, 12], [8, 22],
  [9, 6], [10, 8], [11, 9], [12, 10], [13, 11], [14, 19], [15, 20], [16, 23],
  [17, 13], [18, 14], [19, 15], [20, 16], [21, 17], [22, 18], [23, 21], [24, 24],
]);
const GUIDE_SKILLS = new Set(GUIDE_SKILL_BY_STAT.values());

let api;

const uid = (child) => (GUIDE << 16) | child;

function levelupListVarbit(name) {
  return name === undefined ? null : api.core.CacheDefinitions.getVarbitId(`levelup_list_${name}`);
}

/** A server Skill's name as the levelup_list gamevals spell it. */
function levelupName(skill) {
  const key = String(skill.getName()).toLowerCase();
  return LEVELUP_LIST_BY_SKILL_NAME.get(key) ?? key;
}

/** A level-up being announced: remember its first new level until the guide is viewed. */
function rememberLevelUp({ player, skill, oldLevel }) {
  const varbit = levelupListVarbit(levelupName(skill));
  if (varbit == null) return;
  const sender = player.getPacketSender();
  if (!sender.getVarbit(varbit)) sender.sendVarbit(varbit, oldLevel + 1);
  if (!sender.getVarbit(FLASHSIDE_VARBIT)) sender.sendVarbit(FLASHSIDE_VARBIT, FLASH_SKILLS_TAB);
}

/** Clicking the Skills tab stops its level-up flash. */
function skillsTabClicked(player) {
  const sender = player.getPacketSender();
  if (sender.getVarbit(FLASHSIDE_VARBIT) === FLASH_SKILLS_TAB) sender.sendVarbit(FLASHSIDE_VARBIT, 0);
}

/**
 * The new-style guide's highlight for a stat with a level-up waiting: [mode, from, to], after
 * clearing the waiting level. None waiting (or the stat has no varbit) highlights nothing.
 */
function takeNewUnlocks(player, statChild) {
  const varbit = levelupListVarbit(LEVELUP_LIST_BY_STAT.get(statChild));
  if (varbit == null) return [0, 0, 0];
  const sender = player.getPacketSender();
  const from = sender.getVarbit(varbit);
  if (!from) return [0, 0, 0];
  sender.sendVarbit(varbit, 0);
  const skill = api.core.Skill.VALUES.find((stat) => levelupName(stat) === LEVELUP_LIST_BY_STAT.get(statChild));
  const to = skill ? player.getSkillManager().getMaxLevel(skill) : from;
  return [NEW_UNLOCKS_MODE, from, Math.max(from, to)];
}

function openGuide(player, guideSkill, statChild) {
  const sender = player.getPacketSender();
  if (!sender.getVarbit(NEW_STYLE_VARBIT)) {
    sender.sendSubInterface(FLOATER_UID, OLD_GUIDE, OVERLAY);
    sender.sendInterfaceScript(SKILL_GUIDE_CONTENT_INIT, [guideSkill, 0, 0, 0]);
    sender.sendInterfaceFlagsRange((OLD_GUIDE << 16) | OLD_GUIDE_ICONS, -1, -1, 0);
    return;
  }
  // Live clears the waiting level before it opens the guide.
  const highlight = statChild === undefined ? [0, 0, 0] : takeNewUnlocks(player, statChild);
  sender.sendSubInterface(FLOATER_UID, GUIDE, OVERLAY);
  sender.sendInterfaceFlagsRange(uid(GUIDE_LIST), -1, -1, 0);
  sender.sendInterfaceFlagsRange(uid(GUIDE_TABS), 0, TAB_SLOTS, OP1);
  sender.sendInterfaceScript(SKILL_GUIDE_V2_INIT, [guideSkill, ...highlight]);
}

/** The stats' "View <skill> guide", unless another plugin claims the click first. */
function viewGuide(event) {
  const guideSkill = GUIDE_SKILL_BY_STAT.get(Number(event.childId));
  if (guideSkill === undefined || Number(event.opId ?? event.action) !== VIEW_GUIDE_OP) return;
  event.handled = true;
  const offer = { player: event.player, childId: Number(event.childId), handled: false };
  api.emitCustomEvent("skills:stat-clicked", offer);
  if (!offer.handled) openGuide(event.player, guideSkill, Number(event.childId));
}

/** A link inside the guide to another skill's guide: the skill comes as the trigger's one int. */
function followSkillLink(event) {
  if (!event.scriptTrigger) return;
  const guideSkill = readTriggerInt(event.argsData);
  if (!GUIDE_SKILLS.has(guideSkill)) return;
  event.handled = true;
  openGuide(event.player, guideSkill);
}

/**
 * "View-journal" on a Quest XP row: cache script 9189 sends the quest table row's id column as
 * the trigger's one int. Live OSRS closes the guide and opens that quest's journal, as the quest
 * list's "Read journal" does.
 */
function viewQuestJournal(event) {
  if (!event.scriptTrigger) return;
  const questId = readTriggerInt(event.argsData);
  if (!hasQuestJournal(questId)) return;
  event.handled = true;
  event.player.getPacketSender().closeInterface(GUIDE);
  openQuestJournal(event.player, questId);
}

/** if_triggeroplocal arguments: ints as zigzag varints. */
function readTriggerInt(argsData) {
  if (!argsData?.length) return undefined;
  let value = 0;
  let shift = 0;
  for (const byte of argsData) {
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return (value >>> 1) ^ -(value & 1);
    shift += 7;
  }
  return undefined;
}

function closeGuide(event, group) {
  event.handled = true;
  event.player.getPacketSender().closeInterface(group);
}

function onInterfaceClick(event) {
  const groupId = Number(event.groupId);
  const childId = Number(event.childId);
  if (SKILLS_TAB_STONES.get(groupId) === childId) skillsTabClicked(event.player);
  if (groupId === STATS) viewGuide(event);
  else if (groupId === GUIDE && childId === GUIDE_CLOSE) closeGuide(event, GUIDE);
  else if (groupId === OLD_GUIDE && childId === OLD_GUIDE_CLOSE) closeGuide(event, OLD_GUIDE);
  else if (groupId === GUIDE && childId === GUIDE_SKILL_LINK) followSkillLink(event);
  else if (groupId === GUIDE && childId === GUIDE_QUEST_LINK) viewQuestJournal(event);
}

module.exports = {
  name: "SkillGuide",
  description: "Opens the skill guide (new or old style, as All Settings chooses) when you pick View guide on a Skills tab stat, highlighting what your level-ups since you last looked unlocked (the Skills tab flashes until clicked), and opens a quest's journal from the Quest XP tab.",
  register(pluginApi) {
    api = pluginApi;
    pluginApi.onInterfaceActionClick(onInterfaceClick);
    pluginApi.onCustomEvent("level-up:announced", rememberLevelUp);
  },
};

module.exports._test = { GUIDE_SKILL_BY_STAT, LEVELUP_LIST_BY_STAT, NEW_UNLOCKS_MODE, readTriggerInt, SKILL_GUIDE_V2_INIT, SKILL_GUIDE_CONTENT_INIT };
