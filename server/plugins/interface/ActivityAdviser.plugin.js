"use strict";

const { getRegisteredQuests, hasQuestJournal, openQuestJournal, QUEST_POINTS_ATTRIBUTE } = require("../quests/QuestRuntime");
const { metadata, questMetadata } = require("../quests/QuestList.QuestRuntime");

/**
 * The Activity Adviser (cr_ui, interface 372). The minimap's Activity Adviser button, shown
 * while All Settings' "Show Activity Adviser" is on, opens it in the floater and closes it
 * again; so do its Close button and Esc. The interface has no close script of its own: closing
 * it, or another floater interface taking its place, runs script 6378, which marks it closed and
 * turns the button's option back to "Open Activity Adviser". Only the Quests module
 * exists: the cache's own scripts draw it from one string the server gives script 2493, a
 * serialised int table "<cells + 2>||<rows>||5||<cells...>" with one row per suggestion:
 * [kind, quest id, reason, 0, 0]. Kind 2 is a quest to work towards (its requirements are
 * listed), any other kind one the player can start now. The reason picks script 2491's line:
 * 1 the quest's own cr_recommendation_reason, 3 "Continue the <series> storyline.", 4 "Pick up
 * where you left off.", 6 "Required for other quests.".
 *
 * Suggestions come from the cache quest table's own columns: quests it marks cr_can_recommend,
 * not done, with their requirement_* columns checked. The All Quests / Free Quests Only tabs set
 * cr_quests_include_members; Refresh and a tab click rebuild the list, and "View journal" opens
 * the quest's journal. The cr_quests_cached_* varbits hold the totals the list was built from,
 * which the client's scripts compare to offer Refresh once they change.
 * Ours: the order (started quests first, then starter_order, then name) and the list sizes.
 */

const CR_UI = 372;
const FLOATER_UID = (161 << 16) | 18;
const OVERLAY = 1;
const OP1 = 1 << 1;
/** orbs:cr_button and its no-map and mobile layouts' copies. */
const ORB_BUTTONS = new Set([(160 << 16) | 4, (895 << 16) | 49, (897 << 16) | 46, (898 << 16) | 52]);
const CLOSE_BUTTON = 4;
const TABS = 14;
const TAB_ALL = 0;
const TAB_FREE = 1;
const REFRESH = 15;
const JOURNAL_BUTTONS = 18;

const SCRIPT_SET_QUESTS = 2493;
const SCRIPT_CLOSED = 6378;

const INCLUDE_MEMBERS_VARBIT = 5367;
const INCLUDE_MEMBERS_ATTRIBUTE = "activity-adviser:include-members";
const CACHED = {
  updateCache: 14153,
  available: 14154,
  target: 14155,
  totalLevel: 14156,
  questsCompleted: 14157,
  subquestsCompleted: 14158,
  miniquestsCompleted: 14163,
};
const QUESTS_COMPLETED_VARBIT = 6347;
const SUBQUESTS_COMPLETED_VARBIT = 13987;
const MINIQUESTS_COMPLETED_VARBIT = 14162;

const KIND_AVAILABLE = 1;
const KIND_TARGET = 2;
const REASON_DESCRIPTION = 1;
const REASON_STORYLINE = 3;
const REASON_IN_PROGRESS = 4;
const REASON_REQUIRED_FOR_OTHERS = 6;
const COLUMNS = 5;
const AVAILABLE_LIMIT = 10;
const TARGET_LIMIT = 5;

let api;
/** Players whose Adviser is open, so script 6378 runs once when it goes. */
const shown = new WeakSet();

const first = (column, fallback = undefined) => column?.[0] ?? fallback;

/** The quest table's rows, and each one's registered quest. */
function questRows() {
  const cache = api?.core?.CacheDefinitions;
  const byRow = new Map();
  for (const quest of getRegisteredQuests()) {
    const row = questMetadata(quest, cache);
    if (row) byRow.set(row.rowId, quest);
  }
  return [...metadata(cache).values()].map((row) => ({ row, quest: byRow.get(row.rowId) }));
}

