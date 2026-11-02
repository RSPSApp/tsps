/**
 * The screens behind clan Settings: Members (693), Permissions (706), Bans (689) and Rank Titles
 * (695), and what they change. rsprox 2778, 2896 and 3086 show opening them and setting a rank; the
 * other edits have no capture, so they follow the cache's scripts and the Wiki (docs/clans.md).
 */

const Core = require("./Core.Clans");
const Hall = require("./Hall.Clans");
const PERMISSIONS = require("./data/permissions.json");

const MODAL_UID = (161 << 16) | 16;
const RANK_POPUP_SCRIPT = 4316; // clan_rankpopup(title, current, min, max, canExpel, popup)
const POPUP_OVERLAY_GROUP = 289; // mounted into the popup slot for it (rsprox 2896 tick 31)
const OP1_FLAG = 1 << 1;

const MEMBERS_GROUP = 693;
const members = (child) => (MEMBERS_GROUP << 16) | child;
const MEMBER_COLUMN_1 = 11;
const MEMBER_COLUMN_2 = 13;
const MEMBER_HEADER_OPTIONS_1 = 19;
const MEMBER_HEADER_OPTIONS_2 = 20;
const MEMBER_MIN_RANK = 23;
const MEMBER_MAX_RANK = 24;
const MEMBER_EXIT = 25;
const MEMBER_COMMENT = 26;
const MEMBER_POPUP = 27;
const LAST_MEMBER_SLOT = 499;
const LAST_HEADER_OPTION = 7;
const COMBAT_COLUMN_SCRIPT = 4257;
const TOTAL_COLUMN_SCRIPT = 4258;
/** clan_perm_transmit_0 as live sends it on opening: columns 0, ranks 0 to Owner (rsprox 2778, 2896, 3086). */
const MEMBER_LIST_VARP = 3021;
const MEMBER_LIST_DEFAULT = 16646144;
const MIN_RANK_FILTER_VARBIT = 12179; // clan_members_minrank
const MAX_RANK_FILTER_VARBIT = 12180; // clan_members_maxrankplus1
const EXPEL_POPUP_RANK = 128; // "Nobody" in enum 3795, offered when expelling is allowed

const PERMISSIONS_GROUP = 706;
const permissions = (child) => (PERMISSIONS_GROUP << 16) | child;
const PERMISSION_EXIT = 5;
const PERMISSION_LIST = 12;
const PERMISSION_POPUP = 14;

const BANS_GROUP = 689;
const BAN_EXIT = 11;
const BAN_ADD = 14;
const MAX_BANS = 100; // Wiki: Clan Settings

const TITLES_GROUP = 695;
const TITLES_CANCEL = 12;
const TITLES_SAVE = 13;
/** clan_editing_0-4 mirror settings 1-5, bit for bit, while the screen edits them (scripts 4305, 4302). */
const TITLE_VARPS = [
  [3023, 1],
  [3024, 2],
  [3025, 3],
  [3026, 4],
  [3027, 5],
  // Ranks 96-124's titles borrow these varps on the cache's own varbits, and settings 102-104.
  [733, 102],
  [736, 103],
  [737, 104],
];

/** Enum 3795's ranks that can be assigned, lowest first. */
const ASSIGNABLE_RANKS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 110, 115, 120, 124, 125];
/** What a permission can ask for: those, anyone, and the owner. Not 127 or 128, the enum's others. */
const PERMISSION_RANKS = new Set([-1, ...ASSIGNABLE_RANKS, Core.RANK_OWNER]);

let openSettings = null;

function init(reopenSettings) {
  openSettings = reopenSettings;
}

function memberFor(clan, player) {
  return Core.memberOf(clan, Core.accountOf(player));
}

/** The highest rank this rank can hand out: the next below its own. */
function highestAssignable(rank) {
  return ASSIGNABLE_RANKS.filter((value) => value < rank).at(-1) ?? 0;
}

function showRankPopup(player, title, current, min, max, canExpel, popupUid, onChoice) {
  const sender = player.getPacketSender();
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(count) {
      sender.closeSubInterface(popupUid);
      if (count > 0) onChoice(count - 1);
    },
  });
  sender.sendSubInterface(popupUid, POPUP_OVERLAY_GROUP, 1);
  sender.sendClientScript(RANK_POPUP_SCRIPT, title, current, min, max, canExpel ? 1 : 0, popupUid);
}

