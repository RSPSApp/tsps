"use strict";

/**
 * Ver Sinhaza: the notice board's party list (364) and party information (50), the party HUD
 * (28) while there, and the theatre's entrance.
 *
 * Captured: the interfaces (364 the list, 50 the party, 28 the HUD) and the scripts that fill
 * them (2340 a list row, 2317/2321 member and applicant lines, 2323 the footer), "Your
 * leader, <name>, must go first.". Estimates: the interfaces' buttons, the rest of the
 * entrance's warnings and questions, and leaving Ver Sinhaza taking a player out of their
 * party or application.
 * The cache confirms each script's arguments. Wiki: escape crystals are the only way out of
 * the theatre and the Mysterious Stranger sells them, so the entrance offers his shop.
 */

const Shared = require("./TobShared");
const Parties = require("./TobParties");
const Raid = require("./TobRaid");

const { INTERFACE, SCRIPT, VARP, VARBIT } = Shared;
const { RIGHTS } = Parties;

const uid = (group, component) => (group << 16) | component;
/**
 * The buttons on both interfaces are pause buttons: scripts 890/2319/2327/2330 resume a child
 * of a parent component, so a click arrives as RESUME_PAUSEBUTTON (an interface action click
 * with the child in `action`), never as a button op.
 * 364: Refresh, My/Make Party and Friends/Clan (components 64, 66, 67) resume children 0-2 of
 * component 3 (enum 1938). The rows are components 18-62 (enum 1937), each with a plain op
 * "View party" (script 5220).
 */
const LIST_BUTTONS_UID = uid(INTERFACE.PARTIES_OVERVIEW, 3);
const LIST_ROW_FIRST = 18;
const LIST_ROW_UIDS = Array.from({ length: Shared.LIST_ROWS }, (_, row) => uid(INTERFACE.PARTIES_OVERVIEW, LIST_ROW_FIRST + row));
const LIST_BUTTON = { REFRESH: 0, MY_PARTY: 1, FILTER: 2 };
/**
 * 50: every button resumes a child of component 0. The buttons by enum 1939, then members'
 * Kick/Quit (7 + row, script 2319), applicants' Accept (12 + row) and Decline (22 + row,
 * script 2330).
 */
const INFO_UID = uid(INTERFACE.PARTY_INFORMATION, 0);
const INFO_BUTTON = {
  BACK: 0, REFRESH: 1, UNBLOCK: 2, SIZE: 3, COMBAT: 4, PRIMARY: 5, MODE: 6,
  MEMBER_FIRST: 7, ACCEPT_FIRST: 12, DECLINE_FIRST: 22,
};
const OP1 = 1 << 1;
const MYSTERIOUS_STRANGER_SHOP = 1240;
const ATTR = {
  VIEWING: "tob:viewing",
  WARNED: "tob:death-warning",
  NO_CRYSTAL_PROMPT: "tob:no-crystal-prompt",
};
const ESCAPE_CRYSTALS = [Shared.ITEM.ESCAPE_CRYSTAL];

// ---------------------------------------------------------------- the HUD in Ver Sinhaza

/** The HUD lists the party's names (component 12) and varbit 6440 (tob_client_partystatus) says 1. */
function refreshHud(player) {
  const party = Parties.partyOf(player);
  const sender = player.getPacketSender();
  sender.sendSubInterface(Shared.OVERLAY_HUD_UID, INTERFACE.PARTY_HUD, 1);
  sender.sendVarbit(VARBIT.PARTY_STATE, party ? 1 : 0);
  const lines = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) =>
    (party?.members[i] ? Shared.displayName(party.members[i]) : "-"));
  sender.sendString(`${lines.join("<br>")}<br>`, uid(INTERFACE.PARTY_HUD, 12));
}

function refreshParty(party) {
  if (!party) return;
  for (const member of party.members) {
    refreshHud(member);
    if (isViewing(member, party)) openInformation(member, party);
  }
  for (const applicant of party.applicants) {
    if (isViewing(applicant, party)) openInformation(applicant, party);
  }
}

function enterVerSinhaza({ player }) {
  if (Raid.raidOf(player)) return;
  refreshHud(player);
  Shared.fade(player, 200);
}

/** Leaving Ver Sinhaza (other than into the theatre) leaves a party or withdraws an application. */
function leaveVerSinhaza({ player }) {
  if (Raid.raidOf(player)) return;
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
  player.getPacketSender().sendVarbit(VARBIT.PARTY_STATE, 0);
  leaveParty(player);
  const applied = Parties.applicationOf(player);
  if (applied) {
    applied.withdraw(player);
    refreshParty(applied);
  }
}

