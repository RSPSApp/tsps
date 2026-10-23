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

// Client quest list statuses.
const STATUS_IN_PROGRESS = 0;
const STATUS_NOT_STARTED = 1;
const STATUS_COMPLETE = 2;

const { questListGroups } = require("./QuestList.QuestRuntime");
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

/** Sends the quest list and its row flags; call when the quest tab (re)mounts. */
function refreshQuestList(player) {
  sendQuestList(player);
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

function openJournal(player, quest) {
  const lines = journalLines(quest, player);
  const packet = player.getPacketSender();
  const updater = player.getFrameUpdater?.();
  // The client remounts the interface blank, but the sender's per-widget text
  // cache still holds the previous open's lines; forget them so they re-send.
  const setText = (uid, text) => {
    updater?.clear?.(uid);
    packet.sendString(String(text ?? ""), uid);
  };
  packet.sendConfig(VARP_QJ_LINES, lines.length);
  packet.sendSubInterface(FLOATER_OVERLAY_UID, JOURNAL_GROUP, 0);
  packet.sendInterfaceFlagsRange((JOURNAL_GROUP << 16) | JOURNAL_CLOSE_CHILD, -1, -1, 1 << 1);
  packet.sendInterfaceFlagsRange((JOURNAL_GROUP << 16) | JOURNAL_SWITCH_CHILD, -1, -1, 1 << 1);
  packet.sendInterfaceScript(SCRIPT_QJ_RESET, []);
  setText((JOURNAL_GROUP << 16) | JOURNAL_TITLE_CHILD, `<col=7f0000>${quest.name}</col>`);
  lines.forEach((line, index) => {
    setText((JOURNAL_GROUP << 16) | (JOURNAL_FIRST_LINE_CHILD + index), line);
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
 * quest:is-complete / quest:is-started { player, key, complete | started }: answered for quests
 * registered here, by each quest's own stage values. An unknown key is left unanswered (null).
 */
function answerIsComplete(request) {
  const quest = quests.find((entry) => entry.key === request?.key);
  if (quest && request.player) request.complete = quest.isComplete(request.player);
}

function answerIsStarted(request) {
  const quest = quests.find((entry) => entry.key === request?.key);
  if (quest && request.player) request.started = quest.isStarted(request.player);
}

function answerGetStage(request) {
  const quest = quests.find((entry) => entry.key === request?.key);
  if (quest && request.player) request.stage = quest.getStage(request.player);
}

/** A shop version named after a quest: "Fremennik Isles", "After Lunar Diplomacy", "Before Contact!". */
const QUEST_SHOP_VERSION = /\((?:(After|During|Before) )?([^()]+)\)$/;

function questNamed(name) {
  const plain = (text) => text.toLowerCase().replace(/^the /, "");
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
    if (interfaceId === BOOK_GROUP) openBooks.delete(player);
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
  // The character summary shows the same header stats without opening the list.
  api.onPlayerLogin(({ player }) => sendQuestHeaderStats(player));
  api.onPlayerLogin(sendQuestVarps);
  // The login bootstrap's sendTabInterface(6) runs after the login hooks and
  // re-sends the all-spells-unlocked varps, clobbering quest varps that share
  // storage with cache transforms (e.g. Drezel's 302). Re-send ours afterwards.
  api.onCustomEvent("player:bootstrap-complete", ({ player }) => sendQuestVarps({ player }));
}

/** The cache's two-page book (392), using the captured text lines for each spread. */
function openBook(player, title, pages) {
  if (!pages.length) return;
  player.getPacketSender().sendInterface(BOOK_GROUP);
  openBooks.set(player, { title, pages, page: 0 });
  showBookPage(player);
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
    openBooks.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
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
    complete(player) {
      if (quest.isComplete(player)) return false;
      quest.setStage(player, def.completionValue ?? 2);

      const points = (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) + (def.questPoints || 0);
      player.setAttribute(QUEST_POINTS_ATTRIBUTE, points | 0);
      player.getPacketSender().sendConfig(QUEST_POINTS_VARP, points | 0);

      if (def.onReward) def.onReward(player, quest);
      if (def.rewardItemId !== undefined) {
        const inventory = player.getInventory();
        if (inventory.isFull()) inventory.forceAdd(player, new coreApi.Item(def.rewardItemId, 1));
        else inventory.adds(def.rewardItemId, 1);
      }
      player.getPacketSender().sendJingle(def.completionJingleId ?? QUEST_COMPLETE_JINGLE, 0);
      player.sendMessage(`Congratulations, you've completed a quest: <col=081190>${def.name}</col>`);
      showCompletedScroll(player, quest, points | 0);
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
  QUEST_COMPLETE_JINGLE,
  registerQuest,
  getRegisteredQuests: () => quests.slice(),
  pickQuestShopVersion,
  sendQuestVarps,
  refreshQuestList,
  openJournal,
  openJournalBySlot,
  startDialogue,
  startTranscript,
  loadTranscripts,
};
