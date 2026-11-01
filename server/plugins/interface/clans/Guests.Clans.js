/**
 * Guest clans (702), applying, the Applicants screen (699) and the recruitment board (700).
 * Finding a clan and the screens follow rsprox 76 and 2778; joining a channel as a guest has no
 * capture, so it follows the cache's scripts and the Wiki, with our wording (docs/clans.md).
 */

const Core = require("./Core.Clans");
const Store = require("./Store.Clans");

const GUEST_GROUP = 702;
const GUEST_REFRESH = 2;
const GUEST_CHAT_BUTTON = 8;
const GUEST_INFO_BUTTON = 9;
const GUEST_FIND_BUTTON = 10;
const FIND_PROMPT_SCRIPT = 110; // with this mode, as rsprox 76 tick 7504
const FIND_PROMPT_MODE = 7;
const SIDE_BUTTON = 7;

const QUEST_POINTS_ATTRIBUTE = "quest.points";
/** enum 3828: 1 Any Ironman, 2 UIM only, 3 HCIM only. */
const IRON_RULES = { 1: ["ironman", "ultimate", "hardcore"], 2: ["ultimate"], 3: ["hardcore"] };
const FETCHING = 2; // clan_guest_affinitystatus while the settings arrive (rsprox 76 tick 7587)
const FETCH_TICKS = 1;
const BUTTON_TIMEOUT_TICKS = 5;
const JOIN_DELAY_TICKS = 3;
const GUEST_TIMEOUT_VARBIT = 12169; // clan_transmit_guest_timeout
const LOAD_AS_GUEST_VARBIT = 12165; // clan_transmit_loadasguest
const APPLYING_VARBIT = 12166; // clan_transmit_guestisapplying

const APPLICANTS_GROUP = 699;
const APPLICANT_BUTTONS = 1;
const APPLICANT_LIST = 11;
const BUTTON_BOARD = 0;
const BUTTON_REFRESH = 1;
const BUTTON_DECLINE = 2;
const BUTTON_ACCEPT = 3;
const BUTTON_INVITE = 4;
const BUTTON_MIN_COMBAT = 5;
const BUTTON_MIN_TOTAL = 6;
const APPLICANT_ROWS = 20;
const APPLICANT_INFO_SCRIPT = 4375;
const APPLICANT_ROW_SCRIPT = 4376;
const PAUSE_FLAG = 1;

const BOARD_GROUP = 700;
const BOARD_BUTTONS = 1;
const BOARD_FILTERS = 5;
const BOARD_LIST = 20;
const BOARD_MY_CLAN = 0; // "List your clan" (rsprox 2778 tick 67)
const BOARD_APPLICANTS = 1; // by the buttons' order on screen; only the first is captured
const BOARD_REFRESH = 2;
const BOARD_RESET = 3;
const BOARD_WANTED_VARP = 807; // read by clan_board_filterupdate
const BOARD_UNWANTED_VARP = 808;
const INTERESTS_SETTING = 7;
const BOARD_ROWS = 45;
const BOARD_ROW_SCRIPT = 4357;
const LAST_BOARD_ENTRY = 89;
const LAST_BOARD_FILTER = 15;
const LAST_BOARD_BUTTON = 3;
const MODAL_UID = (161 << 16) | 16;
/** A messagebox's line goes in the chat log too, as this type (rsprox 2778 tick 67, 76 tick 7508). */
const MESSAGEBOX_LOG_TYPE = 115;
const NOT_FOUND_SOUND = 2277; // rsprox 76 tick 7508
/** "Fetching your clan data...": the chatbox's 293 with the spinner 663 in it (rsprox 2778 tick 73). */
const CHATBOX_CLEAR_SCRIPT = 2379;
const FETCH_LAYER_GROUP = 293;
const FETCH_SPINNER_GROUP = 663;
const FETCH_SPINNER_SCRIPT = 4217;
const FETCH_SPINNER_GRAPHIC = 3787;
const uid = (group, child) => (group << 16) | child;

let core = null;
let later = null;
let openSettingsFor = null;
let interestNamesFor = () => [];
let runeDateText = (day) => String(day);

const selectedApplicant = new WeakMap();

