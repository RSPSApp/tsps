"use strict";

/**
 * Stealing artefacts, Port Piscarilius (https://oldschool.runescape.wiki/w/Stealing_artefacts):
 * shared state and helpers. Khaled's task, the drawers, the guards and the run's lifecycle each
 * live in the units beside this file and read/write through here.
 *
 * Ids from the cache (`dump-loc Drawers`): the six Pick-lock drawers are 27771 (1767,3750, z0,
 * North), 27776 (1750,3763, z1, North-West), 27775 (1747,3749, z1, West), 27774 (1749,3735, z1,
 * South-West), 27773 (1764,3735, z1, South) and 27772 (1773,3730, z1, South-East). The house
 * centres are the Wiki's RuneLite tile markers for region 6970; every drawer is nearest its own
 * marker. The artefacts (13434-13438) are already Destroy-only, unnotable and untradeable in the
 * cache; banking is refused in Session.
 *
 * The Wiki does not document the guards' sight or catch chance. They pursue a carrier within
 * SIGHT_RADIUS tiles and an adjacent guard catches deterministically, with no roll.
 */

const TASK_ATTRIBUTE = "stealing-artefacts:task";
const FAILED_ATTRIBUTE = "stealing-artefacts:failed";

const THIEVING_LEVEL = 49;
const STEAL_XP = 750;
const HAND_IN_XP_PER_LEVEL = 40;
const REWARD_MIN = 500;
const REWARD_MAX = 1000;
const COINS = 995;

/** Guards chase a carrying player within this many tiles; an adjacent guard catches. */
const SIGHT_RADIUS = 8;

const MESSAGES = {
  caught: "The guards catch you and confiscate the artefact!",
  stole: "You pick the lock and retrieve the goods.",
  wrongDrawer: "You have no reason to do that.",
  unbankable: "You can't bank stolen artefacts.",
  noSpace: "You don't have enough inventory space.",
  level: `You need a Thieving level of ${THIEVING_LEVEL} to steal artefacts.`,
};

/** The six houses Khaled assigns, and the drawer each holds. */
const HOUSES = [
  { name: "North", label: "northern house", drawer: 27771 },
  { name: "North-West", label: "north-western house", drawer: 27776 },
  { name: "West", label: "western house", drawer: 27775 },
  { name: "South-West", label: "south-western house", drawer: 27774 },
  { name: "South", label: "southern house", drawer: 27773 },
  { name: "South-East", label: "south-eastern house", drawer: 27772 },
];
const DRAWER_IDS = HOUSES.map((house) => house.drawer);

/** Where a caught player lands: beside Leenz (spawned at 1807,3723). */
const LEENZ_TILE = { x: 1806, y: 3723, z: 0 };

/** Port Piscarilius' residential district, foodhall and bank: where the patrol chases. */
const PATROL_AREA = { minX: 1730, maxX: 1870, minY: 3690, maxY: 3810, z: 0 };

/** Captain Khaled's transcript pages (npc-dialogues.json / the Wiki transcript). */
const VARIANT = {
  deliver: "standard-dialogue-delivering-the-artefact",
  failed: "standard-dialogue-getting-caught-or-losing-the-artefact",
  tasked: "standard-dialogue-before-stealing-delivering-an-artefact",
  standard: "standard-dialogue",
};

const state = { api: null, core: null, artefacts: [], artefactIds: new Set(), guardIds: new Set(), khaledIds: new Set() };

/** player -> { house, artefactId }: the live run, dropped when it ends. */
const sessions = new Map();

function bind(api) {
  state.api = api;
  state.core = api.core;
  const Items = api.core.ItemIdentifiers;
  // The Wiki lists the same five artefacts at 1/5 each.
  state.artefacts = [
    Items.STOLEN_PENDANT, Items.STOLEN_GARNET_RING, Items.STOLEN_CIRCLET,
    Items.STOLEN_FAMILY_HEIRLOOM, Items.STOLEN_JEWELRY_BOX,
  ];
  state.artefactIds = new Set(state.artefacts);
  const Npcs = api.core.NpcIdentifiers;
  state.guardIds = new Set([
    Npcs.PATROLMAN, Npcs.PATROLMAN_2, Npcs.PATROLMAN_3, Npcs.PATROLWOMAN,
    Npcs.PATROLMAN_4, Npcs.PATROLWOMAN_2, Npcs.PATROLMAN_5, Npcs.PATROLMAN_6,
  ]);
  state.khaledIds = new Set([Npcs.CAPTAIN_KHALED, Npcs.CAPTAIN_KHALED_2]);
}

const getCore = () => state.core;
const getApi = () => state.api;
const isArtefact = (itemId) => state.artefactIds.has(itemId);
const isGuard = (npcId) => state.guardIds.has(npcId);
const isKhaled = (npcId) => state.khaledIds.has(npcId);

function thievingLevel(player) {
  return player.getSkillManager().getCurrentLevel(getCore().Skill.THIEVING);
}

function taskOf(player) {
  const task = player.getAttribute(TASK_ATTRIBUTE);
  return task && typeof task === "object" && typeof task.house === "string" ? task : null;
}

function failedOf(player) {
  return player.getAttribute(FAILED_ATTRIBUTE) === true;
}

function houseByName(name) {
  return HOUSES.find((house) => house.name === name) ?? null;
}

/** The task hint line from the Wiki transcript, house filled in. */
function taskLine(house) {
  return `You need to recover an artefact for me. It can be found in the ${house.label}.`;
}

