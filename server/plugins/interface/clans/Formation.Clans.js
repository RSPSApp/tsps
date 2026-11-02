/**
 * Forming a clan at the Clan Hub: five founders, 25 hours each, a unique name (Wiki: Clan), through
 * the cache's side panel (705, clan_create_side_init). No capture holds this flow, so the panel's
 * ids and scripts are the cache's and its wording, the invite's prompt and the Clerk's opening
 * option are ours (docs/clans.md).
 */

const Core = require("./Core.Clans");
const Store = require("./Store.Clans");

const PANEL_GROUP = 705;
const uid = (child) => (PANEL_GROUP << 16) | child;
const REFRESH_BUTTON = 1;
const PANEL_ROOT = uid(0);
const CONTENTS = uid(7);
const NAME_BUTTON = 8;
const INVITE_UID = uid(9);
const CANCEL_BUTTON = 10;
const CONFIRM_BUTTON = 11;
const FOUNDER_VARBIT = 12171; // clan_i_am_founder
const FOUNDER_MEMBER_VARBIT = 12172; // clan_i_am_founder_member
const LIST_PLAYERS_SCRIPT = 4448; // clan_create_side_list_players
const UPDATE_NAME_SCRIPT = 4447; // clan_create_update_button_text
const NAME_BUTTON_ENUM = 3824;
const PLAYER_TARGET_FLAG = 1 << 14; // WidgetFlags FLAG_USE_PLAYER: the Invite button's target mode

const FOUNDERS_NEEDED = 5;
const MINUTES_NEEDED = 25 * 60;
const MAX_NAME_LENGTH = 20; // ours: the Wiki only asks for a unique name
const LAST_CREATED_DAY_ATTRIBUTE = "clans:last-created-day";
const PLAYTIME_ATTRIBUTE = "clans:minutes-played";

/** A formation: { founder, name, players: [founder, ...] }. */
const formationOf = new Map();
const sessionStart = new WeakMap();

let core = null;
let emit = null;

function init(api) {
  core = api.core;
  emit = api.emitCustomEvent;
  api.persistAttribute(LAST_CREATED_DAY_ATTRIBUTE, 0);
  api.persistAttribute(PLAYTIME_ATTRIBUTE, 0);
}

function startSession(player) {
  sessionStart.set(player, Date.now());
}

function sessionMinutes(player) {
  return Math.floor((Date.now() - (sessionStart.get(player) ?? Date.now())) / 60000);
}

function minutesPlayed(player) {
  return (player.getAttribute(PLAYTIME_ATTRIBUTE) ?? 0) + sessionMinutes(player);
}

function endSession(player) {
  player.setAttribute(PLAYTIME_ATTRIBUTE, minutesPlayed(player));
  sessionStart.delete(player);
  leaveFormation(player);
}

/** The agent's advance_time. */
function advanceTime(event) {
  const { player, ms, handledBy } = event;
  player.setAttribute(PLAYTIME_ATTRIBUTE, (player.getAttribute(PLAYTIME_ATTRIBUTE) ?? 0) + Math.floor(ms / 60000));
  handledBy.push("Clans");
}

function isForming(player) {
  return formationOf.has(player);
}

/** Shows the panel for this player: the name button, then the founders. */
function showPanel(player, formation) {
  const sender = player.getPacketSender();
  if (formation.name) sender.sendClientScript(UPDATE_NAME_SCRIPT, PANEL_ROOT, uid(NAME_BUTTON), NAME_BUTTON_ENUM, formation.name);
  const names = formation.players.map((other) => other.getUsername());
  while (names.length < FOUNDERS_NEEDED) names.push("");
  sender.sendClientScript(LIST_PLAYERS_SCRIPT, CONTENTS, ...names, player.getUsername());
}

function mountPanel(player, formation) {
  const sender = player.getPacketSender();
  const isFounder = formation.founder === player;
  sender
    .sendVarbit(FOUNDER_VARBIT, isFounder ? 1 : 0)
    .sendVarbit(FOUNDER_MEMBER_VARBIT, isFounder ? 0 : 1)
    .sendInterfaceFlagsRange(INVITE_UID, -1, -1, isFounder ? PLAYER_TARGET_FLAG : 0);
  emit("side-channels:replace-your-clan", {
    player,
    group: PANEL_GROUP,
    onMount: () => showPanel(player, formation),
  });
}

function unmountPanel(player) {
  player.getPacketSender().sendVarbit(FOUNDER_VARBIT, 0).sendVarbit(FOUNDER_MEMBER_VARBIT, 0);
  emit("side-channels:replace-your-clan", { player, group: null });
}

function start(player) {
  if (Core.clanOf(player)) {
    player.sendMessage("You are already in a clan.");
    return;
  }
  let formation = formationOf.get(player);
  if (!formation) {
    formation = { founder: player, name: "", players: [player] };
    formationOf.set(player, formation);
  }
  mountPanel(player, formation);
}

