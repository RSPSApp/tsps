"use strict";

/**
 * The PvP Arena's match finding (https://oldschool.runescape.wiki/w/PvP_Arena, "Matching"): the
 * Grouping tab's PvP Arena button (cache 76:2, "Open"; its client script 489 only plays the click
 * sound) brings up the PvP Arena side panel (pvp_arena_sidepanel) in the Grouping tab, and the
 * game picks the opponent for a ranked 1v1 Duel. Ranked play exists only on the designated PvP
 * Arena worlds, here a world that sets the pluginConfig key "DuelArena:pvpArenaWorld" to true
 * (docs/world-configuration.md); the Legacy Duels keep to the Challenge option in DuelArena.plugin.js.
 *
 * The flow: sign up -> paired with the next queued player -> both are invited to the staging area,
 * whose steps (Emir's Arena, "Staging area steps") only take an invited player up -> once both are
 * up, DuelArena starts the fight (its 3-2-1 countdown) -> the loser's and winner's Reward Points.
 * Wiki: a ranked 1v1 win is 16 Reward Points and a loss 12 (the win-streak bonus, Rank Points,
 * builds, loadouts and the world hop are not here), capped at 15,000.
 *
 * Not from a recording or the Wiki: how the cache's side panel is driven. Its group rows come from
 * clan settings (script 6269: "1v1 Duels" is an official group) and its Find board (767) from a
 * group listing the cache has no source for, and neither is modelled here. The panel is mounted
 * as the cache defines it (varbit 13989 = 1, "No group", gives its own "Click Find" hint), Find
 * is the sign-up (a chatbox choice) and Options shows pvp_arena_sideoptions. The staging area's
 * landing tile and bounds are read off the map. The invitation lapses after 5 minutes: the Wiki
 * gives that timer for tournaments, applied here to a 1v1 invitation.
 */

const GROUPING_GROUP = 76;
const OPEN_CHILD = 2;
const SIDEPANEL = "pvp_arena_sidepanel";
const SIDEPANEL_CLOSE = "pvp_arena_sidepanel:close";
const SIDEPANEL_OPTIONS = "pvp_arena_sidepanel:left";
const SIDEPANEL_FIND = "pvp_arena_sidepanel:right";
const SIDEOPTIONS = "pvp_arena_sideoptions";
const SIDEOPTIONS_CLOSE = "pvp_arena_sideoptions:com_3";
const WORLD_CONFIG = "DuelArena:pvpArenaWorld";
const VARBIT_PVPA_AFFINITYSTATUS = 13989; // 1 = no group
const NO_GROUP = 1;
const INVITATION_TICKS = 500; // 5 minutes
const REWARD_POINTS_ATTRIBUTE = "pvp-arena:reward-points";
const REWARD_POINTS_CAP = 15000;
const WIN_POINTS = 16;
const LOSS_POINTS = 12;
const STAGING_NAME = "Staging area steps";
// Climb-up lands on the platform at plane 1 (the Staging area supplies chests stand on it).
const STAGING_LANDING = [3366, 3274, 1];
const STAGING_BOUNDS = { minX: 3355, maxX: 3378, minY: 3266, maxY: 3282, z: 1 };
const STEPS_DOWN = [3366, 3275, 0];

let pluginApi;
let core;
let startArranged;
let sidepanelId;
let closeUid;
let optionsUid;
let findUid;
let sideoptionsId;
let sideoptionsCloseUid;
/** Players waiting for an opponent, oldest first. */
const queue = [];
/** Player -> { players, staged: Set, expires } once paired, until the fight ends. */
const matches = new Map();

const sendTo = (player, text) => player.sendMessage(text);
const opponentOf = (match, player) => match.players.find(p => p !== player);
const onPvpArenaWorld = () => pluginApi.getPluginConfig(WORLD_CONFIG, false) === true;
const clicked = (event, uid) => ((event.groupId << 16) | event.childId) === uid;

