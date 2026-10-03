/**
 * Motherlode Mine: mine pay-dirt, wash it in Prospector Percy's machine and collect the ore from
 * the sack. Behaviour is from the OSRS Wiki and live captures (docs/motherlode-mine.md); the rest
 * follows OpenRune-Server's motherlode-mine module (ISC).
 *
 * This is under areas/ so its "Ladder" handler runs before the generic one in objects/Ladders.
 */
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../src/main/typescript/elvarg/game/task/TaskManager");
const { NpcIds } = require("../../src/main/typescript/elvarg/util/IdEnums");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const Mine = require("./motherlode/MotherlodeState");
const Veins = require("./motherlode/MotherlodeVeins");
const Machine = require("./motherlode/MotherlodeMachine");
const Rockfalls = require("./motherlode/MotherlodeRockfalls");

/** The mine's map square, where the HUD shows. */
const MINE_ZONE = { ...Mine.MINE, levels: [Mine.MINE.z] };

/** The HUD (interface 382) in the toplevel's overlay_hud (161:8), as captured. */
const HUD = 382;
const OVERLAY_HUD_UID = (161 << 16) | 8;

/** Crawling in and out (as captured going in): animation and sound, then moved the next tick. */
const CRAWL_ANIMATION = 2796;
const CRAWL_SOUND = 2454;
const CRAWL = {
  26654: { to: [3728, 5692] },
  26655: { to: [3060, 9766] },
  30374: { to: [3718, 5678] },
  30375: { to: [3054, 9744], miningGuild: true },
};
const MINING_GUILD_LEVEL = 60;

/** The ladder to the upper level, at its foot and its top (multilocs on varbit 2086). */
const LADDER_BOTTOM = 19044;
const LADDER_TOP = 19045;
const LADDER_UP = { to: [3755, 5675], animation: 828 };
const LADDER_DOWN = { to: [3755, 5672], animation: 827 };
const LADDER_TICKS = 2;

/** The dark tunnels (OpenRune's routes); the eastern pair needs the medium Falador diary. */
const SHORTCUTS = new Map([
  ["3760,5670", [3765, 5671]], ["3764,5671", [3759, 5670]],
  ["3744,5642", [3745, 5646]], ["3745,5645", [3744, 5641]],
]);
const SHORTCUT_AGILITY = 54;
const SHORTCUT_TICKS = 2;

/** Percy's unlocks, in nuggets (Wiki). */
const PRICES = { upperLevel: 100, upperHopper: 50, biggerSack: 200 };
/**
 * The transcript steps that are the purchases: "You pay Percy N nuggets.". The Wiki has no lines
 * for buying the bigger sack, so its step is added in npc-dialogues.json like the others.
 */
const PAY_STEPS = { oc01u6: "upperLevel", gj_wc0: "upperHopper", percyBiggerSack: "biggerSack" };

let now = 0;

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() { action(); this.stop(); }
  })());
}

function enterMine({ player }) {
  Mine.syncVarbits(player);
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, HUD, 1);
}