function init(apiCore, schedule, openSettings, interestNames, dateText) {
  core = apiCore;
  later = schedule;
  openSettingsFor = openSettings;
  interestNamesFor = interestNames;
  runeDateText = dateText;
}

/** Over whatever is in the chatbox, with its line logged; <br> is only for the box. */
function messageBox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core;
  player.getPacketSender().sendTypedMessage(MESSAGEBOX_LOG_TYPE, text.replace(/<br>/g, " "));
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

// ---------------------------------------------------------------- finding a clan

function askFind(player) {
  player.setEnteredSyntaxAction({ execute: (name) => find(player, String(name ?? "").trim()) });
  player.getPacketSender().sendClientScript(FIND_PROMPT_SCRIPT, "Type the name of a clan to seek:", FIND_PROMPT_MODE);
}

function find(player, name) {
  const clan = name ? Store.byName(name) : undefined;
  if (!clan) {
    player.getPacketSender().sendSound(NOT_FOUND_SOUND, 255, 0);
    messageBox(player, "No clan could be found with that name.");
    return;
  }
  viewClan(player, clan);
}

/** rsprox 76: fetching at once with the tab brought up, then the settings a moment later. */
function viewClan(player, clan) {
  discard(player);
  player.getPacketSender().sendVarbit(Core.GUEST_CLAN_STATUS_VARBIT, FETCHING).sendTab(SIDE_BUTTON);
  later(FETCH_TICKS, () => {
    if (Core.isOnline(player) && Store.byName(clan.name) === clan) Core.addGuestViewer(player, clan);
  });
}

function discard(player) {
  Core.removeGuestViewer(player);
  player.getPacketSender().sendVarbit(LOAD_AS_GUEST_VARBIT, 0).sendVarbit(APPLYING_VARBIT, 0);
}

// ---------------------------------------------------------------- the guest channel

function guestRefusal(player, clan) {
  if (!clan.allowGuests) return "This clan does not allow guests in its channel.";
  if (Core.isBanned(clan, player.getUsername())) return "You are banned from this clan's channel.";
  if (Core.clanOf(player) === clan) return "You are already a member of this clan.";
  const rules = Core.guestRules(clan);
  const skills = player.getSkillManager();
  if (skills.getCombatLevel() < rules.combat) return `You need a combat level of ${rules.combat} to chat in this clan's channel.`;
  if (skills.getTotalLevel() < rules.total) return `You need a total level of ${rules.total} to chat in this clan's channel.`;
  if ((player.getAttribute(QUEST_POINTS_ATTRIBUTE) ?? 0) < rules.qp) return `You need ${rules.qp} quest points to chat in this clan's channel.`;
  const needed = IRON_RULES[rules.iron];
  if (needed && !needed.includes(Core.ironmanMode(player))) return "Your account type can't chat in this clan's channel.";
  return null;
}

function greyGuestButton(player) {
  player.getPacketSender().sendVarbit(GUEST_TIMEOUT_VARBIT, 1);
  later(BUTTON_TIMEOUT_TICKS, () => {
    if (Core.isOnline(player)) player.getPacketSender().sendVarbit(GUEST_TIMEOUT_VARBIT, 0);
  });
}

function toggleGuestChannel(player) {
  const clan = Core.guestClanOf(player);
  if (!clan) return;
  if (Core.guestChannelOf(player)) {
    greyGuestButton(player);
    Core.removeFromGuestChannel(player);
    return;
  }
  const refused = guestRefusal(player, clan);
  if (refused) {
    player.sendMessage(refused);
    return;
  }
  greyGuestButton(player);
  later(JOIN_DELAY_TICKS, () => {
    if (Core.isOnline(player) && Core.guestClanOf(player) === clan) Core.joinGuestChannel(player, clan);
  });
}

