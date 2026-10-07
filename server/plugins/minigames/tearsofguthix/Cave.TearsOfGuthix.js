"use strict";

/**
 * Inside the Tears of Guthix cave (https://oldschool.runescape.wiki/w/Tears_of_Guthix_(minigame)).
 *
 * Juna hands over a stone bowl that needs both hands and lets the player past her; they have
 * one tick per quest point. Collecting from a weeping wall goes on every tick until the player
 * moves: a blue stream adds a tear, a green one takes one away, and it carries on through the
 * stream changing colour. When time runs out (or they ask Juna to leave) they walk out past her
 * and drink: per tear, min(60, 10 + floor(XP / 27) / 10) XP in their lowest skill, 10% more
 * with the hard Lumbridge & Draynor Diary. Leaving any other way (death, logout) drinks nothing
 * and leaves the week's visit unused, as the Wiki notes for death.
 *
 * Ids from the cache: varbits tog_tears_collected (455), tog_minigame_collecting (453),
 * tog_countdown (5099; the side panel's bar runs it down from varp 101, quest points),
 * tog_max_tears_collected (10730, the panel's "PB"); interface tog_sidepanel (276); seqs
 * tog_ready/walk/run_bowl (2040-2042), tog_lean_forward/back_bowl (2043/2044),
 * tog_drink_bowl (2045), tog_snake_openclose (2055). The entry/exit tiles, the tabs hidden while
 * collecting and the sound ids follow Offline_Scape's port; the Wiki does not record them.
 */

const Streams = require("./Streams.TearsOfGuthix");

const STONE_BOWL = 4704;
const JUNA_LOC = 3193;

const TEARS_VARBIT = 455;
const COLLECTING_VARBIT = 453;
const COUNTDOWN_VARBIT = 5099;
const PERSONAL_BEST_VARBIT = 10730;
const QUEST_POINTS_ATTRIBUTE = "quest.points";
const PERSONAL_BEST_ATTRIBUTE = "tears-of-guthix:personal-best";
/** { day, questPoints, totalXp } as the player last drank the tears. */
const LAST_VISIT_ATTRIBUTE = "tears-of-guthix:last-visit";

const BOWL_ANIMATIONS = [2040, 823, 2041, 2041, 2041, 2041, 2042];
const LEAN_FORWARD = 2043;
const LEAN_BACK = 2044;
const DRINK = 2045;
const JUNA_OPEN = 2055;
const SOUND_BLUE = 1794;
const SOUND_GREEN = 1793;
const SOUND_JUNA = 1797;
const SOUND_DRINK = 1796;

const PLANE = 2;
const JUNA_TILE = [3252, 9516];
const OUTSIDE = [3251, 9516];
const INSIDE = [3253, 9517];
const CENTRE = [3257, 9517];
const CAVE = [3253, 3261, 9514, 9520];
/** Ticks the walk out may take before the player is put outside anyway. */
const WALK_OUT_TICKS = 12;
const DRINK_TICKS = 2;
/** An entity flag (MovementQueue): steps go straight on, whatever the map's clipping. */
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";

const DIARY_TASK = "collect-at-least-100-tears-of-guthix-in-one-visi";
const DIARY_TEARS = 100;
const DIARY_BONUS_MESSAGE =
  "<col=dc143c>You are awarded an additional 10% experience for completing the hard Lumbridge achievement diary.</col>";

/** Toplevel side tabs hidden while collecting; the equipment tab shows the tears panel. */
const TOPLEVEL = 161;
const TEARS_PANEL = 276;
const EQUIPMENT_TAB = [80, 387];
const EQUIPMENT_TAB_INDEX = 4;
const SWITCH_TAB_SCRIPT = 915;
const HIDDEN_TABS = [
  [77, 320], [78, 629], [79, 149], [81, 541], [83, 7], [84, 109], [86, 182], [87, 116], [88, 216], [89, 239],
];
const COMBAT_TAB = 76;
const MAGIC_TAB = 82;