function leaveMine({ player }) {
  player.getPacketSender().sendVarbit(Mine.VARBIT_UPPER_LEVEL, 0);
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

/** Moves the player within the mine, keeping the ladders right for their level. */
function moveTo(player, [x, y]) {
  player.moveTo(new Location(x, y, 0));
  player.getPacketSender().sendVarbit(Mine.VARBIT_UPPER_LEVEL, Mine.isUpperLevel(x, y) ? 1 : 0);
}

function crawl({ player, objectId }) {
  const route = CRAWL[objectId];
  if (!route) return false;
  if (route.miningGuild && player.getSkillManager().getCurrentLevel(Skill.MINING) < MINING_GUILD_LEVEL) {
    player.sendMessage(`You need a Mining level of ${MINING_GUILD_LEVEL} to access the Mining Guild.`);
    return;
  }
  player.performAnimation(new Animation(CRAWL_ANIMATION));
  player.getPacketSender().sendSoundEffect(CRAWL_SOUND, 2, 4, 10);
  later(player, 1, () => {
    moveTo(player, route.to);
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  });
}

function climb({ player, objectId }) {
  if (objectId !== LADDER_BOTTOM && objectId !== LADDER_TOP) return false;
  const up = objectId === LADDER_BOTTOM;
  if (up && !Mine.stateOf(player).upperLevel) {
    player.sendMessage("You need to pay Prospector Percy to access the upper level of the mine.");
    return;
  }
  const ladder = up ? LADDER_UP : LADDER_DOWN;
  player.performAnimation(new Animation(ladder.animation));
  later(player, LADDER_TICKS, () => {
    moveTo(player, ladder.to);
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  });
}

function squeezeThrough({ player, location }) {
  const exit = SHORTCUTS.get(`${location.x},${location.y}`);
  if (!exit) return false;
  if (player.getSkillManager().getCurrentLevel(Skill.AGILITY) < SHORTCUT_AGILITY) {
    player.sendMessage(`You need an Agility level of ${SHORTCUT_AGILITY} to negotiate this tunnel.`);
    return;
  }
  player.performAnimation(new Animation(CRAWL_ANIMATION));
  player.getPacketSender().sendSoundEffect(CRAWL_SOUND, 2, 4, 10);
  later(player, SHORTCUT_TICKS, () => {
    moveTo(player, exit);
    player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
  });
}

function mineVein(event) {
  return Veins.mineVein(event);
}

function mineRockfall(event) {
  return Rockfalls.mineRockfall(event, now);
}

// --- Prospector Percy's unlocks, through his Wiki transcript.

function nuggets(player) {
  return player.getInventory().getAmount(Mine.GOLDEN_NUGGET);
}

/** Answers the transcript's "If the player ..." conditions. */
function percyCondition({ player, npcId, text }) {
  if (npcId !== NpcIds.PROSPECTOR_PERCY) return null;
  const state = Mine.stateOf(player);
  const owned = [!!state.upperLevel, !!state.biggerSack, !!state.upperHopper];
  // A purchase's "has N nuggets" is false once it's owned: the transcript can replay a menu after it.
  const answers = {
    "If the player has none of the three upgrades unlocked:": owned.every((has) => !has),
    "If the player has only the upper level unlocked:": owned[0] && !owned[1] && !owned[2],
    "If the player has only the bigger sack unlocked:": !owned[0] && owned[1] && !owned[2],
    "If the player has both the upper level and bigger sack unlocked without the super hopper unlocked:":
      owned[0] && owned[1] && !owned[2],
    "If the player has the upper level, bigger sack, and super hopper unlocked:": owned.every(Boolean),
    // The transcript says 54 here and 57 everywhere else; the Wiki's requirement is 57.
    "If the player has 100 nuggets and is at least level 54 Mining:": !owned[0]
      && nuggets(player) >= PRICES.upperLevel && Mine.baseMiningLevel(player) >= Mine.UPPER_LEVEL_LEVEL,
    "If the player is not at least level 57 Mining:": Mine.baseMiningLevel(player) < Mine.UPPER_LEVEL_LEVEL,
    "If the player does not have 100 nuggets:": nuggets(player) < PRICES.upperLevel,
    "If the player has 200 nuggets:": !owned[1] && nuggets(player) >= PRICES.biggerSack,
    "If the player does not have 200 nuggets:": nuggets(player) < PRICES.biggerSack,
    "If the player has 50 nuggets:": !owned[2] && nuggets(player) >= PRICES.upperHopper,
    "If the player doesn't have 50 nuggets:": nuggets(player) < PRICES.upperHopper,
  };
  return Object.hasOwn(answers, text) ? answers[text] : null;
}

function buy(player, upgrade) {
  const state = Mine.stateOf(player);
  if (state[upgrade] || nuggets(player) < PRICES[upgrade]) return false;
  player.getInventory().delete(Mine.GOLDEN_NUGGET, PRICES[upgrade]);
  state[upgrade] = true;
  Mine.save(player, state);
  Mine.syncVarbits(player);
  return true;
}

/** "You pay Percy N nuggets." is where each purchase happens (sent once as a message). */
function percyPays({ player, npcId, stepId, kind }) {
  const upgrade = PAY_STEPS[stepId];
  if (npcId !== NpcIds.PROSPECTOR_PERCY || !upgrade || kind !== "message") return;
  buy(player, upgrade);
}

// --- Logging in and out, and the mine's clock.

function login({ player }) {
  Machine.resume(player);
}

function logout({ player }) {
  Veins.stopMining(player, false);
  Machine.forget(player);
  Rockfalls.forget(player);
}

function tick() {
  now++;
  Veins.tick(now);
  Machine.tick(now);
  Rockfalls.tick(now);
}

function start() {
  Veins.spawnAll();
  Machine.start(now);
  TaskManager.submit(new (class extends Task {
    constructor() { super(1); }
    execute() { tick(); }
  })());
}

module.exports = {
  name: "MotherlodeMine",
  members: true,
  _test: { tick, start, crawl, climb, squeezeThrough, percyCondition, percyPays, enterMine },
  register(api) {
    Machine.init(api);
    api.persistAttribute(Mine.STATE_ATTRIBUTE);
    api.onServerStartup(start);
    api.onPlayerLogin(login);
    api.onPlayerLogout(logout);
    api.onZoneEnter(MINE_ZONE, enterMine);
    api.onZoneExit(MINE_ZONE, leaveMine);
    api.onObjectInteraction("Cave", { Enter: crawl });
    api.onObjectInteraction("Tunnel", { Exit: crawl });
    api.onObjectInteraction("Ladder", { Climb: climb });
    api.onObjectInteraction("Dark tunnel", { Enter: squeezeThrough });
    api.onObjectInteraction("Ore vein", { Mine: mineVein });
    api.onObjectInteraction("Rockfall", { Mine: mineRockfall });
    api.onObjectInteraction("Hopper", { Deposit: Machine.deposit });
    api.onObjectRoute(Machine.routeToHopper);
    api.onObjectInteraction("Sack", { Search: Machine.searchSack });
    api.onObjectInteraction("Empty sack", { Search: Machine.searchSack });
    api.onObjectInteraction("Broken strut", { Hammer: Machine.hammerStrut });
    api.onNpcDialogueCondition(percyCondition);
    api.onCustomEvent("npc-dialogue:action", percyPays);
    api.registerCommand("mlmstrut", Machine.forceBreak, PlayerRights.DEVELOPER);
  },
};