function leaveParty(player) {
  const party = Parties.partyOf(player);
  if (!party || party.raid) return;
  party.remove(player);
  refreshParty(party);
  refreshHud(player);
}

// ---------------------------------------------------------------- 364: the party list

function isViewing(player, party) {
  return player.getAttribute(ATTR.VIEWING) === party.id;
}

/** A row: the five names (the viewer's own leader in white), size, preferences, mode and age. */
function rowText(party, viewer) {
  const names = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) => {
    const member = party.members[i];
    if (!member) return "";
    const name = Shared.displayName(member);
    return i === 0 && party.has(viewer) ? `<col=ffffff>${name}</col>` : name;
  });
  return `${names.join("|")}|${party.members.length}|${party.preferredSize}|${party.preferredCombat}|${Shared.MODES[party.mode].name}|${party.age()}|`;
}

function openOverview(player) {
  const sender = player.getPacketSender();
  player.setAttribute(ATTR.VIEWING, null);
  sender.sendConfig(VARP.HAS_PARTY, Parties.partyOf(player) ? 0 : -1);
  sender.sendInterface(INTERFACE.PARTIES_OVERVIEW);
  const listed = Parties.listed();
  for (let index = 0; index < Shared.LIST_ROWS; index++) {
    const party = listed[index];
    sender.sendClientScript(SCRIPT.PARTY_ROW, index, party ? rowText(party, player) : "");
  }
  for (const rowUid of LIST_ROW_UIDS) sender.sendInterfaceFlags(rowUid, OP1);
}

function slotOf(event) {
  return Number.isInteger(event.slot) && event.slot >= 0 && event.slot < 0xffff ? event.slot : -1;
}

function clickListButton(event) {
  const { player } = event;
  const slot = slotOf(event);
  if (slot === LIST_BUTTON.REFRESH) {
    openOverview(player);
  } else if (slot === LIST_BUTTON.MY_PARTY) {
    if (Raid.raidOf(player)) return;
    const party = Parties.partyOf(player) ?? Parties.create(player);
    const applied = Parties.applicationOf(player);
    if (applied && applied !== party) {
      applied.withdraw(player);
      refreshParty(applied);
    }
    openInformation(player, party);
    refreshHud(player);
  } else if (slot === LIST_BUTTON.FILTER) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT.LIST_FILTER, sender.getVarbit(VARBIT.LIST_FILTER) ? 0 : 1);
    openOverview(player);
  }
}

function selectRow(event) {
  const party = Parties.listed()[(event.buttonId & 0xffff) - LIST_ROW_FIRST];
  if (party) openInformation(event.player, party);
  else openOverview(event.player);
}

// ---------------------------------------------------------------- 50: a party's information

/** A member's line: name, combat, attack, strength, ranged, magic, defence, hitpoints, prayer, completions. */
function memberLine(player) {
  const { Skill } = Shared.core();
  const skills = player.getSkillManager();
  const levels = [Skill.ATTACK, Skill.STRENGTH, Skill.RANGED, Skill.MAGIC, Skill.DEFENCE, Skill.HITPOINTS, Skill.PRAYER]
    .map((skill) => skills.getMaxLevel(skill));
  const completions = Number(player.getAttribute("tob:completions")) || 0;
  return `${Shared.displayName(player)}|${skills.getCombatLevel()}|${levels.join("|")}|${completions}|`;
}

function openInformation(player, party) {
  if (Raid.raidOf(player)) return;
  const sender = player.getPacketSender();
  player.setAttribute(ATTR.VIEWING, party.id);
  sender.sendInterface(INTERFACE.PARTY_INFORMATION);
  for (let index = 0; index < Shared.MAX_PARTY_SIZE; index++) {
    const member = party.members[index];
    sender.sendClientScript(SCRIPT.PARTY_MEMBER, 2, member ? memberLine(member) : "");
  }
  if (party.has(player) || party.applicants.includes(player)) {
    for (const applicant of party.applicants) sender.sendClientScript(SCRIPT.PARTY_APPLICANT, memberLine(applicant));
  }
  sender.sendClientScript(SCRIPT.PARTY_FOOTER, party.rightsOf(player), party.preferredSize, party.preferredCombat, 0);
}

function viewedParty(player) {
  const id = player.getAttribute(ATTR.VIEWING);
  return id ? Parties.byId(id) : null;
}

function promptNumber(player, title, maximum, apply) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({ execute: (value) => apply(Math.max(0, Math.min(maximum, value | 0))) });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

