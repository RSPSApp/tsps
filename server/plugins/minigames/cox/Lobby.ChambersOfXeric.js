"use strict";

/**
 * Mount Quidamortem: the recruiting board, the party page and the way in.
 *
 * Not on the Wiki (to check against a capture):
 * - The board (499) lists up to 40 advertised parties (script 1566 a row: leader, members,
 *   preferred size, combat and total, Challenge Mode, age in ticks); its buttons are Refresh,
 *   Make party and View party. Making a party needs a chat-channel and the rank of Recruit.
 * - The party page (507) lists the channel's members on the mountain (script 1517: name,
 *   combat, total, kill count, 23 skills), then its header (script 1524: title, your state -
 *   0 outsider, 1 member, 2 leader - advertised, adverts left).
 * - rsprox captures 820, 843, 3389 and enum 1539: its buttons are Join/Leave, Advertise/Delist,
 *   Disband, Refresh, Back, the three preferences, Scaling ("Set the number of players to scale
 *   the raid by (or 0 to clear it):"), Challenge Mode, and Map Layout ("How large of a layout to
 *   generate?" Small, Large or Full). Fifteen adverts are left in every capture (the cache has
 *   raids_daily_adverts); they are taken here as a daily allowance (estimate).
 * - The entrance warns once, then lets a party member in; the raid is built on first entry,
 *   and no one can enter once it has started.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Parties = require("./Parties.ChambersOfXeric");
const { Raid } = require("./RaidState.ChambersOfXeric");
const Storage = require("./Storage.ChambersOfXeric");

// rsprox captures: the board's buttons (contents, 0-1) and party rows (list, 0-39) and the party
// page's buttons (contents, 0-10) are pause buttons, so a click comes back as resume_pausebutton.
const BOARD = { BUTTONS: 3, ROWS: 15 };
const BOARD_BUTTON = { REFRESH: 0, MAKE: 1 };
const PARTY = { BUTTONS: 3, LAST_BUTTON: 10 };
const PARTY_BUTTON = {
  JOIN_LEAVE: 0, ADVERTISE: 1, DISBAND: 2, REFRESH: 3, BACK: 4,
  SIZE: 5, COMBAT: 6, TOTAL: 7, SCALING: 8, CHALLENGE: 9, LAYOUT: 10,
};
const ATTR_VIEWING = "cox:viewing-party";
const ADVERTS_PER_DAY = 15;

const uid = (group, component) => (group << 16) | component;

/** The slot clicked: a pause button's comes as the packet's child index (event.action). */
function slotOf(event) {
  return Number.isInteger(event.slot) && event.slot >= 0 && event.slot < 0xffff ? event.slot : event.action;
}

// ---------------------------------------------------------------- the recruiting board

function openBoard(player) {
  const sender = player.getPacketSender();
  const party = Parties.partyOf(player);
  player.setAttribute(ATTR_VIEWING, null);
  sender.sendConfig(Shared.VARP.BOARD_HAS_PARTY, party ? 0 : -1);
  sender.sendInterface(Shared.INTERFACE.RECRUITING_BOARD);
  const listed = Parties.listed();
  const now = Shared.cycle();
  for (let row = 0; row < Shared.BOARD_ROWS; row++) {
    const listing = listed[row];
    if (!listing) {
      sender.sendClientScript(Shared.SCRIPT.BOARD_ROW, row, "");
      continue;
    }
    const members = listing.raid?.players.size ?? 0;
    sender.sendClientScript(Shared.SCRIPT.BOARD_ROW, row, [
      `<col=ffffff>${listing.leader}</col>`, members, listing.preferredSize, listing.preferredCombat,
      listing.preferredTotal, listing.challenge ? 1 : 0, now - listing.created,
    ].join("|"));
  }
  sender.sendInterfaceFlagsRange(uid(Shared.INTERFACE.RECRUITING_BOARD, BOARD.BUTTONS), 0, 1, Shared.EVENT.CONTINUE);
  sender.sendInterfaceFlagsRange(uid(Shared.INTERFACE.RECRUITING_BOARD, BOARD.ROWS), 0, Shared.BOARD_ROWS - 1, Shared.EVENT.CONTINUE);
}

function readBoard(event) {
  openBoard(event.player);
  return true;
}

