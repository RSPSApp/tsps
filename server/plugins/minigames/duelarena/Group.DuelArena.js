/**
 * The Official 1v1 Duels group, as the side panel (762) draws it, as captured (rsprox
 * 20261107T115923 with the clan packets on, world 578). The group is a clan the server owns,
 * "1v1Duels"; the panel's own scripts (6266, 6268-6270, 4399) draw it from the clan data:
 * - Find, then the Duels group: "Seeking group..." in the chatbox (loading_icon, script 4217),
 *   clan_guest_affinitystatus 2, then the group as the player's listened clan (clan type -1):
 *   its settings (clan setting 33 = 1006 marks it a 1v1 Duels group; the owner "PvPA Duels";
 *   the signed-up players) and its channel (everyone looking at or signed up to it, the player
 *   too); clan_guest_affinitystatus and clan_guest_affinity_joined 3;
 * - Sign up: "Requesting...", the listened clan dropped (clan_guest_affinitystatus 1) and the
 *   group sent again as the player's PvP Arena clan (clan type 2, pvpa_affinitystatus 3);
 * - each player in the channel carries a rank the rows' icons come from (script 6270): -1 for
 *   one only looking, 100 + their tier (script 6265: their rank points / 1,000, 6 at most) once
 *   signed up, 112 once invited;
 * - leaving (Find again, a lapsed invitation, going up to the staging area) drops the PvP Arena
 *   clan (an empty one).
 * Each change goes to everyone in the group as a whole snapshot (live sends deltas; the client
 * ends up with the same lists).
 */
const Common = require("./Common.DuelArena");
const Rank = require("./Rank.DuelArena");

const LISTENED = -1;
const PVP_ARENA_CLAN = 2;
const NO_SLOT = 0xffff;
const OWNER_RANK = 126;
const VIEWER_RANK = -1;
const INVITED_RANK = 112;
const TIER_BASE = 100;
const MAX_TIER = 6;
const LOADING_SCRIPT = 4217;
const LOADING_ENUM = 3787;
const CHATBOX_MODAL = "chatbox:chatmodal";
const LOADING_MODAL = "loading_icon_modal";
const LOADING_ICON = "loading_icon";
const SIDE_BUTTON_SCRIPT = 915;
const GROUPING_SIDE_BUTTON = 7;
const RUNE_DAY_EPOCH_MS = Date.UTC(2002, 1, 27);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Looking at the group (listened), and signed up to it (player -> "signed" | "invited"). */
const viewers = new Set();
const members = new Map();
let updateNum = 0;

function data() {
  return Common.data.ranked.group;
}

function runeDay(ms) {
  return Math.floor((ms - RUNE_DAY_EPOCH_MS) / DAY_MS);
}

function send(player, packet) {
  player.getSession()?.sendClientPacket?.(packet);
}

function tierRank(player) {
  return TIER_BASE + Math.min(MAX_TIER, Math.max(0, Math.floor(Rank.rank(player) / 1000)));
}

function channelRank(player) {
  if (!members.has(player)) return VIEWER_RANK;
  return members.get(player) === "invited" ? INVITED_RANK : tierRank(player);
}

function settingsSnapshot() {
  const joined = runeDay(Date.now());
  return {
    updateNum,
    creationTime: runeDay(Date.parse(data().created)),
    name: data().name,
    allowGuests: true,
    talkRank: 0,
    kickRank: 0,
    ownerSlot: 0,
    replacementOwnerSlot: NO_SLOT,
    members: [
      { name: data().owner, rank: OWNER_RANK, extraInfo: 0, joinRuneDay: joined, muted: false },
      ...[...members.entries()].map(([player, state]) => ({
        name: player.getDisplayName(), rank: state === "invited" ? INVITED_RANK : 0, extraInfo: 0, joinRuneDay: joined, muted: false,
      })),
    ],
    banned: [],
    settings: [{ id: data().typeSetting, value: Common.data.ranked.battletype }],
  };
}

