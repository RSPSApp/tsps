"use strict";

/**
 * A player's Theatre of Blood records: attempts, completions, deaths and best times per mode, the
 * lines the last wave reports them in, and the scoreboard by the entrance (363).
 *
 * Captured (227/01764, 234/03299, 227/00554, 227/01852): at Verzik's defeat, the wave's line with
 * "Theatre of Blood completion time" (the challenge time), "Theatre of Blood total completion
 * time" (the overall time), each " (new personal best)" or ". Personal best: m:ss.cc", then
 * "Your completed Theatre of Blood[: Entry Mode|: Hard Mode] count is: N.".
 * "Your party beat the overall target time of m:ss!" was captured for the Tombs; the Theatre's
 * Hard Mode uses the same words here (no Theatre capture has a Hard Mode raid inside its target).
 * Wiki (Scoreboard): personal and global attempts, completions, deaths and completion times.
 * Cache: tob_scoreboard (363), its View tabs (components 4-6, varbit 12270 tob_scoreboard_tab, script
 * 4492: 0 Normal, 1 Entry, 2 Hard) and its text grid, components 41-66. No capture opens it, so
 * which grid cell shows what is an estimate: read off the labels' order, Global then Personal.
 * This world's "global" values are the viewer's world totals since it started; nothing persists them.
 *
 * Sinhaza shrouds (Wiki: Sinhaza shroud tier 1, Theatre of Blood; Transcript:Mysterious Stranger): tiers 1-5
 * at 100, 500, 1000, 1500 and 2000 Normal or Hard completions, taken from the Mysterious Stranger ("What do
 * you have for me?", "The Mysterious Stranger hands you a cape."). Change swaps a shroud to another earned
 * tier. Our wording: the refusal of a tier not earned yet.
 */

const Shared = require("./Shared.TheatreOfBlood");

const ATTR_STATS = "tob:stats";
/** Kept as they were: older saves and the quests read them. */
const ATTR_COMPLETIONS = { entry: "tob:entry-completions", normal: "tob:completions", hard: "tob:hard-completions" };
const COUNT_NAME = { entry: "Theatre of Blood: Entry Mode", normal: "Theatre of Blood", hard: "Theatre of Blood: Hard Mode" };
const TAB_MODES = ["normal", "entry", "hard"];
const SCOREBOARD = 363;
const TAB_VARBIT = 12270;
const TAB_FIRST = 4;
const GRID_FIRST = 41;
const SCOREBOARDS = ["Scoreboard"];
const SIZES = [1, 2, 3, 4, 5];
const SHROUD_COMPLETIONS = [100, 500, 1000, 1500, 2000];
const SHROUD_NAMES = ["SINHAZA_SHROUD_TIER_1", "SINHAZA_SHROUD_TIER_2", "SINHAZA_SHROUD_TIER_3", "SINHAZA_SHROUD_TIER_4", "SINHAZA_SHROUD_TIER_5"];
const SHROUD_CONDITION = {
  NONE: "If the player hasn't earned any Sinhaza shrouds:",
  SOME: "If the player has earned any Sinhaza shrouds:",
  CLAIM: "If the player can claim a Sinhaza shroud:",
};
const SHROUD_OPTION = /^Take Sinhaza shroud tier ([1-5])\.$/;
const SHROUD_HANDED = "The Mysterious Stranger hands you a cape.";

/** The world's totals since it started, for the scoreboard's Global column. */
const world = {
  entry: emptyStats(),
  normal: emptyStats(),
  hard: emptyStats(),
};

function emptyStats() {
  return { attempts: 0, deaths: 0, completions: 0, overall: {}, challenge: {} };
}

function statsOf(player, mode) {
  const all = player.getAttribute(ATTR_STATS);
  return { ...emptyStats(), ...(all?.[mode] ?? {}) };
}

function saveStats(player, mode, stats) {
  const all = { ...(player.getAttribute(ATTR_STATS) ?? {}) };
  all[mode] = stats;
  player.setAttribute(ATTR_STATS, all);
}

function completionsOf(player, mode) {
  return Number(player.getAttribute(ATTR_COMPLETIONS[mode])) || 0;
}

/** Whether a player may join Hard Mode (Wiki: a Normal Mode completion). */
function canPlayHard(player) {
  return completionsOf(player, "normal") > 0;
}

// ---------------------------------------------------------------- the raid's events