/** "done", "started", or "unstarted" from the quest's own var, as the quest list shows it. */
function questState(player, { row, quest }) {
  if (!quest) return "unstarted";
  const sender = player.getPacketSender();
  const value = quest.varbitId !== undefined ? sender.getVarbit?.(quest.varbitId) : sender.getVarp?.(quest.varpId);
  if (!Number.isInteger(value)) return "unstarted";
  if (value >= first(row.endstate, Infinity)) return "done";
  return value > first(row.unstartedstate, 0) ? "started" : "unstarted";
}

function meetsStats(player, row) {
  const skills = player.getSkillManager();
  const stats = row.requirement_stats ?? [];
  for (let i = 0; i + 1 < stats.length; i += 2) if (skills.getMaxLevels(stats[i]) < stats[i + 1]) return false;
  const questPoints = Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0;
  return questPoints >= first(row.requirement_questpoints, 0) && skills.getCombatLevel() >= first(row.requirement_combat, 0);
}

function reasonFor(entry, states, rows) {
  const { row } = entry;
  if (states.get(entry) === "started") return REASON_IN_PROGRESS;
  if (first(row.cr_recommendation_reason_is_primary) === 1) return REASON_DESCRIPTION;
  const series = first(row.series);
  const number = first(row.seriesno);
  if (series !== undefined && number > 1) {
    const previous = rows.find((other) => first(other.row.series) === series && first(other.row.seriesno) === number - 1);
    if (previous && states.get(previous) === "done") return REASON_STORYLINE;
  }
  return first(row.prerequisite_direct, 0) > 0 ? REASON_REQUIRED_FOR_OTHERS : REASON_DESCRIPTION;
}

/** The suggestions, as [kind, quest id, reason] rows: quests to start now, then ones to work towards. */
function suggestions(player) {
  const rows = questRows();
  const states = new Map(rows.map((entry) => [entry, questState(player, entry)]));
  const byId = new Map(rows.map((entry) => [first(entry.row.id), entry]));
  const includeMembers = includesMembers(player);
  const candidates = rows.filter(({ row, quest }) => quest && first(row.cr_can_recommend) === 1
    && first(row.release_type) !== 0 && !row.parent_quest?.length
    && (includeMembers || first(row.members) !== 1)
    && hasQuestJournal(first(row.id)));
  const questsDone = (row) => (row.requirement_quests ?? []).every((id) => byId.has(id) && states.get(byId.get(id)) === "done");
  const order = (a, b) => (states.get(b) === "started") - (states.get(a) === "started")
    || first(a.row.starter_order, Infinity) - first(b.row.starter_order, Infinity)
    || String(first(a.row.sortname, "")).localeCompare(String(first(b.row.sortname, "")));
  const open = candidates.filter((entry) => states.get(entry) !== "done");
  const available = open.filter((entry) => states.get(entry) === "started" || (questsDone(entry.row) && meetsStats(player, entry.row)));
  const targets = open.filter((entry) => !available.includes(entry) && questsDone(entry.row));
  return [
    ...available.sort(order).slice(0, AVAILABLE_LIMIT).map((entry) => [KIND_AVAILABLE, first(entry.row.id), reasonFor(entry, states, rows)]),
    ...targets.sort(order).slice(0, TARGET_LIMIT).map((entry) => [KIND_TARGET, first(entry.row.id), REASON_DESCRIPTION]),
  ];
}

/** Script 2493's string: the cell count (plus the two size cells), rows, columns, then the cells. */
function serialise(rows) {
  const cells = rows.flatMap((row) => [...row, ...Array(COLUMNS - row.length).fill(0)]);
  return [cells.length + 2, rows.length, COLUMNS, ...cells].join("||");
}

function includesMembers(player) {
  return player.getAttribute(INCLUDE_MEMBERS_ATTRIBUTE) !== false;
}

