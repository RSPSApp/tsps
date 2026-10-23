/**
 * The Combat Achievements interfaces, as captured live: Overview (717), Tasks (715), Bosses (716),
 * a boss's page (713) and Rewards (714). Each opens as the main modal with its click events;
 * moving between them through the burger menu closes one and opens the next, and
 * ca_last_opened_interface remembers the last, which the account summary's row reopens. Filters,
 * the selected boss and the rewards tier are varbits the server sets from the clicks; everything
 * drawn comes from the cache's scripts reading the progress varbits (Progress.CombatAchievements).
 *
 *   Overview: a tier's button opens Tasks filtered to that tier.
 *   Tasks: four dropdowns (tier, type, monster, completed); a task's row is the client's own.
 *   Bosses: a boss is a pause button; it opens its page, with its personal best in varp 261.
 *   Boss page: "Boss list" (the server recounts every count first), "Reset time", the progress
 *   bar (Tasks filtered to the boss), "Locate" (the world map at the boss) and "Collection-log".
 *   Rewards: a tier's button selects it.
 */
const Data = require("./Data.CombatAchievements");
const Progress = require("./Progress.CombatAchievements");
const MONSTERS_DATA = require("./data/monsters.json");

const VIEW_ATTRIBUTE = "combat-achievements:view";

const GROUP = { BOSS: 713, REWARDS: 714, TASKS: 715, BOSSES: 716, OVERVIEW: 717 };
/** ca_last_opened_interface's values. */
const SCREEN = { OVERVIEW: 0, TASKS: 1, REWARDS: 2, BOSSES: 3, BOSS: 4 };
const SCREEN_GROUP = { [SCREEN.OVERVIEW]: GROUP.OVERVIEW, [SCREEN.TASKS]: GROUP.TASKS, [SCREEN.REWARDS]: GROUP.REWARDS, [SCREEN.BOSSES]: GROUP.BOSSES, [SCREEN.BOSS]: GROUP.BOSS };
/** The burger menu's entries (slots 10-16; the overview's own menu starts at Tasks). */
const BURGER_SCREEN = { 10: SCREEN.OVERVIEW, 12: SCREEN.TASKS, 14: SCREEN.BOSSES, 16: SCREEN.REWARDS };

const VARBIT = {
  FILTER_TIER: 12858,
  FILTER_TYPE: 12859,
  FILTER_MONSTER: 12860,
  FILTER_COMPLETED: 12861,
  BOSS_SELECTED: 12862,
  LAST_OPENED: 17940,
  REWARD_TIER: 17941,
};
const VIEW_VARBITS = Object.values(VARBIT);
const PERSONAL_BEST_VARP = 261; // if1: the boss page reads it (script 4843), -1 shows "N/A"
const NO_PERSONAL_BEST = -1;

const MAIN_MODAL = (161 << 16) | 16;
const MODAL = 0;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_WORLDMAP_LOCATE = 3331;
const WORLDMAP = 595;
const WORLDMAP_NOCLICK = 3;
const BOSS_COORD_PARAM = 1317;
const BOSS_STRUCT_NAME_PARAM = 1313;

const OP1 = 1 << 1;
const PAUSE_BUTTON = 1 << 0;

const COMPONENT = {
  OVERVIEW_BURGER: 17, OVERVIEW_TIERS: 8,
  TASKS_BURGER: 25, TASKS_LIST: 9, DROPDOWN_TIER: 30, DROPDOWN_TYPE: 31, DROPDOWN_MONSTER: 32, DROPDOWN_COMPLETED: 33,
  BOSSES_BURGER: 23, BOSSES_LIST: 15,
  BOSS_BURGER: 27, BOSS_STATS: 23, BOSS_PROGRESS: 24, BOSS_MAP: 9, BOSS_COLLECTION: 13,
  REWARDS_BURGER: 16, REWARDS_TIERS: 17,
};
const BOSS_STATS_LIST = 0;
const BOSS_STATS_RESET_TIME = 1;

