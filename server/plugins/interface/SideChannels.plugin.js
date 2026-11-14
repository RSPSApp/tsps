/**
 * The social tab's tab bar (side_channels, 707). The client sends a click on a tab, and the server
 * sets the selected varbit and mounts that tab's interface in the content pane (rsprox 2528, 75).
 * The choice is kept across logins (rsprox 3886 logs in on Your Clan, 2762 on Grouping).
 *
 * Your Clan and Guest Clan are the cache's own interfaces; Clans.plugin.js feeds them.
 *
 * Grouping's "Switch <world>" button: script 435 shows it whenever enum 850 gives the chosen
 * activity a suggested world (Castle Wars too, for members). A server has one world, so every
 * login sends enum 850 with no world for any activity, and live's playermember script.
 *
 * A Group Ironman has a fifth tab: the cache's side_channels_large (727) takes 707's place in the
 * side slot, its tab_gim showing what "side-channels:gim-tab" { player, tab, group, onMount } names
 * (GroupIronman.plugin.js answers: the group panel, its creation, or a "Create Group" panel). The
 * tab's selected value is the player's `ironman` varbit (4, 5 or 6), as the cache's
 * side_channels_large_init and side_channels_optab set it. "side-channels:refresh" { player }
 * mounts the frame and tab again after a change.
 */

const GROUP = 707;
const CONTENT_UID = (GROUP << 16) | 7;
const TAB_SELECTED_VARBIT = 13071; // side_channels_tab_selected
const TAB_ATTRIBUTE = "side-channels:tab";
const CHAT_CHANNEL_TAB = 0;
const YOUR_CLAN_TAB = 1;
const GROUPING_TAB = 3;
/** The Group Ironman tab, as kept in TAB_ATTRIBUTE. */
const GIM_TAB = 4;
const LARGE_GROUP = 727; // side_channels_large
const LARGE_CONTENT_UID = (LARGE_GROUP << 16) | 8; // side_channels_large:contents
/** side_channels_large:tab_0 .. tab_3, then tab_gim. */
const LARGE_TABS = [3, 4, 5, 6];
const LARGE_GIM_BUTTON = 2;
/** toplevel_osrs_stretch:side7, where the gameframe mounts the social tab (the client maps it per layout). */
const SIDE_SLOT_UID = (161 << 16) | 83;
const SOCIAL_SIDE_BUTTON = 7;
const CHAT_CHANNEL_GROUP = 7;
/** Button component -> tab index and interface, by the rev 241 cache's 707:2-5. */
const TABS = [
  { button: 2, group: CHAT_CHANNEL_GROUP },
  { button: 3, group: 701 }, // Your Clan
  { button: 4, group: 702 }, // Guest Clan
  { button: 5, group: 76 }, // Grouping
];
// Live (rev 242) mounts Grouping with op1 on its Teleport and world-hop buttons, slots 0-30: each is
// the dynamic child at the chosen activity's index (script 435; 0 when none is chosen).
const GROUPING_GROUP = 76;
const GROUPING_TELEPORT_UID = (GROUPING_GROUP << 16) | 32;
const GROUPING_HOP_UID = (GROUPING_GROUP << 16) | 26;
const GROUPING_LAST_SLOT = 30;
const OP1 = 1 << 1;
const SUGGESTED_WORLD_ENUM = 850;
const NO_WORLD = -1;
const ONE_WORLD_SENDER = "grouping-tab";
// Live runs it as the social tab mounts (rev 230, 242): varc 103 (PLAYERMEMBER) for the tab's scripts.
const PLAYER_MEMBER_SCRIPT = 828;

let core;

/** What stands in for the chat-channel tab, such as the raid party: { group, onMount }. */
const replacements = new WeakMap();
/** What stands in for Your Clan, such as the clan creation panel: { group, onMount }. */
const clanReplacements = new WeakMap();
/** What stands in for Grouping, such as the PvP Arena side panel: { group, onMount }. */
const groupingReplacements = new WeakMap();
/** The frame in the player's social side slot (707 or 727), as last mounted. */
const frames = new WeakMap();

let pluginApi;

function attachApi(api) {
  pluginApi = api;
}

/** The Group Ironman tab's { tab, group, onMount }, or null for a player who has none. */
function gimTab(player) {
  const request = { player, tab: null, group: null, onMount: null };
  pluginApi?.emitCustomEvent?.("side-channels:gim-tab", request);
  return Number.isInteger(request.group) && Number.isInteger(request.tab) ? request : null;
}

function replacementFor(player, tab) {
  if (tab === CHAT_CHANNEL_TAB) return replacements.get(player);
  if (tab === YOUR_CLAN_TAB) return clanReplacements.get(player);
  return tab === GROUPING_TAB ? groupingReplacements.get(player) : undefined;
}

function selectedTab(player, gim = gimTab(player)) {
  const tab = player.getAttribute(TAB_ATTRIBUTE);
  if (tab === GIM_TAB) return gim ? GIM_TAB : CHAT_CHANNEL_TAB;
  return TABS[tab] ? tab : CHAT_CHANNEL_TAB;
}

