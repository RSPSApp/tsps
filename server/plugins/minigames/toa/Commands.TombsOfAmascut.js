"use strict";

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

function skipPuzzle({ player }) {
  const raid = Raid.raidOf(player);
  const room = raid?.roomFor(player);
  if (!Shared.inTombs(player.getLocation()) || !room?.def.puzzle || room.destroyed) {
    player.sendMessage("Enter a Tombs of Amascut puzzle room before using ::toaskippuzzle.");
    return true;
  }
  if (room.isCompleted()) {
    player.sendMessage("This puzzle is already complete. Use the exit to proceed to the boss.");
    return true;
  }
  if (!room.isStarted()) room.start();
  room.complete();
  // Normal completion follows killing the enemies; a developer skip must remove them.
  for (const npc of [...room.npcs]) room.despawn(npc);
  raid.broadcast(`${Shared.displayName(player)} skipped the puzzle for testing. Use the exit to proceed to the boss.`);
  return true;
}

function skipBoss({ player }) {
  const raid = Raid.raidOf(player);
  const room = raid?.roomFor(player);
  if (!Shared.inTombs(player.getLocation()) || !room?.def.boss || room.destroyed) {
    player.sendMessage("Enter a Tombs of Amascut boss room before using ::toaskipboss.");
    return true;
  }
  if (room.isCompleted()) {
    player.sendMessage("This boss is already complete.");
    return true;
  }
  if (!room.isStarted()) room.start();
  if (room.key === "WARDENS_P1") {
    // The first encounter hands its state to the final phase instead of completing a room.
    room.toFinalPhase();
    raid.broadcast("Skipped to the Wardens' final phase for testing. Use ::toaskipboss again after arriving to complete it.");
    return true;
  }
  // Snapshot before completion: it spawns Osmumten and other progression NPCs.
  const enemies = [...room.npcs];
  room.complete();
  for (const npc of enemies) {
    if (room.npcs.has(npc)) room.despawn(npc);
  }
  raid.broadcast(`${Shared.displayName(player)} skipped ${room.def.boss} for testing. Use the normal route onward.`);
  return true;
}

/** Marks every path complete and rebuilds the Nexus, so the Wardens' entrance opens. */
function skipToWardens({ player }) {
  const raid = Raid.raidOf(player);
  const room = raid?.roomFor(player);
  if (!Shared.inTombs(player.getLocation()) || room?.key !== "MAIN_HALL" || room.destroyed) {
    player.sendMessage("Enter the Nexus of a Tombs of Amascut raid before using ::toaskiptowarden.");
    return true;
  }
  if (raid.pathsCompleted.length === Shared.PATHS.length) {
    player.sendMessage("Every path is already complete. The Wardens' entrance is open.");
    return true;
  }
  for (const path of Shared.PATHS) raid.completePath(path.key);
  if (raid.startCycle === 0) raid.startCycle = Shared.cycle();
  const nexus = raid.buildRoom("MAIN_HALL");
  for (const member of nexus.roomPlayers()) nexus.onPlayerArrive(member);
  raid.refreshHudStates();
  raid.broadcast(`${Shared.displayName(player)} completed every path for testing. The Wardens' entrance is open.`);
  return true;
}

const DEFAULT_REWARD_POINTS = 20000;
const MAX_RAID_LEVEL = 600;
/** What ::toaskiptoreward can force for the player using it: a unique by name, or "purple". */
const FORCED_UNIQUES = {
  lightbearer: (I) => I.LIGHTBEARER,
  fang: (I) => I.OSMUMTENS_FANG,
  ward: (I) => I.ELIDINIS_WARD,
  mask: (I) => I.MASORI_MASK,
  body: (I) => I.MASORI_BODY,
  chaps: (I) => I.MASORI_CHAPS,
  masori: (I) => Shared.randomOf([I.MASORI_MASK, I.MASORI_BODY, I.MASORI_CHAPS]),
  shadow: (I) => I.TUMEKENS_SHADOW_UNCHARGED_,
};
const REWARD_USAGE = "Usage: ::toaskiptoreward [points] [raid level] [purple|lightbearer|fang|ward|masori|mask|body|chaps|shadow] [pet]";