/** Assigns a fresh run, replacing any previous one. */
function assignTask(player, house = rollHouse()) {
  player.setAttribute(TASK_ATTRIBUTE, { house: house.name });
  player.setAttribute(FAILED_ATTRIBUTE, null);
  sessions.set(player, { house: house.name, artefactId: null });
  return house;
}

/** The run is over: nothing left to steal for, and Khaled owes the failure line. */
function endRun(player) {
  player.setAttribute(TASK_ATTRIBUTE, null);
  player.setAttribute(FAILED_ATTRIBUTE, true);
  sessions.delete(player);
}

/** Drops the in-memory run without touching the task (logout keeps a task not yet stolen for). */
function forgetSession(player) {
  sessions.delete(player);
}

// --- Rolls. Pure so the tests can pin the ends (1/6 house, 1/5 artefact, 500-1000 coins).

function rollHouse(random = Math.random) {
  return HOUSES[Math.min(HOUSES.length - 1, Math.floor(random() * HOUSES.length))];
}

function rollArtefact(random = Math.random) {
  return state.artefacts[Math.min(state.artefacts.length - 1, Math.floor(random() * state.artefacts.length))];
}

function rollReward(random = Math.random) {
  const span = REWARD_MAX - REWARD_MIN + 1;
  return REWARD_MIN + Math.min(span - 1, Math.floor(random() * span));
}

// --- Carrying

/** The artefact id the player carries, or 0. */
function carriedArtefactId(player) {
  const inventory = player.getInventory();
  const session = sessions.get(player);
  if (session?.artefactId && inventory.getAmount(session.artefactId) > 0) return session.artefactId;
  for (const id of state.artefacts) {
    if (inventory.getAmount(id) > 0) {
      if (session) session.artefactId = id;
      else sessions.set(player, { house: taskOf(player)?.house ?? null, artefactId: id });
      return id;
    }
  }
  return 0;
}

function giveArtefact(player, itemId) {
  player.getInventory().addItem(new (getCore().Item)(itemId, 1));
  const session = sessions.get(player);
  if (session) session.artefactId = itemId;
  else sessions.set(player, { house: taskOf(player)?.house ?? null, artefactId: itemId });
  return itemId;
}

/** Removes the carried artefact, fails the run and (optionally) says why. */
function loseArtefact(player, message) {
  const itemId = carriedArtefactId(player);
  if (!itemId) return false;
  player.getInventory().deleteNumber(itemId, 1);
  endRun(player);
  if (message) player.sendMessage(message);
  return true;
}

// --- Rewards

/** Khaled takes the artefact: 500-1,000 coins and 40 x the current level. 0 when empty-handed. */
function handIn(player, random = Math.random) {
  const itemId = carriedArtefactId(player);
  if (!itemId) return 0;
  player.getInventory().deleteNumber(itemId, 1);
  const coins = rollReward(random);
  player.getInventory().addItem(new (getCore().Item)(COINS, coins));
  player.getSkillManager().addExperiences(getCore().Skill.THIEVING, HAND_IN_XP_PER_LEVEL * thievingLevel(player));
  player.setAttribute(TASK_ATTRIBUTE, null);
  player.setAttribute(FAILED_ATTRIBUTE, null);
  sessions.delete(player);
  return coins;
}

// --- The guards

/** An adjacent guard confiscates the artefact and drops the player beside Leenz's. */
function guardCatch(player) {
  if (!loseArtefact(player, MESSAGES.caught)) return false;
  const { Location } = getCore();
  player.moveTo(new Location(LEENZ_TILE.x, LEENZ_TILE.y, LEENZ_TILE.z));
  return true;
}

// --- Dialogue

/** Which Khaled transcript suits the player now; the one-shot failure flag is spent here. */
function variantFor(player) {
  if (carriedArtefactId(player)) return VARIANT.deliver;
  if (failedOf(player)) {
    player.setAttribute(FAILED_ATTRIBUTE, null);
    return VARIANT.failed;
  }
  return taskOf(player) ? VARIANT.tasked : VARIANT.standard;
}

module.exports = {
  TASK_ATTRIBUTE,
  FAILED_ATTRIBUTE,
  THIEVING_LEVEL,
  STEAL_XP,
  HAND_IN_XP_PER_LEVEL,
  REWARD_MIN,
  REWARD_MAX,
  COINS,
  SIGHT_RADIUS,
  MESSAGES,
  HOUSES,
  DRAWER_IDS,
  LEENZ_TILE,
  PATROL_AREA,
  VARIANT,
  bind,
  getCore,
  getApi,
  isArtefact,
  isGuard,
  isKhaled,
  thievingLevel,
  taskOf,
  failedOf,
  houseByName,
  taskLine,
  assignTask,
  endRun,
  forgetSession,
  rollHouse,
  rollArtefact,
  rollReward,
  carriedArtefactId,
  giveArtefact,
  loseArtefact,
  handIn,
  guardCatch,
  variantFor,
};

module.exports._test = {
  bind,
  sessions,
  state,
  HOUSES,
  DRAWER_IDS,
  MESSAGES,
  LEENZ_TILE,
  rollHouse,
  rollArtefact,
  rollReward,
  assignTask,
  endRun,
  taskOf,
  failedOf,
  houseByName,
  taskLine,
  carriedArtefactId,
  giveArtefact,
  loseArtefact,
  handIn,
  guardCatch,
  variantFor,
  thievingLevel,
};