function inStaging(player) {
  const { x, y, z } = { x: player.getLocation().getX(), y: player.getLocation().getY(), z: player.getLocation().getZ() };
  const b = STAGING_BOUNDS;
  return z === b.z && x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

function leaveQueue(player) {
  const at = queue.indexOf(player);
  if (at >= 0) queue.splice(at, 1);
  return at >= 0;
}

function moveTo(player, [x, y, z]) {
  player.moveTo(new core.Location(x, y, z));
}

function signUp(player) {
  if (!onPvpArenaWorld()) {
    sendTo(player, "Ranked PvP Arena fights are only available on a PvP Arena world.");
    return;
  }
  if (queue.includes(player) || matches.has(player)) {
    sendTo(player, "You are already signed up for a PvP Arena fight.");
    return;
  }
  const opponent = queue.shift();
  if (!opponent) {
    queue.push(player);
    sendTo(player, "You have signed up for a 1v1 Duel. You will be invited when an opponent is found.");
    return;
  }
  const match = { players: [opponent, player], staged: new Set(), expires: core.World.getProcessCycle() + INVITATION_TICKS };
  for (const p of match.players) {
    matches.set(p, match);
    sendTo(p, `Your 1v1 Duel against ${opponentOf(match, p).getDisplayName()} is ready. `
      + "Climb the staging area steps at the Emir's Arena to get ready.");
  }
}

function withdraw(player) {
  const match = matches.get(player);
  if (match) {
    if (player.getDueling().inDuel()) {
      sendTo(player, "Your fight has started. Use Forfeit to leave it.");
      return;
    }
    cancel(match, player, "withdrew their sign-up");
    sendTo(player, "Your PvP Arena invitation has been cancelled.");
  } else if (leaveQueue(player)) sendTo(player, "You are no longer signed up for a PvP Arena fight.");
  else sendTo(player, "You are not signed up for a PvP Arena fight.");
}

/** Find: the sign-up itself. */
function promptSignUp(player) {
  pluginApi.sendMultiChatboxPrompt(player, "PvP Arena",
    "Sign up for a ranked 1v1 Duel", () => signUp(player),
    "Withdraw my sign-up", () => withdraw(player),
    "Cancel", () => {});
}

function mountPanel({ player }) {
  player.getPacketSender().sendVarbit(VARBIT_PVPA_AFFINITYSTATUS, NO_GROUP);
}

function openPvpArena(event) {
  if (event.groupId !== GROUPING_GROUP || event.childId !== OPEN_CHILD || (event.opId ?? event.action) !== 1) return;
  event.handled = true;
  pluginApi.emitCustomEvent("side-channels:replace-grouping", {
    player: event.player, group: sidepanelId, onMount: () => mountPanel(event),
  });
}

/** The side panel's own buttons: Close, Options, Find. */
function sidePanelButton(event) {
  const { player } = event;
  if (clicked(event, closeUid)) {
    pluginApi.emitCustomEvent("side-channels:replace-grouping", { player, group: null });
  } else if (clicked(event, optionsUid)) {
    player.getPacketSender().sendInterface(sideoptionsId);
  } else if (clicked(event, findUid)) {
    promptSignUp(player);
  } else if (clicked(event, sideoptionsCloseUid)) {
    player.getPacketSender().sendInterfaceRemoval();
  } else return;
  event.handled = true;
}

function climbUp(event) {
  const { player } = event;
  const match = matches.get(player);
  if (!match) {
    sendTo(player, "You need to be invited to a PvP Arena fight to enter the staging area.");
    return;
  }
  moveTo(player, STAGING_LANDING);
  match.staged.add(player);
  const opponent = opponentOf(match, player);
  if (!match.staged.has(opponent) || !inStaging(opponent)) {
    match.staged.delete(opponent);
    sendTo(player, "Waiting for your opponent to reach the staging area.");
    return;
  }
  if (!startArranged(match.players)) {
    sendTo(player, "The arena is unavailable or a player is not ready to fight.");
    match.staged.delete(player);
  }
}

function climbDown(event) {
  const { player } = event;
  const match = matches.get(player);
  moveTo(player, STEPS_DOWN);
  if (match) cancel(match, player, "left the staging area");
}

/** One side gave up before the fight: the match is off, and the other side is told. */
function cancel(match, quitter, why) {
  for (const p of match.players) matches.delete(p);
  const opponent = opponentOf(match, quitter);
  sendTo(opponent, `Your opponent ${why}. The fight has been cancelled.`);
  if (opponent && inStaging(opponent)) sendTo(opponent, "Use the staging area steps to leave.");
}

function fightEnded({ players, winner, loser }) {
  for (const p of players) matches.delete(p);
  if (!winner || !loser) return;
  grant(winner, WIN_POINTS, "won");
  grant(loser, LOSS_POINTS, "lost");
}

function grant(player, points, result) {
  const total = Math.min(REWARD_POINTS_CAP, (Number(player.getAttribute(REWARD_POINTS_ATTRIBUTE)) || 0) + points);
  player.setAttribute(REWARD_POINTS_ATTRIBUTE, total);
  sendTo(player, `You ${result} the fight and earned ${points} Reward Points. You now have ${total.toLocaleString("en-US")}.`);
}

function expireInvitation({ player }) {
  const match = matches.get(player);
  if (match && !player.getDueling().inDuel() && !inStaging(player)) match.staged.delete(player);
  if (match && !player.getDueling().inDuel() && core.World.getProcessCycle() >= match.expires) {
    cancel(match, player, "did not reach the staging area in time");
    sendTo(player, "Your PvP Arena invitation has expired.");
  }
}

function gone({ player }) {
  leaveQueue(player);
  const match = matches.get(player);
  if (match && !player.getDueling().inDuel()) cancel(match, player, "left");
}

function attach(api, hooks) {
  pluginApi = api;
  core = api.core;
  startArranged = hooks.startArranged;
  sidepanelId = core.CacheDefinitions.getInterfaceId(SIDEPANEL);
  closeUid = core.CacheDefinitions.getComponentId(SIDEPANEL_CLOSE);
  optionsUid = core.CacheDefinitions.getComponentId(SIDEPANEL_OPTIONS);
  findUid = core.CacheDefinitions.getComponentId(SIDEPANEL_FIND);
  sideoptionsId = core.CacheDefinitions.getInterfaceId(SIDEOPTIONS);
  sideoptionsCloseUid = core.CacheDefinitions.getComponentId(SIDEOPTIONS_CLOSE);
  api.persistAttribute(REWARD_POINTS_ATTRIBUTE, 0);
  api.onInterfaceActionClick(openPvpArena);
  api.onInterfaceActionClick(sidePanelButton);
  api.onPlayerProcess(expireInvitation);
  api.onObjectInteraction(STAGING_NAME, { "Climb-up": climbUp, Use: climbDown, "Quick-use": climbDown });
  api.onCustomEvent("pvp-arena:fight-ended", fightEnded);
  api.onPlayerDisconnect(gone);
  api.onPlayerLogout(gone);
}

module.exports = { attach, queue, matches };