// ---------------------------------------------------------------- Members

/**
 * Each member slot's value then a "|", blank for those offline. Field N is slot N: in rsprox 2778
 * Z-Kris is member 1 and has field 1, so a string starting "|" is just slot 0 being offline.
 */
function memberColumn(clan, valueOf) {
  return clan.members
    .map((member) => {
      const player = Core.onlinePlayer(member.account);
      return `${player ? valueOf(player) : ""}|`;
    })
    .join("");
}

function sendMemberColumns(player, clan) {
  player
    .getPacketSender()
    .sendClientScript(COMBAT_COLUMN_SCRIPT, memberColumn(clan, (other) => other.getSkillManager().getCombatLevel()))
    .sendClientScript(TOTAL_COLUMN_SCRIPT, memberColumn(clan, (other) => other.getSkillManager().getTotalLevel()));
}

function openMembers(player, clan) {
  const sender = player.getPacketSender();
  sender.sendConfig(MEMBER_LIST_VARP, MEMBER_LIST_DEFAULT);
  sender.sendSubInterface(MODAL_UID, MEMBERS_GROUP, 0);
  sender
    .sendInterfaceFlagsRange(members(MEMBER_HEADER_OPTIONS_1), 1, LAST_HEADER_OPTION, OP1_FLAG)
    .sendInterfaceFlagsRange(members(MEMBER_HEADER_OPTIONS_2), 1, LAST_HEADER_OPTION, OP1_FLAG)
    .sendInterfaceFlagsRange(members(MEMBER_COLUMN_1), 0, LAST_MEMBER_SLOT, OP1_FLAG)
    .sendInterfaceFlagsRange(members(MEMBER_COLUMN_2), 0, LAST_MEMBER_SLOT, OP1_FLAG);
  sendMemberColumns(player, clan);
  sender.sendString("Use the drop-down menus above to choose what data to see.", members(MEMBER_COMMENT));
}

function clickMemberRow(player, clan, slot) {
  const own = memberFor(clan, player);
  const target = clan.members[slot];
  if (!own || !target) return;
  if (own.rank < Core.permissionRank(clan, Core.SETTING_ASSIGN_RANKS) || target.rank >= own.rank) {
    player.sendMessage("You can only edit the ranks of players whose ranks are lower than yours.");
    return;
  }
  const canExpel = own.rank >= Core.permissionRank(clan, Core.SETTING_EXPEL);
  showRankPopup(player, `Set rank for ${target.name}:`, target.rank, Core.RANK_RECRUIT, highestAssignable(own.rank), canExpel,
    members(MEMBER_POPUP), (rank) => chooseMemberRank(player, clan, target, rank));
}

function chooseMemberRank(player, clan, target, rank) {
  const own = memberFor(clan, player);
  if (!own || !clan.members.includes(target) || target.rank >= own.rank) return;
  if (rank === EXPEL_POPUP_RANK) {
    if (own.rank < Core.permissionRank(clan, Core.SETTING_EXPEL)) return;
    const online = Core.onlinePlayer(target.account);
    Core.removeMember(clan, target.account);
    online?.sendMessage(`You have been expelled from ${clan.name}.`);
    player.sendMessage(`You have expelled ${target.name} from the clan.`);
    return;
  }
  if (own.rank < Core.permissionRank(clan, Core.SETTING_ASSIGN_RANKS)) return;
  if (!ASSIGNABLE_RANKS.includes(rank) || rank > highestAssignable(own.rank)) return;
  Core.setMemberRank(clan, target, rank);
}

function chooseRankFilter(player, varbit, offset, rank) {
  player.getPacketSender().sendVarbit(varbit, rank + offset);
}

function clickMembers(player, clan, event) {
  const { childId, slot } = event;
  if (childId === MEMBER_EXIT) openSettings(player);
  else if (childId === MEMBER_COLUMN_1 || childId === MEMBER_COLUMN_2) clickMemberRow(player, clan, slot);
  else if (childId === MEMBER_MIN_RANK) {
    showRankPopup(player, "Show ranks from:", -1, -1, Core.RANK_OWNER, false, members(MEMBER_POPUP),
      (rank) => chooseRankFilter(player, MIN_RANK_FILTER_VARBIT, 0, rank));
  } else if (childId === MEMBER_MAX_RANK) {
    showRankPopup(player, "Show ranks to:", Core.RANK_OWNER, -1, Core.RANK_OWNER, false, members(MEMBER_POPUP),
      (rank) => chooseRankFilter(player, MAX_RANK_FILTER_VARBIT, 1, rank));
  }
}

