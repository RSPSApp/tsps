// Reporting a player, as captured on live (rsprox 2375 rev 229, 3719 rev 235): every player
// gets the "Report" option in player slot 8; that option or the chatbox Report button opens
// interface 875 (reportabuse) as an overlay on chatbox:chatoverlay with reportabuse_init, Close
// undoes it with reportabuse_close, and the form's submit arrives as REPORT_ABUSE (OSRS
// SEND_SNAPSHOT: name, internal rule id, mute request). The form shows its own thank-you page,
// so the server answers nothing; the report is appended to a JSON-lines file and announced as
// the "report:abuse" custom event. See server/docs/social-chat-and-following.md.
const fs = require("fs");
const path = require("path");

const REPORT_PLAYER_OPTION_SLOT = 8;
const REPORT_PLAYER_OPTION = "Report";
/** All Settings "Player Report options" (row 372): the option is left off while it is 1. */
const REPORT_OPTION_SETTING = 372;
const REPORT_OPTION_DISABLED_VARBIT = 1334; // rightclick_report_abuse_disabled
const SETTINGS_VALUES_ATTRIBUTE = "settings:values";
/** chatbox:reportabuse (162:31): op 2 "Report abuse", op 4 "Report game bug". */
const CHATBOX_REPORT_BUTTON = (162 << 16) | 31;
const CHATBOX_REPORT_ABUSE_OP = 2;
/**
 * chatbox:chatoverlay, where live mounts the form as an overlay: 162:567 in the rev 241 cache
 * (162:565 in the rev 231-236 captures; the chatbox's children drift). Script 113 sizes it to
 * 479x96 while chatoverlay_unclamp is set.
 */
const CHATBOX_OVERLAY_TARGET = (162 << 16) | 567;
const OVERLAY_SUB_TYPE = 1;
const CHATOVERLAY_UNCLAMP_VARBIT = 10689;
const REPORT_INTERFACE_ID = 875;
/** reportabuse:close (875:23). */
const REPORT_CLOSE_BUTTON = (REPORT_INTERFACE_ID << 16) | 23;
/** reportabuse_init(enabled, hasName, name) and reportabuse_close. */
const REPORT_INIT_SCRIPT = 5084;
const REPORT_CLOSE_SCRIPT = 5085;
const BUSY_MESSAGE = "Please finish what you're doing first.";
const REPORTS_FILE_ENV = "TSPS_ABUSE_REPORTS_FILE";
const DEFAULT_REPORTS_FILE = "./data/saves/abuse-reports.jsonl";
const MAX_NAME_LENGTH = 12;

/**
 * The form's categories by the rule id on the wire (rev 241 script 5084 passes the id plus one;
 * the client op subtracts it, as RSProx documents for SEND_SNAPSHOT). Two categories share an
 * id where the 2025 category list reused one.
 */
const RULES = {
  3: "Exploiting a bug",
  4: "Staff impersonation",
  5: "Buying/selling accounts and services",
  6: "Macroing or use of bots",
  7: "PvP Cheating / Boxing in the Deadman Tournament",
  8: "Real-world trading / Encouraging rule breaking",
  10: "Advertising websites",
  11: "Muling in the Deadman Tournament",
  12: "Asking for or providing contact information",
  14: "Scamming",
  15: "Seriously offensive language",
  16: "Solicitation",
  17: "Disruptive behaviour",
  18: "Offensive display name",
  19: "Real-life threats",
  20: "Breaking real-world laws",
  21: "Player-run Games of Chance / Deathmatching",
};

let pluginApi = null;

function reportsFile() {
  return path.resolve(process.env[REPORTS_FILE_ENV] || DEFAULT_REPORTS_FILE);
}

/** Only staff (any rank above a player) may ask for a mute with their report; live limits it to mods. */
function isStaff(player) {
  return (player.getRights?.()?.getId?.() ?? 0) > 0;
}

/** The saved setting: the login hooks can run before Settings sends it back. */
function reportOptionDisabled(player) {
  const saved = player.getAttribute(SETTINGS_VALUES_ATTRIBUTE);
  const key = `varbit:${REPORT_OPTION_DISABLED_VARBIT}`;
  if (saved && typeof saved === "object" && Number.isInteger(saved[key])) return saved[key] === 1;
  return player.getPacketSender().getVarbit(REPORT_OPTION_DISABLED_VARBIT) === 1;
}

