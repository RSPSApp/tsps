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
const COLLECTION_LOG_GROUP_ID = 621;

// Tab-selection state, drives which tab icon is shown highlighted. Packed
// into varp 1141 bits 4-6, but the client exposes it as varbit 8168.
const VARBIT_SIDE_JOURNAL_SELECTED_TAB = 8168;
const SIDE_JOURNAL_CHARACTER_SUMMARY_TAB = 0;
const SIDE_JOURNAL_QUEST_TAB = 1;
const SIDE_JOURNAL_ACHIEVEMENT_DIARY_TAB = 2;

const SIDE_JOURNAL_SUMMARY_ICON_UID = (SIDE_JOURNAL_GROUP_ID << 16) | 2;
const SIDE_JOURNAL_QUEST_ICON_UID = (SIDE_JOURNAL_GROUP_ID << 16) | 10;
const SIDE_JOURNAL_DIARY_ICON_UID = (SIDE_JOURNAL_GROUP_ID << 16) | 18;

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

// Collection log close button (childId 1, confirmed from click logs: uid
// matches exactly (COLLECTION_LOG_GROUP_ID<<16)|1, and transmits by default
// unlike our custom widgets - real cache-defined button).
const COLLECTION_LOG_CLOSE_BUTTON_UID = (COLLECTION_LOG_GROUP_ID << 16) | 1;

const SCRIPT_ACCOUNT_SUMMARY_SET_TIME_ID = 3970;
const VARBIT_ACCOUNT_SUMMARY_DISPLAY_PLAYTIME = 12933;
const sessionStartByPlayer = new WeakMap();
const playtimeRevealedByPlayer = new WeakMap();
let pluginApi;

function mountSideJournalContent(player, groupId, tabIndex) {
  player.getPacketSender().sendSubInterface(SIDE_JOURNAL_TAB_CONTAINER_UID, groupId);
  player.getPacketSender().sendVarbit(VARBIT_SIDE_JOURNAL_SELECTED_TAB, tabIndex);
  if (groupId === INTERFACE_QUEST_LIST_ID) {
    // The client renders the quest list only while 399 is mounted and purges the
    // row flags on unmount, so the quest runtime repopulates on every open.
    pluginApi?.emitCustomEvent("quest:list-refresh", { player });
  }
  if (groupId === INTERFACE_CHARACTER_SUMMARY_ID) {
    // Re-send row flags every time 712 comes back - the client drops them
    // on unmount, so a one-time login send only covers the very first view.
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_QUESTS, ROW_ACHIEVEMENTS, FLAGS_OP1);
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_COMBAT_TASKS, ROW_COMBAT_TASKS, FLAGS_OP1_4);
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_COLLECTION_LOG, ROW_COLLECTION_LOG, FLAGS_OP1_2);
    player.getPacketSender().sendInterfaceFlagsRange(ACCOUNT_SUMMARY_ENTRY_LIST_UID, ROW_PLAYTIME, ROW_PLAYTIME, FLAGS_OP1);
  }
}

function sessionMinutes(player) {
  const start = sessionStartByPlayer.get(player) ?? Date.now();
  return Math.max(0, Math.floor((Date.now() - start) / 60000));
}

module.exports = {
  name: "SideJournalDefaults",
  register(api) {
    pluginApi = api;
    api.onPlayerLogin(({ player }) => {
      sessionStartByPlayer.set(player, Date.now());
    });

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
        case ROW_COLLECTION_LOG: {
          // sendInterface/WIDGET_OPEN only creates a client-side bookkeeping
          // session - it never actually renders anything (confirmed against
          // this codebase's own working Bank.open()). Bank mounts into
          // root:16 (main) via sendSubInterface - same mechanism as our
          // quest journal fix. Explicit type 0 matches hasInterruptibleInterface()
          // in Player.ts, so movement correctly auto-closes this the same
          // way it closes Bank.
          //
          // Bank ALSO mounts an inventory side-panel at root:74 (type 3),
          // which this used to copy - but subInterfaceTargets in
          // PacketSender.ts is keyed by groupId alone, so mounting the
          // MAIN_INVENTORY_GROUP_ID (149) a second time there silently
          // overwrote the tracking entry for the player's real sidebar
          // inventory tab (root:79, set at login), breaking it after this
          // interface closed. Not worth the side panel until there's a
          // safe way to do it - removed.
          //
          // Content still renders empty: nothing tracks item acquisitions
          // server-side yet.
          const root = 161;
          player.getPacketSender().sendSubInterface((root << 16) | 16, COLLECTION_LOG_GROUP_ID, 0);
          return true;
        }
        case ROW_PLAYTIME: {
          const revealed = !playtimeRevealedByPlayer.get(player);
          playtimeRevealedByPlayer.set(player, revealed);
          player.getPacketSender().sendVarbit(VARBIT_ACCOUNT_SUMMARY_DISPLAY_PLAYTIME, revealed ? 1 : 0);
          player.getPacketSender().sendInterfaceScript(SCRIPT_ACCOUNT_SUMMARY_SET_TIME_ID, [
            ACCOUNT_SUMMARY_CONTENTS_UID,
            ACCOUNT_SUMMARY_ENTRY_LIST_UID,
            sessionMinutes(player),
          ]);
          return true;
        }
        case ROW_COMBAT_TASKS:
          return false;
        default:
          return false;
      }
    });

    // Collection log close button. closeInterface() is the same mechanism
    // sendWidgetClose (client) -> "widget"/action:"close" (server) uses -
    // it looks up the tracked target for this group and sends the correct
    // close_sub, same as walking away does via closeInterruptibleInterfaces().
    api.onInterfaceActionButton(COLLECTION_LOG_CLOSE_BUTTON_UID, ({ player }) => {
      player.getPacketSender().closeInterface(COLLECTION_LOG_GROUP_ID);
      return true;
    });

    api.log("registered");
  },
};