function raidEntered({ raid, player }) {
  const stats = statsOf(player, raid.mode);
  stats.attempts++;
  saveStats(player, raid.mode, stats);
  world[raid.mode].attempts++;
}

function playerDied({ raid, player }) {
  const stats = statsOf(player, raid.mode);
  stats.deaths++;
  saveStats(player, raid.mode, stats);
  world[raid.mode].deaths++;
}

/** " (new personal best)" or ". Personal best: m:ss.cc", saving the new best. */
function bestSuffix(best, size, ticks) {
  const previous = best[size];
  if (previous === undefined || ticks < previous) {
    best[size] = ticks;
    return " (new personal best)";
  }
  return `. Personal best: ${Shared.formatTicks(previous)}`;
}

/** The last wave, for one player: its line, the records and the count, in the captured order. */
function raidWon({ raid, player, wave }) {
  const { mode, size } = raid;
  const stats = statsOf(player, mode);
  const challenge = bestSuffix(stats.challenge, size, raid.totalTicks);
  const overall = bestSuffix(stats.overall, size, raid.overallTicks);
  stats.completions++;
  saveStats(player, mode, stats);
  world[mode].completions++;
  const worldBest = world[mode];
  worldBest.challenge[size] = Math.min(worldBest.challenge[size] ?? Infinity, raid.totalTicks);
  worldBest.overall[size] = Math.min(worldBest.overall[size] ?? Infinity, raid.overallTicks);
  player.sendMessage(`${wave}<br>Theatre of Blood completion time: <col=ff0000>${Shared.formatTicks(raid.totalTicks)}</col>${challenge}`);
  player.sendMessage(`Theatre of Blood total completion time: <col=ff0000>${Shared.formatTicks(raid.overallTicks)}</col>${overall}`);
  const count = countCompletion(player, mode);
  const target = Shared.MODES[mode].challengeTicks?.[size];
  if (target && raid.overallTicks <= target) {
    player.sendMessage(`<col=229628>Your party beat the overall target time of ${Math.floor((target * 0.6) / 60)}:00!</col>`);
  }
  Shared.api().emitCustomEvent("tob:counted", { raid, player, mode, count });
}

/** The count goes up, is announced, and the quests waiting on a clear hear it. */
function countCompletion(player, mode = "normal") {
  const count = completionsOf(player, mode) + 1;
  player.setAttribute(ATTR_COMPLETIONS[mode], count);
  player.sendMessage(`Your completed ${COUNT_NAME[mode]} count is: <col=ff0000>${count}</col>.`);
  Shared.api().emitCustomEvent("tob:completed", { player, mode });
  return count;
}

/** A clear of any mode finishes "A Night at the Theatre"'s raid step. */
function hasCompletion(request) {
  const { player } = request;
  if (Object.keys(ATTR_COMPLETIONS).some((mode) => completionsOf(player, mode) > 0)) request.complete = true;
}

// ---------------------------------------------------------------- Sinhaza shrouds

const shroudIds = () => SHROUD_NAMES.map((name) => Shared.core().ItemIdentifiers[name]);

/** The tiers earned so far, 1-5: Normal and Hard completions count (Wiki). */
function shroudTiers(player) {
  const count = completionsOf(player, "normal") + completionsOf(player, "hard");
  return SHROUD_COMPLETIONS.filter((needed) => count >= needed).length;
}

function strangerPage(pages) {
  return (pages ?? []).some((entry) => String(entry.page ?? "").replace(/^Transcript:/, "") === "Mysterious Stranger");
}

/** The Stranger's transcript asks whether shrouds are earned and claimable. */
function shroudCondition({ player, text, pages }) {
  if (!strangerPage(pages)) return undefined;
  const earned = shroudTiers(player) > 0;
  if (text === SHROUD_CONDITION.NONE) return !earned;
  if (text === SHROUD_CONDITION.SOME || text === SHROUD_CONDITION.CLAIM) return earned;
  return undefined;
}

function shroudChoice({ player, option }) {
  const match = SHROUD_OPTION.exec(String(option ?? ""));
  if (match) player.__tobShroudChoice = Number(match[1]);
}

