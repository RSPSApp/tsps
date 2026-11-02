/**
 * The social tab's tab bar (side_channels, 707). The client sends a click on a tab, and the server
 * sets the selected varbit and mounts that tab's interface in the content pane (rsprox 2528, 75).
 * The choice is kept across logins (rsprox 3886 logs in on Your Clan, 2762 on Grouping).
 *
 * Your Clan and Guest Clan are the cache's own interfaces in their "No current clan" state:
 * tsps has no clans.
 */

const GROUP = 707;
const CONTENT_UID = (GROUP << 16) | 7;
const TAB_SELECTED_VARBIT = 13071; // side_channels_tab_selected
const TAB_ATTRIBUTE = "side-channels:tab";
const CHAT_CHANNEL_TAB = 0;
// clan_affinitystatus and its guest twin (script 4288): 0 Connecting, 1 No current clan. Live
// clan members go through 2 and 3 once the login's clan packets arrive (rsprox 763).
const CLAN_STATUS_VARBIT = 933;
const GUEST_CLAN_STATUS_VARBIT = 12164;
const NO_CLAN = 1;
const CHAT_CHANNEL_GROUP = 7;
/** Button component -> tab index and interface, by the rev 241 cache's 707:2-5. */
const TABS = [
  { button: 2, group: CHAT_CHANNEL_GROUP },
  { button: 3, group: 701 }, // Your Clan
  { button: 4, group: 702 }, // Guest Clan
  { button: 5, group: 76 }, // Grouping
];
// The activity list's rows: op1 on 76:30 (rsprox 2762, 75).
const GROUPING_GROUP = 76;
const GROUPING_LIST_UID = (GROUPING_GROUP << 16) | 30;
const GROUPING_LAST_ROW = 27;
const OP1 = 1 << 1;

/** What stands in for the chat-channel tab, such as the raid party: { group, onMount }. */
const replacements = new WeakMap();

function selectedTab(player) {
  const tab = player.getAttribute(TAB_ATTRIBUTE);
  return TABS[tab] ? tab : CHAT_CHANNEL_TAB;
}

function mountSelected(player) {
  const sender = player.getPacketSender();
  const tab = selectedTab(player);
  const replacement = tab === CHAT_CHANNEL_TAB ? replacements.get(player) : undefined;
  const group = replacement?.group ?? TABS[tab].group;
  sender.sendVarbit(TAB_SELECTED_VARBIT, tab);
  sender.sendSubInterface(CONTENT_UID, group, 1);
  if (group === GROUPING_GROUP) sender.sendInterfaceFlagsRange(GROUPING_LIST_UID, 0, GROUPING_LAST_ROW, OP1);
  replacement?.onMount?.();
}

function selectTab(event) {
  if (event.groupId !== GROUP) return;
  const tab = TABS.findIndex(({ button }) => button === event.childId);
  if (tab < 0) return;
  event.player.setAttribute(TAB_ATTRIBUTE, tab);
  mountSelected(event.player);
  event.handled = true;
}

/** The login and every later mount of 707 start on the chat-channel. */
function restoreSelectedTab({ player }) {
  player.getPacketSender().sendVarbit(CLAN_STATUS_VARBIT, NO_CLAN).sendVarbit(GUEST_CLAN_STATUS_VARBIT, NO_CLAN);
  if (selectedTab(player) !== CHAT_CHANNEL_TAB || replacements.has(player)) mountSelected(player);
}

function restoreSelectedTabOnMount({ player, group }) {
  if (group === GROUP) restoreSelectedTab({ player });
}

/**
 * "side-channels:replace-chat-channel" ({ player, group, onMount }): shows `group` on the
 * chat-channel tab and opens that tab. A null group puts the chat-channel back.
 */
function replaceChatChannel({ player, group, onMount }) {
  if (group == null) replacements.delete(player);
  else {
    replacements.set(player, { group, onMount });
    player.setAttribute(TAB_ATTRIBUTE, CHAT_CHANNEL_TAB);
  }
  if (selectedTab(player) === CHAT_CHANNEL_TAB) mountSelected(player);
}

module.exports = {
  name: "SideChannels",
  register(api) {
    api.persistAttribute(TAB_ATTRIBUTE, CHAT_CHANNEL_TAB);
    api.onInterfaceActionClick(selectTab);
    api.onCustomEvent("player:bootstrap-complete", restoreSelectedTab);
    api.onCustomEvent("gameframe:ready", restoreSelectedTab);
    api.onCustomEvent("gameframe:tab-mounted", restoreSelectedTabOnMount);
    api.onCustomEvent("side-channels:replace-chat-channel", replaceChatChannel);
  },
};