/** If skills share the least XP, the first here wins (Wiki, from November 2025). */
const SKILL_ORDER = [
  "ATTACK", "STRENGTH", "RANGED", "MAGIC", "DEFENCE", "HITPOINTS", "PRAYER", "AGILITY", "HERBLORE",
  "THIEVING", "CRAFTING", "RUNECRAFTING", "MINING", "SMITHING", "FISHING", "COOKING", "FIREMAKING",
  "WOODCUTTING", "FLETCHING", "SLAYER", "FARMING", "CONSTRUCTION", "HUNTER", "SAILING",
];
const SKILL_MESSAGES = {
  ATTACK: "You feel a brief surge of aggression!",
  STRENGTH: "Your muscles bulge!",
  DEFENCE: "You feel very defensive!",
  RANGED: "Your aim improves.",
  PRAYER: "You suddenly feel very close to the gods.",
  MAGIC: "You feel magical power coursing through your body.",
  HITPOINTS: "You feel more healthy.",
  AGILITY: "You feel very nimble.",
  HERBLORE: "You gain a deep understanding of all kinds of strange plants.",
  THIEVING: "You feel your respect for others' property slipping away.",
  CRAFTING: "Your fingers feel nimble and suited to delicate work.",
  FLETCHING: "You gain a deep understanding of wooden sticks.",
  MINING: "You gain a deep understanding of the stones of the earth.",
  SMITHING: "You gain a deep understanding of metal.",
  FISHING: "You gain a deep understanding of the creatures of the sea.",
  COOKING: "You have a brief urge to cook some food.",
  FIREMAKING: "You have a brief urge to set light to something!",
  WOODCUTTING: "You gain a deep understanding of the trees in the forest.",
  RUNECRAFTING: "You gain a deep understanding of runes.",
  SLAYER: "You gain a deep understanding of many strange creatures.",
  FARMING: "You gain a deep understanding of the cycles of nature.",
  CONSTRUCTION: "You feel homesick.",
  HUNTER: "You briefly experience the joy of the hunt.",
  SAILING: "You gain a deep understanding of navigating the sea.",
};
/** Skills the tears skip until the player can train them. */
const SKILL_UNLOCKS = {
  RUNECRAFTING: { quest: "rune_mysteries", stage: 6 },
  HERBLORE: { quest: "druidic_ritual", stage: 4 },
  SAILING: { quest: "pandemonium", stage: 1 },
};

let api;
let core;
let streams;
/** player -> { tears, ticksLeft, leaving, wall, collectTile, entry: { questPoints, totalXp } } */
const games = new Map();

const today = () => Math.floor(Date.now() / 86400000);
const tile = ([x, y]) => new core.Location(x, y, PLANE);
const questPoints = (player) => Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0;
const totalXp = (player) => player.getSkillManager().getTotalExp();

function inCave(player) {
  const at = player.getLocation();
  return at.getZ() === PLANE && at.getX() >= CAVE[0] && at.getX() <= CAVE[1] && at.getY() >= CAVE[2] && at.getY() <= CAVE[3];
}

function isPlaying(player) {
  return games.has(player);
}

function questStage(player, key) {
  return Number(player.getAttribute(`quest.${key}.stage`)) || 0;
}

// --- Rewards

/** Per tear: min(60, 10 + floor(xp / 27) / 10) (Wiki). */
function xpPerTear(xp) {
  return Math.min(60, 10 + Math.floor(xp / 27) / 10);
}

function canTrain(player, name) {
  const unlock = SKILL_UNLOCKS[name];
  if (unlock) return questStage(player, unlock.quest) >= unlock.stage;
  if (name !== "CONSTRUCTION") return true;
  const request = { player, owns: false };
  api.emitCustomEvent("construction:owns-house", request);
  return request.owns === true;
}

/** The trainable skill with the least XP, ties broken by SKILL_ORDER. */
function lowestSkill(player, experienceOf = (skill) => player.getSkillManager().getExperience(skill)) {
  let lowest;
  let lowestXp = Infinity;
  for (const name of SKILL_ORDER) {
    const skill = core.Skill[name];
    if (!skill || !canTrain(player, name)) continue;
    const xp = experienceOf(skill);
    if (xp < lowestXp) {
      lowest = name;
      lowestXp = xp;
    }
  }
  return lowest ? { name: lowest, skill: core.Skill[lowest], xp: lowestXp } : undefined;
}

