/**
 * Shared quest runtime for the quest plugins in this folder.
 *
 * A quest is a plugin: `register(api)` builds one with `registerQuest(api, {...})`
 * and wires its interactions with the normal plugin hooks. The runtime keeps the
 * per-player stage (a persisted player attribute, mirrored to the quest varp so
 * CS2 scripts see it), quest points, the side-journal quest list, the quest
 * journal overlay and the completion scroll - all built on the core dialogue
 * and packet APIs.
 *
 * Stage is the dialogue branch selector: `quest.getStage(player)` decides which
 * conversation a quest starts, and `quest.complete(player)` marks it finished.
 *
 * The dialogue entry classes come from `api.core` (no core source-path imports),
 * so quest plugins load in a plain `node dist/Server.js` process too.
 */

// Side journal quest list (client/common/ui/sideJournal.ts + questList.ts).
const QUEST_LIST_GROUP = 399;
const QUEST_LIST_ENTRY_UID = (QUEST_LIST_GROUP << 16) | 7;
// The "Quest Points"/"Completed" header lines are rendered by cache CS2 scripts
// (1356/5995) from these varps, not from interface text.
const QUEST_POINTS_TOTAL_VARBIT = 1782; // "Quest Points: X/<total>"
const QUESTS_COMPLETED_VARBIT = 6347; // "Completed: <n>/<total>"
const QUESTS_TOTAL_VARBIT = 11877;
const QUEST_LIST_ENTRY_FLAGS = 0x7e;

// Quest journal overlay (xrsps client/common/ui constants).
const JOURNAL_GROUP = 119;
const JOURNAL_TITLE_CHILD = 5;
const JOURNAL_CLOSE_CHILD = 8;
const JOURNAL_SWITCH_CHILD = 9;
const JOURNAL_FIRST_LINE_CHILD = 11;
const VARP_QJ_LINES = 4398;
const SCRIPT_QJ_RESET = 5240;
const SCRIPT_QJ_SCROLL = 2523;
// Journal text is navy, names and places dark red; the line widgets default to black.
const JOURNAL_TEXT_COLOUR = "<col=000080>";
/** latest_quest_journal: the quest table row of the journal or overview last opened. */
const LATEST_QUEST_JOURNAL_VARP = 3679;

// Quest overview (questjournal_overview), opened for quests not started yet. Its setup script
// draws the start point, difficulty, length, requirements and recommendations from the quest's
// cache row; the server sends only the start sentence.
const OVERVIEW_GROUP = 782;
const OVERVIEW_UNIVERSE = (OVERVIEW_GROUP << 16) | 1;
const OVERVIEW_INNER = (OVERVIEW_GROUP << 16) | 2;
const OVERVIEW_SCROLL = (OVERVIEW_GROUP << 16) | 3;
const OVERVIEW_CONTAINER = (OVERVIEW_GROUP << 16) | 4;
const OVERVIEW_TITLE = (OVERVIEW_GROUP << 16) | 5;
const OVERVIEW_CONTENT_OUTER = (OVERVIEW_GROUP << 16) | 6;
const OVERVIEW_CONTENT_INNER = (OVERVIEW_GROUP << 16) | 7;
const OVERVIEW_SCROLLBAR = (OVERVIEW_GROUP << 16) | 8;
const OVERVIEW_CLOSE = (OVERVIEW_GROUP << 16) | 9;
/** The setup script's "Show on Map" line is the second child it creates in content_inner. */
const OVERVIEW_SHOW_ON_MAP_SLOT = 1;
const SCRIPT_QJ_OVERVIEW_SETUP = 6821;
/** "I can start this quest by " is written by the setup script; the file holds the rest. */
const START_TEXT = require("./data/quest-start-text.json");
const START_SENTENCE = /^I can start this (?:mini)?quest by (.+)$/;

// "Show on Map": the world map, marking the quest's start (script3331 on worldmap:map_noclick).
const WORLD_MAP_NOCLICK = (595 << 16) | 3;
const SCRIPT_WORLD_MAP_MARK = 3331;

// Completion scroll.
const COMPLETED_GROUP = 153;
const COMPLETED_TITLE_CHILD = 3;
const COMPLETED_NAME_CHILD = 4;
const COMPLETED_REWARD_ITEM_CHILD = 5;
const COMPLETED_POINTS_CHILD = 6;
const COMPLETED_FIRST_LINE_CHILD = 8;
const COMPLETED_LINE_COUNT = 8;
const COMPLETED_CLOSE_CHILD = 16;

// Gameframe floater overlay target (ViewportEnumService FLOATER_OVERLAY).
const FLOATER_OVERLAY_UID = (161 << 16) | 18;