function sendSuggestions(player) {
  const sender = player.getPacketSender();
  const rows = suggestions(player);
  sender.sendVarbit(CACHED.updateCache, 0);
  sender.sendVarbit(CACHED.available, rows.filter(([kind]) => kind !== KIND_TARGET).length);
  sender.sendVarbit(CACHED.target, rows.filter(([kind]) => kind === KIND_TARGET).length);
  sender.sendVarbit(CACHED.totalLevel, player.getSkillManager().getTotalLevel());
  sender.sendVarbit(CACHED.questsCompleted, sender.getVarbit?.(QUESTS_COMPLETED_VARBIT) ?? 0);
  sender.sendVarbit(CACHED.subquestsCompleted, sender.getVarbit?.(SUBQUESTS_COMPLETED_VARBIT) ?? 0);
  sender.sendVarbit(CACHED.miniquestsCompleted, sender.getVarbit?.(MINIQUESTS_COMPLETED_VARBIT) ?? 0);
  sender.sendInterfaceScript(SCRIPT_SET_QUESTS, [serialise(rows)]);
}

function isOpen(player) {
  return player.getPacketSender().isSubInterfaceOpen?.(CR_UI) === true;
}

function open(player) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(FLOATER_UID, CR_UI, OVERLAY);
  shown.add(player);
  sender.sendInterfaceFlagsRange(uid(TABS), TAB_ALL, TAB_FREE, OP1);
  sender.sendInterfaceFlagsRange(uid(REFRESH), 0, 0, OP1);
  const ids = questRows().map(({ row }) => first(row.id)).filter(Number.isInteger);
  sender.sendInterfaceFlagsRange(uid(JOURNAL_BUTTONS), 0, Math.max(0, ...ids), OP1);
  sendSuggestions(player);
}

function close(player) {
  player.getPacketSender().closeSubInterface(FLOATER_UID);
  closed(player);
}

function closed(player) {
  if (!shown.delete(player)) return;
  player.getPacketSender().sendInterfaceScript(SCRIPT_CLOSED);
}

/** Another floater interface (the collection log, a skill guide) replaces the Adviser. */
function replaced({ player, groupId, targetUid }) {
  if (targetUid === FLOATER_UID && groupId !== CR_UI) closed(player);
}

function uid(child) {
  return (CR_UI << 16) | child;
}

function selectTab(player, tab) {
  const includeMembers = tab === TAB_ALL;
  player.setAttribute(INCLUDE_MEMBERS_ATTRIBUTE, includeMembers);
  player.getPacketSender().sendVarbit(INCLUDE_MEMBERS_VARBIT, includeMembers ? 1 : 0);
  sendSuggestions(player);
}

function viewJournal(player, questId) {
  if (!hasQuestJournal(questId)) return;
  openQuestJournal(player, questId);
}

function onInterfaceClick(event) {
  if (event.handled) return;
  const { player } = event;
  const groupId = Number(event.groupId);
  const childId = Number(event.childId);
  if (ORB_BUTTONS.has((groupId << 16) | childId)) {
    event.handled = true;
    if (isOpen(player)) close(player);
    else open(player);
    return;
  }
  if (groupId !== CR_UI || !isOpen(player)) return;
  const slot = Number(event.slot);
  if (childId === CLOSE_BUTTON) close(player);
  else if (childId === TABS && (slot === TAB_ALL || slot === TAB_FREE)) selectTab(player, slot);
  else if (childId === REFRESH) sendSuggestions(player);
  else if (childId === JOURNAL_BUTTONS) viewJournal(player, slot);
  else return;
  event.handled = true;
}

function sendIncludeMembers({ player }) {
  player.getPacketSender().sendVarbit(INCLUDE_MEMBERS_VARBIT, includesMembers(player) ? 1 : 0);
}

module.exports = {
  name: "ActivityAdviser",
  description: "The Activity Adviser: the minimap button opens its quest suggestions, built from the cache quest table.",
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(INCLUDE_MEMBERS_ATTRIBUTE, true);
    api.onPlayerLogin(sendIncludeMembers);
    api.onInterfaceActionClick(onInterfaceClick);
    api.onCustomEvent("interface:opened", replaced);
  },
};

module.exports._test = { suggestions, serialise, onInterfaceClick, replaced, FLOATER_UID, CR_UI, ORB_BUTTONS };