function makeParty(player) {
  const channel = Shared.channelOf(player);
  if (!channel) {
    Shared.statement(player, "You must be in a chat-channel to create a party.");
    return;
  }
  const existing = Parties.partyForChannel(channel.key);
  if (existing) {
    openParty(player, existing);
    return;
  }
  if (channel.rankOf(player) < channel.ranks.Recruit) {
    Shared.statement(player, "Only players with the rank of Recruit can create a party.");
    return;
  }
  openParty(player, Parties.create(player, channel));
}

function clickBoardButton(event) {
  const slot = slotOf(event);
  if (slot === BOARD_BUTTON.REFRESH) openBoard(event.player);
  else if (slot === BOARD_BUTTON.MAKE) makeParty(event.player);
  return true;
}

function viewListedParty(event) {
  const party = Parties.listed()[slotOf(event)];
  if (!party) return true;
  openParty(event.player, party);
  return true;
}

// ---------------------------------------------------------------- the party page

function todayNumber() {
  return Math.floor(Date.now() / 86400000);
}

function advertsLeft(player) {
  const adverts = player.getAttribute(Shared.ATTR.ADVERTS);
  return adverts?.day === todayNumber() ? Math.max(0, ADVERTS_PER_DAY - adverts.used) : ADVERTS_PER_DAY;
}

function killCount(player, challenge) {
  return Number(player.getAttribute(challenge ? Shared.ATTR.CHALLENGE_KILLS : Shared.ATTR.KILLS)) || 0;
}

/** The party page, from the viewer's side: who is on the mountain in its channel, and the settings. */
function openParty(player, party) {
  const sender = player.getPacketSender();
  const { Skill } = Shared.core();
  player.setAttribute(ATTR_VIEWING, party);
  sender.sendVarbit(Shared.VARBIT.PARTY_LEADER, party.isLeader(player) ? 1 : 0);
  sender.sendInterface(Shared.INTERFACE.PARTY);
  sender.sendVarbit(Shared.VARBIT.CHALLENGE_MODE, party.challenge ? 1 : 0);
  const viewerChannel = party.channel(player);
  const members = party.members().filter((member) => Shared.onMount(member));
  for (const member of members) {
    const skills = member.getSkillManager();
    const levels = Shared.PARTY_SKILLS.map((name) => skills.getMaxLevel(Skill[name]));
    sender.sendClientScript(Shared.SCRIPT.PARTY_MEMBER, 0, [
      `<col=ffffff>${Shared.displayName(member)}</col>`, skills.getCombatLevel(), skills.getTotalLevel(),
      killCount(member, party.challenge), ...levels, "",
    ].join("|"));
  }
  const state = !viewerChannel ? 0 : party.isLeader(player) ? 2 : 1;
  sender.sendClientScript(Shared.SCRIPT.PARTY_HEADER, `Raiding Party of ${party.leader} (${members.length})`,
    state, party.isAdvertised() ? 1 : 0, advertsLeft(player));
  sender.sendInterfaceFlagsRange(uid(Shared.INTERFACE.PARTY, PARTY.BUTTONS), 0, PARTY.LAST_BUTTON, Shared.EVENT.CONTINUE);
  sender.sendVarbit(Shared.VARBIT.PREFERRED_SIZE, party.preferredSize)
    .sendVarbit(Shared.VARBIT.PREFERRED_COMBAT, party.preferredCombat)
    .sendVarbit(Shared.VARBIT.PREFERRED_TOTAL, party.preferredTotal)
    .sendVarbit(Shared.VARBIT.SCALING, party.scaling)
    .sendVarbit(Shared.VARBIT.LAYOUT_POOL, party.layout);
}

/** Refreshes the page for everyone in the channel who has it open. */
function refreshPartyViewers(party) {
  for (const member of party.members()) {
    if (member.getAttribute(ATTR_VIEWING) === party) openParty(member, party);
  }
}

function viewedParty(player) {
  const party = player.getAttribute(ATTR_VIEWING);
  return party && Parties.all().includes(party) ? party : null;
}

/** The party of the viewer's own channel, for the leader's buttons; null with a reason given. */
function ownParty(player) {
  const party = Parties.partyOf(player);
  if (!party) {
    Shared.statement(player, "That party is no longer recruiting.");
    return null;
  }
  return party;
}