// ---------------------------------------------------------------- Permissions

function openPermissions(player) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(MODAL_UID, PERMISSIONS_GROUP, 0);
  sender.sendInterfaceFlagsRange(permissions(PERMISSION_LIST), 0, PERMISSIONS.length - 1, OP1_FLAG);
}

/** The lowest a row can be set to: its own minimum, or the row it must be at least. */
function rowFloor(clan, row) {
  const atLeast = row.atLeast === null ? -1 : Core.rowRank(clan, Core.rowByStruct(row.atLeast));
  return Math.max(atLeast, row.minRank ?? -1);
}

function canEditPermissions(player, clan) {
  const own = memberFor(clan, player);
  return !!own && own.rank >= Core.permissionRank(clan, Core.SETTING_PERMISSIONS);
}

/** The popup's answer comes from the client, so it's checked here as well as offered there. */
function askRowRank(player, clan, row, title, popupUid, afterSet = () => {}) {
  const own = memberFor(clan, player);
  if (!own) return;
  const current = Core.rowRank(clan, row);
  if (current > own.rank) {
    player.sendMessage("You cannot change a permission that is above your own rank.");
    return;
  }
  showRankPopup(player, title, current, rowFloor(clan, row), own.rank, false, popupUid, (rank) => {
    const now = memberFor(clan, player);
    if (!canEditPermissions(player, clan) || !PERMISSION_RANKS.has(rank) || rank < rowFloor(clan, row) || rank > now.rank) return;
    Core.setRowRank(clan, row, rank);
    afterSet();
  });
}

function clickPermission(player, clan, index) {
  const row = PERMISSIONS[index];
  const own = memberFor(clan, player);
  if (!row || !own) return;
  if (!canEditPermissions(player, clan)) {
    player.sendMessage("You are not a high enough rank to change the clan's permissions.");
    return;
  }
  if (row.special) {
    clickSpecialRow(player, clan, row);
    return;
  }
  askRowRank(player, clan, row, `${row.label}:`, permissions(PERMISSION_POPUP));
}

/** Rows holding a value, not a rank; their settings are clan_permissions_buttonresynch's. */
const GUESTS_LISTEN_STRUCT = 2957;
const GUEST_RULE_STRUCTS = { 2958: "combat", 2959: "total", 2960: "qp", 2961: "iron" };
const VALUE_STRUCTS = { 3109: 31, 854: 101, 4247: 65, 4678: 98, 4239: 66, 4240: 67, 4241: 68, 4238: 69, 4571: 111, 4570: 110, 4572: 112 };