const QUEST_POINTS_VARP = 101;
const QUEST_COMPLETE_JINGLE = 238;
const QUEST_POINTS_ATTRIBUTE = "quest.points";
/** Keys of the quests completed with `experience: false`, whose later XP claims pay nothing. */
const EXPERIENCE_WITHHELD_ATTRIBUTE = "quest.experience-withheld";

// Client quest list statuses.
const STATUS_IN_PROGRESS = 0;
const STATUS_NOT_STARTED = 1;
const STATUS_COMPLETE = 2;

const { questListGroups, questMetadata } = require("./QuestList.QuestRuntime");
const quests = [];
const sentQuestSlots = new WeakMap();
const openBooks = new WeakMap();
const BOOK_GROUP = 392;
const BOOK_CLOSE = (BOOK_GROUP << 16) | 7;
const BOOK_PREVIOUS = (BOOK_GROUP << 16) | 75;
const BOOK_NEXT = (BOOK_GROUP << 16) | 77;
let widgetsRegistered = false;
let coreApi = null;

function stageAttribute(questKey) {
  return `quest.${questKey}.stage`;
}

function orderedQuests() {
  return quests.slice().sort((a, b) => a.name.localeCompare(b.name));
}

// ============================================================================
// Quest list / journal / completion widgets
// ============================================================================

/**
 * Assigns list slots: each group's title occupies the row before its quests
 * (the client draws the title at firstQuestSlot - 1). Returns the groups for the
 * packet, the slot -> quest map for journal clicks, and the quest-slot ranges
 * that carry the "Read journal:" flags.
 */
function questRows(player) {
  const groups = [];
  const slotQuests = [];
  const ranges = [];
  let slot = 0;
  for (const group of questListGroups(quests, player, coreApi?.CacheDefinitions, questStatus, coreApi?.Skill)) {
    if (group.title) { slotQuests[slot] = null; slot++; }
    const start = slot;
    const entries = group.quests.map(({ quest, status }) => {
      const row = {
        slot,
        status,
        key: quest.key,
        displayName: quest.name,
      };
      slotQuests[slot] = quest;
      slot++;
      return row;
    });
    groups.push({ title: group.title, quests: entries });
    ranges.push([start, slot - 1]);
  }
  return { groups, slotQuests, ranges };
}

function sendQuestList(player) {
  const { groups, ranges, slotQuests } = questRows(player);
  const previous = sentQuestSlots.get(player);
  sentQuestSlots.set(player, slotQuests);
  const packet = player.getPacketSender();
  if (previous?.length) packet.sendInterfaceFlagsRange(QUEST_LIST_ENTRY_UID, 0, previous.length - 1, 0);
  packet.sendQuestList(groups);
  for (const [start, end] of ranges) {
    if (end >= start) {
      packet.sendInterfaceFlagsRange(QUEST_LIST_ENTRY_UID, start, end, QUEST_LIST_ENTRY_FLAGS);
    }
  }
  sendQuestHeaderStats(player);
}

/**
 * The "Quest Points: X/Y" and "Completed: X/Y" header lines on both the quest
 * list (399) and character summary (712) are rendered by cache CS2 scripts
 * (1356/5995/3310) from these varps; interface text writes are overwritten.
 */
function sendQuestHeaderStats(player) {
  const list = orderedQuests();
  const packet = player.getPacketSender();
  packet.sendConfig(QUEST_POINTS_VARP, Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0);
  packet.sendVarbit(QUEST_POINTS_TOTAL_VARBIT, list.reduce((sum, quest) => sum + (quest.questPoints || 0), 0));
  packet.sendVarbit(QUESTS_COMPLETED_VARBIT, list.filter((quest) => questStatus(quest, player) === STATUS_COMPLETE).length);
  packet.sendVarbit(QUESTS_TOTAL_VARBIT, list.length);
}

/**
 * Players whose login hooks are running: player -> whether a refresh was asked for. Nearly
 * every quest refreshes the list from its login hook, so a login rebuilt and sent the whole
 * list about 140 times; it is sent once instead, after the login bootstrap.
 */
const loginQuestLists = new WeakMap();

/** Sends the quest list and its row flags; call when the quest tab (re)mounts. */
function refreshQuestList(player) {
  if (loginQuestLists.has(player)) {
    loginQuestLists.set(player, true);
    return;
  }
  sendQuestList(player);
}

/** Login started: hold quest list refreshes until the bootstrap completes. */
function holdLoginQuestList({ player }) {
  loginQuestLists.set(player, false);
}

/** Login bootstrap done: send the held quest list once, if anything asked for it. */
function sendLoginQuestList({ player }) {
  const requested = loginQuestLists.get(player);
  loginQuestLists.delete(player);
  if (requested) sendQuestList(player);
}

