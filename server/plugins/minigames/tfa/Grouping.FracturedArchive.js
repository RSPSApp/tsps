"use strict";

/**
 * The Grouping Board (Inspect): the party list (tfa_partylist, 977) and a party's details
 * (tfa_partydetails, 976), and the lobby overlay's party names (tfa_lobby, 975).
 *
 * Captured: opening the list, Make Party, the details screen's refresh, tab and accept clicks,
 * tfa_mycontroller (5913) and tfa_client_partystatus (16386). The cache scripts give the rest
 * (docs/fractured-archive.md): both screens count their rows from their onload script, so every
 * redraw opens the interface again, as live does; the details screen asks for a refresh (sub 1)
 * every ~17 ticks by itself. Not captured (our wording): the prompts and refusals.
 */

const Shared = require("./Shared.FracturedArchive");
const Parties = require("./Parties.FracturedArchive");

const { SCRIPT } = Shared;
const { RIGHTS } = Parties;

/** 977:1's buttons (enum 6059). */
const LIST_BUTTON = { REFRESH: 0, MY_PARTY: 1, FILTER: 2 };
/** 976:1's buttons (enum 6057 and the row scripts). */
const DETAILS_BUTTON = {
  BACK: 0, REFRESH: 1, UNBLOCK: 2, SIZE: 3, COMPLETIONS: 4, MODE: 5, PRIMARY: 6,
  MEMBERS_TAB: 7, APPLICANTS_TAB: 8, SPECTATING: 9,
  KICK_FIRST: 10, MOVE_UP_FIRST: 18, MOVE_DOWN_FIRST: 26, ACCEPT_FIRST: 34, REJECT_FIRST: 41,
};
const DETAILS_BUTTON_LAST = 47;
/** The details screen's panels (10060's last argument): new parties open on the applicants. */
const TAB = { MEMBERS: 0, APPLICANTS: 1 };
const PAUSEBUTTON = 1 << 0;

const ATTR = {
  /** The party whose details the player has open (not saved). */
  VIEWING: "fractured-archive:viewing-party",
  TAB: "fractured-archive:details-tab",
  /** The list's Friends/Clan Only filter (varbit 16380, which the row script reads). */
  FRIENDS_FILTER: "fractured-archive:friends-filter",
  /** Completions, shown on the details screen (saved; phase 1 has no completion yet). */
  COMPLETIONS: "fractured-archive:completions",
};

// ---------------------------------------------------------------- the lobby overlay

/** 975:5 lists the party's eight slots, "-" where empty; 16386 says 0 no party, 1 party, 2 go in. */
function refreshOverlay(player) {
  const party = Parties.partyOf(player);
  const sender = player.getPacketSender();
  const lines = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) =>
    (party?.members[i] ? Shared.displayName(party.members[i]) : "-"));
  sender.sendString(lines.join("<br>"), Shared.id("component", "LOBBY_NAMES"));
  sender.sendVarbit(Shared.id("varbit", "PARTY_STATUS"), !party ? 0 : party.raid?.canJoin() ? 2 : 1);
  sender.sendConfig(Shared.id("varp", "CONTROLLER"), party ? party.controller : -1);
}

function refreshParty(party) {
  if (!party) return;
  for (const member of party.members) {
    if (party.raid?.hasMember(member)) continue;
    refreshOverlay(member);
    if (isViewing(member, party)) openDetails(member, party);
  }
  for (const applicant of party.applicants) {
    if (isViewing(applicant, party)) openDetails(applicant, party);
  }
}

/** Out of the party, unless already inside the Archive with it (the raid handles that). */
function leaveParty(player) {
  const party = Parties.partyOf(player);
  if (!party || party.raid?.hasMember(player)) return;
  party.remove(player);
  party.raid?.dropFromRoster(player);
  refreshParty(party);
  refreshOverlay(player);
}

