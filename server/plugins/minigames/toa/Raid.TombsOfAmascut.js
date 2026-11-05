"use strict";

/**
 * Raid-wide rules and the objects every room shares: barriers, entries, exits, teleport
 * crystals and Osmumten's way back to the Nexus; safe deaths with team lives; points for
 * damage; and the invocations that change eating, drinking and prayer.
 */

const Shared = require("./Shared.TombsOfAmascut");
const Raid = require("./RaidState.TombsOfAmascut");
const CombatAchievements = require("./CombatAchievements.TombsOfAmascut");
const Retrieval = require("./Retrieval.TombsOfAmascut");
const Supplies = require("./Supplies.TombsOfAmascut");

/** TOA_DAMAGE_DONE and _TAKEN hold 16 bits (cache). */
const MAX_DAMAGE_VARBIT = 65535;
const ABANDON_TEXT = "You are about to <col=ad2800>abandon the raid</col>. If you do this, you <col=ad2800>will not</col> be able to return to your current run.";

// Restoration that Dehydration forbids (wiki: "Players can no longer drink potions that restore health").
const DEHYDRATION_BLOCKED = ["Nectar", "Ambrosia", "Saradomin brew", "Guthix rest"];

function raidRoom(player) {
  const raid = Raid.raidOf(player);
  if (!raid || !Shared.inTombs(player.getLocation())) return null;
  return raid.roomFor(player);
}

function isGhost(player) {
  const raid = Raid.raidOf(player);
  return !!raid && raid.member(player).ghost;
}

// ------------------------------------------------------------------ objects

function passBarrier(event) {
  if (!raidRoom(event.player) && (event.option === "Pass" || event.option === "Quick-Pass")) return followParty(event.player);
  const room = raidRoom(event.player);
  // Only the room barriers' Pass / Quick-Pass: Het's puzzle has "Barrier"s to Break too.
  if (!room || (event.option !== "Pass" && event.option !== "Quick-Pass")) return false;
  room.passBarrier(event.player, event.object, event.option !== "Pass");
  return true;
}

/** Puzzle-room exits into the boss, and Wardens P1 into P3. The Nexus handles its own. */
function useEntry(event) {
  const room = raidRoom(event.player);
  if (!room) return followParty(event.player);
  if (room.key === "MAIN_HALL") return false;
  if (!room.def.next) return false;
  if (room.def.bounds && !room.isCompleted() && room.key !== "WARDENS_P1") {
    Shared.statement(event.player, "You can't proceed until the challenge is complete.");
    return true;
  }
  Raid.raidOf(event.player).advance(event.player, event.option !== "Enter");
  return true;
}

/**
 * The party moved on, which tears the old room down: whoever is still in it follows through its way
 * on, into the party's room. (Played over the MCP: the second player of a party was stuck.)
 */
function followParty(player) {
  const raid = Raid.raidOf(player);
  if (!raid?.room || !Shared.inTombs(player.getLocation()) || raid.roomFor(player)) return false;
  if (raid.member(player).ghost) return false;
  raid.enterRoom(player, raid.roomKey, { leaderOnly: false });
  return true;
}

function useExit(event) {
  const { player } = event;
  if (!Shared.inTombs(player.getLocation())) return false;
  if (recoverMissingRaid(event)) return true;
  if (isGhost(player)) {
    Shared.statement(player, "A mysterious force prevents you from doing that.");
    return true;
  }
  player.sendMessage(ABANDON_TEXT.replace(/<[^>]+>/g, ""));
  Shared.options(player, "Abandon the raid?",
    "Yes, abandon the raid.", () => {
      const raid = Raid.raidOf(player);
      if (!raid) return;
      player.sendMessage("You abandon the raid and leave the Tombs of Amascut.");
      raid.leave(player, { teleport: true });
    },
    "No, I want to stay.", () => {});
  return true;
}

/** Raid instances are not persisted across server restarts. */
function recoverMissingRaid({ player }) {
  if (Raid.raidOf(player)) return false;
  // Raid supplies never leave the tombs, even when the raid ended while the player was away.
  Raid.removeRaidItems(player);
  if (!Shared.inTombs(player.getLocation())) return false;
  player.setAttribute(Raid.ATTR_RAID, null);
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_ATMOSPHERE_UID);
  player.getPacketSender().sendVarbit(Shared.VARBIT.PARTY_STATUS, 0);
  player.moveTo(Shared.loc(Shared.LOBBY_RETURN));
  player.sendMessage("Your previous raid is no longer available. You have been returned to the lobby.");
  return true;
}

/**
 * Logging in after a logout in a raid (Raid.onLogout): rejoin the party if it's still there and
 * has someone in it; otherwise the eject or wipe the Wiki describes.
 */
