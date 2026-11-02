/**
 * The Settings button's interface (clans_info, 690), filled as rsprox 2778 shows, and its rows.
 * Edits have no capture, so their prompts and messages are ours (docs/clans.md).
 */

const Core = require("./Core.Clans");
const Guests = require("./Guests.Clans");
const Management = require("./Management.Clans");
const Screens = require("./Screens.Clans");
const Store = require("./Store.Clans");

const SETTINGS_GROUP = 690;
const uid = (child) => (SETTINGS_GROUP << 16) | child;
const MODAL_UID = (161 << 16) | 16;
const CLOSE_BUTTON = 3;
const NAME_ROW = 11;
const HOME_WORLD_ROW = 12;
const RESIGN_ROW = 13;
const INTERESTS_ROW = 14;
const TALK_ROW = 15;
const GUESTS_ROW = 16;
const LOAD_AS_GUEST_VARBIT = 12165; // clan_transmit_loadasguest
const OUTFIT_BUTTON = 5;
const EVENTS_BUTTON = 19;
const HALL_BUTTON = 22;
const MEMBERS_BUTTON = 20;
const APPLICANTS_BUTTON = 21;
const PERMISSIONS_BUTTON = 23;
const TITLES_BUTTON = 24;
const BANS_BUTTON = 25;
const LEAVE_BUTTON = 26;
const POPUP = 27;
const MAX_NAME_LENGTH = 20;
const RENAME_COOLDOWN_MS = 7 * 86400000; // Wiki: Clan Settings
const STRUCT_TALK = 2954;
const ENUM_3797_GUEST = "Guest";
const STATIC_ROWS_SCRIPT = 4289; // clan_info_static
const EDITABLE_ROW_SCRIPT = 4290; // clan_info_editable
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RUNE_DAY_EPOCH_MS = Date.UTC(2002, 1, 27);
const DAY_MS = 86400000;
const REFRESH_TICKS = 6; // rsprox 2778 ticks 42, 48; 133, 139, 145, 151

let core = null;
let later = null;
const guestView = new WeakSet();
/** Each player's latest refresh loop, so reopening the screen doesn't start a second one. */
const refreshLoops = new WeakMap();

function init(apiCore, schedule) {
  core = apiCore;
  later = schedule;
}

const highlight = (text) => `<col=ffb83f>${text}</col>`;

