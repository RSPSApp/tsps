// Mirrors constants from client/common/ui/sideJournal.ts and
// client/common/ui/accountSummary.ts. These can't be imported directly
// (server plugins run as plain JS and don't cross into the client TS
// package), so they're kept in sync by hand.
const SIDE_JOURNAL_GROUP_ID = 629;
const SIDE_JOURNAL_TAB_CONTAINER_CHILD_ID = 43;
const SIDE_JOURNAL_TAB_CONTAINER_UID =
(SIDE_JOURNAL_GROUP_ID << 16) | SIDE_JOURNAL_TAB_CONTAINER_CHILD_ID;

const INTERFACE_CHARACTER_SUMMARY_ID = 712;
const INTERFACE_QUEST_LIST_ID = 399;
const INTERFACE_ACHIEVEMENT_DIARY_ID = 259;

// Tab-selection state, drives which tab icon is shown highlighted. Packed
// into varp 1141 bits 4-6, but the client exposes it as varbit 8168.
const VARBIT_SIDE_JOURNAL_SELECTED_TAB = 8168;
const SIDE_JOURNAL_CHARACTER_SUMMARY_TAB = 0;
const SIDE_JOURNAL_QUEST_TAB = 1;
const SIDE_JOURNAL_ACHIEVEMENT_DIARY_TAB = 2;

const SIDE_JOURNAL_SUMMARY_ICON_UID = (SIDE_JOURNAL_GROUP_ID << 16) | 2;
const SIDE_JOURNAL_QUEST_ICON_UID = (SIDE_JOURNAL_GROUP_ID << 16) | 10;
const SIDE_JOURNAL_DIARY_ICON_UID = (SIDE_JOURNAL_GROUP_ID << 16) | 18;
const ACHIEVEMENT_DIARY_TASKBOX_UID = (INTERFACE_ACHIEVEMENT_DIARY_ID << 16) | 2;
const ACHIEVEMENT_DIARY_COUNT = 12;

const ROOT_INTERFACE_ID = 161;
const QUEST_TAB_ICON_UID = (ROOT_INTERFACE_ID << 16) | 61;
const OP_CHARACTER_SUMMARY = 2;
const OP_QUEST_LIST = 3;
const OP_ACHIEVEMENT_DIARIES = 4;

const ACCOUNT_SUMMARY_CONTENTS_UID = (INTERFACE_CHARACTER_SUMMARY_ID << 16) | 2;
const ACCOUNT_SUMMARY_ENTRY_LIST_UID = (INTERFACE_CHARACTER_SUMMARY_ID << 16) | 3;
const ROW_QUESTS = 3;
const ROW_ACHIEVEMENTS = 4;
const ROW_COMBAT_TASKS = 5;
const ROW_COLLECTION_LOG = 6;
const ROW_PLAYTIME = 7;
// Same flags sent once at login bootstrap (ClientProtocol.ts) - the client
// purges these on unmount, so they must be resent every time 712 remounts,
// not just on the very first login. This was the root cause of account
// summary buttons working once then going dead after switching panels.
const FLAGS_OP1 = 1 << 1;
const FLAGS_OP1_4 = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4);
const FLAGS_OP1_2 = (1 << 1) | (1 << 2);


const SCRIPT_ACCOUNT_SUMMARY_SET_TIME_ID = 3970;
const VARBIT_ACCOUNT_SUMMARY_DISPLAY_PLAYTIME = 12933;
const VARBIT_ACCOUNT_SUMMARY_PLAYTIME_REMIND_DISABLE = 12962;
/** Milliseconds online in earlier sessions; the Time Played row adds this session (rsprox 3276). */
const PLAY_TIME_ATTRIBUTE = "account-summary:play-time";
const PLAY_TIME_DISPLAY_ATTRIBUTE = "account-summary:play-time-displayed";
const PLAY_TIME_REMIND_DISABLE_ATTRIBUTE = "account-summary:play-time-remind-disabled";
const PLAY_TIME_PROMPT = "Are you sure you want to display your time played?";
const sessionStartByPlayer = new WeakMap();
let pluginApi;