function mountSelected(player) {
  const sender = player.getPacketSender();
  const gim = gimTab(player);
  const frame = gim ? LARGE_GROUP : GROUP;
  if (frames.get(player) !== frame && (gim || frames.get(player) === LARGE_GROUP)) {
    sender.sendSubInterface(SIDE_SLOT_UID, frame, 1);
  }
  frames.set(player, frame);
  const tab = selectedTab(player, gim);
  const replacement = tab === GIM_TAB ? gim : replacementFor(player, tab);
  const group = replacement?.group ?? TABS[tab].group;
  sender.sendVarbit(TAB_SELECTED_VARBIT, tab === GIM_TAB ? gim.tab : tab);
  sender.sendSubInterface(gim ? LARGE_CONTENT_UID : CONTENT_UID, group, 1);
  if (group === GROUPING_GROUP) {
    sender.sendInterfaceFlagsRange(GROUPING_TELEPORT_UID, 0, GROUPING_LAST_SLOT, OP1);
    sender.sendInterfaceFlagsRange(GROUPING_HOP_UID, 0, GROUPING_LAST_SLOT, OP1);
  }
  replacement?.onMount?.();
}

function selectTab(event) {
  let tab = -1;
  if (event.groupId === GROUP) tab = TABS.findIndex(({ button }) => button === event.childId);
  else if (event.groupId === LARGE_GROUP) {
    tab = event.childId === LARGE_GIM_BUTTON ? GIM_TAB : LARGE_TABS.indexOf(event.childId);
  } else return;
  if (tab < 0) return;
  event.player.setAttribute(TAB_ATTRIBUTE, tab);
  mountSelected(event.player);
  event.handled = true;
}

/** The login and every later mount of 707 start on the chat-channel (a Group Ironman's frame is 727). */
function restoreSelectedTab({ player }) {
  frames.set(player, GROUP);
  if (selectedTab(player) !== CHAT_CHANNEL_TAB || replacements.has(player) || gimTab(player)) mountSelected(player);
}

function restoreSelectedTabOnMount({ player, group }) {
  if (group === GROUP) restoreSelectedTab({ player });
}

/** "side-channels:refresh" { player }: the frame and the selected tab again, after a change. */
function refresh({ player }) {
  if (player && frames.has(player)) mountSelected(player);
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

/**
 * "side-channels:replace-your-clan" ({ player, group, onMount }): shows `group` on Your Clan and
 * brings it up. A null group puts Your Clan back.
 */
function replaceYourClan({ player, group, onMount }) {
  if (group == null) clanReplacements.delete(player);
  else {
    clanReplacements.set(player, { group, onMount });
    player.setAttribute(TAB_ATTRIBUTE, YOUR_CLAN_TAB);
    player.getPacketSender().sendTab(SOCIAL_SIDE_BUTTON);
  }
  if (selectedTab(player) === YOUR_CLAN_TAB) mountSelected(player);
}

/**
 * "side-channels:replace-grouping" ({ player, group, onMount }): shows `group` on Grouping and
 * brings it up. A null group puts Grouping back.
 */
function replaceGrouping({ player, group, onMount }) {
  if (group == null) groupingReplacements.delete(player);
  else {
    groupingReplacements.set(player, { group, onMount });
    player.setAttribute(TAB_ATTRIBUTE, GROUPING_TAB);
    player.getPacketSender().sendTab(SOCIAL_SIDE_BUTTON);
  }
  if (selectedTab(player) === GROUPING_TAB) mountSelected(player);
}

/** One world: no activity suggests another, so script 435 never offers "Switch <world>". */
function sendOneWorld({ player }) {
  const entries = [...core.CacheDefinitions.getEnumValues(SUGGESTED_WORLD_ENUM).keys()].map((key) => [key, NO_WORLD]);
  const sender = player.getPacketSender();
  sender.sendContentData(ONE_WORLD_SENDER, [
    { key: "enumOverrides", rows: [{ enumId: SUGGESTED_WORLD_ENUM, valueType: "I", defaultValue: NO_WORLD, entries }] },
  ]);
  sender.sendClientScript(PLAYER_MEMBER_SCRIPT, core.WorldDefinition.isMembersWorld() ? 1 : 0);
}

module.exports = {
  name: "SideChannels",
  description: "Tab bar of the social tab, switching between chat channel, Your Clan, grouping and (for Group Ironmen) the Group Ironman tab, and remembering the chosen tab between logins.",
  register(api) {
    core = api.core;
    attachApi(api);
    api.persistAttribute(TAB_ATTRIBUTE, CHAT_CHANNEL_TAB);
    api.onPlayerLogin(sendOneWorld);
    api.onInterfaceActionClick(selectTab);
    api.onCustomEvent("player:bootstrap-complete", restoreSelectedTab);
    api.onCustomEvent("gameframe:ready", restoreSelectedTab);
    api.onCustomEvent("gameframe:tab-mounted", restoreSelectedTabOnMount);
    api.onCustomEvent("side-channels:replace-chat-channel", replaceChatChannel);
    api.onCustomEvent("side-channels:replace-your-clan", replaceYourClan);
    api.onCustomEvent("side-channels:replace-grouping", replaceGrouping);
    api.onCustomEvent("side-channels:refresh", refresh);
  },
};
