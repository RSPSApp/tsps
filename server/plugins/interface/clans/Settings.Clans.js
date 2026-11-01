/**
 * The Settings button's interface (clans_info, 690), filled as rsprox 2778 shows. Leaving and
 * resigning are here; their confirmations and messages have no capture, so the wording is ours
 * apart from the rows. The other rows and buttons are later phases (docs/clans.md).
 */

const Core = require("./Core.Clans");

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
const LEAVE_BUTTON = 26;
const STATIC_ROWS_SCRIPT = 4289; // clan_info_static
const EDITABLE_ROW_SCRIPT = 4290; // clan_info_editable
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const RUNE_DAY_EPOCH_MS = Date.UTC(2002, 1, 27);
const DAY_MS = 86400000;

let core = null;

function init(apiCore) {
  core = apiCore;
}

const highlight = (text) => `<col=ffb83f>${text}</col>`;

function creationDate(day) {
  const date = new Date(RUNE_DAY_EPOCH_MS + day * DAY_MS);
  return `${String(date.getUTCDate()).padStart(2, "0")}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function ownershipRow(clan, now) {
  if (!clan.resignDueAt) return `Ownership:|${highlight("Click here")} to <col=ff0000>resign</col> as clan owner.|Resignation`;
  const days = Math.ceil((clan.resignDueAt - now) / DAY_MS);
  return `Ownership:|You are resigning: ${highlight(`${days} days`)} left. ${highlight("Click here")} to stay.|Resignation`;
}

/** The rows in rsprox 2778's order; the last argument is -1, or 0 for the checkbox row. */
function draw(player, clan) {
  const sender = player.getPacketSender();
  const row = (text, child, last = -1) => sender.sendClientScript(EDITABLE_ROW_SCRIPT, text, uid(child), 1, last);
  const isOwner = Core.memberOf(clan, Core.accountOf(player))?.rank === Core.RANK_OWNER;
  sender.sendClientScript(
    STATIC_ROWS_SCRIPT,
    "Clan Size:<br>Owner:<br>Creation Date:",
    [clan.members.length, Core.ownerOf(clan)?.name ?? "", creationDate(clan.creationTime)].map(highlight).join("<br>"),
  );
  row(`Name:|${highlight(clan.name)}|Rename`, NAME_ROW);
  row("Home World:|---", HOME_WORLD_ROW);
  sender.sendInterfaceDisplayState(uid(RESIGN_ROW), !isOwner);
  if (isOwner) row(ownershipRow(clan, Date.now()), RESIGN_ROW);
  row(`Interests:|${highlight("None")}`, INTERESTS_ROW);
  row(`Talk in chat:|${highlight("Guest")}`, TALK_ROW);
  row(`Guests may listen in chat:|${highlight(clan.allowGuests ? "Permitted" : "Not permitted")}`, GUESTS_ROW, 0);
}

function open(player) {
  const clan = Core.clanOf(player);
  if (!clan) return;
  Core.settleOwnership(clan);
  if (!Core.clanOf(player)) return;
  player.getPacketSender().sendSubInterface(MODAL_UID, SETTINGS_GROUP, 0);
  draw(player, clan);
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

function clickResign(player, clan) {
  if (clan.resignDueAt) {
    clan.resignDueAt = 0;
    Core.refreshClan(clan);
    player.sendMessage("You are no longer resigning as clan owner.");
    draw(player, clan);
    return;
  }
  confirm(player, "Resign as clan owner?", () => {
    clan.resignDueAt = Date.now() + Core.RESIGN_MS;
    Core.refreshClan(clan);
    player.sendMessage(clan.members.length > 1
      ? "You will stop being the clan's owner in 7 days."
      : "You are the only member: the clan will be deleted in 7 days.");
  });
}

function clickLeave(player, clan) {
  if (Core.memberOf(clan, Core.accountOf(player))?.rank === Core.RANK_OWNER) {
    player.sendMessage("You must resign as clan owner before you can leave.");
    return;
  }
  confirm(player, `Leave ${clan.name}?`, () => {
    Core.removeMember(clan, Core.accountOf(player));
    player.sendMessage(`You have left ${clan.name}.`);
  });
}

function click(event) {
  if (event.groupId !== SETTINGS_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  const clan = Core.clanOf(player);
  if (childId === CLOSE_BUTTON) {
    player.getPacketSender().sendInterfaceRemoval();
    return;
  }
  if (!clan) return;
  if (childId === RESIGN_ROW) clickResign(player, clan);
  else if (childId === LEAVE_BUTTON) clickLeave(player, clan);
  else player.sendMessage("That part of the clan settings is not available yet.");
}

module.exports = { click, init, open };