/** "The Mysterious Stranger hands you a cape.": the tier chosen, if it's earned. */
function shroudHanded(event) {
  const { player } = event;
  if (event.text !== SHROUD_HANDED || !strangerPage(event.pages)) return;
  const tier = player.__tobShroudChoice ?? 0;
  player.__tobShroudChoice = undefined;
  const refuse = (line) => {
    event.handled = true;
    event.end = true;
    player.sendMessage(line);
  };
  if (tier < 1 || tier > shroudTiers(player)) {
    refuse(`You need ${SHROUD_COMPLETIONS[Math.max(0, tier - 1)]} Theatre of Blood completions for that one.`);
    return;
  }
  const { Item } = Shared.core();
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0) {
    refuse("You don't have enough inventory space.");
    return;
  }
  const id = shroudIds()[tier - 1];
  inventory.add(new Item(id, 1), true);
  // The transcript's box shows the cape (tbox pic).
  event.box = { items: [id] };
}

/** Change: the next tier the player has earned, round again after the highest. */
function changeShroud(event) {
  const { player } = event;
  const ids = shroudIds();
  const item = event.item ?? player.getInventory().getItems()[event.slot];
  const tier = ids.indexOf(item?.getId?.()) + 1;
  const earned = shroudTiers(player);
  if (tier < 1) return;
  if (earned <= 1) {
    player.sendMessage("You haven't earned another tier of the shroud yet.");
    return;
  }
  item.setId(ids[tier % earned]);
  player.getInventory().refreshItems();
}

// ---------------------------------------------------------------- the scoreboard

function timeText(ticks) {
  return ticks === undefined || ticks === Infinity ? "-" : Shared.formatTicks(ticks);
}

/** Global and Personal: attempts, completions, deaths; then each size's four best times. */
function gridOf(player, mode) {
  const mine = statsOf(player, mode);
  const all = world[mode];
  const cells = [all.attempts, mine.attempts, all.completions, mine.completions, all.deaths, mine.deaths].map(String);
  for (const size of SIZES) {
    cells.push(timeText(all.overall[size]), timeText(all.challenge[size]), timeText(mine.overall[size]), timeText(mine.challenge[size]));
  }
  return cells;
}

function sendScoreboard(player) {
  const sender = player.getPacketSender();
  const tab = sender.getVarbit?.(TAB_VARBIT) ?? 0;
  gridOf(player, TAB_MODES[tab] ?? "normal").forEach((text, index) => sender.sendString(text, (SCOREBOARD << 16) | (GRID_FIRST + index)));
}

function openScoreboard(event) {
  const { player } = event;
  if (!Shared.inVerSinhaza(player.getLocation())) return false;
  player.getPacketSender().sendInterface(SCOREBOARD);
  sendScoreboard(player);
  return true;
}

function clickTab({ player, buttonId }) {
  player.getPacketSender().sendVarbit(TAB_VARBIT, (buttonId & 0xffff) - TAB_FIRST);
  sendScoreboard(player);
}

module.exports = function registerTheatreStats(api) {
  Shared.bind(api);
  api.persistAttribute(ATTR_STATS);
  for (const attribute of Object.values(ATTR_COMPLETIONS)) api.persistAttribute(attribute);
  api.onCustomEvent("tob:raid-entered", raidEntered);
  api.onCustomEvent("tob:player-died", playerDied);
  api.onCustomEvent("tob:raid-won", raidWon);
  api.onCustomEvent("tob:has-completion", hasCompletion);
  api.onNpcDialogueCondition(shroudCondition);
  api.onCustomEvent("npc-dialogue:choice", shroudChoice);
  api.onCustomEvent("npc-dialogue:action", shroudHanded);
  for (let tier = 1; tier <= SHROUD_NAMES.length; tier++) api.onItemAction(`Sinhaza shroud tier ${tier}`, { Change: changeShroud });
  Shared.onObject(api, SCOREBOARDS, openScoreboard);
  for (let component = TAB_FIRST; component < TAB_FIRST + TAB_MODES.length; component++) {
    api.onInterfaceActionButton((SCOREBOARD << 16) | component, clickTab);
  }
};

Object.assign(module.exports, { shroudTiers, shroudCondition, shroudChoice, shroudHanded, changeShroud, SHROUD_COMPLETIONS, ATTR_STATS, ATTR_COMPLETIONS, statsOf, completionsOf, canPlayHard, countCompletion, raidWon, raidEntered, playerDied, hasCompletion, gridOf, bestSuffix, openScoreboard, clickTab });