/** A login that ends before its bootstrap leaves no hold behind. */
function releaseLoginQuestList({ player }) {
  loginQuestLists.delete(player);
}

function refreshQuestRequirements({ player }) {
  refreshQuestList(player);
}

/**
 * The login bootstrap's sendTabInterface(6) sends the all-spells-unlocked varps
 * after the player-login hooks, clobbering cache NPC transform varps that share
 * storage with quest varps (e.g. Drezel's varp 302). sendQuestVarps (below) is
 * bound to player:bootstrap-complete to re-send the real stages.
 */

function questStatus(quest, player) {
  if (quest.isComplete(player)) return STATUS_COMPLETE;
  if (quest.isStarted(player)) return STATUS_IN_PROGRESS;
  return STATUS_NOT_STARTED;
}

function journalLines(quest, player) {
  return typeof quest.buildJournal === "function" ? quest.buildJournal(player, quest) : [];
}

function openJournalBySlot(player, slot) {
  // Quest rows sit in the same slots questRows() sent, after each letter header.
  const quest = (sentQuestSlots.get(player) ?? questRows(player).slotQuests)[slot | 0];
  if (quest) openJournal(player, quest);
}

/**
 * A journal line as live OSRS sends it: navy text, with each highlight returning to navy rather
 * than to the widget's black. Crossed-out lines and the red "QUEST COMPLETE!" keep their own.
 */
function journalText(line) {
  const text = String(line ?? "");
  if (!text || text.startsWith("<str>") || text.includes("<col=ff0000>")) return text;
  return JOURNAL_TEXT_COLOUR + text.replace(/<\/col>/g, JOURNAL_TEXT_COLOUR);
}

/**
 * How the overview says the quest starts, after "I can start this quest by": from the data file
 * (Wiki journal transcripts and live captures), else from the quest's own not-started journal
 * line, which may wrap over several lines. Null when neither has one.
 */
function startSentence(row, lines) {
  const known = START_TEXT[row.displayname?.[0]];
  if (known) return known;
  const plain = (line) => String(line ?? "").replace(/<[^>]*>/g, "");
  const first = lines.findIndex((line) => START_SENTENCE.test(String(line ?? "")));
  if (first < 0) return null;
  let last = first;
  while (last < lines.length - 1 && !/[.!?]\s*$/.test(plain(lines[last])) && plain(lines[last + 1])) last++;
  const sentence = lines.slice(first, last + 1).join(" ").replace(/\s+/g, " ").trim();
  return START_SENTENCE.exec(sentence.replace(/<\/col>/g, JOURNAL_TEXT_COLOUR))[1];
}

/** Players' open quest overview: player -> the quest's cache row, for "Show on Map". */
const openOverviews = new WeakMap();

function openOverview(player, quest, row, start) {
  const packet = player.getPacketSender();
  const updater = player.getFrameUpdater?.();
  const combatLevel = player.getSkillManager?.()?.getCombatLevel?.() ?? 3;
  packet.sendConfig(LATEST_QUEST_JOURNAL_VARP, row.rowId);
  packet.sendSubInterface(FLOATER_OVERLAY_UID, OVERVIEW_GROUP, 0);
  updater?.clear?.(OVERVIEW_TITLE);
  packet.sendString(`<col=7f0000>${quest.name}</col>`, OVERVIEW_TITLE);
  packet.sendInterfaceFlagsRange(OVERVIEW_CONTENT_INNER, OVERVIEW_SHOW_ON_MAP_SLOT, OVERVIEW_SHOW_ON_MAP_SLOT, 1 << 1);
  packet.sendInterfaceScript(SCRIPT_QJ_OVERVIEW_SETUP, [
    row.rowId, start, OVERVIEW_UNIVERSE, OVERVIEW_CONTENT_INNER, OVERVIEW_CONTENT_OUTER,
    OVERVIEW_SCROLLBAR, OVERVIEW_INNER, OVERVIEW_CONTAINER, OVERVIEW_SCROLL, combatLevel,
  ]);
  openOverviews.set(player, row);
}

/** "Show on Map" in the overview: the world map, with the quest's start point marked. */
function showStartOnMap({ player, slot }) {
  const row = openOverviews.get(player);
  const start = row?.startcoord?.[0];
  if (slot !== OVERVIEW_SHOW_ON_MAP_SLOT || start === undefined) return;
  const packet = player.getPacketSender();
  if (!packet.isWorldMapOpen()) packet.toggleWorldMap();
  packet.sendInterfaceScript(SCRIPT_WORLD_MAP_MARK, [WORLD_MAP_NOCLICK, start, row.mapelement?.[0] ?? -1]);
}

/**
 * The quest list's "Read journal": the overview for a quest not started yet (as live OSRS opens
 * it), otherwise the journal (119) with the quest's progress lines.
 */