function mountSideJournalContent(player, groupId, tabIndex) {
  // As captured (rsprox 3276): the time goes first, the summary opens on it.
  if (groupId === INTERFACE_CHARACTER_SUMMARY_ID) sendPlayTime(player);
  player.getPacketSender().sendSubInterface(SIDE_JOURNAL_TAB_CONTAINER_UID, groupId);
  player.getPacketSender().sendVarbit(VARBIT_SIDE_JOURNAL_SELECTED_TAB, tabIndex);
  // Other journal content (the Leagues tab) learns its panel was replaced.
  pluginApi?.emitCustomEvent("journal:tab-mounted", { player, groupId, tabIndex });
  if (groupId === INTERFACE_QUEST_LIST_ID) {
    // The client renders the quest list only while 399 is mounted and purges the
    // row flags on unmount, so the quest runtime repopulates on every open.
    pluginApi?.emitCustomEvent("quest:list-refresh", { player });
  }
  if (groupId === INTERFACE_ACHIEVEMENT_DIARY_ID) {
    // As captured: the diary rows (one per diary) take Open and Wiki each time the tab mounts.
    player.getPacketSender().sendInterfaceFlagsRange(ACHIEVEMENT_DIARY_TASKBOX_UID, 0, ACHIEVEMENT_DIARY_COUNT - 1, FLAGS_OP1_2);
  }
  if (groupId === INTERFACE_CHARACTER_SUMMARY_ID) {
    // Re-send row flags every time 712 comes back - the client drops them
    // on unmount, so a one-time login send only covers the very first view.
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_QUESTS, ROW_ACHIEVEMENTS, FLAGS_OP1);
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_COMBAT_TASKS, ROW_COMBAT_TASKS, FLAGS_OP1_4);
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_COLLECTION_LOG, ROW_COLLECTION_LOG, FLAGS_OP1_2);
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_PLAYTIME, ROW_PLAYTIME, FLAGS_OP1);
  }
  pluginApi?.emitCustomEvent("side-journal:mounted", { player, groupId, tabIndex });
}

function mountRequested(event) {
  const { player, groupId, tabIndex } = event;
  const validGroup = Number.isInteger(groupId) && groupId >= 0 && groupId <= 65535;
  const validTab = Number.isInteger(tabIndex) && tabIndex >= 0 && tabIndex <= 4;
  if (!player || !validGroup || !validTab) return;
  mountSideJournalContent(player, groupId, tabIndex);
  event.mounted = true;
}

/** Milliseconds online: the saved total plus this session. */
function playTime(player) {
  const saved = Number(player.getAttribute(PLAY_TIME_ATTRIBUTE)) || 0;
  const start = sessionStartByPlayer.get(player);
  return saved + (start === undefined ? 0 : Math.max(0, Date.now() - start));
}

/** Moves the session so far into the saved total, so a save always holds it. */
function flushPlayTime(player) {
  if (!sessionStartByPlayer.has(player)) return;
  player.setAttribute(PLAY_TIME_ATTRIBUTE, playTime(player));
  sessionStartByPlayer.set(player, Date.now());
}

function sendPlayTime(player) {
  flushPlayTime(player);
  player.getPacketSender().sendInterfaceScript(SCRIPT_ACCOUNT_SUMMARY_SET_TIME_ID, [
    ACCOUNT_SUMMARY_CONTENTS_UID,
    ACCOUNT_SUMMARY_ENTRY_LIST_UID,
    Math.floor(playTime(player) / 60000),
  ]);
}

function displayPlayTime(player, displayed) {
  player.setAttribute(PLAY_TIME_DISPLAY_ATTRIBUTE, displayed);
  player.getPacketSender().sendVarbit(VARBIT_ACCOUNT_SUMMARY_DISPLAY_PLAYTIME, displayed ? 1 : 0);
  sendPlayTime(player);
}

/** rsprox 3276: showing the row asks first, unless "don't ask me again" was chosen; hiding never asks. */
function togglePlayTime(player) {
  if (player.getAttribute(PLAY_TIME_DISPLAY_ATTRIBUTE)) {
    displayPlayTime(player, false);
    return;
  }
  if (player.getAttribute(PLAY_TIME_REMIND_DISABLE_ATTRIBUTE)) {
    displayPlayTime(player, true);
    return;
  }
  const { DialogueChainBuilder, OptionDialogue } = pluginApi.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        const choice = Number(option);
        if (choice === 2) {
          player.setAttribute(PLAY_TIME_REMIND_DISABLE_ATTRIBUTE, true);
          player.getPacketSender().sendVarbit(VARBIT_ACCOUNT_SUMMARY_PLAYTIME_REMIND_DISABLE, 1);
        }
        if (choice === 1 || choice === 2) displayPlayTime(player, true);
      },
    }, "Yes", "Yes and don't ask me again", "No").setTitle(PLAY_TIME_PROMPT),
  ));
}

