/**
 * The main game's league records (data.records, as captured on rev 229): the trophies a Leagues
 * Tutor hands out (league_trophies 447) and the accomplishment scroll's statistics (449),
 * rankings (445) and firsts (676). A main character's league points are its league character's:
 * at login the account's league save is read (LeaguePoints' `league:saved-points`) and its points
 * are sent as that league's main-game varp, which the trophy and statistics screens read. An
 * account keeps one league character, so only that league's trophies can be earned; the other
 * leagues read 0.
 *
 * A trophy shows "Take" while the character holds none of it (inventory, equipment or bank) and
 * "Store" while it does, so a lost trophy can be taken again for free (Wiki "League trophy").
 * Take hands out an earned trophy; Store takes it back from the inventory. Rankings and firsts
 * are the cache's own tables. `::leaguerecords <trophies|statistics|rankings|firsts>` opens them.
 */
const Common = require("./Common.LeagueMode");
const { FLAG_OP1, eventFlags } = require("../../interface/widgetGroup");

/** The trophy screen's Examine (op10). */
const EXAMINE_OP = 10;
/** The dialogue target that opens the trophies (the Leagues Tutor's generated conversation). */
const TROPHIES_TARGET = "League trophies";
const TUTOR = "Leagues Tutor";
const SCROLL = "League Accomplishment Scroll";
/** Set on bots and agent players, whose saves are never read or written. */
const SKIP_PERSISTENCE_ATTRIBUTE = "bot-skip-persistence";

/** Per main character: its league save's points, by league type. */
const savedPoints = new WeakMap();
/** enum 2778's trophies, by slot: { item, league, points }; read from the cache once. */
let trophyList = null;

function uid(group, child) {
  return (group << 16) | child;
}

function records() {
  return Common.data.records;
}

/** The league types the data knows, in order (the statistics' and firsts' league order). */
function leagueTypes() {
  return Object.keys(Common.data.leagues).map(Number).sort((a, b) => a - b);
}

function trophies() {
  if (trophyList) return trophyList;
  const { CacheDefinitions } = Common.core;
  const { enum: enumId, leagueParam, pointsParam } = records().trophies;
  trophyList = [...CacheDefinitions.getEnumValues(enumId).entries()].sort(([a], [b]) => a - b).map(([, item]) => {
    const params = CacheDefinitions.getItem(Number(item))?.params;
    return { item: Number(item), league: Number(params?.get?.(leagueParam)) || 0, points: Number(params?.get?.(pointsParam)) || 0 };
  });
  return trophyList;
}

/** The account's league save's points: { [type]: points }, empty with no league save. */
function readSavedPoints(player) {
  if (player.getAttribute?.(SKIP_PERSISTENCE_ATTRIBUTE) === true) return {};
  const persistence = Common.core.GameConstants.PLAYER_PERSISTENCE;
  const name = player.getUsername();
  let save = null;
  try {
    if (persistence?.exists?.(name, Common.LEAGUE_PROFILE)) save = persistence.load(name, Common.LEAGUE_PROFILE) ?? null;
  } catch (error) {
    console.warn(`[LeagueMode] could not read ${player.getUsername()}'s league save: ${error?.message ?? error}`);
  }
  const type = Number(save?.attributes?.[Common.LEAGUE_TYPE_ATTRIBUTE]);
  if (!save || !Common.league(type)) return {};
  const query = { save, points: 0, tasks: 0 };
  Common.api.emitCustomEvent("league:saved-points", query);
  return { [type]: Number(query.points) || 0 };
}

function pointsIn(player, type) {
  return savedPoints.get(player)?.[type] ?? 0;
}

/** A main character on a plain world: the records are the main game's. */
function isMainGame(player) {
  return !Common.isLeagueProfile(player) && Common.worldLeague() === null;
}

function login({ player }) {
  if (!isMainGame(player)) return;
  const points = readSavedPoints(player);
  savedPoints.set(player, points);
  const sender = player.getPacketSender();
  for (const [type, value] of Object.entries(points)) {
    const varp = records().pointsVarps[type];
    if (varp !== undefined) sender.sendConfig(varp, value);
  }
}

function logout({ player }) {
  savedPoints.delete(player);
}

/** `league:account-points { player } -> { leagues: { [type]: points }, total }`: what a main character earned in the leagues. */
function accountPoints(request) {
  const leagues = request?.player ? { ...(savedPoints.get(request.player) ?? {}) } : {};
  request.leagues = leagues;
  request.total = Object.values(leagues).reduce((sum, points) => sum + points, 0);
}

/** A bank placeholder keeps the id at amount 0: only a real item counts. */
function banked(bank, item) {
  return (bank?.getItems?.() ?? []).some((entry) => entry?.getId?.() === item && entry.getAmount() > 0);
}

function holds(player, item) {
  const { Bank } = Common.core;
  return player.getInventory().contains(item) || player.getEquipment().contains(item) ||
    player.getBanks().some((bank, tab) => tab !== Bank.BANK_SEARCH_TAB_INDEX && banked(bank, item));
}

function earned(player, trophy) {
  return trophy.points > 0 && pointsIn(player, trophy.league) >= trophy.points;
}

/** The masks scripts 1128 and 1130 take: bit n set while trophy n is the Tutor's to hand out ("Take"). */
function masks(player) {
  const words = new Array(records().trophies.masks).fill(0);
  trophies().forEach((trophy, slot) => {
    const word = slot >> 5;
    if (word < words.length && !holds(player, trophy.item)) words[word] |= 1 << (slot & 31);
  });
  return words;
}