function openJournal(player, quest) {
  const lines = journalLines(quest, player);
  const row = questMetadata(quest, coreApi?.CacheDefinitions);
  if (row && !quest.isStarted(player)) {
    const start = startSentence(row, lines);
    if (start) {
      openOverview(player, quest, row, start);
      return;
    }
  }
  const packet = player.getPacketSender();
  const updater = player.getFrameUpdater?.();
  // The client remounts the interface blank, but the sender's per-widget text
  // cache still holds the previous open's lines; forget them so they re-send.
  const setText = (uid, text) => {
    updater?.clear?.(uid);
    packet.sendString(String(text ?? ""), uid);
  };
  if (row) packet.sendConfig(LATEST_QUEST_JOURNAL_VARP, row.rowId);
  packet.sendConfig(VARP_QJ_LINES, lines.length);
  packet.sendSubInterface(FLOATER_OVERLAY_UID, JOURNAL_GROUP, 0);
  packet.sendInterfaceFlagsRange((JOURNAL_GROUP << 16) | JOURNAL_CLOSE_CHILD, -1, -1, 1 << 1);
  packet.sendInterfaceFlagsRange((JOURNAL_GROUP << 16) | JOURNAL_SWITCH_CHILD, -1, -1, 1 << 1);
  packet.sendInterfaceScript(SCRIPT_QJ_RESET, []);
  setText((JOURNAL_GROUP << 16) | JOURNAL_TITLE_CHILD, `<col=7f0000>${quest.name}</col>`);
  lines.forEach((line, index) => {
    setText((JOURNAL_GROUP << 16) | (JOURNAL_FIRST_LINE_CHILD + index), journalText(line));
  });
  packet.sendInterfaceScript(SCRIPT_QJ_SCROLL, [0, lines.length]);
}

function rewardLines(quest) {
  const lines = ["You are awarded:"];
  const points = quest.questPoints || 0;
  lines.push(`${points} Quest Point${points === 1 ? "" : "s"}`);
  for (const reward of quest.xpRewards ?? []) lines.push(`${reward.amount.toLocaleString("en-US")} ${reward.label} XP`);
  if (quest.rewardItemLabel) lines.push(quest.rewardItemLabel);
  lines.push(...(quest.otherRewards ?? []));
  return lines.slice(0, COMPLETED_LINE_COUNT);
}

function openCompletedScroll(player, quest, questPoints) {
  const packet = player.getPacketSender();
  const updater = player.getFrameUpdater?.();
  const setText = (uid, text) => {
    updater?.clear?.(uid);
    packet.sendString(String(text ?? ""), uid);
  };
  packet.sendInterfaceRemoval();
  packet.sendInterface(COMPLETED_GROUP);
  packet.sendInterfaceFlagsRange((COMPLETED_GROUP << 16) | COMPLETED_CLOSE_CHILD, -1, -1, 1 << 1);
  setText((COMPLETED_GROUP << 16) | COMPLETED_TITLE_CHILD, "Congratulations!");
  setText((COMPLETED_GROUP << 16) | COMPLETED_NAME_CHILD, `You have completed ${quest.name}!`);
  const scrollItemId = typeof quest.scrollItemId === "function"
    ? quest.scrollItemId(player)
    : quest.scrollItemId ?? quest.rewardItemId;
  if (scrollItemId !== undefined) {
    packet.sendItemOnInterfaces((COMPLETED_GROUP << 16) | COMPLETED_REWARD_ITEM_CHILD, scrollItemId, 1);
  }
  setText((COMPLETED_GROUP << 16) | COMPLETED_POINTS_CHILD, `Quest points: ${questPoints}`);
  const lines = rewardLines(quest);
  for (let i = 0; i < COMPLETED_LINE_COUNT; i++) {
    setText((COMPLETED_GROUP << 16) | (COMPLETED_FIRST_LINE_CHILD + i), lines[i] ?? "");
  }
}

/**
 * True while the player has a chatbox up: a running dialogue or a multi-option prompt.
 * Stale dialogue-manager entries after a close are harmless here only because
 * sendInterfaceRemoval resets the manager before this ever sees them.
 */
function chatboxOpen(player) {
  const prompt = coreApi?.MultiChatboxPrompt?.getPending?.(player) ?? null;
  return player.getDialogueManager?.()?.isActive?.() === true || prompt !== null;
}

/**
 * Completion scroll entry point. Rewards, jingle and message fire immediately in
 * complete(); the scroll has to wait when the completion happens inside an open
 * chatbox, because the hand-in dialogue closes the interface right after the
 * action returns (sendInterfaceRemoval) and would wipe it. Polls a tick at a time
 * until the dialogue/prompt is gone, then opens it. A player who logs out while
 * waiting gets no scroll.
 */