/** Apply, withdraw, leave or (the leader) disband, by the viewer's rights. */
function primaryAction(player, party) {
  const rights = party.rightsOf(player);
  if (rights === RIGHTS.LEADER) {
    const members = [...party.members];
    const applicants = [...party.applicants];
    party.dispose();
    for (const member of members) {
      member.sendMessage("Your party has disbanded.");
      refreshHud(member);
      if (isViewing(member, party)) openOverview(member);
    }
    for (const applicant of applicants) if (isViewing(applicant, party)) openOverview(applicant);
  } else if (rights === RIGHTS.MEMBER) {
    leaveParty(player);
    openOverview(player);
  } else if (rights === RIGHTS.APPLICANT) {
    party.withdraw(player);
    refreshParty(party);
    openInformation(player, party);
  } else if (rights === RIGHTS.CAN_APPLY) {
    const current = Parties.partyOf(player);
    if (current) {
      player.getPacketSender().sendInterfaceRemoval();
      player.sendMessage("You cannot apply for this party if you're already in another one.");
      Shared.options(player, "You are already in a party.",
        "Stay in my existing party.", () => openInformation(player, party),
        "Quit that one and apply to this one.", () => {
          leaveParty(player);
          apply(player, party);
        });
      return;
    }
    apply(player, party);
  } else if (rights === RIGHTS.BLOCKED) {
    player.getPacketSender().sendInterfaceRemoval();
    Shared.statement(player, "You have been declined by this party.");
  }
}

function apply(player, party) {
  if (party.raid || !Parties.byId(party.id)) return;
  if (party.applicants.length >= Shared.MAX_APPLICANTS) {
    player.sendMessage("There are too many applicants for this party at the moment.");
    openInformation(player, party);
    return;
  }
  const before = Parties.applicationOf(player);
  party.apply(player);
  if (before && before !== party) refreshParty(before);
  refreshParty(party);
  openInformation(player, party);
}

function answerApplicant(player, party, index, accept) {
  const applicant = party.applicants[index];
  if (!applicant) {
    openInformation(player, party);
    return;
  }
  if (accept) {
    if (party.members.length >= Shared.MAX_PARTY_SIZE) {
      player.sendMessage("Your raiding party is already full.");
      openInformation(player, party);
      return;
    }
    if (Parties.partyOf(applicant)) {
      party.withdraw(applicant);
      player.getPacketSender().sendInterfaceRemoval();
      Shared.statement(player, `${Shared.displayName(applicant)} appears to have joined another party.`);
      return;
    }
    party.accept(applicant);
  } else {
    party.decline(applicant);
    applicant.sendMessage(`Your application to the party of ${Shared.displayName(party.leader)} has been declined.`);
  }
  refreshParty(party);
  if (isViewing(applicant, party)) openInformation(applicant, party);
}

function clickInformation(event) {
  const { player } = event;
  const slot = slotOf(event);
  const party = viewedParty(player);
  if (slot === INFO_BUTTON.BACK || !party) {
    openOverview(player);
    return;
  }
  const leader = party.isLeader(player);
  if (slot === INFO_BUTTON.REFRESH) {
    openInformation(player, party);
  } else if (slot === INFO_BUTTON.PRIMARY) {
    primaryAction(player, party);
  } else if (slot === INFO_BUTTON.UNBLOCK && leader) {
    party.blocked.clear();
    refreshParty(party);
  } else if (slot === INFO_BUTTON.SIZE && leader) {
    promptNumber(player, "Set a preferred party size (or 0 to clear it)", Shared.MAX_PARTY_SIZE, (value) => {
      party.preferredSize = value;
      refreshParty(party);
    });
  } else if (slot === INFO_BUTTON.COMBAT && leader) {
    promptNumber(player, "Set a preferred combat level (or 0 to clear it)", 126, (value) => {
      party.preferredCombat = value;
      refreshParty(party);
    });
  } else if (slot === INFO_BUTTON.MODE) {
    player.sendMessage("Only Normal Mode is available.");
    openInformation(player, party);
  } else if (slot >= INFO_BUTTON.MEMBER_FIRST && slot < INFO_BUTTON.ACCEPT_FIRST && leader) {
    const member = party.members[slot - INFO_BUTTON.MEMBER_FIRST];
    if (!member) {
      openInformation(player, party);
      return;
    }
    if (member === player) {
      primaryAction(player, party);
      return;
    }
    member.sendMessage("You have been removed from the party.");
    leaveParty(member);
    refreshParty(party);
  } else if (slot >= INFO_BUTTON.ACCEPT_FIRST && slot < INFO_BUTTON.DECLINE_FIRST && leader) {
    answerApplicant(player, party, slot - INFO_BUTTON.ACCEPT_FIRST, true);
  } else if (slot >= INFO_BUTTON.DECLINE_FIRST && slot < INFO_BUTTON.DECLINE_FIRST + Shared.MAX_APPLICANTS && leader) {
    answerApplicant(player, party, slot - INFO_BUTTON.DECLINE_FIRST, false);
  } else {
    // The client waits on a pause button until the interface is redrawn.
    openInformation(player, party);
  }
}