function clickGuestPanel(event) {
  if (event.groupId !== GUEST_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  if (childId === GUEST_CHAT_BUTTON) toggleGuestChannel(player);
  else if (childId === GUEST_INFO_BUTTON) {
    if (!Core.guestClanOf(player)) return;
    player.getPacketSender().sendVarbit(LOAD_AS_GUEST_VARBIT, 1);
    openSettingsFor(player);
    player.getPacketSender().sendVarbit(APPLYING_VARBIT, applicantOf(Core.guestClanOf(player), player) ? 1 : 0);
  } else if (childId === GUEST_FIND_BUTTON) {
    if (Core.guestClanOf(player)) discard(player);
    else askFind(player);
  } else if (childId === GUEST_REFRESH) {
    const clan = Core.guestClanOf(player);
    if (clan) Core.addGuestViewer(player, clan);
  }
}

// ---------------------------------------------------------------- applying

function applicationRefusal(player, clan) {
  if (Core.clanOf(player)) return "You are already in a clan.";
  if (!clan.inviting) return "This clan is not inviting applications at the moment.";
  if (Core.isBanned(clan, player.getUsername())) return "You are banned from this clan.";
  const skills = player.getSkillManager();
  if (skills.getCombatLevel() < (clan.applyMinCombat ?? 0)) return `You need a combat level of ${clan.applyMinCombat} to apply.`;
  if (skills.getTotalLevel() < (clan.applyMinTotal ?? 0)) return `You need a total level of ${clan.applyMinTotal} to apply.`;
  return null;
}

function applicantOf(clan, player) {
  return (clan.applicants ?? []).find((entry) => entry.account === Core.accountOf(player));
}

/** rsprox 2778's applicant line: name, combat, total, then each skill's level. */
function applicantStats(player) {
  const skills = player.getSkillManager();
  const levels = core.Skill.values().map((skill) => skills.getMaxLevel(skill));
  return [player.getUsername(), skills.getCombatLevel(), skills.getTotalLevel(), ...levels].join("|");
}

function toggleApplication(player, clan) {
  const sender = player.getPacketSender();
  if (applicantOf(clan, player)) {
    clan.applicants = clan.applicants.filter((entry) => entry.account !== Core.accountOf(player));
    Store.save();
    sender.sendVarbit(APPLYING_VARBIT, 0);
    return;
  }
  const refused = applicationRefusal(player, clan);
  if (refused) {
    player.sendMessage(refused);
    return;
  }
  clan.applicants = [...(clan.applicants ?? []), { account: Core.accountOf(player), name: player.getUsername(), stats: applicantStats(player) }];
  Store.save();
  sender.sendVarbit(APPLYING_VARBIT, 1);
  for (const member of clan.members) {
    if (member.rank < Core.permissionRank(clan, Core.SETTING_RECRUIT)) continue;
    Core.onlinePlayer(member.account)?.sendMessage(`${player.getUsername()} has applied to join your clan.`);
  }
}

// ---------------------------------------------------------------- Applicants

function canRecruit(player, clan) {
  const own = Core.memberOf(clan, Core.accountOf(player));
  return !!own && own.rank >= Core.permissionRank(clan, Core.SETTING_RECRUIT);
}

function openApplicants(player, clan) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(MODAL_UID, APPLICANTS_GROUP, 0);
  sender
    .sendInterfaceFlagsRange(uid(APPLICANTS_GROUP, APPLICANT_LIST), 0, APPLICANT_ROWS - 1, PAUSE_FLAG)
    .sendInterfaceFlagsRange(uid(APPLICANTS_GROUP, APPLICANT_BUTTONS), 0, BUTTON_MIN_TOTAL, PAUSE_FLAG);
  selectedApplicant.delete(player);
  sender.sendClientScript(APPLICANT_INFO_SCRIPT, "");
  const applicants = clan.applicants ?? [];
  for (let row = 0; row < APPLICANT_ROWS; row++) {
    sender.sendClientScript(APPLICANT_ROW_SCRIPT, row, applicants[row]?.name ?? "");
  }
}

/** Settings' Applications and the board's buttons: the screen goes, and Applicants comes a tick on. */
function fetchApplicants(player, clan) {
  const sender = player.getPacketSender();
  sender.sendClientScript(CHATBOX_CLEAR_SCRIPT);
  sender.closeSubInterface(MODAL_UID);
  sender.sendChatboxInterface(FETCH_LAYER_GROUP);
  sender.sendSubInterface(uid(FETCH_LAYER_GROUP, 2), FETCH_SPINNER_GROUP, 1);
  sender.sendClientScript(FETCH_SPINNER_SCRIPT, uid(FETCH_LAYER_GROUP, 2), uid(FETCH_LAYER_GROUP, 1), FETCH_SPINNER_GRAPHIC, 10, 1000, 3000, 512, 1024, 0, 3, "Fetching your clan data...");
  later(FETCH_TICKS, () => {
    // Walking off closes the chatbox, and with it this.
    if (!Core.isOnline(player) || !player.getPacketSender().isChatboxInterface(FETCH_LAYER_GROUP)) return;
    player.getPacketSender().closeInterface(FETCH_LAYER_GROUP);
    if (Core.clanOf(player) === clan) openApplicants(player, clan);
  });
}

