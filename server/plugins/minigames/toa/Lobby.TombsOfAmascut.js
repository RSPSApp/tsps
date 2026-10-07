"use strict";

/**
 * The Jaltevas pyramid lobby: the way in from Necropolis, the grouping obelisk's party board
 * (interfaces 772/774), the invocation board, the party overlay (773) and the raid entry.
 *
 * Party board protocol (lists drawn by cache scripts 6601/6722/6727, the management panel
 * initialised by 6729 with the invocation bitmaps) follows the cache interfaces.
 */

const Shared = require("./ToaShared");
const Parties = require("./ToaParties");
const Invocations = require("./ToaInvocations");
const Raid = require("./ToaRaid");
const Rewards = require("./ToaRewards");

const { INTERFACE, SCRIPT, VARBIT, VARP, EVENT } = Shared;

const OVERVIEW_BUTTONS_UID = (INTERFACE.PARTY_OVERVIEW << 16) | 1;
const OVERVIEW_PARTY_LIST_UID = (INTERFACE.PARTY_OVERVIEW << 16) | 16;
const MANAGEMENT_BUTTONS_UID = (INTERFACE.PARTY_MANAGEMENT << 16) | 1;
const MANAGEMENT_REWARD_INFO_UID = (INTERFACE.PARTY_MANAGEMENT << 16) | 96;
/** The details panel's pause buttons: tabs, members, applicants and invocations (0-97). */
const MANAGEMENT_PAUSE_LAST = 97;
const MANAGEMENT_PRESETS_UID = (INTERFACE.PARTY_MANAGEMENT << 16) | 98;
const REWARD_POTENTIAL_TEXT_UID = 50724925;

const OVERVIEW = { REFRESH: 0, MAKE_PARTY: 1, FILTER: 2 };
/**
 * The details panel's pause button numbers, as its cache scripts number them: the 12 fixed
 * buttons (enum 4792), then from 12 members, from 36 applicants' Accept and from 44 their
 * Decline (6746: 12 + 24 (+ 8) + row), and from 52 the invocations in enum 4664's order
 * (6754: 12 + 24 + 16 + grid position).
 */
const MANAGEMENT = {
  OPEN_LIST: 0, REFRESH: 1, UNBLOCK: 2, SET_COMPLETIONS: 3, MEMBER_OPTION: 4, CLEAR_ALL: 5,
  LOAD_PRESET: 6, SAVE_PRESET: 7, TAB_FIRST: 8, TAB_LAST: 11, MEMBER_FIRST: 12, MEMBER_LAST: 19,
  ACCEPT_FIRST: 36, DECLINE_FIRST: 44, APPLICANT_LAST: 51, INVOCATION_FIRST: 52,
};
const VIEW = { NON_MEMBER: 0, MEMBER: 1, LEADER: 2, APPLICANT: 3, DECLINED: 4 };

const REWARD_POTENTIAL_INFO = "Reward Potential|"
  + "Before entering a raid, you can customise the difficulty of the challenges you'll face by using <col=ffffff>Invocations</col>. "
  + "There are a large variety of Invocations available, covering both challenge-specific mechanics as well as raid-wide systems.<br><br>"
  + "Enabling or disabling Invocations will change the <col=ffffff>Raid Level</col>. Higher Raid Levels will result in more rewards becoming available."
  + "<br><br>If a reward is outlined in <col=ffd270>gold</col>, it is reasonably possible to obtain it at this Raid Level. "
  + "If a reward is outlined in <col=ff7070>red</col>, it is not possible to obtain it at this Raid Level. "
  + "If a reward is not outlined, it is still possible, though highly unlikely, to obtain it at this Raid Level.|"
  + "Close|";

const NECROPOLIS_ENTRANCE_RADIUS = 8;
// Interface 775: data_a_p/c_p/d_p (each followed by its world column), then per team size
// data_<n>_p_o, _p_r, _g_o, _g_r from 53; the tabs story (Entry), normal and hard (Expert).
const SCOREBOARD = {
  LOC: 46071,
  INTERFACE: 775,
  TAB_VARBIT: 14320,
  ATTEMPTS: 47,
  COMPLETIONS: 49,
  DEATHS: 51,
  FIRST_ROW: 53,
  TABS: [
    { component: 86, mode: "normal" },
    { component: 85, mode: "entry" },
    { component: 87, mode: "expert" },
  ],
};
const SHROUD_CHEST = 46080; // TOA_LOBBY_CAPE_CHEST
const SHROUDS = [
  { id: 27257, completions: 100, option: "Take Icthlarin's shroud (tier 1)." },
  { id: 27259, completions: 500, option: "Take Icthlarin's shroud (tier 2)." },
  { id: 27261, completions: 1000, option: "Take Icthlarin's shroud (tier 3)." },
  { id: 27263, completions: 1500, option: "Take Icthlarin's shroud (tier 4)." },
  { id: 27265, completions: 2000, option: "Take Icthlarin's shroud (tier 5)." },
  { id: 27267, completions: 2000, option: "Take Icthlarin's hood (tier 5)." },
];
// The lobby's sack: TOA_GRAIN, a needle, the camulet and the bank camel (TOA_BANK_CAMEL).
const SACK = { LOW: 1, HIGH: 10, GRAIN: 27225, NEEDLE: 1733, CAMULET: 6707, CAMEL: 11806 };