function joinOrLeave(player) {
  const party = viewedParty(player);
  const channel = Shared.channelOf(player);
  if (party && !channel) {
    Shared.joinChannel(player, party.channelKey);
    refreshPartyViewers(party);
    return;
  }
  if (party && channel && channel.key !== party.channelKey) {
    player.sendMessage("You need to leave your clan channel before joining another one.");
    return;
  }
  if (!channel) {
    Shared.statement(player, "That party is no longer recruiting.");
    return;
  }
  const own = Parties.partyForChannel(channel.key);
  Shared.leaveChannel(player);
  if (own) refreshPartyViewers(own);
  openBoard(player);
}

function toggleAdvert(player) {
  const party = ownParty(player);
  if (!party) return;
  const left = advertsLeft(player);
  if (party.isAdvertised()) Parties.delist(party);
  else if (left <= 0) player.sendMessage("You have used all of your adverts for today.");
  else if (!Parties.advertise(party)) player.sendMessage("The advertised parties list is currently full!");
  else player.setAttribute(Shared.ATTR.ADVERTS, { day: todayNumber(), used: ADVERTS_PER_DAY - left + 1 });
  openParty(player, party);
}

function disband(player) {
  const party = ownParty(player);
  if (!party) return;
  const name = Shared.displayName(player);
  player.getPacketSender().sendInterfaceRemoval();
  player.sendMessage("Your party has been disbanded.");
  for (const member of party.members()) {
    if (member !== player && Shared.onMount(member)) Shared.raidMessage(member, `${name} has disbanded the party.`);
  }
  Parties.disband(party);
  openBoard(player);
}

/** The leader's settings can't change once the party is inside. */
function editable(player) {
  const party = ownParty(player);
  if (!party) return null;
  if (party.isLocked()) {
    player.sendMessage("Your party has already entered the chambers, you cannot edit the settings now.");
    return null;
  }
  return party;
}

function askPreference(player, title, max, apply) {
  if (!editable(player)) return;
  player.getPacketSender().sendInterfaceRemoval();
  player.setEnteredAmountAction({
    // "(or 0 to clear it)".
    acceptsZero: true,
    execute: function setPreference(amount) {
      const party = editable(player);
      if (!party) return;
      apply(party, Math.max(0, Math.min(max, Math.trunc(Number(amount) || 0))));
      openParty(player, party);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(title);
}

/** The maker's next party starts from these (rsprox captures: varp 4064 is kept over a login). */
function rememberSettings(player, party) {
  // The remembered party type has a value of its own for Challenge Mode (capture 3389: 3).
  const partyType = party.challenge ? 3 : party.layoutPool;
  player.setAttribute(Shared.ATTR.LAST_SCALING, party.scaling);
  player.setAttribute(Shared.ATTR.LAST_LAYOUT, party.layoutPool);
  player.getPacketSender().sendVarbit(Shared.VARBIT.REMEMBER_SCALING, party.scaling)
    .sendVarbit(Shared.VARBIT.REMEMBER_PARTY_TYPE, partyType);
}

function settingChanged(player, party) {
  rememberSettings(player, party);
  refreshPartyViewers(party);
  openParty(player, party);
}

function toggleChallenge(player) {
  const party = editable(player);
  if (!party) return;
  party.challenge = !party.challenge;
  settingChanged(player, party);
}

function chooseLayout(player) {
  if (!editable(player)) return;
  const pick = (pool) => () => {
    const party = editable(player);
    if (!party) return;
    party.layoutPool = pool;
    settingChanged(player, party);
  };
  const { SMALL, LARGE, FULL } = Shared.LAYOUT_POOL;
  Shared.options(player, "How large of a layout to generate?",
    Shared.LAYOUT_NAMES[SMALL], pick(SMALL), Shared.LAYOUT_NAMES[LARGE], pick(LARGE), Shared.LAYOUT_NAMES[FULL], pick(FULL));
}

function clickPartyButton(event) {
  const { player } = event;
  switch (slotOf(event)) {
    case PARTY_BUTTON.JOIN_LEAVE: joinOrLeave(player); break;
    case PARTY_BUTTON.ADVERTISE: toggleAdvert(player); break;
    case PARTY_BUTTON.DISBAND: disband(player); break;
    case PARTY_BUTTON.REFRESH: {
      const party = viewedParty(player) ?? Parties.partyOf(player);
      if (party) openParty(player, party);
      else Shared.statement(player, "That party is no longer recruiting.");
      break;
    }
    case PARTY_BUTTON.BACK: openBoard(player); break;
    case PARTY_BUTTON.SIZE:
      askPreference(player, "Set a preferred party size (or 0 to clear it):", Shared.MAX_RAIDERS, (party, value) => { party.preferredSize = value; });
      break;
    case PARTY_BUTTON.COMBAT:
      askPreference(player, "Set a preferred combat level (or 0 to clear it):", 126, (party, value) => { party.preferredCombat = value; });
      break;
    case PARTY_BUTTON.TOTAL:
      askPreference(player, "Set a preferred skill total (or 0 to clear it):", 99 * Shared.PARTY_SKILLS.length, (party, value) => { party.preferredTotal = value; });
      break;
    case PARTY_BUTTON.SCALING:
      askPreference(player, "Set the number of players to scale the raid by (or 0 to clear it):", Shared.MAX_RAIDERS, (party, value) => {
        party.scaling = value;
        rememberSettings(player, party);
      });
      break;
    case PARTY_BUTTON.CHALLENGE: toggleChallenge(player); break;
    case PARTY_BUTTON.LAYOUT: chooseLayout(player); break;
    default: break;
  }
  return true;
}

// ---------------------------------------------------------------- the entrance

function enterChambers(event) {
  const { player } = event;
  if (!player.getAttribute(Shared.ATTR.WARNED)) {
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Shared.core();
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, "WARNING!<br>Items left in a dungeon <col=ff0000>cannot</col> be retrieved.<br>Participants <col=ff0000>may be ejected</col> at any time.<br>Don't risk dropping items that you want to keep."),
      new ActionDialogue(1, {
        execute: () => Shared.options(player, "Select an Option",
          "Accept warning and proceed.", () => {
            player.setAttribute(Shared.ATTR.WARNED, true);
            enterChambers(event);
          },
          "Cancel.", () => {}),
      }),
    ));
    return true;
  }
  if (!Storage.canEnter(player)) return true;
  const channel = Shared.channelOf(player);
  if (!channel) {
    player.sendMessage("You need to be in a clan chat to do this.");
    return true;
  }
  const party = Parties.partyForChannel(channel.key);
  if (!party) {
    player.sendMessage("You need to make a raid party first.");
    return true;
  }
  party.raid ??= new Raid(party);
  if (party.raid.stage !== 0) {
    player.sendMessage("The raid has already been started.");
    return true;
  }
  if (!party.isLeader(player) && !party.raid.players.size && channel.rankOf(player) < channel.ranks.General) {
    Shared.statement(player, "Only Generals and above may enter the raid before the party leader.");
    return true;
  }
  party.raid.enter(player);
  return true;
}