function settleApplicant(player, clan, accept) {
  const chosen = selectedApplicant.get(player);
  if (!chosen || !(clan.applicants ?? []).includes(chosen)) return;
  if (accept && clan.members.length >= Core.MAX_MEMBERS) {
    player.sendMessage("Your clan is full.");
    return;
  }
  clan.applicants = clan.applicants.filter((entry) => entry !== chosen);
  selectedApplicant.delete(player);
  const online = Core.onlinePlayer(chosen.account);
  online?.getPacketSender().sendVarbit(APPLYING_VARBIT, 0);
  if (!accept) {
    Store.save();
    online?.sendMessage(`Your application to ${clan.name} has been declined.`);
  } else if (online && !Core.clanOf(online)) {
    discard(online);
    Core.addMember(clan, online);
    player.sendMessage(`You have accepted ${chosen.name} into ${clan.name}.`);
  } else if (!online && !Store.byMember(chosen.account)) {
    Core.addOfflineMember(clan, chosen.account, chosen.name);
    player.sendMessage(`You have accepted ${chosen.name} into ${clan.name}.`);
  } else {
    Store.save();
    player.sendMessage(`${chosen.name} can't join: they are already in a clan.`);
  }
  openApplicants(player, clan);
}

function askApplyMinimum(player, clan, key, title) {
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(value) {
      clan[key] = value;
      Store.save();
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

function clickApplicants(event) {
  if (event.groupId !== APPLICANTS_GROUP) return;
  const { player, childId, action } = event;
  event.handled = true;
  const clan = Core.clanOf(player);
  if (!clan) return;
  if (childId === APPLICANT_LIST) {
    const chosen = (clan.applicants ?? [])[action];
    selectedApplicant.set(player, chosen);
    player.getPacketSender().sendClientScript(APPLICANT_INFO_SCRIPT, chosen?.stats ?? "");
    return;
  }
  if (childId !== APPLICANT_BUTTONS) return;
  if (action === BUTTON_BOARD) openBoard(player);
  else if (action === BUTTON_REFRESH) openApplicants(player, clan);
  else if (!canRecruit(player, clan)) player.sendMessage("You are not a high enough rank to do that.");
  else if (action === BUTTON_ACCEPT) settleApplicant(player, clan, true);
  else if (action === BUTTON_DECLINE) settleApplicant(player, clan, false);
  else if (action === BUTTON_INVITE) toggleInviting(player, clan);
  else if (action === BUTTON_MIN_COMBAT) askApplyMinimum(player, clan, "applyMinCombat", "Enter the minimum combat level:");
  else if (action === BUTTON_MIN_TOTAL) askApplyMinimum(player, clan, "applyMinTotal", "Enter the minimum total level:");
}

/** rsprox 2778 tick 181; the line for turning it off is ours. */
function toggleInviting(player, clan) {
  clan.inviting = !clan.inviting;
  Store.save();
  for (const member of clan.members) {
    Core.onlinePlayer(member.account)?.getPacketSender().sendVarbit(Core.RECRUITER_VARBIT, clan.inviting ? 1 : 0);
  }
  messageBox(player, clan.inviting
    ? "You are now inviting applications to this clan.<br>Remember to turn this option off when you've finished!"
    : "You are no longer inviting applications to this clan.");
  player.getPacketSender().closeSubInterface(MODAL_UID);
}

// ---------------------------------------------------------------- the recruitment board

const boardFilters = new WeakMap();

/** Interests a clan must and mustn't list: the green and red marks (clan_board_filterupdate). */
function filtersOf(player) {
  return boardFilters.get(player) ?? { wanted: 0, unwanted: 0 };
}

function boardClans(player) {
  const { wanted, unwanted } = filtersOf(player);
  return [...Store.all()]
    .filter((clan) => {
      const interests = Core.settingValue(clan, INTERESTS_SETTING);
      return clan.inviting && (interests & wanted) === wanted && (interests & unwanted) === 0;
    })
    .slice(0, BOARD_ROWS);
}

/** clan_board_addline's fields: name, size, created, its sort key, interests, then the minimums. */
function boardRow(clan) {
  const interests = interestNamesFor(clan).join(", ") || "No interests listed";
  return [clan.name, clan.members.length, runeDateText(clan.creationTime), clan.creationTime, interests, clan.applyMinCombat ?? 0, clan.applyMinTotal ?? 0].join("|");
}

function sendBoardFilters(player) {
  const { wanted, unwanted } = filtersOf(player);
  player.getPacketSender().sendConfig(BOARD_WANTED_VARP, wanted).sendConfig(BOARD_UNWANTED_VARP, unwanted);
}

/** Each click moves on: nothing, wanted, unwanted. */
function clickFilter(player, interest) {
  const bit = 1 << interest;
  const { wanted, unwanted } = filtersOf(player);
  if (wanted & bit) boardFilters.set(player, { wanted: wanted & ~bit, unwanted: unwanted | bit });
  else if (unwanted & bit) boardFilters.set(player, { wanted, unwanted: unwanted & ~bit });
  else boardFilters.set(player, { wanted: wanted | bit, unwanted });
  listBoard(player);
}

function listBoard(player) {
  sendBoardFilters(player);
  const sender = player.getPacketSender();
  const clans = boardClans(player);
  for (let row = 0; row < BOARD_ROWS; row++) {
    sender.sendClientScript(BOARD_ROW_SCRIPT, row, clans[row] ? boardRow(clans[row]) : "", 0);
  }
}

/** The object's View (rsprox 2778 tick 58) and its rows. */
function openBoard(player) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(MODAL_UID, BOARD_GROUP, 0);
  sender
    .sendInterfaceFlagsRange(uid(BOARD_GROUP, BOARD_LIST), 0, LAST_BOARD_ENTRY, PAUSE_FLAG)
    .sendInterfaceFlagsRange(uid(BOARD_GROUP, BOARD_FILTERS), 0, LAST_BOARD_FILTER, PAUSE_FLAG)
    .sendInterfaceFlagsRange(uid(BOARD_GROUP, BOARD_BUTTONS), 0, LAST_BOARD_BUTTON, PAUSE_FLAG);
  listBoard(player);
}

function clickBoard(event) {
  if (event.groupId !== BOARD_GROUP) return;
  const { player, childId, action } = event;
  event.handled = true;
  if (childId === BOARD_BUTTONS && action === BOARD_MY_CLAN) {
    const clan = Core.clanOf(player);
    if (!clan) player.sendMessage("You are not in a clan.");
    else if (!clan.inviting) {
      messageBox(player, "You should start inviting applications first.<br>Remember to turn this option off when you've finished!");
      player.getPacketSender().closeSubInterface(MODAL_UID);
    } else fetchApplicants(player, clan);
  } else if (childId === BOARD_BUTTONS && action === BOARD_REFRESH) {
    openBoard(player);
  } else if (childId === BOARD_BUTTONS && action === BOARD_RESET) {
    boardFilters.delete(player);
    listBoard(player);
  } else if (childId === BOARD_FILTERS) {
    clickFilter(player, action);
  } else if (childId === BOARD_BUTTONS && action === BOARD_APPLICANTS) {
    const clan = Core.clanOf(player);
    if (clan) fetchApplicants(player, clan);
    else player.sendMessage("You are not in a clan.");
  } else if (childId === BOARD_LIST) {
    const clan = boardClans(player)[Math.floor(action / 2)];
    if (clan) {
      player.getPacketSender().sendInterfaceRemoval();
      viewClan(player, clan);
    }
  }
}

module.exports = {
  applicantOf,
  clickApplicants,
  clickBoard,
  clickGuestPanel,
  discard,
  fetchApplicants,
  guestRefusal,
  init,
  openApplicants,
  openBoard,
  toggleApplication,
};