function channelSnapshot() {
  return {
    key: data().key,
    updateNum,
    name: data().name,
    talkRank: 0,
    kickRank: 0,
    users: [...viewers, ...members.keys()].map((player) => ({ name: player.getDisplayName(), rank: channelRank(player), world: Common.data.ranked.world })),
  };
}

/** Everyone in the group: its settings and channel as they stand, in their own slot. */
function broadcast() {
  updateNum++;
  const { encodeClanSettingsFull, encodeClanChannelFull } = Common.core;
  const settings = settingsSnapshot();
  const channel = channelSnapshot();
  for (const player of viewers) {
    send(player, encodeClanSettingsFull(LISTENED, settings));
    send(player, encodeClanChannelFull(LISTENED, channel));
  }
  for (const player of members.keys()) {
    send(player, encodeClanSettingsFull(PVP_ARENA_CLAN, settings));
    send(player, encodeClanChannelFull(PVP_ARENA_CLAN, channel));
  }
}

function dropSlot(player, clanType) {
  const { encodeClanSettingsFull, encodeClanChannelFull } = Common.core;
  send(player, encodeClanSettingsFull(clanType, null));
  send(player, encodeClanChannelFull(clanType, null));
}

/** The chatbox's loading icon while the group answers (captured text), gone a tick later. */
function loading(player, text, then) {
  const sender = player.getPacketSender();
  sender.sendSubInterface(Common.component(CHATBOX_MODAL), Common.interfaceId(LOADING_MODAL), 0);
  sender.sendSubInterface(Common.component(`${LOADING_MODAL}:main`), Common.interfaceId(LOADING_ICON), 1);
  sender.sendInterfaceScript(LOADING_SCRIPT, [Common.component(`${LOADING_MODAL}:main`), Common.component(`${LOADING_MODAL}:text`),
    LOADING_ENUM, 10, 1000, 3000, 512, 1024, 0, 3, text]);
  Common.later(1, () => {
    if (player.isRegistered?.() === false) return;
    sender.closeSubInterface(Common.component(CHATBOX_MODAL));
    then();
  });
}

/** Find, then the Duels group: the group as the player's listened clan. */
function view(player) {
  if (viewers.has(player) || members.has(player)) return;
  loading(player, data().seeking, () => {
    // The listened slot is the Guest Clan tab's too: whatever clan was up there makes way.
    Common.api.emitCustomEvent("clans:release-guest", { player });
    Common.varbit(player, "clan_guest_affinitystatus", 2);
    viewers.add(player);
    broadcast();
    Common.varbit(player, "clan_guest_affinitystatus", 3);
    Common.varbit(player, "clan_guest_affinity_joined", 3);
    player.getPacketSender().sendClientScript(SIDE_BUTTON_SCRIPT, GROUPING_SIDE_BUTTON);
  });
}

function viewing(player) {
  return viewers.has(player);
}

/** Sign up: "Requesting...", then the group as the player's PvP Arena clan. */
function join(player, then) {
  loading(player, data().requesting, () => {
    if (viewers.delete(player)) {
      dropSlot(player, LISTENED);
      Common.varbit(player, "clan_guest_affinitystatus", 1);
      Common.varbit(player, "clan_guest_affinity_joined", 0);
    }
    members.set(player, "signed");
    then();
    broadcast();
  });
}

function invited(player) {
  if (!members.has(player)) return;
  members.set(player, "invited");
  broadcast();
}

/** Out of the group (left, lapsed, gone up to the staging area): its PvP Arena clan dropped. */
function leave(player) {
  if (!members.delete(player)) return;
  dropSlot(player, PVP_ARENA_CLAN);
  broadcast();
}

/** Gone (a logout): out of the lists, nothing sent to them. */
function forget(player) {
  const was = viewers.delete(player) | members.delete(player);
  if (was) broadcast();
}

module.exports = { view, viewing, join, invited, leave, forget, channelRank, _test: { viewers, members, settingsSnapshot, channelSnapshot } };