function showCompletedScroll(player, quest, questPoints) {
  if (player.isRegistered?.() === false) return;
  const { CountdownTask, TaskManager } = coreApi ?? {};
  // Always defer at least a tick: during a hand-in action the dialogue manager already
  // reports inactive, but NpcDialogues still sends sendInterfaceRemoval right after the
  // action returns and would wipe a scroll opened now.
  if (!CountdownTask || !TaskManager) {
    openCompletedScroll(player, quest, questPoints);
    return;
  }
  TaskManager.submit(
    new CountdownTask(player, 1, () => {
      if (player.isRegistered?.() === false) return;
      if (chatboxOpen(player)) {
        showCompletedScroll(player, quest, questPoints);
        return;
      }
      openCompletedScroll(player, quest, questPoints);
    })
  );
}

/**
 * quest:is-complete / quest:is-started { player, key | name, complete | started }: answered for
 * quests registered here, by each quest's own stage values, looked up by key or (as the cache's
 * music unlock hints name them) by name. An unknown quest is left unanswered (null).
 */
function requestedQuest(request) {
  if (request?.key !== undefined) return quests.find((entry) => entry.key === request.key);
  return request?.name === undefined ? undefined : questNamed(request.name);
}

function answerIsComplete(request) {
  const quest = requestedQuest(request);
  if (quest && request.player) request.complete = quest.isComplete(request.player);
}

function answerIsStarted(request) {
  const quest = requestedQuest(request);
  if (quest && request.player) request.started = quest.isStarted(request.player);
}

function answerGetStage(request) {
  const quest = requestedQuest(request);
  if (quest && request.player) request.stage = quest.getStage(request.player);
}

/** A shop version named after a quest: "Fremennik Isles", "After Lunar Diplomacy", "Before Contact!". */
const QUEST_SHOP_VERSION = /\((?:(After|During|Before) )?([^()]+)\)$/;

/** Case, a leading "The" and punctuation don't count: "Another Slice of H.A.M" is "Another Slice of H.A.M.". */
function questNamed(name) {
  const plain = (text) => String(text).toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  return quests.find((quest) => plain(quest.name) === plain(name));
}

function questShopVersionApplies(name, player) {
  const match = QUEST_SHOP_VERSION.exec(name);
  const quest = match && questNamed(match[2]);
  if (!quest) return false;
  if (match[1] === "Before") return !quest.isComplete(player);
  if (match[1] === "During") return quest.isStarted(player) && !quest.isComplete(player);
  return quest.isComplete(player);
}

/** npc-dialogue:shop: picks the version of a shop that the player's quest progress unlocks. */
function pickQuestShopVersion(request) {
  if (request.shop || !request.player) return;
  request.shop = request.shops.find((name) => questShopVersionApplies(name, request.player)) ?? null;
}

function registerQuestWidgets(api) {
  coreApi = api.core;
  if (widgetsRegistered) return;
  widgetsRegistered = true;

  api.onInterfaceActionButton([BOOK_CLOSE, BOOK_PREVIOUS, BOOK_NEXT], turnBookPage);
  api.onCustomEvent("interface:closed", ({ player, interfaceId }) => {
    if (interfaceId === BOOK_GROUP) closeBook(player);
  });

  // "Read journal:" on a quest list row.
  api.onInterfaceActionButton([QUEST_LIST_ENTRY_UID], (event) => {
    openJournalBySlot(event.player, event.slot);
  });
  // Journal close / switch-view.
  api.onInterfaceActionButton(
    [(JOURNAL_GROUP << 16) | JOURNAL_CLOSE_CHILD, (JOURNAL_GROUP << 16) | JOURNAL_SWITCH_CHILD],
    (event) => event.player.getPacketSender().closeSubInterface(FLOATER_OVERLAY_UID)
  );
  // Overview close / "Show on Map".
  api.onInterfaceActionButton([OVERVIEW_CLOSE], (event) => event.player.getPacketSender().closeSubInterface(FLOATER_OVERLAY_UID));
  api.onInterfaceActionButton([OVERVIEW_CONTENT_INNER], showStartOnMap);
  // Completion scroll close.
  api.onInterfaceActionButton([(COMPLETED_GROUP << 16) | COMPLETED_CLOSE_CHILD], (event) =>
    event.player.getPacketSender().sendInterfaceRemoval()
  );
  // SideJournalDefaults asks for the list when it mounts the quest tab.
  api.onCustomEvent("quest:list-refresh", ({ player }) => refreshQuestList(player));
  api.onPlayerLevelUp?.(refreshQuestRequirements);
  api.onCustomEvent("quest:is-complete", answerIsComplete);
  api.onCustomEvent("quest:is-started", answerIsStarted);
  api.onCustomEvent("quest:get-stage", answerGetStage);
  api.onCustomEvent("npc-dialogue:shop", pickQuestShopVersion);
  // Registered before the quests, so this runs before every quest's own login hook.
  api.onPlayerLogin(holdLoginQuestList);
  api.onCustomEvent("player:bootstrap-complete", sendLoginQuestList);
  api.onPlayerLogout?.(releaseLoginQuestList);
  // The character summary shows the same header stats without opening the list.
  api.onPlayerLogin(({ player }) => sendQuestHeaderStats(player));
  api.onPlayerLogin(sendQuestVarps);
  // The login bootstrap's sendTabInterface(6) runs after the login hooks and
  // re-sends the all-spells-unlocked varps, clobbering quest varps that share
  // storage with cache transforms (e.g. Drezel's 302). Re-send ours afterwards.
  api.onCustomEvent("player:bootstrap-complete", ({ player }) => sendQuestVarps({ player }));
}