function openModal(player, group) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(Common.data.panels.modalSizeScript, records().modalSize);
  sender.sendInterface(group);
  return sender;
}

function openTrophies(player) {
  if (!isMainGame(player)) return false;
  const { group, items, flags, openScript, title } = records().trophies;
  const sender = openModal(player, group);
  // As captured: slot 0 to the trophy count (0-35 for rev 229's 35 trophies).
  sender.sendInterfaceFlagsRange(uid(group, items), 0, trophies().length, eventFlags(flags));
  sender.sendInterfaceScript(openScript, [title, ...masks(player)]);
  return true;
}

function examine(player, item) {
  const text = Common.core.ItemDefinition.forId(item)?.getExamine?.();
  if (text) player.sendMessage(text);
}

/** Take hands out an earned trophy the character doesn't hold; Store takes a held one back from the inventory. */
function clickTrophy(event) {
  const { player } = event;
  if (!isMainGame(player)) return false;
  // A click reaches the server only from the open screen; a crafted one elsewhere does nothing.
  if (player.getInterfaceId() !== records().trophies.group) return true;
  const trophy = trophies()[Number(event.slot)];
  if (!trophy) return true;
  if (Number(event.opId ?? event.action) === EXAMINE_OP) {
    examine(player, trophy.item);
    return true;
  }
  const inventory = player.getInventory();
  if (!holds(player, trophy.item)) {
    if (!earned(player, trophy)) return true;
    if (inventory.getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    inventory.adds(trophy.item, 1);
  } else if (inventory.contains(trophy.item)) {
    inventory.delete(trophy.item, 1);
  } else {
    return true;
  }
  player.getPacketSender().sendInterfaceScript(records().trophies.updateScript, masks(player));
  return true;
}

function claimTrophies({ player }) {
  return openTrophies(player);
}

/** The Leagues Tutor's conversation ends in open_interface "League trophies". */
function dialogueAction(event) {
  if (event.handled || event.action !== "open_interface" || event.target !== TROPHIES_TARGET || !isMainGame(event.player)) return;
  event.handled = true;
  event.end = true;
  // The conversation closes its window as it ends; the trophies open on the next tick.
  Common.later(event.player, 1, () => openTrophies(event.player));
}

function openStatistics(player) {
  if (!isMainGame(player)) return false;
  const { group, script, components } = records().statistics;
  const sender = openModal(player, group);
  sender.sendInterfaceScript(script, [
    ...components.map((child) => uid(group, child)),
    player.getDisplayName(),
    ...leagueTypes().map((type) => pointsIn(player, type)),
  ]);
  return true;
}

function openRankings(player) {
  if (!isMainGame(player)) return false;
  openModal(player, records().rankings.group);
  return true;
}

/** The firsts table for `league`, then its dropdown's one slot per league. */
function showFirsts(player, league) {
  const { group, script, components, dropdown } = records().firsts;
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(script, [...components.map((child) => uid(group, child)), league]);
  sender.sendInterfaceFlagsRange(uid(group, dropdown), 1, leagueTypes().length, FLAG_OP1);
}

function openFirsts(player) {
  if (!isMainGame(player)) return false;
  openModal(player, records().firsts.group);
  showFirsts(player, leagueTypes().at(-1));
  return true;
}

function pickFirsts({ player, slot }) {
  if (player.getInterfaceId() !== records().firsts.group) return true;
  const league = Number(slot);
  if (!leagueTypes().includes(league)) return true;
  showFirsts(player, league);
  return true;
}

function scrollStatistics({ player }) {
  return openStatistics(player);
}

function scrollRankings({ player }) {
  return openRankings(player);
}

function scrollFirsts({ player }) {
  return openFirsts(player);
}

const SCREENS = { trophies: openTrophies, statistics: openStatistics, rankings: openRankings, firsts: openFirsts };

function recordsCommand({ player, parts }) {
  const open = SCREENS[String(parts[1] ?? "").toLowerCase()];
  if (!open) {
    player.sendMessage(`Use ::leaguerecords <${Object.keys(SCREENS).join("|")}>.`);
    return true;
  }
  if (open(player) === false) player.sendMessage("League records open on a main character in the main game.");
  return true;
}

/** The trophy list's and the firsts dropdown's components. */
function buttons() {
  const { trophies: trophyScreen, firsts } = records();
  return { trophyItems: uid(trophyScreen.group, trophyScreen.items), firstsDropdown: uid(firsts.group, firsts.dropdown) };
}

module.exports = function attach(api) {
  const { trophyItems, firstsDropdown } = buttons();
  api.onPlayerLogin(login);
  api.onPlayerLogout(logout);
  api.onCustomEvent("league:account-points", accountPoints);
  api.onNpcInteraction(TUTOR, { "Claim-trophies": claimTrophies });
  api.onCustomEvent("npc-dialogue:action", dialogueAction);
  api.onObjectInteraction(SCROLL, { "League-statistics": scrollStatistics, "League-rankings": scrollRankings, "League-firsts": scrollFirsts });
  api.onInterfaceActionButton(trophyItems, clickTrophy);
  api.onInterfaceActionButton(firstsDropdown, pickFirsts);
  api.registerCommand("leaguerecords", recordsCommand, api.core.PlayerRights.DEVELOPER,
    "Open a league record screen: ::leaguerecords <trophies|statistics|rankings|firsts>");
};

module.exports._test = { savedPoints, masks, trophies, readSavedPoints };