function askRowValue(player, clan, row, onValue) {
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(value) {
      if (canEditPermissions(player, clan)) onValue(value);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(`${row.label}:`);
}

function clickSpecialRow(player, clan, row) {
  if (row.struct === GUESTS_LISTEN_STRUCT) {
    clan.allowGuests = !clan.allowGuests;
    Core.refreshClan(clan);
    return;
  }
  const rule = GUEST_RULE_STRUCTS[row.struct];
  if (rule) {
    askRowValue(player, clan, row, (value) => Core.setGuestRules(clan, { ...Core.guestRules(clan), [rule]: value }));
    return;
  }
  const setting = VALUE_STRUCTS[row.struct];
  if (setting) askRowValue(player, clan, row, (value) => Core.setSettingValue(clan, setting, value));
}

function clickPermissions(player, clan, event) {
  if (event.childId === PERMISSION_EXIT) openSettings(player);
  else if (event.childId === PERMISSION_LIST) clickPermission(player, clan, event.slot);
}

// ---------------------------------------------------------------- Bans

/** The list's Unban answers with the name through resume_stringdialog (clan_banned_unban). */
function listenForUnban(player, clan) {
  player.setEnteredSyntaxAction({ execute: (name) => unban(player, clan, String(name ?? "")) });
}

function canBan(player, clan) {
  const own = memberFor(clan, player);
  return !!own && own.rank >= Core.permissionRank(clan, Core.SETTING_BAN);
}

function openBans(player, clan) {
  player.getPacketSender().sendSubInterface(MODAL_UID, BANS_GROUP, 0);
  listenForUnban(player, clan);
}

function unban(player, clan, name) {
  listenForUnban(player, clan);
  if (!canBan(player, clan)) return;
  Core.setBanned(clan, (clan.banned ?? []).filter((banned) => banned.toLowerCase() !== name.toLowerCase()));
}

/** A banned guest goes at once: from the channel, and from the hall if they're in it. */
function removeBannedGuest(clan, name) {
  const guest = Core.onlinePlayer(name.toLowerCase());
  if (!guest) return;
  if (Core.guestChannelOf(guest)?.clan === clan) Core.removeFromGuestChannel(guest);
  Hall.sendOut(guest, clan);
}

/** Every ban comes through here, from the Bans screen or a channel user's menu. */
function addBan(player, clan, name) {
  const banned = clan.banned ?? [];
  if (banned.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
    removeBannedGuest(clan, name);
    return;
  }
  if (banned.length >= MAX_BANS) {
    player.sendMessage(`The ban list can't hold more than ${MAX_BANS} names.`);
    return;
  }
  if (Core.memberOf(clan, name.toLowerCase())) {
    player.sendMessage("That player must be expelled from the clan before they can be banned.");
    return;
  }
  Core.setBanned(clan, [...banned, name]);
  removeBannedGuest(clan, name);
}

function ban(player, clan, rawName) {
  listenForUnban(player, clan);
  const name = rawName.trim();
  if (name && canBan(player, clan)) addBan(player, clan, name);
}

function askBan(player, clan) {
  if (!canBan(player, clan)) {
    player.sendMessage("You are not a high enough rank to ban players.");
    return;
  }
  player.setEnteredSyntaxAction({ execute: (name) => ban(player, clan, String(name ?? "")) });
  player.getPacketSender().sendEnterInputPrompt("Enter the name of the player to ban:");
}

function clickBans(player, clan, event) {
  if (event.childId === BAN_EXIT) openSettings(player);
  else if (event.childId === BAN_ADD) askBan(player, clan);
}

// ---------------------------------------------------------------- Rank Titles

const titleEdits = new WeakMap();

function openTitles(player, clan) {
  const sender = player.getPacketSender();
  const edits = new Map();
  for (const [varp, setting] of TITLE_VARPS) {
    const value = Core.titleSetting(clan, setting);
    edits.set(varp, value);
    sender.sendConfig(varp, value);
  }
  titleEdits.set(player, edits);
  sender.sendSubInterface(MODAL_UID, TITLES_GROUP, 0);
}

/** The screen's scripts change these varps as titles are dragged, and the client passes them on. */
function varpTransmitted(event) {
  const edits = titleEdits.get(event.player);
  if (!edits?.has(event.varpId)) return;
  edits.set(event.varpId, event.value);
  event.handled = true;
}

function clickTitles(player, clan, event) {
  if (event.childId === TITLES_CANCEL) {
    titleEdits.delete(player);
    openSettings(player);
    return;
  }
  if (event.childId !== TITLES_SAVE) return;
  const own = memberFor(clan, player);
  const edits = titleEdits.get(player);
  if (!own || !edits) return;
  if (own.rank < Core.permissionRank(clan, Core.SETTING_TITLES)) {
    player.sendMessage("You are not a high enough rank to edit the rank titles.");
    return;
  }
  Core.setTitles(clan, new Map(TITLE_VARPS.map(([varp, setting]) => [setting, edits.get(varp)])));
  titleEdits.delete(player);
  openSettings(player);
}

// ---------------------------------------------------------------- routing

function click(event) {
  const { groupId, player } = event;
  const handler = { [MEMBERS_GROUP]: clickMembers, [PERMISSIONS_GROUP]: clickPermissions, [BANS_GROUP]: clickBans, [TITLES_GROUP]: clickTitles }[groupId];
  if (!handler) return;
  event.handled = true;
  const clan = Core.clanOf(player);
  if (clan) handler(player, clan, event);
}

module.exports = { addBan, askRowRank, canBan, click, init, openBans, openMembers, openPermissions, openTitles, showRankPopup, varpTransmitted };