function loggedIn(event) {
  const { player } = event;
  const noted = player.getAttribute(Raid.ATTR_LOGOUT);
  const raid = Raid.absentees.get(player.getUsername());
  if (raid && raid.rejoin(player)) return;
  if (raid) Raid.absentees.delete(player.getUsername());
  if (noted) {
    player.setAttribute(Raid.ATTR_LOGOUT, null);
    Raid.removeRaidItems(player);
    if (noted.encounter && noted.attempts && Retrieval.storeLost(player) > 0) player.sendMessage(Retrieval.RETRIEVED_LINE);
    else if (noted.crystal) player.sendMessage("Your escape crystal activates, and you find yourself outside the raid.");
    player.getPacketSender().closeSubInterface(Shared.OVERLAY_ATMOSPHERE_UID);
    player.getPacketSender().sendVarbit(Shared.VARBIT.PARTY_STATUS, 0);
    player.moveTo(Shared.loc(Shared.LOBBY_RETURN));
    return;
  }
  recoverMissingRaid(event);
}

function useTeleportCrystal(event) {
  const room = raidRoom(event.player);
  if (!room || !room.def.challenge) return false;
  if (room.def.next === "REWARD" && room.isCompleted()) {
    room.raid.advance(event.player, true);
    return true;
  }
  room.useTeleportCrystal(event.player, event.option !== "Use");
  return true;
}

function talkToOsmumten({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid) return false;
  // The Wardens' Osmumten starts the fight instead (Wardens unit), and the vault's sees players out (Rewards).
  const room = raid.roomFor(player);
  if (room?.def.wardens || room?.key === "REWARD") return false;
  raid.returnToNexus(player);
  return true;
}

// ------------------------------------------------------------------ deaths

function keepItemsOnDeath(event) {
  if (Raid.raidOf(event.player) && Shared.inTombs(event.player.getLocation())) event.shouldDrop = false;
}

function respawnInRaid(event) {
  const raid = Raid.raidOf(event.player);
  if (!raid || !Shared.inTombs(event.player.getLocation())) return;
  event.handled = true;
  raid.onPlayerDied(event.player);
}

// ------------------------------------------------------------------ combat

/** Points for damage dealt to raid NPCs, and the Deadly/Quiet Prayers punishments. */
function trackDamage(event) {
  const { player, target, hit } = event;
  const npc = target?.isNpc?.() ? target : null;
  const room = npc?.__toaRoom;
  if (!room || room.destroyed) return;
  const raid = Raid.raidOf(player);
  if (!raid || room.raid !== raid) return;
  const dealt = Math.min(hit?.getTotalDamage?.() ?? 0, Math.max(0, npc.getHitpoints()));
  if (dealt <= 0) return;
  const member = raid.member(player);
  member.damageDone += dealt;
  const style = styleOf(event.method ?? hit?.getCombatMethod?.());
  if (style) raid.tally(player, style, dealt);
  const sender = player.getPacketSender();
  sender.sendVarbit(Shared.VARBIT.DAMAGE_DONE, Math.min(MAX_DAMAGE_VARBIT, member.damageDone));
  // Per NPC too: a boss's trophy goes to whoever dealt it the most.
  (npc.__toaDamageBy ??= new Map()).set(player, (npc.__toaDamageBy.get(player) ?? 0) + dealt);
  raid.addPoints(player, dealt * room.pointsPerDamage(npc));
}

/** Which raid summary title a hit's combat style counts towards. */
function styleOf(method) {
  const { CombatType } = Shared.core();
  const type = method?.type?.();
  if (type === CombatType.MELEE) return "meleeDamage";
  if (type === CombatType.RANGED) return "rangedDamage";
  if (type === CombatType.MAGIC) return "magicDamage";
  return null;
}

/** Scripted bosses fight on their room's timers, never through ordinary aggression. */
function blockScriptedNpcs(event) {
  if (event.attacker?.__toaScripted) event.allow = false;
}

function blockGhostAttacks(event) {
  if (event.attacker?.isPlayer?.() && isGhost(event.attacker)) event.allow = false;
  if (event.target?.isPlayer?.() && isGhost(event.target)) event.allow = false;
}

/** Damage taken (for the scoreboard) and Deadly Prayers draining a fifth of each hit. */
function afterPlayerHit(event) {
  const { attacker, target, hit } = event;
  const player = target?.isPlayer?.() ? target : null;
  if (!player) return;
  const raid = Raid.raidOf(player);
  if (!raid?.roomFor(player)) return;
  const damage = hit.getTotalDamage?.() ?? 0;
  const member = raid.member(player);
  member.damageTaken += damage;
  if (damage > 0) player.getPacketSender().sendVarbit(Shared.VARBIT.DAMAGE_TAKEN, Math.min(MAX_DAMAGE_VARBIT, member.damageTaken));
  if (damage > 0 && attacker && attacker !== player && raid.settings.isActive("DEADLY_PRAYERS")) {
    const { Skill } = Shared.core();
    player.getSkillManager().decreaseCurrentLevel(Skill.PRAYER, Math.floor(damage / 5), 0);
  }
}

// ------------------------------------------------------------------ restrictions