// ---------------------------------------------------------------- leaving the channel

/** A raider who leaves the chat-channel leaves the party (and the raid, if inside it). */
function leftChannel({ player, channelKey }) {
  const party = Parties.partyForChannel(channelKey);
  if (!party) return;
  if (party.raid?.players.has(player)) {
    party.raid.leave(player);
    return;
  }
  if (!party.isLeader(player)) return;
  if (Parties.appointLeader(party, player)) return;
  if (Shared.onMount(player)) Shared.raidMessage(player, "You are no longer eligible to lead the party.");
  Parties.disband(party);
}

module.exports = function registerCoxLobby(api) {
  Shared.bind(api);
  api.persistAttribute(Shared.ATTR.WARNED);
  api.persistAttribute(Shared.ATTR.KILLS);
  api.persistAttribute(Shared.ATTR.CHALLENGE_KILLS);
  api.persistAttribute(Shared.ATTR.LAST_SCALING, 0);
  api.persistAttribute(Shared.ATTR.LAST_LAYOUT, 0);
  api.persistAttribute(Shared.ATTR.ADVERTS);
  api.onObjectInteraction("Recruiting board", { Read: readBoard });
  api.onObjectInteraction("Chambers of Xeric", { Enter: enterChambers });
  api.onInterfaceActionButton(uid(Shared.INTERFACE.RECRUITING_BOARD, BOARD.BUTTONS), clickBoardButton);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.RECRUITING_BOARD, BOARD.ROWS), viewListedParty);
  api.onInterfaceActionButton(uid(Shared.INTERFACE.PARTY, PARTY.BUTTONS), clickPartyButton);
  api.onCustomEvent("friends-chat:left", leftChannel);
};

module.exports.openBoard = openBoard;
module.exports.openParty = openParty;
module.exports.enterChambers = enterChambers;
module.exports.makeParty = makeParty;
module.exports.clickPartyButton = clickPartyButton;
module.exports.leftChannel = leftChannel;