/** A pause button on either interface: its parent and the child resumed. */
function resumeButton(event) {
  if (event.buttonId === LIST_BUTTONS_UID) clickListButton({ player: event.player, slot: event.action });
  else if (event.buttonId === INFO_UID) clickInformation({ player: event.player, slot: event.action });
  else return;
  event.handled = true;
}

// ---------------------------------------------------------------- the notice board and entrance

function readNoticeBoard({ player }) {
  openOverview(player);
  return true;
}

function hasEscapeCrystal(player) {
  return ESCAPE_CRYSTALS.some((id) => player.getInventory().contains(id) || player.getEquipment().contains?.(id));
}

/**
 * The theatre's entrance: no party opens the list; the leader goes first; the first time,
 * a warning about deaths; without an escape crystal, an offer to buy one.
 */
function useEntrance(event) {
  const { player } = event;
  const party = Parties.partyOf(player);
  if (!party) {
    Shared.options(player, "You are not in a party...",
      "Form or join a party", () => openOverview(player),
      "Cancel", () => {});
    return true;
  }
  if (!party.isLeader(player) && !party.raid) {
    Shared.statement(player, `Your leader, ${Shared.displayName(party.leader)}, must go first.`);
    return true;
  }
  if (!player.getAttribute(ATTR.WARNED)) {
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Shared.core();
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, "<col=ff0000>Warning:</col> The Theatre of Blood is <col=ff0000>dangerous.</col> Once you enter, you are at <col=ff0000>risk of death</col>. The only method of escape is to resign or defeat the Theatre. <col=ff0000>Teleporting is restricted</col>, and <col=ff0000>logging out is considered a death</col>. Your <col=ff0000>items will be lost</col> if the whole party dies."),
      new StatementDialogue(1, "You will not see the warning again should you accept."),
      new ActionDialogue(2, {
        execute: () => Shared.options(player, "Accept the warning and proceed?",
          "Yes - proceed.", () => {
            player.setAttribute(ATTR.WARNED, true);
            askAboutCrystals(player, party);
          },
          "No - stay out.", () => {}),
      }),
    ));
    return true;
  }
  askAboutCrystals(player, party);
  return true;
}

function askAboutCrystals(player, party) {
  if (hasEscapeCrystal(player) || player.getAttribute(ATTR.NO_CRYSTAL_PROMPT)) {
    enterTheatre(player, party);
    return;
  }
  Shared.options(player, "<col=ff0000>Only escape crystals can teleport out of the Theatre.</col>",
    "Go and buy escape crystals.", () => Shared.core().ShopManager.open(player, MYSTERIOUS_STRANGER_SHOP),
    "Enter the Theatre without any escape crystals.", () => enterTheatre(player, party),
    "Enter the Theatre, and don't ask this again.", () => {
      player.setAttribute(ATTR.NO_CRYSTAL_PROMPT, true);
      enterTheatre(player, party);
    });
}

function enterTheatre(player, party) {
  if (party.raid) {
    party.raid.enter(player);
    return;
  }
  Shared.options(player, `Is your party ready? (Members: ${party.members.length})`,
    "Yes, let's go!", () => {
      if (party.raid || !party.isLeader(player)) return;
      Raid.begin(player)?.enter(player);
    },
    "Cancel.", () => {});
}

/** Logging out in Ver Sinhaza leaves the party too (the HUD and lists follow). */
function logoutFromLobby({ player }) {
  if (Raid.raidOf(player)) return;
  leaveParty(player);
  const applied = Parties.applicationOf(player);
  if (applied) {
    applied.withdraw(player);
    refreshParty(applied);
  }
}

module.exports = function registerTheatreLobby(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR.WARNED);
  api.persistAttribute(ATTR.NO_CRYSTAL_PROMPT);
  api.onZoneEnter(Shared.VER_SINHAZA, enterVerSinhaza);
  api.onZoneExit(Shared.VER_SINHAZA, leaveVerSinhaza);
  api.onPlayerLogout(logoutFromLobby);
  Shared.onObject(api, Shared.OBJECT.NOTICE_BOARD, readNoticeBoard);
  Shared.onObject(api, Shared.OBJECT.ENTRANCE, useEntrance);
  api.onInterfaceActionClick(resumeButton);
  api.onInterfaceActionButton(LIST_ROW_UIDS, selectRow);
};

Object.assign(module.exports, {
  ATTR, openOverview, openInformation, rowText, memberLine, clickListButton, selectRow, clickInformation, resumeButton,
  LIST_ROW_UIDS,
  useEntrance, refreshHud, leaveParty,
});