/** Leaving the lobby (or logging out there) leaves a party and withdraws an application. */
function leaveLobby(player) {
  leaveParty(player);
  const applied = Parties.applicationOf(player);
  if (applied) {
    applied.withdraw(player);
    refreshParty(applied);
  }
}

// ---------------------------------------------------------------- 977: the party list

function isViewing(player, party) {
  return player.getAttribute(ATTR.VIEWING) === party.id;
}

function completionsOf(player) {
  return Number(player.getAttribute(ATTR.COMPLETIONS)) || 0;
}

/** A row: the eight names (leader first), members, preferred size and completions, mode, age. */
function rowText(party) {
  const names = Array.from({ length: Shared.MAX_PARTY_SIZE }, (_, i) =>
    (party.members[i] ? Shared.displayName(party.members[i]) : ""));
  const mode = party.mode === Parties.MODE.PRACTICE ? "Practice" : "Normal";
  return `${names.join("|")}|${party.members.length}|${party.preferredSize}|${party.preferredCompletions}|${mode}|${party.age()}`;
}

function openList(player) {
  const sender = player.getPacketSender();
  player.setAttribute(ATTR.VIEWING, null);
  refreshOverlay(player);
  sender.sendInterface(Shared.id("iface", "PARTY_LIST"));
  const listed = Parties.listed();
  // The row with index 44 lays the list out, so it goes last.
  for (let row = 0; row < Shared.LIST_ROWS; row++) {
    const party = listed[row];
    sender.sendClientScript(SCRIPT.PARTY_ROW, row, party ? rowText(party) : "");
  }
  sender.sendInterfaceFlagsRange(Shared.id("component", "LIST_CONTENTS"), 0, 2, PAUSEBUTTON);
  sender.sendInterfaceFlagsRange(Shared.id("component", "LIST_ROWS"), 0, Shared.LIST_ROWS - 1, PAUSEBUTTON);
}

function clickList(player, slot) {
  if (slot === LIST_BUTTON.MY_PARTY) {
    let party = Parties.partyOf(player);
    if (!party) {
      party = Parties.create(player);
      player.setAttribute(ATTR.TAB, TAB.APPLICANTS);
      refreshOverlay(player);
    }
    openDetails(player, party);
  } else if (slot === LIST_BUTTON.FILTER) {
    const on = player.getAttribute(ATTR.FRIENDS_FILTER) === true;
    player.setAttribute(ATTR.FRIENDS_FILTER, !on);
    player.getPacketSender().sendVarbit(Shared.id("varbit", "FRIENDS_FILTER"), on ? 0 : 1);
    openList(player);
  } else {
    openList(player);
  }
}

/** A row clicked: the sub is the row index the script was sent with. */
function selectRow(player, row) {
  const party = Parties.listed()[row];
  if (!party) {
    openList(player);
    return;
  }
  openDetails(player, party);
}

// ---------------------------------------------------------------- 976: a party's details

/** name|combat|attack|strength|ranged|magic|defence|hitpoints|prayer|completions|practice. */
function memberLine(player) {
  const { Skill } = Shared.core();
  const skills = player.getSkillManager();
  const levels = [Skill.ATTACK, Skill.STRENGTH, Skill.RANGED, Skill.MAGIC, Skill.DEFENCE, Skill.HITPOINTS, Skill.PRAYER]
    .map((skill) => skills.getMaxLevel(skill));
  return `${Shared.displayName(player)}|${skills.getCombatLevel()}|${levels.join("|")}|${completionsOf(player)}|0`;
}