/**
 * The cache's two-page book (392), using the captured text lines for each spread.
 * `onClose` runs once when the reader closes the book (X, close button, or the
 * interface being removed), so quests can advance only after it has been read.
 */
function openBook(player, title, pages, onClose) {
  if (!pages.length) return;
  player.getPacketSender().sendInterface(BOOK_GROUP);
  openBooks.set(player, { title, pages, page: 0, onClose });
  showBookPage(player);
}

/** Closes an open book and runs its reader callback, if it has one. */
function closeBook(player) {
  const book = openBooks.get(player);
  if (!book) return;
  openBooks.delete(player);
  if (typeof book.onClose === "function") book.onClose();
}

function showBookPage(player) {
  const { title, pages, page } = openBooks.get(player);
  const packet = player.getPacketSender();
  packet.sendString(title, (BOOK_GROUP << 16) | 6);
  packet.sendString(String(page * 2 + 1), (BOOK_GROUP << 16) | 9);
  packet.sendString(String(page * 2 + 2), (BOOK_GROUP << 16) | 10);
  for (let line = 0; line < 15; line++) {
    for (const [text, model] of [[44 + line, 12 + line], [60 + line, 28 + line]]) {
      packet.sendString(pages[page][text] ?? "", (BOOK_GROUP << 16) | text);
      packet.sendInterfaceDisplayState((BOOK_GROUP << 16) | model, true);
    }
  }
  packet.sendInterfaceDisplayState(BOOK_PREVIOUS, page === 0);
  packet.sendInterfaceDisplayState(BOOK_NEXT, page === pages.length - 1);
  packet.sendInterfaceScript(2524, [-1, -1]);
}

function turnBookPage(event) {
  const { player, buttonId } = event;
  const book = openBooks.get(player);
  if (!book) return false;
  event.handled = true;
  if (buttonId === BOOK_CLOSE) {
    // Close the book first, then run its reader callback: the callback may open
    // an item box, which the removal packet must not wipe.
    player.getPacketSender().sendInterfaceRemoval();
    closeBook(player);
    return;
  }
  const page = book.page + (buttonId === BOOK_NEXT ? 1 : -1);
  if (page < 0 || page >= book.pages.length) return;
  book.page = page;
  showBookPage(player);
}

/**
 * Sends each quest's saved stage in its varp on login. The client reads them for more than the
 * quest list: the cache shows locs and NPCs by quest progress (the Grand Exchange spirit tree
 * only has Travel once Tree Gnome Village's varp says complete). setStage sends a varp only
 * when it changes, so without this a relog left them all at 0. Stage 0 is sent too: the login
 * bootstrap clobbers shared varps, so unstarted quests must be reset to 0 as well.
 */
function sendQuestVarps({ player }) {
  const sender = player.getPacketSender();
  for (const quest of quests) {
    // Bitfield stages must write their varbit: writing the whole parent varp
    // clobbers sibling bits (X Marks/Client of Kourend share veos_quest).
    if (quest.varbitId !== undefined) {
      sender.sendVarbit(quest.varbitId, quest.varbitValue(quest.getStage(player), player));
      continue;
    }
    if (!Number.isInteger(quest.varpId) || quest.varpId < 0) continue;
    sender.sendConfig(quest.varpId, quest.varpValue(quest.getStage(player), player));
  }
}

// ============================================================================
// Quest registration
// ============================================================================

/**
 * Registers a quest and returns a handle with stage/complete helpers.
 *
 * @param api  the plugin api
 * @param def  { key, name, varpId, varbitId, varbitValue, startedValue, completionValue, questPoints,
 *               xpRewards?, rewardItemId?, rewardItemLabel?, otherRewards?,
 *               scrollItemId? (item id or function of player),
 *               buildJournal?(player, quest), onReward?(player, quest),
 *               varpValue?(stage, player) }
 */
