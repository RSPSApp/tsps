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
const QUEST_LIST_ENTRY_MAX_SLOT = 199;

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

const quests = [];
let widgetsRegistered = false;

function stageAttribute(questKey) {
  return `quest.${questKey}.stage`;
}

function orderedQuests() {
  return quests.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * OSRS sorts the quest list alphabetically with a leading "The" ignored, and
 * renders a single-letter header ("A", "B", ...) before each group.
 */
function questSortName(quest) {
  return String(quest.name).replace(/^the\s+/i, "");
}

function questGroups() {
  const sorted = quests
    .slice()
    .sort((a, b) => questSortName(a).localeCompare(questSortName(b)));
  const groups = [];
  for (const quest of sorted) {
    const letter = questSortName(quest).charAt(0).toUpperCase();
    const title = letter >= "A" && letter <= "Z" ? letter : "#";
    const last = groups[groups.length - 1];
    if (last && last.title === title) {
      last.quests.push(quest);
    } else {
      groups.push({ title, quests: [quest] });
    }
  }
  return groups;
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
  for (const group of questGroups()) {
    slotQuests[slot] = null; // header row
    slot++;
    const start = slot;
    const entries = group.quests.map((quest) => {
      const row = {
        slot,
        status: questStatus(quest, player),
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
  const { groups, ranges } = questRows(player);
  const packet = player.getPacketSender();
  packet.sendQuestList(groups);
  for (const [start, end] of ranges) {
    if (end >= start) {
      packet.sendInterfaceFlagsRange(
        QUEST_LIST_ENTRY_UID,
        start,
        Math.min(end, QUEST_LIST_ENTRY_MAX_SLOT),
        QUEST_LIST_ENTRY_FLAGS
      );
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
  const quest = questRows(player).slotQuests[slot | 0];
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
  const scrollItemId = quest.scrollItemId ?? quest.rewardItemId;
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

function registerQuestWidgets(api) {
  if (widgetsRegistered) return;
  widgetsRegistered = true;

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
  api.onCustomEvent("quest:is-complete", answerIsComplete);
  api.onCustomEvent("quest:is-started", answerIsStarted);
  // The character summary shows the same header stats without opening the list.
  api.onPlayerLogin(({ player }) => sendQuestHeaderStats(player));
}

// ============================================================================
// Quest registration
// ============================================================================

/**
 * Registers a quest and returns a handle with stage/complete helpers.
 *
 * @param api  the plugin api
 * @param def  { key, name, varpId, startedValue, completionValue, questPoints,
 *               xpRewards?, rewardItemId?, rewardItemLabel?, otherRewards?,
 *               buildJournal?(player, quest), onReward?(player, quest) }
 */
function registerQuest(api, def) {
  if (!def || !def.key || !def.name) throw new Error("registerQuest requires a key and name");
  registerQuestWidgets(api);
  api.persistAttribute(stageAttribute(def.key));
  api.persistAttribute(QUEST_POINTS_ATTRIBUTE);

  const stageKey = stageAttribute(def.key);
  const quest = {
    ...def,
    getStage(player) {
      const value = Number(player.getAttribute(stageKey));
      return Number.isFinite(value) ? value | 0 : 0;
    },
    setStage(player, value) {
      player.setAttribute(stageKey, value | 0);
      player.getPacketSender().sendConfig(def.varpId, value | 0);
      refreshQuestList(player);
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
      if (def.rewardItemId !== undefined) player.getInventory().adds(def.rewardItemId, 1);
      player.getPacketSender().sendJingle(QUEST_COMPLETE_JINGLE, 0);
      player.sendMessage(`Congratulations, you've completed a quest: ${def.name}`);
      openCompletedScroll(player, quest, points | 0);
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

function loadTranscripts(api) {
  if (transcriptCache) return transcriptCache;
  const fs = require("fs");
  const path = require("path");
  const file = path.join(api.core.GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogues.json");
  transcriptCache = JSON.parse(fs.readFileSync(file, "utf8"));
  return transcriptCache;
}

/** Wiki multi-speaker lines -> generic NPC lines so one chathead renders them. */
function flattenSpeakers(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.map((step) => {
    const copy = { ...step };
    if (copy.type === "line" && typeof copy.speaker === "string") {
      copy.npc = copy.text;
      delete copy.speaker;
    }
    if (Array.isArray(copy.steps)) copy.steps = flattenSpeakers(copy.steps);
    if (Array.isArray(copy.options)) {
      copy.options = copy.options.map((option) => ({ ...option, steps: flattenSpeakers(option.steps) }));
    }
    return copy;
  });
}

/**
 * Plays one variant of a transcript page for `player`. Returns false when the
 * page/variant is missing. `npcId` drives the chathead and the emitted events.
 */
function startTranscript(api, player, npcId, page, variant) {
  const data = loadTranscripts(api);
  const record = data?.[page];
  const raw = record?.variants?.[variant];
  if (!Array.isArray(raw)) return false;
  const { startDialogue: playDialogue } = require("../npcs/NpcDialogues.plugin.js");
  const definition = api.core.NpcDefinition.forId(npcId);
  const event = { player, npcId, npc: null, definition };
  const context = { player, npc: null, npcId, definition, pages: [{ page, variants: [variant] }] };
  playDialogue(api, event, flattenSpeakers(raw), record.branches, context);
  return true;
}

module.exports = {
  QUEST_POINTS_VARP,
  QUEST_POINTS_ATTRIBUTE,
  QUEST_COMPLETE_JINGLE,
  registerQuest,
  getRegisteredQuests: () => quests.slice(),
  refreshQuestList,
  openJournal,
  openJournalBySlot,
  startDialogue,
  startTranscript,
  loadTranscripts,
};