function openDetails(player, party) {
  if (party.raid?.hasMember(player)) return;
  const sender = player.getPacketSender();
  const rights = party.rightsOf(player);
  player.setAttribute(ATTR.VIEWING, party.id);
  sender.sendInterface(Shared.id("iface", "PARTY_DETAILS"));
  // Eight member rows, leader first: the footer counts applicants from the ninth row on.
  for (let index = 0; index < Shared.MAX_PARTY_SIZE; index++) {
    const member = party.members[index];
    sender.sendClientScript(SCRIPT.PARTY_MEMBER, rights, member ? memberLine(member) : "");
  }
  for (const applicant of party.applicants.slice(0, Parties.APPLICANT_ROWS)) {
    sender.sendClientScript(SCRIPT.PARTY_APPLICANT, memberLine(applicant));
  }
  const tab = player.getAttribute(ATTR.TAB) ?? TAB.MEMBERS;
  sender.sendClientScript(SCRIPT.PARTY_FOOTER, rights, party.preferredCompletions, party.mode, party.preferredSize,
    party.spectating ? 0 : 1, tab);
  sender.sendInterfaceFlagsRange(Shared.id("component", "DETAILS_BUTTONS"), 0, DETAILS_BUTTON_LAST, PAUSEBUTTON);
}

function viewedParty(player) {
  const viewing = player.getAttribute(ATTR.VIEWING);
  return viewing ? Parties.byId(viewing) : null;
}