/** The forced loot named after the level, e.g. ["shadow", "pet"]; null if a word isn't known. */
function forcedLoot(player, words) {
  const I = Shared.core().ItemIdentifiers;
  const forced = { player, unique: null, pet: false };
  for (const word of words.map((part) => part.toLowerCase())) {
    if (word === "pet") forced.pet = true;
    else if (word === "purple") forced.unique = true;
    else if (FORCED_UNIQUES[word]) forced.unique = FORCED_UNIQUES[word](I);
    else return null;
  }
  return forced.unique || forced.pet ? forced : undefined;
}

/**
 * ::toaskiptoreward [points] [raid level] [unique] [pet]: ends the raid as if the Wardens fell
 * and takes the party to the chest. Every player gets `points` loot points (beyond the 5,000
 * start; default 20,000). A raid level, if given, replaces the invocations' for the loot rolls.
 * "purple" (or a unique's name) and "pet" guarantee them to the player using the command.
 */
function skipToReward({ player, parts }) {
  const raid = Raid.raidOf(player);
  if (!raid || !Shared.inTombs(player.getLocation())) {
    player.sendMessage("Enter a Tombs of Amascut raid before using ::toaskiptoreward.");
    return true;
  }
  if (raid.lootRolled) {
    player.sendMessage("This raid's loot has already been rolled.");
    return true;
  }
  const maxPoints = Raid.TOTAL_POINTS_CAP - Raid.START_POINTS;
  // Numbers are the points then the raid level; words are what to force, in any order.
  const args = parts?.slice(1) ?? [];
  const numbers = args.filter((arg) => /^-?\d+$/.test(arg)).map(Number);
  const points = numbers[0] ?? DEFAULT_REWARD_POINTS;
  const level = numbers[1] ?? null;
  const forced = numbers.length > 2 ? null : forcedLoot(player, args.filter((arg) => !/^-?\d+$/.test(arg)));
  if (!Number.isInteger(points) || points < 0 || points > maxPoints
    || (level !== null && (!Number.isInteger(level) || level < 0 || level > MAX_RAID_LEVEL)) || forced === null) {
    player.sendMessage(REWARD_USAGE);
    player.sendMessage(`Points 0-${maxPoints}, raid level 0-${MAX_RAID_LEVEL}.`);
    return true;
  }
  raid.forcedLoot = forced ?? null;
  for (const path of Shared.PATHS) raid.completePath(path.key);
  if (raid.startCycle === 0) raid.startCycle = Shared.cycle();
  raid.setCompletion();
  if (level !== null) raid.completedRaidLevel = level;
  for (const member of raid.players) {
    raid.member(member).points = Raid.START_POINTS + points;
    raid.revive(member);
  }
  raid.sendContributions();
  for (const member of [...raid.players]) raid.enterRoom(member, "REWARD", { leaderOnly: false });
  raid.broadcast(`${Shared.displayName(player)} skipped to the rewards for testing: ${points.toLocaleString()} points each`
    + ` at raid level ${raid.raidLevel}${forced ? `, with ${[forced.unique && "a purple", forced.pet && "the pet"].filter(Boolean).join(" and ")} forced` : ""}.`);
  return true;
}

/** ::toa: to the Tombs of Amascut lobby beneath Necropolis (not from inside a raid). */
function toLobby({ player }) {
  if (Raid.raidOf(player)) {
    player.sendMessage("Leave your raid before using ::toa.");
    return true;
  }
  player.moveTo(Shared.loc(Shared.LOBBY_RETURN));
  player.sendMessage("You teleport to the Tombs of Amascut lobby.");
  return true;
}

module.exports = function registerTombsCommands(api) {
  api.registerCommand("toa", toLobby, api.core.PlayerRights.DEVELOPER);
  api.registerCommand("toaskippuzzle", skipPuzzle, api.core.PlayerRights.DEVELOPER);
  api.registerCommand("toaskipboss", skipBoss, api.core.PlayerRights.DEVELOPER);
  api.registerCommand("toaskiptowarden", skipToWardens, api.core.PlayerRights.DEVELOPER);
  api.registerCommand("toaskiptoreward", skipToReward, api.core.PlayerRights.DEVELOPER);
};