// ------------------------------------------------------------------ entrances

function isNearNecropolisEntrance(location) {
  return location.getZ() === 0
    && Math.abs(location.getX() - Shared.NECROPOLIS_EXIT.x) <= NECROPOLIS_ENTRANCE_RADIUS
    && Math.abs(location.getY() - Shared.NECROPOLIS_EXIT.y) <= NECROPOLIS_ENTRANCE_RADIUS;
}

/** Necropolis' pyramid entry down into the lobby. */
function enterPyramid({ player, location }) {
  if (!isNearNecropolisEntrance(Shared.loc(location))) return false;
  const { Direction } = Shared.core();
  Shared.fadeMove(player, () => {
    player.moveTo(Shared.loc(Shared.LOBBY_ENTRANCE));
    player.setDirection?.(Direction.SOUTH);
  });
  return true;
}

function leavePyramid({ player }) {
  if (!Shared.inLobby(player.getLocation())) return false;
  const { Direction } = Shared.core();
  Shared.fadeMove(player, () => {
    player.moveTo(Shared.loc(Shared.NECROPOLIS_EXIT));
    player.setDirection?.(Direction.NORTH_WEST);
  });
  return true;
}

/** The lobby's raid entrance: the leader takes the party in, members follow. */
function enterTombs({ player }) {
  if (!Shared.inLobby(player.getLocation())) return false;
  const lobby = Parties.currentParty(player);
  if (!lobby) {
    Shared.options(player, "You are currently not in a raiding party.",
      "Form or join a party.", () => openOverview(player),
      "Cancel.", () => {});
    return true;
  }
  if (Rewards.hasRewards(player)) {
    Shared.statement(player, "You have unclaimed rewards from your last raid. Collect them from the chest first.");
    return true;
  }
  const raid = lobby.raid ?? Raid.begin(player);
  if (!raid) return true;
  raid.add(player);
  raid.enterRoom(player, "MAIN_HALL", { leaderOnly: !raid.room });
  Parties.stateOf(player).current = lobby;
  return true;
}

/**
 * Wiki: a Thieving roll, 0.78% at level 1 rising to 4.30% at 99 (Jagex's level-scaled chance,
 * 1-10 out of 256 plus one), and never with a full inventory. A success is grain or a needle,
 * half and half; a failure is the camel spitting, or scolding a player wearing a camulet. The
 * dialogue is OpenRune's (#271).
 */
function searchSack({ player }) {
  if (!Shared.inLobby(player.getLocation())) return false;
  const { Skill } = Shared.core();
  const level = player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  if (player.getInventory().getFreeSlots() < 1 || Math.random() >= sackChance(level)) {
    sackCaught(player);
    return true;
  }
  if (Shared.random(0, 1) === 0) {
    player.getInventory().adds(SACK.NEEDLE, 1);
    sackDialogue(player, SACK.NEEDLE, "You search the sack and find a needle.", [
      "Wow! A needle in a hay sack?",
      "Wait, isn't it supposed to be a stack, not a sack?",
      "And now that I think about it, this sack is full of grain, not hay...",
      "Ah well, never mind.",
    ]);
  } else {
    player.getInventory().adds(SACK.GRAIN, 1);
    sackDialogue(player, SACK.GRAIN, "You successfully take some grain while the bank camel isn't looking.", [
      "It's just grain...",
      "Well, I'm not entirely sure what else I expected.",
    ]);
  }
  return true;
}

/**
 * The chest across from the grouping obelisk (TOA_LOBBY_CAPE_CHEST, 46080). Wiki: Icthlarin's
 * shroud tiers at 100/500/1000/1500/2000 Normal or Expert completions, and the tier 5 hood with
 * the last. Any unlocked one can be taken (OpenRune #271's menu and messages).
 */