const uid = (group, child) => (group << 16) | child;

let pluginApi;

function view(player) {
  return { ...(player.getAttribute(VIEW_ATTRIBUTE) ?? {}) };
}

function setView(player, varbit, value) {
  const saved = view(player);
  saved[varbit] = value;
  player.setAttribute(VIEW_ATTRIBUTE, saved);
  player.getPacketSender().sendVarbit(varbit, value);
}

/** The view varbits as left last session (filters, selected boss, last screen), at login. */
function restore(player) {
  const saved = view(player);
  for (const varbit of VIEW_VARBITS) {
    const value = Number(saved[varbit]) || 0;
    if (value) player.getPacketSender().sendVarbit(varbit, value);
  }
}

function sendEvents(player, screen) {
  const sender = player.getPacketSender();
  const events = (group, child, from, to, flags = OP1) => sender.sendInterfaceFlagsRange(uid(group, child), from, to, flags);
  switch (screen) {
    case SCREEN.OVERVIEW:
      events(GROUP.OVERVIEW, COMPONENT.OVERVIEW_BURGER, 12, 16);
      events(GROUP.OVERVIEW, COMPONENT.OVERVIEW_TIERS, 0, Data.tiers().length - 1);
      break;
    case SCREEN.TASKS:
      events(GROUP.TASKS, COMPONENT.DROPDOWN_TIER, 1, 8);
      events(GROUP.TASKS, COMPONENT.DROPDOWN_COMPLETED, 1, 4);
      events(GROUP.TASKS, COMPONENT.DROPDOWN_TYPE, 1, 8);
      events(GROUP.TASKS, COMPONENT.DROPDOWN_MONSTER, 1, Data.monsters().size + 2);
      events(GROUP.TASKS, COMPONENT.TASKS_LIST, 0, Data.tasks().size);
      events(GROUP.TASKS, COMPONENT.TASKS_BURGER, 10, 16);
      break;
    case SCREEN.REWARDS:
      events(GROUP.REWARDS, COMPONENT.REWARDS_BURGER, 10, 16);
      events(GROUP.REWARDS, COMPONENT.REWARDS_TIERS, 0, Data.tiers().length - 1);
      break;
    case SCREEN.BOSSES:
      events(GROUP.BOSSES, COMPONENT.BOSSES_BURGER, 10, 16);
      events(GROUP.BOSSES, COMPONENT.BOSSES_LIST, 0, Data.bossList().length, PAUSE_BUTTON | OP1);
      break;
    case SCREEN.BOSS:
      events(GROUP.BOSS, COMPONENT.BOSS_BURGER, 10, 16);
      events(GROUP.BOSS, COMPONENT.BOSS_STATS, 0, 1);
      events(GROUP.BOSS, COMPONENT.BOSS_PROGRESS, 0, 0);
      break;
    default:
      break;
  }
}

function currentScreen(player) {
  const saved = Number(view(player)[VARBIT.LAST_OPENED]) || 0;
  return SCREEN_GROUP[saved] !== undefined ? saved : SCREEN.OVERVIEW;
}

/**
 * Shows a screen in the main modal: from outside (the account summary) with the main modal's
 * open script; from another of these screens, closing it first (the bosses list hands its boss
 * page straight over, as captured).
 */
function show(player, screen, { from = null } = {}) {
  const sender = player.getPacketSender();
  setView(player, VARBIT.LAST_OPENED, screen);
  if (from === null) {
    pluginApi?.emitCustomEvent("collection-log:close", { player });
    sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  } else if (!(from === SCREEN.BOSSES && screen === SCREEN.BOSS)) {
    sender.closeInterface(SCREEN_GROUP[from]);
  }
  player.setInterfaceId(SCREEN_GROUP[screen]);
  sender.sendSubInterface(MAIN_MODAL, SCREEN_GROUP[screen], MODAL);
  sendEvents(player, screen);
}