function disband(formation) {
  for (const player of formation.players) {
    formationOf.delete(player);
    unmountPanel(player);
    if (player !== formation.founder) player.sendMessage("The clan you were helping to form has been cancelled.");
  }
}

/** The founder going ends the formation; anyone else just leaves it. */
function leaveFormation(player) {
  const formation = formationOf.get(player);
  if (!formation) return;
  if (formation.founder === player) {
    disband(formation);
    return;
  }
  formationOf.delete(player);
  unmountPanel(player);
  formation.players = formation.players.filter((other) => other !== player);
  for (const other of formation.players) showPanel(other, formation);
}

function askName(player, formation) {
  player.setEnteredSyntaxAction({ execute: (text) => setName(player, formation, String(text ?? "").trim()) });
  player.getPacketSender().sendEnterInputPrompt("Enter your clan's name:");
}

function setName(player, formation, name) {
  if (!name || name.length > MAX_NAME_LENGTH || !/^[a-z0-9 _-]+$/i.test(name)) {
    player.sendMessage(`Clan names are up to ${MAX_NAME_LENGTH} letters, numbers and spaces.`);
    return;
  }
  if (Store.byName(name)) {
    player.sendMessage("That name is taken.");
    return;
  }
  formation.name = name;
  for (const other of formation.players) showPanel(other, formation);
}

function invite(player, target) {
  const formation = formationOf.get(player);
  if (!formation || formation.founder !== player) return;
  if (target === player || formation.players.includes(target)) return;
  if (formation.players.length >= FOUNDERS_NEEDED) {
    player.sendMessage("You already have enough founders.");
    return;
  }
  if (Core.clanOf(target) || formationOf.has(target)) {
    player.sendMessage(`${target.getUsername()} is already in a clan.`);
    return;
  }
  if (target.getDialogueManager?.()?.isActive?.()) {
    player.sendMessage(`${target.getUsername()} is busy at the moment.`);
    return;
  }
  player.sendMessage(`Inviting ${target.getUsername()} to found your clan...`);
  const { DialogueChainBuilder, OptionDialogue } = core;
  target.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new OptionDialogue(0, {
      executeOption(option) {
        target.getPacketSender().sendInterfaceRemoval();
        if (Number(option) === 1) accept(formation, target);
        else player.sendMessage(`${target.getUsername()} has declined your invitation.`);
      },
    }, "Yes.", "No.").setTitle(`Help ${player.getUsername()} form a clan?`),
  ));
}

function accept(formation, target) {
  const founder = formation.founder;
  if (formationOf.get(founder) !== formation || !Core.isOnline(founder) || Core.clanOf(target)) return;
  if (formation.players.length >= FOUNDERS_NEEDED || formationOf.has(target)) return;
  formation.players.push(target);
  formationOf.set(target, formation);
  mountPanel(target, formation);
  for (const other of formation.players) if (other !== target) showPanel(other, formation);
}

function refusal(formation, today) {
  const { founder, name, players } = formation;
  if (!name) return "Your clan needs a name first.";
  if (players.length < FOUNDERS_NEEDED) return `You need ${FOUNDERS_NEEDED} founders to form a clan.`;
  if (Store.byName(name)) return "That name is taken.";
  if (founder.getAttribute(LAST_CREATED_DAY_ATTRIBUTE) === today) return "You can only create one clan per day.";
  const inClan = players.find((player) => Core.clanOf(player));
  if (inClan) return `${inClan.getUsername()} is already in a clan.`;
  const tooNew = players.find((player) => minutesPlayed(player) < MINUTES_NEEDED);
  if (tooNew) return `${tooNew.getUsername()} has not spent 25 hours in-game yet.`;
  return null;
}

function confirm(player, formation) {
  const today = Core.runeDay();
  const refused = refusal(formation, today);
  if (refused) {
    player.sendMessage(refused);
    return;
  }
  player.setAttribute(LAST_CREATED_DAY_ATTRIBUTE, today);
  for (const founder of formation.players) formationOf.delete(founder);
  for (const founder of formation.players) unmountPanel(founder);
  Core.createClan(formation.name, formation.players);
}

function clickPanel(event) {
  if (event.groupId !== PANEL_GROUP) return;
  const { player, childId } = event;
  event.handled = true;
  const formation = formationOf.get(player);
  if (!formation) return;
  const isFounder = formation.founder === player;
  if (childId === REFRESH_BUTTON) showPanel(player, formation);
  else if (childId === CANCEL_BUTTON) leaveFormation(player);
  else if (childId === NAME_BUTTON && isFounder) askName(player, formation);
  else if (childId === CONFIRM_BUTTON && isFounder) confirm(player, formation);
}

function inviteByTarget(event) {
  if (event.spellWidget !== INVITE_UID) return;
  event.handled = true;
  invite(event.player, event.target);
}

function reset() {
  formationOf.clear();
}

module.exports = {
  advanceTime,
  clickPanel,
  endSession,
  init,
  invite,
  inviteByTarget,
  isForming,
  leaveFormation,
  reset,
  start,
  startSession,
};