/** Live sends the option in slot 8, or an empty slot 8 while the setting turns it off. */
function sendReportOption(player) {
  const option = reportOptionDisabled(player) ? "" : REPORT_PLAYER_OPTION;
  player.getPacketSender().sendPlayerOption(REPORT_PLAYER_OPTION_SLOT, option, false);
}

function giveReportOption({ player }) {
  sendReportOption(player);
}

/** The row clicked: flip the setting through Settings, then add or remove the option. */
function reportSettingClicked(request) {
  if (request.settingId !== REPORT_OPTION_SETTING || request.handled) return;
  request.handled = true;
  const value = reportOptionDisabled(request.player) ? 0 : 1;
  pluginApi.emitCustomEvent("settings:set", { player: request.player, settingId: REPORT_OPTION_SETTING, value });
  sendReportOption(request.player);
}

/** Opens the form over the chatbox, with the name filled in when the player right-clicked someone. */
function openReportForm(player, name = "") {
  if (player.busy?.()) {
    player.getPacketSender().sendMessage(BUSY_MESSAGE);
    return true;
  }
  const sender = player.getPacketSender();
  sender.sendVarbit(CHATOVERLAY_UNCLAMP_VARBIT, 1);
  sender.sendSubInterface(CHATBOX_OVERLAY_TARGET, REPORT_INTERFACE_ID, OVERLAY_SUB_TYPE);
  sender.sendClientScript(REPORT_INIT_SCRIPT, 1, name ? 1 : 0, name);
  return true;
}

function closeReportForm({ player }) {
  const sender = player.getPacketSender();
  sender.sendVarbit(CHATOVERLAY_UNCLAMP_VARBIT, 0);
  sender.closeSubInterface(CHATBOX_OVERLAY_TARGET);
  sender.sendClientScript(REPORT_CLOSE_SCRIPT);
  return true;
}

function reportFromPlayerOption(event) {
  if (event.option !== REPORT_PLAYER_OPTION_SLOT || reportOptionDisabled(event.player)) return;
  event.handled = true;
  openReportForm(event.player, event.target?.getUsername?.() ?? "");
}

function reportFromChatbox(event) {
  if ((event.opId ?? event.action) !== CHATBOX_REPORT_ABUSE_OP) return false;
  return openReportForm(event.player);
}

/** Records a submitted report. Anything malformed is swallowed: the form never needs an answer. */
function receiveReport(event) {
  const { player, packet } = event;
  if (packet?.type !== "report_abuse") return;
  event.handled = true;
  const reported = String(packet.name ?? "").trim().slice(0, MAX_NAME_LENGTH);
  const ruleId = Number(packet.ruleId);
  const rule = RULES[ruleId];
  if (!reported || !rule) return;
  const report = {
    time: new Date().toISOString(),
    reporter: player.getUsername(),
    reported,
    ruleId,
    rule,
    mute: packet.mute === true && isStaff(player),
  };
  try {
    const file = reportsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(report)}\n`);
  } catch (error) {
    pluginApi?.log?.(`could not record a report: ${error?.message ?? error}`);
  }
  pluginApi?.emitCustomEvent("report:abuse", { ...report, reporter: player });
}

module.exports = {
  name: "ReportAbuse",
  description: "Report option on players and the chatbox Report button open the report form; submitted reports are written to a JSON-lines file.",
  RULES,
  _test: { giveReportOption, reportSettingClicked, reportFromPlayerOption },
  register(api) {
    pluginApi = api;
    api.onPlayerLogin(giveReportOption);
    api.onPlayerOption(reportFromPlayerOption);
    api.onCustomEvent("settings:setting-clicked", reportSettingClicked);
    api.onInterfaceActionButton(CHATBOX_REPORT_BUTTON, reportFromChatbox);
    api.onInterfaceActionButton(REPORT_CLOSE_BUTTON, closeReportForm);
    api.onSocialPacket(receiveReport);
  },
};