function registerQuest(api, def) {
  if (!def || !def.key || !def.name) throw new Error("registerQuest requires a key and name");
  registerQuestWidgets(api);
  api.persistAttribute(stageAttribute(def.key), 0);
  api.persistAttribute(QUEST_POINTS_ATTRIBUTE, 0);
  api.persistAttribute(EXPERIENCE_WITHHELD_ATTRIBUTE, []);

  const stageKey = stageAttribute(def.key);
  const quest = {
    ...def,
    /** The varp value the client sees for a stage; def.varpValue maps stages the cache keys on. */
    varpValue(stage, player) {
      return def.varpValue ? def.varpValue(stage, player) | 0 : stage;
    },
    varbitValue(stage, player) {
      return def.varbitValue ? def.varbitValue(stage, player) | 0 : quest.varpValue(stage, player);
    },
    getStage(player) {
      const value = Number(player.getAttribute(stageKey));
      return Number.isFinite(value) ? value | 0 : 0;
    },
    setStage(player, value) {
      player.setAttribute(stageKey, value | 0);
      // Quests whose stage lives in a varbit of a shared varp (most post-2007
      // quests) set the varbit, so sibling bits in the same varp survive.
      if (def.varbitId !== undefined) {
        player.getPacketSender().sendVarbit(def.varbitId, quest.varbitValue(value | 0, player));
      } else {
        player.getPacketSender().sendConfig(def.varpId, quest.varpValue(value | 0, player));
      }
      refreshQuestList(player);
      // Quests whose progress shows in more than their varp (a varbit the cache reads) follow it.
      api.emitCustomEvent?.("quest:stage-changed", { player, key: def.key, stage: value | 0 });
    },
    isStarted(player) {
      return quest.getStage(player) >= (def.startedValue ?? 1);
    },
    isComplete(player) {
      return quest.getStage(player) >= (def.completionValue ?? 2);
    },
    /** Completed with `experience: false`: a post-quest XP claim (a trainer, a lamp reclaimed) pays nothing. Saved. */
    experienceWithheld(player) {
      const keys = player.getAttribute(EXPERIENCE_WITHHELD_ATTRIBUTE);
      return Array.isArray(keys) && keys.includes(def.key);
    },
    /**
     * `options` for a completion the quest wasn't played through (Shattered Relics' quest packs):
     * `experience: false` asks onReward (its third argument) to hold back experience it would hand
     * out later, such as a prompt a tick on, and is saved for the quest's post-quest claims
     * (`experienceWithheld`); `scroll: false` skips the jingle and the scroll; `announce: false`
     * skips the "Congratulations, you've completed a quest" chat line.
     */
    complete(player, options = {}) {
      if (quest.isComplete(player)) return false;
      if (options.experience === false && !quest.experienceWithheld(player)) {
        const keys = player.getAttribute(EXPERIENCE_WITHHELD_ATTRIBUTE);
        player.setAttribute(EXPERIENCE_WITHHELD_ATTRIBUTE, [...(Array.isArray(keys) ? keys : []), def.key]);
      }
      quest.setStage(player, def.completionValue ?? 2);

      const points = (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) + (def.questPoints || 0);
      player.setAttribute(QUEST_POINTS_ATTRIBUTE, points | 0);
      player.getPacketSender().sendConfig(QUEST_POINTS_VARP, points | 0);

      if (def.onReward) def.onReward(player, quest, options);
      if (def.rewardItemId !== undefined) {
        const inventory = player.getInventory();
        if (inventory.isFull()) inventory.forceAdd(player, new coreApi.Item(def.rewardItemId, 1));
        else inventory.adds(def.rewardItemId, 1);
      }
      if (options.scroll !== false) player.getPacketSender().sendJingle(def.completionJingleId ?? QUEST_COMPLETE_JINGLE, 0);
      if (options.announce !== false) {
        player.sendMessage(`Congratulations, you've completed a quest: <col=081190>${def.name}</col>`);
      }
      if (options.scroll !== false) showCompletedScroll(player, quest, points | 0);
      api.emitCustomEvent?.("quest:completed", { player, key: def.key, quest });
      return true;
    },
  };
  quests.push(quest);
  return quest;
}

// ============================================================================
// Dialogue runner
//
// Steps are plain objects, played in order:
//   { npc: ["line", ...] }        NPC chatbox lines
//   { player: ["line", ...] }     player chatbox lines
//   { options: [{ text, echo?, next: [...] }] }   option menu
//   { exec: (player, ctx) => {} } side effect
// Option branches splice their own steps in front of whatever follows, so every
// branch converges on the remaining sequence.
// ============================================================================