function searchShroudChest(event) {
  const { player } = event;
  if (event.objectId !== SHROUD_CHEST || !Shared.inLobby(player.getLocation())) return false;
  const counts = Raid.killCounts(player);
  const unlocked = SHROUDS.filter((shroud) => counts.normal + counts.expert >= shroud.completions);
  if (unlocked.length === 0) Shared.statement(player, "There doesn't seem to be anything inside.");
  else if (unlocked.length === 1) takeShroud(player, unlocked[0]);
  else chooseShroud(player, unlocked, 0);
  return true;
}

/** Up to five choices a page; more than that pages with "More...". */
function chooseShroud(player, unlocked, page) {
  const perPage = unlocked.length <= 5 ? 5 : 4;
  const shown = unlocked.slice(page * perPage, page * perPage + perPage);
  const pairs = shown.flatMap((shroud) => [shroud.option, () => takeShroud(player, shroud)]);
  if (unlocked.length > 5) {
    const next = (page + 1) * perPage < unlocked.length ? page + 1 : 0;
    pairs.push("More...", () => chooseShroud(player, unlocked, next));
  }
  Shared.options(player, "Select an Option", ...pairs);
}

function takeShroud(player, shroud) {
  if (player.getInventory().getFreeSlots() < 1) {
    Shared.statement(player, "You don't have enough inventory space.");
    return;
  }
  player.getInventory().adds(shroud.id, 1);
  const { DialogueChainBuilder, ItemStatementDialogue, EndDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, shroud.id, "You take a mysterious shroud from the chest."),
    new EndDialogue(1),
  ));
}

/**
 * The lobby scoreboard (TOA_SCOREBOARD 46071, interface 775), as OpenRune #271 fills it: a tab
 * per mode (varbit TOA_SCOREBOARD_TAB) showing the player's attempts, completions and deaths, and
 * their best challenge and overall times for each team size. The world columns stay "-": there
 * are no world-wide records.
 */
function readScoreboard(event) {
  const { player } = event;
  if (event.objectId !== SCOREBOARD.LOC || !Shared.inLobby(player.getLocation())) return false;
  const sender = player.getPacketSender();
  sender.sendInterface(SCOREBOARD.INTERFACE);
  for (const tab of SCOREBOARD.TABS) sender.sendInterfaceFlags(uid(SCOREBOARD.INTERFACE, tab.component), EVENT.OP1);
  const tab = sender.getVarbit?.(SCOREBOARD.TAB_VARBIT) ?? 0;
  sendScoreboard(player, SCOREBOARD.TABS[tab] ?? SCOREBOARD.TABS[0]);
  return true;
}

function clickScoreboardTab(event) {
  const { player } = event;
  const index = SCOREBOARD.TABS.findIndex((tab) => uid(SCOREBOARD.INTERFACE, tab.component) === event.buttonId
    || tab.component === event.childId);
  if (index < 0) return;
  player.getPacketSender().sendVarbit(SCOREBOARD.TAB_VARBIT, index);
  sendScoreboard(player, SCOREBOARD.TABS[index]);
}

function sendScoreboard(player, tab) {
  const sender = player.getPacketSender();
  const stats = Raid.statsOf(player);
  const counts = Raid.killCounts(player);
  const text = (component, value) => sender.sendString(String(value), uid(SCOREBOARD.INTERFACE, component));
  text(SCOREBOARD.ATTEMPTS, (stats.attempts[tab.mode] ?? 0).toLocaleString());
  text(SCOREBOARD.ATTEMPTS + 1, "-");
  text(SCOREBOARD.COMPLETIONS, (counts[tab.mode] ?? 0).toLocaleString());
  text(SCOREBOARD.COMPLETIONS + 1, "-");
  text(SCOREBOARD.DEATHS, (stats.deaths[tab.mode] ?? 0).toLocaleString());
  text(SCOREBOARD.DEATHS + 1, "-");
  for (let size = 1; size <= Raid.MAX_TEAM_SIZE; size++) {
    const row = SCOREBOARD.FIRST_ROW + (size - 1) * 4; // personal overall, personal challenge, world overall, world challenge
    text(row, scoreboardTime(stats.overall[`${tab.mode}:${size}`]));
    text(row + 1, scoreboardTime(stats.challenge[`${tab.mode}:${size}`]));
    text(row + 2, "-");
    text(row + 3, "-");
  }
}