function hasDiaryBonus(player) {
  const request = { player, diary: "lumbridge", tier: "hard", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function drink(player, game) {
  player.performAnimation(new core.Animation(DRINK));
  player.getPacketSender().sendSound(SOUND_DRINK, 1, 0);
  later(DRINK_TICKS, () => {
    if (games.get(player) !== game) return;
    const lowest = lowestSkill(player);
    if (lowest && game.tears > 0) {
      const bonus = hasDiaryBonus(player);
      const xp = Math.round(xpPerTear(lowest.xp) * game.tears * (bonus ? 1.1 : 1) * 10) / 10;
      player.getSkillManager().addExperiences(lowest.skill, xp);
      player.sendMessage(SKILL_MESSAGES[lowest.name]);
      if (bonus) player.sendMessage(DIARY_BONUS_MESSAGE);
    }
    if (game.tears >= DIARY_TEARS) api.emitCustomEvent("diary:task", { player, diary: "lumbridge", task: DIARY_TASK });
    const best = Math.max(game.tears, Number(player.getAttribute(PERSONAL_BEST_ATTRIBUTE)) || 0);
    player.setAttribute(PERSONAL_BEST_ATTRIBUTE, best);
    player.getPacketSender().sendVarbit(PERSONAL_BEST_VARBIT, best);
    player.setAttribute(LAST_VISIT_ATTRIBUTE, { day: today(), ...game.entry });
    cleanUp(player);
  });
}

// --- The panel and the bowl

function showPanel(player) {
  const sender = player.getPacketSender();
  for (const [slot] of [[COMBAT_TAB], [MAGIC_TAB], ...HIDDEN_TABS]) sender.closeSubInterface((TOPLEVEL << 16) | slot);
  sender.sendTabInterface(EQUIPMENT_TAB[0], TEARS_PANEL);
  sender.sendInterfaceScript(SWITCH_TAB_SCRIPT, [EQUIPMENT_TAB_INDEX]);
}

function restoreTabs(player) {
  const sender = player.getPacketSender();
  sender.sendTabInterface(0, 593);
  sender.sendTabInterface(6, player.getSpellbook().getInterfaceId());
  sender.sendTabInterface(EQUIPMENT_TAB[0], EQUIPMENT_TAB[1]);
  for (const [slot, group] of HIDDEN_TABS) sender.sendTabInterface(slot, group);
  player.getInventory().refreshItems();
  player.getEquipment().refreshItems();
}

function holdBowl(player, held) {
  const { Equipment, Flag, Item } = core;
  const equipment = player.getEquipment();
  if (held) equipment.setItem(Equipment.WEAPON_SLOT, new Item(STONE_BOWL, 1));
  else if (equipment.getSlot(Equipment.WEAPON_SLOT) === STONE_BOWL) equipment.setItem(Equipment.WEAPON_SLOT, new Item(-1, 0));
  player.setRenderAnimations(held ? BOWL_ANIMATIONS : null);
  equipment.refreshItems();
  player.getUpdateFlag().flag(Flag.APPEARANCE);
}

function cleanUp(player) {
  games.delete(player);
  player.removeFlag(IGNORE_CLIPPING_FLAG);
  holdBowl(player, false);
  const sender = player.getPacketSender();
  sender.sendVarbit(TEARS_VARBIT, 0);
  sender.sendVarbit(COLLECTING_VARBIT, 0);
  sender.sendVarbit(COUNTDOWN_VARBIT, 0);
  restoreTabs(player);
}

// --- Walking in and out past Juna

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks); }
    execute() {
      this.stop();
      action();
    }
  })());
}

function openJuna(player) {
  const juna = core.MapObjects.get(JUNA_LOC, tile(JUNA_TILE), null);
  if (juna) player.getPacketSender().sendObjectAnimation(juna, new core.Animation(JUNA_OPEN));
  player.getPacketSender().sendSound(SOUND_JUNA, 1, 0);
}

/** Straight steps through Juna's tile, which the map blocks. */
function walkPast(player, ...tiles) {
  const movement = player.getMovementQueue();
  player.setFlag(IGNORE_CLIPPING_FLAG);
  movement.reset();
  for (const step of tiles) movement.addSteps(tile(step));
}

/** Juna lets the player in (the "enters the Tears of Guthix cave" stage direction). */
function enter(player) {
  player.getPacketSender().sendInterfaceRemoval();
  games.set(player, {
    tears: 0,
    ticksLeft: questPoints(player),
    leaving: false,
    wall: -1,
    collectTile: null,
    entry: { questPoints: questPoints(player), totalXp: totalXp(player) },
  });
  holdBowl(player, true);
  const sender = player.getPacketSender();
  sender.sendVarbit(TEARS_VARBIT, 0);
  sender.sendVarbit(COLLECTING_VARBIT, 1);
  sender.sendVarbit(COUNTDOWN_VARBIT, questPoints(player));
  showPanel(player);
  openJuna(player);
  walkPast(player, OUTSIDE, INSIDE, CENTRE);
}

