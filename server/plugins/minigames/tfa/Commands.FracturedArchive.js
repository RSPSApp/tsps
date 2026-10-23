"use strict";

/** Developer commands for testing The Fractured Archive. */

const Shared = require("./Shared.FracturedArchive");
const Parties = require("./Parties.FracturedArchive");
const Raid = require("./RaidState.FracturedArchive");
const Entry = require("./Entry.FracturedArchive");
const Guardian = require("./Guardian.FracturedArchive");

/** ::tfa - to the lobby, where crawling in from the Chasm puts you. */
function toLobby({ player }) {
  player.moveTo(Shared.loc(Shared.TILE.LOBBY_ARRIVAL));
  return true;
}

/** ::tfaguardian - straight into the Archive Guardian's room, with a party of your own if need be. */
function toGuardian({ player }) {
  let party = Parties.partyOf(player);
  if (!party) party = Parties.create(player);
  if (!party.isLeader(player) && !party.raid) {
    player.sendMessage("Your party's leader has to go in first.");
    return true;
  }
  const raid = party.raid ?? Raid.begin(player);
  raid?.enter(player);
  return true;
}

/** ::tfaintro - forget the opening cutscene (tfa_miniquest back to 0), to see it again. */
function resetIntro({ player }) {
  player.setAttribute(Entry.ATTR.MINIQUEST, Entry.STAGE.NOT_STARTED);
  player.getPacketSender().sendVarbit(Shared.id("varbit", "MINIQUEST"), 0);
  player.sendMessage("The Fractured Archive's opening cutscene will play on your next crawl in.");
  return true;
}

/** ::tfacomplete - wins the challenge your party is in. */
function completeRoom({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid?.room) {
    player.sendMessage("You're not in the Fractured Archive.");
    return true;
  }
  if (!raid.room.isStarted()) raid.room.start();
  raid.room.complete();
  return true;
}

/**
 * ::tfahp <amount> [2] - sets the current boss's hitpoints: the Guardian's pool (its shield in
 * the air, its health on the ground), Ocellus' shared pool after his first phase, or Smork
 * (Bork's room, with a 2).
 */
function setHitpoints({ player, parts }) {
  const room = Raid.raidOf(player)?.room;
  const amount = Math.max(1, Math.floor(Number(parts?.[1])));
  if (!room?.isStarted() || !Number.isFinite(amount)) {
    player.sendMessage("Use ::tfahp <amount> in a Fractured Archive challenge once it has started.");
    return true;
  }
  if (room.guardian) {
    room.guardian.setHitpoints(amount);
    if (room.phase === Guardian.PHASE.GROUNDED) room.health = amount;
    player.sendMessage(`The Archive Guardian is on ${room.guardian.getHitpoints()} (${room.phase}).`);
    return true;
  }
  if (room.pool !== undefined && room.phase >= 2) {
    room.pool = Math.min(room.poolMax, amount);
    player.sendMessage(`Ocellus is on ${room.pool}.`);
    return true;
  }
  const npc = parts?.[2] === "2" ? room.smork : room.boss ?? room.bork ?? room.ezekiel;
  if (!npc) {
    player.sendMessage("This room has no boss to set.");
    return true;
  }
  npc.setHitpoints(Math.min(npc.getMaxHitpoints(), amount));
  player.sendMessage(`Set to ${npc.getHitpoints()}.`);
  return true;
}

/** Bosses past the Guardian, the Nexus section each one needs beaten first. */
const ROOM_SECTIONS = { HUB: 0, BORK: 0, EZEKIEL: 0, DREADNOTH: 1, XARTH: 2, OCELLUS: 3, VAULT: 3 };
/** Ticks from going in to being in the Guardian's room with the HUD (Raid's entry). */
const ARRIVED_AFTER = 8;

/**
 * ::tfaroom <KEY> - takes your raid's party straight to a room (BORK, EZEKIEL, DREADNOTH, XARTH,
 * OCELLUS, VAULT, HUB), with everything before it done: the Guardian and each section's boss
 * beaten along the east side (the captures' way), and for the vault the raid won, so its loot is
 * rolled as after a clear. Outside a raid it goes in first (as ::tfaguardian), then on.
 */
function toRoom({ player, parts }) {
  const key = String(parts?.[1] ?? "").toUpperCase();
  if (!(key in ROOM_SECTIONS)) {
    player.sendMessage(`Use ::tfaroom <${Object.keys(ROOM_SECTIONS).join("|")}>.`);
    return true;
  }
  const raid = Raid.raidOf(player);
  if (raid && raid.hasMember(player)) {
    skipTo(raid, key);
    return true;
  }
  toGuardian({ player });
  Shared.later(player, ARRIVED_AFTER, () => {
    const entered = Raid.raidOf(player);
    if (entered?.hasMember(player)) skipTo(entered, key);
    else player.sendMessage("Couldn't get into the Archive; try ::tfaguardian.");
  });
  return true;
}

/** Marks everything before a room as done, then moves the party there. */
function skipTo(raid, key) {
  const section = ROOM_SECTIONS[key];
  raid.challengeStarted();
  raid.section = Math.max(raid.section, section);
  for (let beaten = 1; beaten <= section; beaten++) raid.path[beaten] ??= "east";
  // The Guardian is beaten whatever the room: its doors and the Nexus' first visit follow on.
  const guardian = raid.rooms.get("GUARDIAN");
  if (guardian && !guardian.isCompleted()) guardian.stage = Raid.STAGE.COMPLETED;
  if (key === "VAULT" && raid.finishedTicks < 0) raid.finishedTicks = raid.elapsed();
  for (const member of [...raid.players]) raid.moveTo(member, key);
}

/**
 * ::tfafade <0-255> [cycles] - fades the room's boss to that transparency (0 opaque, 255
 * invisible) over the cycles (30), and leaves it there: checks the client draws NPC fades.
 */
function fadeBoss({ player, parts }) {
  const room = Raid.raidOf(player)?.room;
  const npc = room?.boss ?? room?.guardian ?? room?.bork ?? room?.ezekiel;
  const to = Math.max(0, Math.min(255, Math.floor(Number(parts?.[1]))));
  const cycles = Math.max(0, Math.floor(Number(parts?.[2] ?? 30)));
  if (!npc || !Number.isFinite(to)) {
    player.sendMessage("Use ::tfafade <0-255> [cycles] in a Fractured Archive room with its boss.");
    return true;
  }
  npc.fade(to, { endCycles: Number.isFinite(cycles) ? cycles : 30 });
  player.sendMessage(`Fading to ${to} over ${cycles} cycles.`);
  return true;
}

module.exports = function registerCommands(api) {
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("tfa", toLobby, DEVELOPER, "To the Fractured Archive's lobby");
  api.registerCommand("tfaguardian", toGuardian, DEVELOPER, "Into the Archive Guardian's room");
  api.registerCommand("tfaintro", resetIntro, DEVELOPER, "Replay the Fractured Archive's opening cutscene");
  api.registerCommand("tfacomplete", completeRoom, DEVELOPER, "Win the current Fractured Archive challenge");
  api.registerCommand("tfahp", setHitpoints, DEVELOPER, "Set the current Fractured Archive boss's hitpoints");
  api.registerCommand("tfaroom", toRoom, DEVELOPER, "Take your Fractured Archive party to a room");
  api.registerCommand("tfafade", fadeBoss, DEVELOPER, "Fade the current Fractured Archive boss (0 opaque, 255 invisible)");
};