function onADiet(event) {
  const raid = Raid.raidOf(event.player);
  if (!raid || !Shared.inTombs(event.player.getLocation())) return;
  if (isGhost(event.player)) {
    event.allow = false;
    return;
  }
  // Wiki: no food at all, honey locusts included (the spirit and the paths stop giving them).
  if (raid.settings.isActive("ON_A_DIET")) {
    event.player.sendMessage("You've been prevented from consuming food within the Tombs of Amascut.");
    event.allow = false;
    return;
  }
  raid.tally(event.player, "foodEaten");
  noteConsumed(raid, event);
}

/** Combat achievements: any food or potion fails one of the two supply tasks (captured). */
function noteConsumed(raid, event) {
  if (Supplies.doses(event.itemId)) CombatAchievements.suppliesFromSpirit(raid, event.player);
  else CombatAchievements.suppliesFromOutside(raid, event.player);
}

function dehydration(event) {
  const raid = Raid.raidOf(event.player);
  if (!raid || !Shared.inTombs(event.player.getLocation())) return;
  if (isGhost(event.player)) {
    event.allow = false;
    return;
  }
  if (raid.settings.isActive("DEHYDRATION")) {
    const name = Shared.core().ItemDefinition.forId(event.itemId)?.getName?.() ?? "";
    if (DEHYDRATION_BLOCKED.some((prefix) => name.startsWith(prefix))) {
      event.player.sendMessage("You've been prevented from consuming potions within the Tombs of Amascut.");
      event.allow = false;
      return;
    }
  }
  noteConsumed(raid, event);
}

/**
 * Overly Draining (Wiki): every special attack costs all the energy, 50% under liquid adrenaline.
 * The energy spent counts towards The Specialist. Adrenaline's own halving is here as well: a
 * cost, not a refund as it was, so a special that couldn't be afforded at full price can be.
 */
function specialCost(request) {
  const { player } = request;
  const raid = player?.isPlayer?.() ? Raid.raidOf(player) : null;
  if (!raid || !Shared.inTombs(player.getLocation())) return;
  const adrenaline = Supplies.hasAdrenaline(player);
  if (raid.settings.isActive("OVERLY_DRAINING")) request.cost = adrenaline ? 50 : 100;
  else if (adrenaline) request.cost = Math.floor(request.cost / 2);
  if (request.phase === "drain") raid.tally(player, "specialEnergy", request.cost);
}

/** Wiki: the standard book's utility spells don't work here, Telekinetic Grab excepted. */
function standardUtilitySpells(event) {
  const { player } = event;
  if (!Raid.raidOf(player) || !Shared.inTombs(player.getLocation())) return;
  if (player.getSpellbook() !== Shared.core().MagicSpellbook.NORMAL || event.spellName === "Telekinetic Grab") return;
  event.handled = true;
  player.sendMessage("You can't cast that within the Tombs of Amascut.");
}

function ghostsCantTeleport(event) {
  if (isGhost(event.player)) {
    Shared.statement(event.player, "A mysterious force prevents you from doing that.");
    event.allow = false;
  }
}

/** Tumeken's shadow asks: its passive is stronger inside the tombs. */
function answerInTombs(query) {
  if (query?.player && Shared.inTombs(query.player.getLocation())) query.inside = true;
}

/**
 * Cache script 2735: Normal uses 2048, Entry uses 2941 and Expert uses 2942.
 */
function collectionLogCount(request) {
  if (request?.category !== "Tombs of Amascut") return;
  const counts = Raid.killCounts(request.player);
  request.count = counts.normal;
  request.extraCounts = [counts.entry, counts.expert];
}

function ghostsCantEquip(event) {
  if (isGhost(event.player)) event.allow = false;
}

module.exports = function registerTombsRaid(api) {
  module.exports.followParty = followParty;
  Shared.bind(api);
  api.persistAttribute(Raid.ATTR_LOGOUT);
  api.onPlayerLogin(loggedIn);
  api.onCustomEvent("combat-special:cost", specialCost);
  api.onCustomEvent("collection-log:category-count", collectionLogCount);
  Shared.onObject(api, "Barrier", passBarrier);
  Shared.onObject(api, "Entry", useEntry);
  Shared.onObject(api, "Exit", useExit);
  Shared.onObject(api, "Teleport crystal", useTeleportCrystal);
  api.onNpcInteraction("Osmumten", { "Talk-to": talkToOsmumten, Proceed: talkToOsmumten });
  api.onShouldDropItemsOnDeath(keepItemsOnDeath);
  api.onPlayerDeath(respawnInRaid);
  api.onPlayerDealtDamage(trackDamage);
  api.onCombatHitResolved(afterPlayerHit);
  Raid.onRaidArea("canAttack", blockScriptedNpcs);
  Raid.onRaidArea("canAttack", blockGhostAttacks);
  api.onSpellCast(standardUtilitySpells);
  api.onCanEat(onADiet);
  api.onCanDrink(dehydration);
  Raid.onRaidArea("canTeleport", ghostsCantTeleport);
  api.onCanEquip(ghostsCantEquip);
  api.onCanUnequip(ghostsCantEquip);
  api.onCustomEvent("toa:in-tombs", answerInTombs);
};

Object.assign(module.exports, { collectionLogCount });