/** A collection log boss category's button: that boss's page. */
function openForCollectionLog(player, categoryName) {
  const { CacheDefinitions } = pluginApi.core;
  const boss = Data.bossList().find((each) => {
    const name = String(CacheDefinitions.getStructParams(bossStruct(each.position)).get(BOSS_STRUCT_NAME_PARAM));
    return (MONSTERS_DATA.collectionLog[name] ?? name) === categoryName;
  });
  if (!boss) return open(player);
  setView(player, VARBIT.BOSS_SELECTED, boss.position);
  open(player, SCREEN.BOSS);
}

/** The account summary's Combat Achievements row: the screen used last (or `screen`). */
function open(player, screen = currentScreen(player)) {
  if (screen === SCREEN.BOSS) player.getPacketSender().sendConfig(PERSONAL_BEST_VARP, personalBest(player, selectedBoss(player)?.monster));
  show(player, screen);
}

function selectedBoss(player) {
  const position = Number(view(player)[VARBIT.BOSS_SELECTED]) || 0;
  return Data.bossList().find((boss) => boss.position === position) ?? null;
}

/** A boss plugin that keeps a best time answers in ticks: { player, monster, best }. */
function personalBest(player, monster) {
  if (!monster) return NO_PERSONAL_BEST;
  const request = { player, monster: monster.name, best: null };
  pluginApi?.emitCustomEvent("combat-achievements:personal-best", request);
  return Number.isInteger(request.best) && request.best > 0 ? request.best : NO_PERSONAL_BEST;
}

function openBoss(player, position, from) {
  const boss = Data.bossList().find((each) => each.position === position);
  if (!boss) return;
  setView(player, VARBIT.BOSS_SELECTED, position);
  player.getPacketSender().sendConfig(PERSONAL_BEST_VARP, personalBest(player, boss.monster));
  show(player, SCREEN.BOSS, { from });
}

/** Tasks filtered to a tier or a monster; as captured, a filter set to something else goes to 0 first. */
function openTasks(player, from, { tier = 0, monster = 0 } = {}) {
  for (const [varbit, value] of [[VARBIT.FILTER_MONSTER, monster], [VARBIT.FILTER_TIER, tier]]) {
    const current = Number(view(player)[varbit]) || 0;
    if (current === value) continue;
    if (current !== 0 && value !== 0) setView(player, varbit, 0);
    setView(player, varbit, value);
  }
  show(player, SCREEN.TASKS, { from });
}

function bossStruct(position) {
  return Number(pluginApi.core.CacheDefinitions.getEnumValues(3987).get(position));
}

/** "Locate": the world map, centred on the boss. */
function locate(player) {
  const boss = selectedBoss(player);
  if (!boss) return;
  const coord = Number(pluginApi.core.CacheDefinitions.getStructParams(bossStruct(boss.position)).get(BOSS_COORD_PARAM));
  if (!Number.isFinite(coord)) return;
  // As captured: the world map opens as it always does, then the script centres it on the boss.
  const sender = player.getPacketSender();
  if (!sender.isWorldMapOpen()) sender.toggleWorldMap();
  sender.sendInterfaceScript(SCRIPT_WORLDMAP_LOCATE, [uid(WORLDMAP, WORLDMAP_NOCLICK), coord, -1]);
}

function openCollectionLog(player) {
  const boss = selectedBoss(player);
  if (!boss) return;
  const name = String(pluginApi.core.CacheDefinitions.getStructParams(bossStruct(boss.position)).get(BOSS_STRUCT_NAME_PARAM));
  player.getPacketSender().closeInterface(GROUP.BOSS);
  pluginApi.emitCustomEvent("collection-log:open", { player, category: MONSTERS_DATA.collectionLog[name] ?? name });
}