function runeDateText(day) {
  const date = new Date(RUNE_DAY_EPOCH_MS + day * DAY_MS);
  return `${String(date.getUTCDate()).padStart(2, "0")}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function ownershipRow(clan, now) {
  if (!clan.resignDueAt) return `Ownership:|${highlight("Click here")} to <col=ff0000>resign</col> as clan owner.|Resignation`;
  const days = Math.ceil((clan.resignDueAt - now) / DAY_MS);
  return `Ownership:|You are resigning: ${highlight(`${days} days`)} left. ${highlight("Click here")} to stay.|Resignation`;
}

/**
 * The rows in rsprox 2778's order; the last argument is -1, or 0 for the checkbox row. For anyone but
 * the owner the name offers Report, and Talk and Guests are 0, not editable (2895 and 3084, a Deputy
 * Owner, even with Permission access at their rank).
 */
function draw(player, clan) {
  const sender = player.getPacketSender();
  const row = (text, child, last = -1, editable = 1) => sender.sendClientScript(EDITABLE_ROW_SCRIPT, text, uid(child), editable, last);
  const owner = isOwner(player, clan);
  sender.sendClientScript(
    STATIC_ROWS_SCRIPT,
    "Clan Size:<br>Owner:<br>Creation Date:",
    [clan.members.length, Core.ownerOf(clan)?.name ?? "", runeDateText(clan.creationTime)].map(highlight).join("<br>"),
  );
  row(`Name:|${highlight(clan.name)}|${owner ? "Rename" : "Report"}`, NAME_ROW);
  row("Home World:|---", HOME_WORLD_ROW);
  sender.sendInterfaceDisplayState(uid(RESIGN_ROW), !owner);
  if (owner) row(ownershipRow(clan, Date.now()), RESIGN_ROW);
  const interests = Screens.interestNames(clan);
  row(`Interests:|${interests.length ? interests.map(highlight).join(", ") : highlight("None")}`, INTERESTS_ROW);
  row(`Talk in chat:|${highlight(rankName(clan.talkRank))}`, TALK_ROW, -1, owner ? 1 : 0);
  row(`Guests may listen in chat:|${highlight(clan.allowGuests ? "Permitted" : "Not permitted")}`, GUESTS_ROW, 0, owner ? 1 : 0);
}

/** Only what a new clan's own Talk row can be set to without the title lookup the client does. */
function rankName(rank) {
  if (rank === -1) return ENUM_3797_GUEST;
  if (rank === Core.RANK_OWNER) return "Owner";
  if (rank === 125) return "Deputy Owner";
  if (rank === Core.RANK_ADMINISTRATOR) return "Administrator";
  return `Rank ${rank}+`;
}

/** Live redraws the rows and the resign row's hide while the screen is up. */
function keepDrawn(player, loop = {}) {
  refreshLoops.set(player, loop);
  later(REFRESH_TICKS, () => {
    if (refreshLoops.get(player) !== loop || !Core.isOnline(player)) return;
    if (!player.getPacketSender().isSubInterfaceOpen(SETTINGS_GROUP)) return;
    const clan = guestView.has(player) ? Core.guestClanOf(player) : Core.clanOf(player);
    if (!clan) return;
    draw(player, clan);
    keepDrawn(player, loop);
  });
}

function open(player) {
  const clan = Core.clanOf(player);
  if (!clan) return;
  guestView.delete(player);
  player.getPacketSender().sendVarbit(LOAD_AS_GUEST_VARBIT, 0);
  Core.settleOwnership(clan);
  if (!Core.clanOf(player)) return;
  player.getPacketSender().sendSubInterface(MODAL_UID, SETTINGS_GROUP, 0);
  draw(player, clan);
  keepDrawn(player);
}

/** Guest Clan's Info: the same screen, read-only but for Apply (clan_info_draw). */
function openAsGuest(player) {
  const clan = Core.guestClanOf(player);
  if (!clan) return;
  guestView.add(player);
  player.getPacketSender().sendSubInterface(MODAL_UID, SETTINGS_GROUP, 0);
  draw(player, clan);
  keepDrawn(player);
}

function confirm(player, title, onYes) {
  const { DialogueChainBuilder, OptionDialogue } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        player.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) onYes();
      },
    }, "Yes.", "No.").setTitle(title),
  ));
}

function isOwner(player, clan) {
  return Core.memberOf(clan, Core.accountOf(player))?.rank === Core.RANK_OWNER;
}

function clickResign(player, clan) {
  if (!isOwner(player, clan)) {
    player.sendMessage("Only the clan's owner can do that.");
    return;
  }
  if (clan.resignDueAt) {
    clan.resignDueAt = 0;
    Core.refreshClan(clan);
    player.sendMessage("You are no longer resigning as clan owner.");
    draw(player, clan);
    return;
  }
  confirm(player, "Resign as clan owner?", () => {
    if (!isOwner(player, clan)) return;
    clan.resignDueAt = Date.now() + Core.RESIGN_MS;
    Core.refreshClan(clan);
    player.sendMessage(clan.members.length > 1
      ? "You will stop being the clan's owner in 7 days."
      : "You are the only member: the clan will be deleted in 7 days.");
  });
}

function clickLeave(player, clan) {
  if (isOwner(player, clan)) {
    player.sendMessage("You must resign as clan owner before you can leave.");
    return;
  }
  confirm(player, `Leave ${clan.name}?`, () => {
    // They may have been expelled, or made the owner, while this was up.
    if (Core.clanOf(player) !== clan || isOwner(player, clan)) return;
    Core.removeMember(clan, Core.accountOf(player));
    player.sendMessage(`You have left ${clan.name}.`);
  });
}

function askRename(player, clan) {
  if (!isOwner(player, clan)) {
    player.sendMessage("To report this clan's name, use Report at the bottom of the screen.");
    return;
  }
  const waited = Date.now() - (clan.renamedAt ?? 0);
  if (waited < RENAME_COOLDOWN_MS) {
    player.sendMessage("A clan can only be renamed once every 7 days.");
    return;
  }
  player.setEnteredSyntaxAction({ execute: (text) => rename(player, clan, String(text ?? "").trim()) });
  player.getPacketSender().sendEnterInputPrompt("Enter your clan's new name:");
}

function rename(player, clan, name) {
  if (!isOwner(player, clan)) return;
  if (!name || name.length > MAX_NAME_LENGTH || !/^[a-z0-9 _-]+$/i.test(name)) {
    player.sendMessage(`Clan names are up to ${MAX_NAME_LENGTH} letters, numbers and spaces.`);
    return;
  }
  if (Store.byName(name)) {
    player.sendMessage("That name is taken.");
    return;
  }
  clan.name = name;
  clan.renamedAt = Date.now();
  Core.refreshClan(clan);
  draw(player, clan);
}

/** These rows are the owner's here; others with Permission access use the Permissions screen. */
function ownerRow(player, clan) {
  if (isOwner(player, clan)) return true;
  player.sendMessage("Only the clan's owner can change that here.");
  return false;
}

function clickTalkRow(player, clan) {
  if (!ownerRow(player, clan)) return;
  Management.askRowRank(player, clan, Core.rowByStruct(STRUCT_TALK), "Talk in chat:", uid(POPUP), () => draw(player, clan));
}

function clickGuestsRow(player, clan) {
  if (!ownerRow(player, clan)) return;
  clan.allowGuests = !clan.allowGuests;
  Core.refreshClan(clan);
  draw(player, clan);
}

function click(event) {
  if (event.groupId !== SETTINGS_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  const clan = Core.clanOf(player);
  if (childId === CLOSE_BUTTON) {
    guestView.delete(player);
    player.getPacketSender().sendVarbit(LOAD_AS_GUEST_VARBIT, 0).sendInterfaceRemoval();
    return;
  }
  if (guestView.has(player)) {
    const viewed = Core.guestClanOf(player);
    if (viewed && childId === APPLICANTS_BUTTON) Guests.toggleApplication(player, viewed);
    return;
  }
  if (!clan) return;
  if (childId === RESIGN_ROW) clickResign(player, clan);
  else if (childId === LEAVE_BUTTON) clickLeave(player, clan);
  else if (childId === NAME_ROW) askRename(player, clan);
  else if (childId === TALK_ROW) clickTalkRow(player, clan);
  else if (childId === GUESTS_ROW) clickGuestsRow(player, clan);
  else if (childId === INTERESTS_ROW) Screens.openInterests(player, clan);
  else if (childId === OUTFIT_BUTTON) Screens.openOutfit(player, clan);
  else if (childId === EVENTS_BUTTON) Screens.openEvents(player, clan);
  else if (childId === HALL_BUTTON) Screens.openHall(player, clan);
  else if (childId === APPLICANTS_BUTTON) Guests.fetchApplicants(player, clan);
  else if (childId === MEMBERS_BUTTON) Management.openMembers(player, clan);
  else if (childId === PERMISSIONS_BUTTON) Management.openPermissions(player);
  else if (childId === TITLES_BUTTON) Management.openTitles(player, clan);
  else if (childId === BANS_BUTTON) Management.openBans(player, clan);
  else if (childId === HOME_WORLD_ROW) player.sendMessage("Clans here have one home world: this server's.");
}

module.exports = { click, init, open, openAsGuest, runeDateText };