/** m:ss.cc from ticks, as OpenRune shows them. */
function scoreboardTime(ticks) {
  if (!ticks) return "-";
  const centis = ticks * 60;
  const seconds = Math.floor(centis / 100);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(centis % 100).padStart(2, "0")}`;
}

function uid(group, child) {
  return (group << 16) | child;
}

function sackChance(level) {
  const value = Math.floor((SACK.LOW * (99 - level) + SACK.HIGH * (level - 1)) / 98 + 0.5);
  return (value + 1) / 256;
}

function sackCaught(player) {
  const { Equipment } = Shared.core();
  if (player.getEquipment().getItems()[Equipment.AMULET_SLOT]?.getId?.() !== SACK.CAMULET) {
    Shared.statement(player, "You go to search the sack, but the bank camel glares at you menacingly and spits in your direction.");
    return;
  }
  Shared.npcSay(player, SACK.CAMEL, "Hey, get your hands off my food! Unless you'd like me to start eating the contents of your bank instead!");
}

function sackDialogue(player, itemId, found, lines) {
  const { DialogueChainBuilder, ItemStatementDialogue, PlayerDialogue, EndDialogue } = Shared.core();
  const chain = [new ItemStatementDialogue(0, itemId, found)];
  lines.forEach((line, index) => chain.push(new PlayerDialogue(index + 1, line)));
  chain.push(new EndDialogue(lines.length + 1));
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(...chain));
}

function readInvocationBoard({ player }) {
  player.getPacketSender().sendInterface(INTERFACE.INVOCATION_INFO);
}

function inspectObelisk({ player, option }) {
  if (option !== "Inspect") return false;
  openOverview(player);
  return true;
}

// ------------------------------------------------------------------ lobby zone

function enterLobby({ player }) {
  player.getPacketSender().sendSubInterface(Shared.OVERLAY_HUD_UID, INTERFACE.PARTY_OVERLAY, 1);
  const party = Parties.currentParty(player);
  if (party) party.broadcastMembers();
  else Parties.sendEmptyPartyOverlay(player);
}

function leaveLobby({ player }) {
  if (Raid.raidOf(player) && Shared.inTombs(player.getLocation())) return;
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
  const { applied, current } = Parties.forget(player);
  if (applied?.leader) refreshIfViewing(applied.leader);
  if (current && !current.insideRaid()) {
    player.sendMessage("You have left the lobby, so you have been removed from your party.");
    if (current.leader) refreshIfViewing(current.leader);
  }
}

function forgetOnLogout({ player }) {
  if (Raid.raidOf(player)) return;
  const { applied, current } = Parties.forget(player);
  if (applied?.leader) refreshIfViewing(applied.leader);
  if (current?.leader) refreshIfViewing(current.leader);
}

// ------------------------------------------------------------------ overview (772)

function openOverview(player) {
  const state = Parties.stateOf(player);
  state.viewing = null;
  const sender = player.getPacketSender();
  sender.sendConfig(VARP.CURRENT_PARTY, state.current ? 0 : -1);
  sender.sendInterface(INTERFACE.PARTY_OVERVIEW);
  // The list's buttons and rows are pause buttons (resume_pausebutton), as OSRS sets them;
  // as op1 clicks the script-built rows had nothing to click.
  sender.sendInterfaceFlagsRange(OVERVIEW_BUTTONS_UID, 0, 2, EVENT.CONTINUE);
  sender.sendInterfaceFlagsRange(OVERVIEW_PARTY_LIST_UID, 0, Shared.MAX_LOBBY_PARTIES - 1, EVENT.CONTINUE);
  sendPartyList(player);
}

/** One row per recruiting party: leader|members...|size|kc|invocations|level|mode|age|. */
function sendPartyList(player) {
  const state = Parties.stateOf(player);
  const friendsOnly = player.getPacketSender().getVarbit?.(VARBIT.FRIENDS_ONLY) === 1;
  state.listed = [];
  const sender = player.getPacketSender();
  const parties = Parties.lobbyParties.filter((party) => !friendsOnly || party.players.some((member) => isFriend(player, member)));
  for (let index = 0; index < Shared.MAX_LOBBY_PARTIES; index++) {
    const party = parties[index];
    if (!party) {
      sender.sendClientScript(SCRIPT.PARTY_LIST_ROW, index, "");
      continue;
    }
    let leaderName = party.leaderName;
    if (party.players.includes(player)) leaderName = `<col=FFFFFF>${leaderName}`;
    const fields = [leaderName];
    for (let i = 1; i < Shared.MAX_PARTY_SIZE; i++) fields.push(party.players[i] ? Shared.displayName(party.players[i]) : "");
    fields.push(party.players.length, party.settings.kcRequirement, party.settings.activeCount,
      party.settings.raidLevel, party.settings.mode, Shared.cycle() - party.createdAt);
    sender.sendClientScript(SCRIPT.PARTY_LIST_ROW, index, `${fields.join("|")}|`);
    state.listed.push(party);
  }
}

function isFriend(player, other) {
  return player.getRelations?.()?.isFriendWith?.(other.getUsername()) === true;
}

function clickOverviewButton(event) {
  const { player } = event;
  switch (slotOf(event)) {
    case OVERVIEW.REFRESH:
      sendPartyList(player);
      return;
    case OVERVIEW.MAKE_PARTY:
      makeOrViewParty(player);
      return;
    case OVERVIEW.FILTER: {
      const current = player.getPacketSender().getVarbit?.(VARBIT.FRIENDS_ONLY) ?? 0;
      player.getPacketSender().sendVarbit(VARBIT.FRIENDS_ONLY, current === 0 ? 1 : 0);
      sendPartyList(player);
      return;
    }
    default:
  }
}

function makeOrViewParty(player) {
  const state = Parties.stateOf(player);
  if (!state.current) {
    if (Parties.isListFull()) {
      player.sendMessage("The list of lobby parties is currently full. Please come back later or apply to an existing party.");
      return;
    }
    const applied = state.applied;
    if (applied && applied.withdraw(player) && applied.leader) refreshIfViewing(applied.leader);
    state.viewing = Parties.createParty(player);
    state.tab = 1;
  } else {
    state.viewing = state.current;
    state.tab = 0;
  }
  openManagement(player);
}

function selectParty(event) {
  const { player } = event;
  const state = Parties.stateOf(player);
  const party = state.listed[slotOf(event)];
  if (!party) return;
  if (state.current?.insideRaid()) {
    Shared.statement(player, "You should join your party in the tombs.");
    return;
  }
  if (!Parties.listed(party) || party.insideRaid()) {
    Shared.statement(player, "That party is no longer recruiting.");
    return;
  }
  state.viewing = party;
  openManagement(player);
}

// ------------------------------------------------------------------ management (774)

/**
 * (Re)opens the details panel and draws it. The panel must be reopened for every redraw: the
 * member and applicant rows (scripts 6722/6727) count themselves into varcs 178 and 1087,
 * which only the interface's onLoad (script 6615) zeroes, so redrawing in place doubled
 * "Members (x)" and "Applicants (x)" (OpenRune reopens it the same way).
 */
function openManagement(player) {
  player.getPacketSender().sendInterface(INTERFACE.PARTY_MANAGEMENT);
  drawManagement(player);
}

/** Redraws the panel for the player who acted on it. */
function refreshManagement(player) {
  openManagement(player);
}

/** Redraws someone else's panel, only while it's open (on `party`, if given). */
function refreshIfViewing(player, party = null) {
  if (player.getInterfaceId() !== INTERFACE.PARTY_MANAGEMENT) return;
  if (party && !viewingManagement(player, party)) return;
  openManagement(player);
}

function viewingParty(player) {
  const party = Parties.stateOf(player).viewing;
  if (!party || !party.leader) {
    openOverview(player);
    return null;
  }
  return party;
}

function viewingManagement(player, party) {
  return Parties.stateOf(player).viewing === party;
}

/** Draws the management panel's rows and settings for a player looking at a party. */
function drawManagement(player) {
  const state = Parties.stateOf(player);
  const party = state.viewing;
  if (!party || !party.leader) return;
  const sender = player.getPacketSender();
  state.viewingValue = party.isLeader(player) ? VIEW.LEADER
    : party.players.includes(player) ? VIEW.MEMBER
      : party.applicants.includes(player) ? VIEW.APPLICANT
        : party.blocked.includes(player) ? VIEW.DECLINED
          : VIEW.NON_MEMBER;
  for (let index = 0; index < Shared.MAX_PARTY_SIZE; index++) {
    const member = party.players[index];
    sender.sendClientScript(SCRIPT.PARTY_MEMBER_ROW, state.viewingValue, member ? statLine(member, member === player) : "");
  }
  for (const applicant of party.applicants) {
    sender.sendClientScript(SCRIPT.PARTY_APPLICANT_ROW, statLine(applicant, applicant === player));
  }
  const { settings } = party;
  sender.sendClientScript(SCRIPT.PARTY_MANAGEMENT_INIT, state.viewingValue, settings.kcRequirement,
    settings.activeCount, settings.raidLevel, state.tab, settings.bitmaps[0], settings.bitmaps[1], settings.bitmaps[2]);
  sender.sendInterfaceFlagsRange(MANAGEMENT_BUTTONS_UID, 0, MANAGEMENT_PAUSE_LAST, EVENT.CONTINUE);
  sender.sendInterfaceFlags(MANAGEMENT_REWARD_INFO_UID, EVENT.OP1);
  if (party.isLeader(player)) {
    sender.sendInterfaceFlagsRange(MANAGEMENT_PRESETS_UID, 0, Parties.PRESET_COUNT, EVENT.OP1 | EVENT.OP2);
  }
}

/** name|combat|attack|strength|ranged|magic|defence|hitpoints|prayer|entry / normal / expert| */
function statLine(player, self) {
  const { Skill } = Shared.core();
  const skills = player.getSkillManager();
  const counts = Raid.killCounts(player);
  const fields = [
    `${self ? "<col=FFFFFF>" : ""}${Shared.displayName(player)}`,
    player.getSkillManager().getCombatLevel?.() ?? 3,
    skills.getMaxLevel(Skill.ATTACK),
    skills.getMaxLevel(Skill.STRENGTH),
    skills.getMaxLevel(Skill.RANGED),
    skills.getMaxLevel(Skill.MAGIC),
    skills.getMaxLevel(Skill.DEFENCE),
    skills.getMaxLevel(Skill.HITPOINTS),
    skills.getMaxLevel(Skill.PRAYER),
    `${counts.entry} / ${counts.normal} / ${counts.expert}`,
  ];
  return `${fields.join("|")}|`;
}

function refreshPartyViewers(party) {
  for (const member of [...party.players, ...party.applicants, ...party.blocked]) {
    refreshIfViewing(member, party);
  }
}

function clickManagementButton(event) {
  const { player } = event;
  const slot = slotOf(event);
  const party = viewingParty(player);
  if (!party) return;
  const leader = party.isLeader(player);
  if (slot === MANAGEMENT.OPEN_LIST) {
    openOverview(player);
  } else if (slot === MANAGEMENT.REFRESH) {
    refreshManagement(player);
  } else if (slot === MANAGEMENT.UNBLOCK && leader) {
    party.blocked = [];
    Shared.statement(player, "All players rejected from this party have been unblocked and may apply again.");
    refreshManagement(player);
  } else if (slot === MANAGEMENT.SET_COMPLETIONS && leader) {
    promptCompletions(player, party);
  } else if (slot === MANAGEMENT.MEMBER_OPTION) {
    memberOption(player, party);
  } else if (slot === MANAGEMENT.CLEAR_ALL && leader) {
    Shared.confirm(player, "Are you sure you want to clear all active Invocations?", () => {
      party.settings.clear();
      Shared.sound(player, Shared.SOUND.CLEAR);
      refreshPartyViewers(party);
      refreshManagement(player);
    });
  } else if (slot === MANAGEMENT.LOAD_PRESET && leader) {
    loadPreset(player, party);
  } else if (slot === MANAGEMENT.SAVE_PRESET && leader) {
    savePreset(player, party);
  } else if (slot >= MANAGEMENT.TAB_FIRST && slot <= MANAGEMENT.TAB_LAST) {
    Parties.stateOf(player).tab = slot - MANAGEMENT.TAB_FIRST;
    refreshManagement(player);
  } else if (slot >= MANAGEMENT.MEMBER_FIRST && slot <= MANAGEMENT.MEMBER_LAST && leader) {
    kick(player, party, party.players[slot - MANAGEMENT.MEMBER_FIRST]);
  } else if (slot >= MANAGEMENT.ACCEPT_FIRST && slot <= MANAGEMENT.APPLICANT_LAST && leader) {
    const accept = slot < MANAGEMENT.DECLINE_FIRST;
    answerApplicant(player, party, party.applicants[slot - (accept ? MANAGEMENT.ACCEPT_FIRST : MANAGEMENT.DECLINE_FIRST)], accept);
  } else if (slot >= MANAGEMENT.INVOCATION_FIRST && leader) {
    toggleInvocation(player, party, Invocations.keyAtSlot(slot - MANAGEMENT.INVOCATION_FIRST));
  }
}

function promptCompletions(player, party) {
  player.setEnteredAmountAction({
    execute: (value) => {
      party.settings.kcRequirement = Math.max(0, Math.min(100, value | 0));
      refreshPartyViewers(party);
      refreshManagement(player);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt("Set a preferred number of completions up to 100 (or 0 to clear it):");
}

function toggleInvocation(player, party, key) {
  if (!key || party.insideRaid()) return;
  const wasActive = party.settings.isActive(key);
  const refusal = party.settings.toggle(key);
  if (refusal) {
    player.sendMessage(refusal);
    return;
  }
  Shared.sound(player, wasActive ? Shared.SOUND.INVOCATION_OFF : Shared.SOUND.INVOCATION_ON);
  refreshPartyViewers(party);
}

/** The panel's one context button: apply, withdraw, leave or disband depending on who looks. */
function memberOption(player, party) {
  const state = Parties.stateOf(player);
  switch (state.viewingValue) {
    case VIEW.NON_MEMBER:
      applyToParty(player, party);
      return;
    case VIEW.MEMBER:
      if (state.current?.insideRaid()) {
        Shared.statement(player, "You should join your party in the tombs.");
        return;
      }
      if (party.leave(player, true)) {
        player.sendMessage(`You have left the party of ${party.leaderName}.`);
        refreshPartyViewers(party);
        openOverview(player);
      }
      return;
    case VIEW.LEADER:
      if (party.insideRaid()) return;
      party.disband();
      openOverview(player);
      return;
    case VIEW.APPLICANT:
      if (party.withdraw(player)) {
        player.sendMessage("You have withdrawn your party application.");
        refreshPartyViewers(party);
        refreshManagement(player);
      }
      return;
    case VIEW.DECLINED:
      Shared.statement(player, "You have been declined by this party.");
      return;
    default:
  }
}

function applyToParty(player, party) {
  const state = Parties.stateOf(player);
  if (state.current?.insideRaid()) {
    Shared.statement(player, "You should join your party in the tombs.");
    return;
  }
  const apply = () => {
    const previous = state.applied;
    if (previous && previous.withdraw(player) && previous.leader) refreshIfViewing(previous.leader);
    if (!party.apply(player)) {
      Shared.statement(player, "That party is no longer recruiting.");
      return;
    }
    player.sendMessage(`You have applied to join the party of ${party.leaderName}.`);
    state.tab = 1;
    refreshPartyViewers(party);
    refreshManagement(player);
  };
  if (state.current) {
    Shared.options(player, "You are already in a party",
      "Stay in my existing party.", () => refreshManagement(player),
      "Quit that one and apply to this one.", () => {
        const old = state.current;
        old.leave(player, true);
        refreshPartyViewers(old);
        apply();
      });
  } else {
    apply();
  }
}

function kick(player, party, target) {
  if (!target) return;
  if (target === player) {
    if (party.leave(player, true)) {
      player.sendMessage("You have left your party.");
      refreshPartyViewers(party);
      openOverview(player);
    }
    return;
  }
  party.removePlayer(target);
  Parties.sendEmptyPartyOverlay(target);
  target.sendMessage(`You have been kicked from the party of ${Shared.displayName(player)}.`);
  Shared.sound(target, Shared.SOUND.DECLINE);
  player.sendMessage(`You have kicked ${Shared.displayName(target)} from your party.`);
  refreshIfViewing(target, party);
  refreshManagement(player);
}

function answerApplicant(player, party, applicant, accept) {
  if (!applicant) return;
  if (accept && party.players.length >= Shared.MAX_PARTY_SIZE) {
    player.sendMessage("Your party is full.");
    return;
  }
  if (!party.answer(applicant, accept)) return;
  if (accept) {
    player.sendMessage(`You have accepted ${Shared.displayName(applicant)} into your party.`);
    applicant.sendMessage(`Your application to the party of ${party.leaderName} has been accepted.`);
    Shared.sound(applicant, Shared.SOUND.CONFIRM);
  } else {
    player.sendMessage(`You have declined the party application from ${Shared.displayName(applicant)}.`);
    applicant.sendMessage(`Your application to the party of ${party.leaderName} has been declined.`);
    Shared.sound(applicant, Shared.SOUND.DECLINE);
  }
  refreshPartyViewers(party);
}

function selectedPreset(player) {
  return (player.getPacketSender().getVarbit?.(VARBIT.PRESET_SELECT) ?? 0) - 1;
}

function savePreset(player, party) {
  const slot = selectedPreset(player);
  if (slot < 0) {
    player.sendMessage("You do not have a valid preset selected to save to.");
    return;
  }
  const presets = Parties.presetsOf(player);
  const save = () => {
    presets[slot] = [...party.settings.bitmaps];
    player.setAttribute("toa:invocation-presets", presets);
    player.getPacketSender().sendVarbit(VARBIT.PRESET_SELECT, 0);
    sendPresetVarps(player);
    player.sendMessage("Your preset has been saved.");
    Shared.sound(player, Shared.SOUND.CONFIRM);
    refreshManagement(player);
  };
  if (presets[slot].some((word) => word !== 0)) {
    Shared.options(player, "You already have a preset saved in this slot.",
      "Save and overwrite this preset.", save,
      "Cancel", () => refreshManagement(player));
  } else {
    save();
  }
}

function loadPreset(player, party) {
  const slot = selectedPreset(player);
  player.getPacketSender().sendVarbit(VARBIT.PRESET_SELECT, 0);
  if (slot < 0) {
    player.sendMessage("You do not have a valid preset selected to load from.");
    return;
  }
  const preset = Parties.presetsOf(player)[slot];
  if (preset.every((word) => word === 0)) {
    player.sendMessage("You do not have any invocations stored in this preset.");
    return;
  }
  party.settings.load(preset);
  player.sendMessage("Your preset has been loaded.");
  Shared.sound(player, Shared.SOUND.CONFIRM);
  refreshPartyViewers(party);
  refreshManagement(player);
}

/** Each preset is three varps the panel reads to show what it holds. */
function sendPresetVarps(player) {
  const presets = Parties.presetsOf(player);
  presets.forEach((preset, index) => {
    for (let word = 0; word < 3; word++) {
      player.getPacketSender().sendConfig(VARP.PRESET_BASE + index * 3 + word, preset[word] | 0);
    }
  });
}

function clickPreset(event) {
  const { player } = event;
  const party = viewingParty(player);
  const slot = slotOf(event);
  if (!party || !party.isLeader(player) || slot < 0 || slot >= Parties.PRESET_COUNT) return;
  if ((event.opId ?? event.action) <= 1) {
    const current = player.getPacketSender().getVarbit?.(VARBIT.PRESET_SELECT) ?? 0;
    player.getPacketSender().sendVarbit(VARBIT.PRESET_SELECT, current === slot + 1 ? 0 : slot + 1);
    refreshManagement(player);
    return;
  }
  Shared.options(player, "Are you sure you wish to clear this preset?",
    "Clear this preset.", () => {
      Parties.presetsOf(player)[slot] = [0, 0, 0];
      sendPresetVarps(player);
      player.sendMessage("Your preset has been cleared.");
      Shared.sound(player, Shared.SOUND.CLEAR);
      refreshManagement(player);
    },
    "Cancel", () => refreshManagement(player));
}

function showRewardPotential({ player }) {
  player.getPacketSender().sendClientScript(SCRIPT.TEXT_POPUP, REWARD_POTENTIAL_INFO, REWARD_POTENTIAL_TEXT_UID);
}

/** Slot of a list click; resume_pausebutton clicks carry it as the action. */
function slotOf(event) {
  return Number.isInteger(event.slot) && event.slot >= 0 && event.slot < 0xffff ? event.slot : event.action;
}

function sendPresetsOnLogin({ player }) {
  if (Parties.presetsOf(player).some((preset) => preset.some((word) => word !== 0))) sendPresetVarps(player);
}

module.exports = function registerTombsLobby(api) {
  Shared.bind(api);
  Shared.onObject(api, "Entry", enterPyramid);
  Shared.onObject(api, "Entry", enterTombs);
  Shared.onObject(api, "Exit", leavePyramid);
  Shared.onObject(api, "Grouping Obelisk", inspectObelisk);
  Shared.onObject(api, "Invocation Board", readInvocationBoard);
  Shared.onObject(api, "Sack", searchSack);
  api.onObjectClick(SHROUD_CHEST, 1, searchShroudChest);
  api.onObjectClick(SCOREBOARD.LOC, 1, readScoreboard);
  for (const tab of SCOREBOARD.TABS) api.onInterfaceActionButton(uid(SCOREBOARD.INTERFACE, tab.component), clickScoreboardTab);
  api.persistAttribute(Raid.ATTR_STATS);
  api.onZoneEnter(Shared.LOBBY, enterLobby);
  api.onZoneExit(Shared.LOBBY, leaveLobby);
  api.onPlayerLogout(forgetOnLogout);
  api.onPlayerLogin(sendPresetsOnLogin);
  api.onInterfaceActionButton(OVERVIEW_BUTTONS_UID, clickOverviewButton);
  api.onInterfaceActionButton(OVERVIEW_PARTY_LIST_UID, selectParty);
  api.onInterfaceActionButton(MANAGEMENT_BUTTONS_UID, clickManagementButton);
  api.onInterfaceActionButton(MANAGEMENT_REWARD_INFO_UID, showRewardPotential);
  api.onInterfaceActionButton(MANAGEMENT_PRESETS_UID, clickPreset);
  api.persistAttribute("toa:invocation-presets");
  api.persistAttribute("toa:completions");
};