function resetTime(player) {
  const boss = selectedBoss(player);
  if (!boss?.monster) return;
  const request = { player, monster: boss.monster.name, handled: false };
  pluginApi.emitCustomEvent("combat-achievements:reset-best", request);
  if (request.handled) player.getPacketSender().sendConfig(PERSONAL_BEST_VARP, NO_PERSONAL_BEST);
}

function burger(player, from, slot) {
  const screen = BURGER_SCREEN[slot];
  if (screen === undefined || screen === from) return;
  show(player, screen, { from });
}

/** onInterfaceActionClick: true when the click was one of these screens'. */
function click(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const group = event.groupId ?? (buttonId >>> 16);
  const child = event.childId ?? (buttonId & 0xffff);
  const slot = Number(event.slot ?? event.action);
  const { player } = event;
  switch (group) {
    case GROUP.OVERVIEW:
      if (child === COMPONENT.OVERVIEW_BURGER) burger(player, SCREEN.OVERVIEW, slot);
      else if (child === COMPONENT.OVERVIEW_TIERS && Data.tiers()[slot]) openTasks(player, SCREEN.OVERVIEW, { tier: slot + 1 });
      else return false;
      return true;
    case GROUP.TASKS:
      if (child === COMPONENT.TASKS_BURGER) burger(player, SCREEN.TASKS, slot);
      else if (child === COMPONENT.DROPDOWN_TIER) setView(player, VARBIT.FILTER_TIER, slot - 1);
      else if (child === COMPONENT.DROPDOWN_TYPE) setView(player, VARBIT.FILTER_TYPE, slot - 1);
      else if (child === COMPONENT.DROPDOWN_MONSTER) setView(player, VARBIT.FILTER_MONSTER, slot - 1);
      else if (child === COMPONENT.DROPDOWN_COMPLETED) setView(player, VARBIT.FILTER_COMPLETED, slot - 1);
      else if (child !== COMPONENT.TASKS_LIST) return false;
      return true;
    case GROUP.BOSSES:
      if (child === COMPONENT.BOSSES_BURGER) burger(player, SCREEN.BOSSES, slot);
      else if (child === COMPONENT.BOSSES_LIST) openBoss(player, slot, SCREEN.BOSSES);
      else return false;
      return true;
    case GROUP.BOSS:
      if (child === COMPONENT.BOSS_BURGER) {
        burger(player, SCREEN.BOSS, slot);
      } else if (child === COMPONENT.BOSS_STATS && slot === BOSS_STATS_LIST) {
        Progress.sendCounts(player);
        show(player, SCREEN.BOSSES, { from: SCREEN.BOSS });
      } else if (child === COMPONENT.BOSS_STATS && slot === BOSS_STATS_RESET_TIME) {
        resetTime(player);
      } else if (child === COMPONENT.BOSS_PROGRESS) {
        openTasks(player, SCREEN.BOSS, { monster: selectedBoss(player)?.monster?.key ?? 0 });
      } else if (child === COMPONENT.BOSS_MAP) {
        locate(player);
      } else if (child === COMPONENT.BOSS_COLLECTION) {
        openCollectionLog(player);
      } else {
        return false;
      }
      return true;
    case GROUP.REWARDS:
      if (child === COMPONENT.REWARDS_BURGER) burger(player, SCREEN.REWARDS, slot);
      else if (child === COMPONENT.REWARDS_TIERS && Data.tiers()[slot]) setView(player, VARBIT.REWARD_TIER, slot);
      else return false;
      return true;
    default:
      return false;
  }
}

function onClick(event) {
  if (event?.player && click(event)) event.handled = true;
}

module.exports = function attachInterface(api) {
  pluginApi = api;
  api.persistAttribute(VIEW_ATTRIBUTE, {});
  api.onInterfaceActionClick(onClick);
};

Object.assign(module.exports, { VIEW_ATTRIBUTE, GROUP, SCREEN, VARBIT, restore, open, openForCollectionLog, show, click, onClick });