function startPlayTime({ player }) {
  sessionStartByPlayer.set(player, Date.now());
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_ACCOUNT_SUMMARY_DISPLAY_PLAYTIME, player.getAttribute(PLAY_TIME_DISPLAY_ATTRIBUTE) ? 1 : 0);
  sender.sendVarbit(VARBIT_ACCOUNT_SUMMARY_PLAYTIME_REMIND_DISABLE, player.getAttribute(PLAY_TIME_REMIND_DISABLE_ATTRIBUTE) ? 1 : 0);
  sendPlayTime(player);
}

function stopPlayTime({ player }) {
  flushPlayTime(player);
  sessionStartByPlayer.delete(player);
}

module.exports = {
  name: "SideJournalDefaults",
  register(api) {
    pluginApi = api;
    api.onCustomEvent("side-journal:mount", mountRequested);
    api.persistAttribute(PLAY_TIME_ATTRIBUTE, 0);
    api.persistAttribute(PLAY_TIME_DISPLAY_ATTRIBUTE, false);
    api.persistAttribute(PLAY_TIME_REMIND_DISABLE_ATTRIBUTE, false);
    api.onPlayerLogin(startPlayTime);
    api.onPlayerLogout(stopPlayTime);

    api.onInterfaceActionButton(
      [SIDE_JOURNAL_SUMMARY_ICON_UID, SIDE_JOURNAL_QUEST_ICON_UID, SIDE_JOURNAL_DIARY_ICON_UID],
      ({ player, buttonId }) => {
        switch (buttonId) {
          case SIDE_JOURNAL_SUMMARY_ICON_UID:
            mountSideJournalContent(player, INTERFACE_CHARACTER_SUMMARY_ID, SIDE_JOURNAL_CHARACTER_SUMMARY_TAB);
            return true;
          case SIDE_JOURNAL_QUEST_ICON_UID:
            mountSideJournalContent(player, INTERFACE_QUEST_LIST_ID, SIDE_JOURNAL_QUEST_TAB);
            return true;
          case SIDE_JOURNAL_DIARY_ICON_UID:
            mountSideJournalContent(player, INTERFACE_ACHIEVEMENT_DIARY_ID, SIDE_JOURNAL_ACHIEVEMENT_DIARY_TAB);
            return true;
          default:
            return false;
        }
      }
    );

    api.onInterfaceActionButton(QUEST_TAB_ICON_UID, ({ player, opId }) => {
      switch (opId) {
        case OP_CHARACTER_SUMMARY:
          mountSideJournalContent(player, INTERFACE_CHARACTER_SUMMARY_ID, SIDE_JOURNAL_CHARACTER_SUMMARY_TAB);
          return true;
        case OP_QUEST_LIST:
          mountSideJournalContent(player, INTERFACE_QUEST_LIST_ID, SIDE_JOURNAL_QUEST_TAB);
          return true;
        case OP_ACHIEVEMENT_DIARIES:
          mountSideJournalContent(player, INTERFACE_ACHIEVEMENT_DIARY_ID, SIDE_JOURNAL_ACHIEVEMENT_DIARY_TAB);
          return true;
        default:
          return false;
      }
    });

    api.onInterfaceActionButton(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ({ player, slot }) => {
      switch (slot) {
        case ROW_QUESTS:
          mountSideJournalContent(player, INTERFACE_QUEST_LIST_ID, SIDE_JOURNAL_QUEST_TAB);
          return true;
        case ROW_ACHIEVEMENTS:
          mountSideJournalContent(player, INTERFACE_ACHIEVEMENT_DIARY_ID, SIDE_JOURNAL_ACHIEVEMENT_DIARY_TAB);
          return true;
        case ROW_COLLECTION_LOG:
          // The collection log plugin owns the log (plugins/achievements/collectionlog/).
          pluginApi?.emitCustomEvent("collection-log:open", { player });
          return true;
        case ROW_PLAYTIME:
          togglePlayTime(player);
          return true;
        case ROW_COMBAT_TASKS:
          // Combat Achievements own their screens (plugins/achievements/combatachievements/).
          pluginApi?.emitCustomEvent("combat-achievements:open", { player });
          return true;
        default:
          return false;
      }
    });

    api.log("registered");
  },
};