/** Time is up, or the player asked Juna to let them out: walk out and drink. */
function finish(player) {
  const game = games.get(player);
  if (!game || game.leaving) return;
  game.leaving = true;
  stopCollecting(player, game);
  player.getPacketSender().sendInterfaceRemoval();
  openJuna(player);
  walkPast(player, INSIDE, OUTSIDE);
  later(WALK_OUT_TICKS, () => {
    if (games.get(player) === game && inCave(player)) player.moveTo(tile(OUTSIDE));
  });
}

// --- Collecting

function stopCollecting(player, game) {
  if (game.wall < 0) return;
  game.wall = -1;
  player.performAnimation(new core.Animation(LEAN_BACK));
}

/** Collect-from on a weeping wall: keep collecting each tick until the player moves. */
function collectFrom({ player, location }) {
  const game = games.get(player);
  if (!game || game.leaving || !inCave(player)) return;
  game.wall = Streams.wallAt(location.x, location.y);
  game.collectTile = player.getLocation().clone();
  player.setPositionToFace(new core.Location(location.x, location.y, PLANE));
}

function collectTick(player, game) {
  const moved = player.getMovementQueue().size() > 0 || !player.getLocation().equals(game.collectTile);
  if (moved) return stopCollecting(player, game);
  const colour = streams.colourAt(game.wall);
  if (colour === Streams.BLUE) game.tears++;
  else if (colour === Streams.GREEN) game.tears = Math.max(0, game.tears - 1);
  if (colour !== Streams.NONE) player.getPacketSender().sendSound(colour === Streams.BLUE ? SOUND_BLUE : SOUND_GREEN, 1, 0);
  player.getPacketSender().sendVarbit(TEARS_VARBIT, game.tears);
  player.performAnimation(new core.Animation(LEAN_FORWARD));
}

// --- The cave as an Area

function createCave() {
  class TearsOfGuthixCave extends core.Area {
    process(mobile) {
      const player = mobile.isPlayer() ? mobile.getAsPlayer() : null;
      const game = player && games.get(player);
      if (!game || game.leaving) return;
      if (game.wall >= 0) collectTick(player, game);
      game.ticksLeft--;
      player.getPacketSender().sendVarbit(COUNTDOWN_VARBIT, Math.max(0, game.ticksLeft));
      if (game.ticksLeft <= 0) finish(player);
    }

    postEnter(mobile) {
      if (mobile.isPlayer() && games.has(mobile.getAsPlayer())) mobile.getAsPlayer().removeFlag(IGNORE_CLIPPING_FLAG);
    }

    postLeave(mobile, logout) {
      const player = mobile.isPlayer() ? mobile.getAsPlayer() : null;
      const game = player && games.get(player);
      if (!game) return;
      if (game.leaving && !logout) drink(player, game);
      else cleanUp(player);
    }

    canTeleport() {
      return false;
    }
  }
  const { Boundary } = core;
  return new TearsOfGuthixCave([new Boundary(CAVE[0], CAVE[1], CAVE[2], CAVE[3], PLANE)]);
}

/** Logging out mid-game drinks nothing; the player starts outside next time. */
function logout({ player }) {
  if (!player) return;
  if (games.has(player)) cleanUp(player);
  if (inCave(player)) player.setLocation(tile(OUTSIDE));
}

function login({ player }) {
  if (!player) return;
  if (inCave(player)) player.moveTo(tile(OUTSIDE));
  if (player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT) === STONE_BOWL) holdBowl(player, false);
  const best = Number(player.getAttribute(PERSONAL_BEST_ATTRIBUTE)) || 0;
  if (best > 0) player.getPacketSender().sendVarbit(PERSONAL_BEST_VARBIT, best);
}

function startStreams() {
  streams = Streams.startStreams(core);
}

module.exports = function registerCave(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.persistAttribute(PERSONAL_BEST_ATTRIBUTE);
  api.persistAttribute(LAST_VISIT_ATTRIBUTE);
  api.registerArea(createCave());
  api.onServerStartup(startStreams);
  api.onObjectInteraction("Weeping wall", { "Collect-from": collectFrom });
  api.onPlayerLogout(logout);
  api.onPlayerLogin(login);
};

Object.assign(module.exports, {
  LAST_VISIT_ATTRIBUTE,
  enter,
  finish,
  isPlaying,
  questPoints,
  totalXp,
  today,
  _test: { xpPerTear, lowestSkill, games, setCore: (value) => { core = value; }, setApi: (value) => { api = value; } },
});