function speak(api, player, npcId, speaker, lines, onDone) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = api.core;
  const builder = new DialogueChainBuilder();
  lines.forEach((line, index) => {
    builder.add(
      speaker === "npc" ? new NpcDialogue(index, npcId, line) : new PlayerDialogue(index, line)
    );
  });
  builder.add(new ActionDialogue(lines.length, { execute: () => onDone() }));
  player.getDialogueManager().startDialogues(builder);
}

function runSteps(api, player, context, steps) {
  const [step, ...rest] = steps;
  if (!step) {
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  if (step.exec) {
    step.exec(player, context);
    // A terminal exec owns its own UI (starts the next conversation, opens a
    // reward scroll, ...), so never force-close the interface after it.
    if (rest.length > 0) runSteps(api, player, context, rest);
    return;
  }
  if (step.options) {
    const pairs = [];
    for (const option of step.options) {
      pairs.push(option.text, () => {
        const echoed = option.echo === false ? [] : [{ player: [option.text] }];
        runSteps(api, player, context, [...echoed, ...(option.next || []), ...rest]);
      });
    }
    if (pairs.length < 4) pairs.push("Goodbye.", () => player.getPacketSender().sendInterfaceRemoval());
    // Drop the chatbox dialogue first, so the prompt owns the interface.
    player.getDialogueManager().reset();
    api.sendMultiChatboxPrompt(player, step.title || "Select an Option", ...pairs);
    return;
  }
  const speaker = step.npc ? "npc" : "player";
  const lines = step.npc || step.player || [];
  speak(api, player, context.npcId, speaker, lines, () => runSteps(api, player, context, rest));
}

/** Starts a conversation. `context` needs `npcId`. */
function startDialogue(api, player, context, steps) {
  runSteps(api, player, context, steps);
}

// ============================================================================
// Transcript replay
//
// Quest NPCs that npc-dialogue-index.json does not index (Drezel, the monks,
// quest-only spawn ids) can still play their wiki variant: look it up in
// npc-dialogues.json and hand it to the NpcDialogues runtime so conditions,
// hooks and hand-in events keep working.
// ============================================================================

let transcriptCache = null;
let transcriptSpeakers = null;

function loadTranscripts(api) {
  if (transcriptCache) return transcriptCache;
  const fs = require("fs");
  const path = require("path");
  const file = path.join(api.core.GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogues.json");
  transcriptCache = JSON.parse(fs.readFileSync(file, "utf8"));
  return transcriptCache;
}

/**
 * Plays one variant of a transcript page for `player`. Returns false when the
 * page/variant is missing. `npcId` drives the chathead and the emitted events.
 * `select` can narrow the variant's steps (e.g. skip a wiki continuation tail); `npc`, the
 * NPC talked to, reaches the dialogue events (for its animations).
 */
function startTranscript(api, player, npcId, page, variant, select, npc = null) {
  const data = loadTranscripts(api);
  const record = data?.[page];
  const raw = record?.variants?.[variant];
  if (!Array.isArray(raw)) return false;
  const steps = typeof select === "function" ? select(raw) : raw;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  const { startDialogue: playDialogue, speakerIdIndex, collectPageOptions, collectPageLines, collectMenuBefore } = require("../npcs/NpcDialogues.plugin.js");
  if (!transcriptSpeakers) {
    const fs = require("fs"), path = require("path");
    const index = JSON.parse(fs.readFileSync(path.join(api.core.GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogue-index.json"), "utf8"));
    transcriptSpeakers = speakerIdIndex(index, api.core.NpcDefinition);
  }
  const definition = api.core.NpcDefinition.forId(npcId);
  const event = { player, npcId, npc, definition };
  const options = collectPageOptions(record);
  const context = { player, npc, npcId, definition, pages: [{ page, variants: [variant] }], speakerIdByName: transcriptSpeakers,
    pageOptions: options.byText, pageOptionList: options.list, pageLines: collectPageLines(record), pageMenuBefore: collectMenuBefore(record, variant) };
  playDialogue(api, event, steps, record.branches, context);
  return true;
}

module.exports = {
  openBook,
  QUEST_POINTS_VARP,
  QUEST_POINTS_ATTRIBUTE,
  EXPERIENCE_WITHHELD_ATTRIBUTE,
  QUEST_COMPLETE_JINGLE,
  registerQuestWidgets,
  registerQuest,
  getRegisteredQuests: () => quests.slice(),
  questNamed,
  pickQuestShopVersion,
  sendQuestVarps,
  refreshQuestList,
  openJournal,
  openJournalBySlot,
  startDialogue,
  startTranscript,
  loadTranscripts,
};