function promptNumber(player, title, maximum, apply) {
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({ execute: (value) => apply(Math.max(0, Math.min(maximum, value | 0))) });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

/** Disband, leave, withdraw or apply, by the viewer's rights (976:56). */
function primaryAction(player, party) {
  const rights = party.rightsOf(player);
  if (rights === RIGHTS.LEADER) {
    const applicants = [...party.applicants];
    for (const member of party.disband()) {
      if (member !== player) member.sendMessage("Your party has disbanded.");
      refreshOverlay(member);
      if (isViewing(member, party)) openList(member);
    }
    for (const applicant of applicants) if (isViewing(applicant, party)) openList(applicant);
  } else if (rights === RIGHTS.MEMBER) {
    leaveParty(player);
    openList(player);
  } else if (rights === RIGHTS.APPLICANT) {
    party.withdraw(player);
    refreshParty(party);
    openDetails(player, party);
  } else if (rights === RIGHTS.CAN_APPLY) {
    if (Parties.partyOf(player)) {
      player.getPacketSender().sendInterfaceRemoval();
      Shared.options(player, "You are already in a party.",
        "Stay in my existing party.", () => openDetails(player, party),
        "Quit that one and apply to this one.", () => {
          leaveParty(player);
          apply(player, party);
        });
      return;
    }
    apply(player, party);
  } else {
    openDetails(player, party);
  }
}

function apply(player, party) {
  if (party.raid || !Parties.byId(party.id)) return;
  const before = Parties.applicationOf(player);
  if (!party.apply(player)) {
    player.sendMessage("You can't apply to this party right now.");
    openDetails(player, party);
    return;
  }
  if (before && before !== party) refreshParty(before);
  refreshParty(party);
  openDetails(player, party);
}

function answerApplicant(player, party, index, accept) {
  const applicant = party.applicants[index];
  if (!applicant) {
    openDetails(player, party);
    return;
  }
  if (accept) {
    if (party.isFull()) {
      player.sendMessage("Your party is already full.");
    } else if (Parties.partyOf(applicant)) {
      party.withdraw(applicant);
      player.sendMessage(`${Shared.displayName(applicant)} appears to have joined another party.`);
    } else {
      party.accept(applicant);
      refreshOverlay(applicant);
    }
  } else {
    party.reject(applicant);
    applicant.sendMessage(`Your application to the party of ${Shared.displayName(party.leader)} has been rejected.`);
  }
  refreshParty(party);
  if (isViewing(applicant, party)) openDetails(applicant, party);
}

function clickDetails(player, slot) {
  const party = viewedParty(player);
  if (slot === DETAILS_BUTTON.BACK || !party) {
    openList(player);
    return;
  }
  const leader = party.isLeader(player);
  if (slot === DETAILS_BUTTON.PRIMARY) {
    primaryAction(player, party);
  } else if (slot === DETAILS_BUTTON.UNBLOCK && leader) {
    party.blocked.clear();
    refreshParty(party);
  } else if (slot === DETAILS_BUTTON.SIZE && leader) {
    promptNumber(player, "Set a preferred party size (or 0 to clear it)", Shared.MAX_PARTY_SIZE, (value) => {
      party.preferredSize = value;
      refreshParty(party);
    });
  } else if (slot === DETAILS_BUTTON.COMPLETIONS && leader) {
    promptNumber(player, "Set a preferred number of completions (or 0 to clear it)", 9999, (value) => {
      party.preferredCompletions = value;
      refreshParty(party);
    });
  } else if (slot === DETAILS_BUTTON.MEMBERS_TAB || slot === DETAILS_BUTTON.APPLICANTS_TAB) {
    player.setAttribute(ATTR.TAB, slot === DETAILS_BUTTON.MEMBERS_TAB ? TAB.MEMBERS : TAB.APPLICANTS);
    openDetails(player, party);
  } else if (slot === DETAILS_BUTTON.SPECTATING && leader) {
    party.spectating = !party.spectating;
    refreshParty(party);
  } else if (slot >= DETAILS_BUTTON.KICK_FIRST && slot < DETAILS_BUTTON.MOVE_UP_FIRST && leader) {
    const member = party.members[slot - DETAILS_BUTTON.KICK_FIRST];
    if (member === player) {
      primaryAction(player, party);
      return;
    }
    if (member) {
      member.sendMessage("You have been removed from the party.");
      leaveParty(member);
    }
    refreshParty(party);
  } else if (slot >= DETAILS_BUTTON.MOVE_UP_FIRST && slot < DETAILS_BUTTON.ACCEPT_FIRST && leader) {
    const up = slot < DETAILS_BUTTON.MOVE_DOWN_FIRST;
    party.move(slot - (up ? DETAILS_BUTTON.MOVE_UP_FIRST : DETAILS_BUTTON.MOVE_DOWN_FIRST), up ? -1 : 1);
    refreshParty(party);
  } else if (slot >= DETAILS_BUTTON.ACCEPT_FIRST && slot < DETAILS_BUTTON.REJECT_FIRST && leader) {
    answerApplicant(player, party, slot - DETAILS_BUTTON.ACCEPT_FIRST, true);
  } else if (slot >= DETAILS_BUTTON.REJECT_FIRST && slot <= DETAILS_BUTTON_LAST && leader) {
    answerApplicant(player, party, slot - DETAILS_BUTTON.REJECT_FIRST, false);
  } else {
    // Refresh, the mode label, or a leader's button for someone else: the client waits on a
    // pause button until the screen is drawn again.
    openDetails(player, party);
  }
}

/** A pause button on either screen: the component and the child resumed. */
function resumeButton(event) {
  const slot = Number.isInteger(event.action) ? event.action : -1;
  if (event.buttonId === Shared.id("component", "LIST_CONTENTS")) clickList(event.player, slot);
  else if (event.buttonId === Shared.id("component", "LIST_ROWS")) selectRow(event.player, slot);
  else if (event.buttonId === Shared.id("component", "DETAILS_BUTTONS")) clickDetails(event.player, slot);
  else return;
  event.handled = true;
}

function sendFilter({ player }) {
  player.getPacketSender().sendVarbit(Shared.id("varbit", "FRIENDS_FILTER"), player.getAttribute(ATTR.FRIENDS_FILTER) === true ? 1 : 0);
}

function inspectBoard({ player }) {
  openList(player);
  return true;
}

module.exports = function registerGrouping(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR.COMPLETIONS, 0);
  api.persistAttribute(ATTR.FRIENDS_FILTER, false);
  api.onPlayerLogin(sendFilter);
  api.onObjectInteraction("Grouping Board", { Inspect: inspectBoard });
  api.onInterfaceActionClick(resumeButton);
};

Object.assign(module.exports, {
  ATTR, LIST_BUTTON, DETAILS_BUTTON, TAB, refreshOverlay, refreshParty, leaveParty, leaveLobby,
  openList, openDetails, rowText, memberLine, clickList, clickDetails, resumeButton,
});
