"use strict";

/**
 * Raid-wide rules and the objects every room shares: barriers, entries, exits, teleport
 * crystals and Osmumten's way back to the Nexus; safe deaths with team lives; points for
 * damage; and the invocations that change eating, drinking and prayer.
 */

const Shared = require("./ToaShared");
const Raid = require("./ToaRaid");

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
  const room = raidRoom(event.player);
  // Only the room barriers' Pass / Quick-Pass: Het's puzzle has "Barrier"s to Break too.
  if (!room || (event.option !== "Pass" && event.option !== "Quick-Pass")) return false;
  room.passBarrier(event.player, event.object, event.option !== "Pass");
  return true;
}

/** Puzzle-room exits into the boss, and Wardens P1 into P3. The Nexus handles its own. */
function useEntry(event) {
  const room = raidRoom(event.player);
  if (!room || room.key === "MAIN_HALL") return false;
  if (!room.def.next) return false;
  if (room.def.bounds && !room.isCompleted() && room.key !== "WARDENS_P1") {
    Shared.statement(event.player, "You can't proceed until the challenge is complete.");
    return true;
  }
  Raid.raidOf(event.player).advance(event.player, event.option !== "Enter");
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
  player.getPacketSender().closeSubInterface(Shared.OVERLAY_HUD_UID);
  player.getPacketSender().sendVarbit(Shared.VARBIT.PARTY_STATUS, 0);
  player.moveTo(Shared.loc(Shared.LOBBY_RETURN));
  player.sendMessage("Your previous raid is no longer available. You have been returned to the lobby.");
  return true;
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
  // The Wardens' Osmumten starts the fight instead (Wardens unit).
  if (raid.roomFor(player)?.def.wardens) return false;
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
  raid.member(player).damageDone += dealt;
  // Per NPC too: a boss's trophy goes to whoever dealt it the most.
  (npc.__toaDamageBy ??= new Map()).set(player, (npc.__toaDamageBy.get(player) ?? 0) + dealt);
  raid.addPoints(player, dealt * room.pointsPerDamage(npc));
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
  raid.member(player).damageTaken += damage;
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
    event.player.sendMessage("You've been prevented from consuming food within the Tombs of Amascut");
    event.allow = false;
  }
}

function dehydration(event) {
  const raid = Raid.raidOf(event.player);
  if (!raid || !Shared.inTombs(event.player.getLocation())) return;
  if (isGhost(event.player)) {
    event.allow = false;
    return;
  }
  if (!raid.settings.isActive("DEHYDRATION")) return;
  const name = Shared.core().ItemDefinition.forId(event.itemId)?.getName?.() ?? "";
  if (DEHYDRATION_BLOCKED.some((prefix) => name.startsWith(prefix))) {
    event.player.sendMessage("You've been prevented from drinking this potion within the Tombs of Amascut");
    event.allow = false;
  }
}

function ghostsCantTeleport(event) {
  if (isGhost(event.player)) {
    Shared.statement(event.player, "A mysterious force prevents you from doing that.");
    event.allow = false;
  }
}

function ghostsCantEquip(event) {
  if (isGhost(event.player)) event.allow = false;
}

module.exports = function registerTombsRaid(api) {
  Shared.bind(api);
  api.onPlayerLogin(recoverMissingRaid);
  Shared.onObject(api, "Barrier", passBarrier);
  Shared.onObject(api, "Entry", useEntry);
  Shared.onObject(api, "Exit", useExit);
  Shared.onObject(api, "Teleport crystal", useTeleportCrystal);
  api.onNpcInteraction("Osmumten", { "Talk-to": talkToOsmumten, Proceed: talkToOsmumten });
  api.onShouldDropItemsOnDeath(keepItemsOnDeath);
  api.onPlayerDeath(respawnInRaid);
  api.onPlayerDealtDamage(trackDamage);
  api.onCombatHitResolved(afterPlayerHit);
  api.onCanAttack(blockScriptedNpcs);
  api.onCanAttack(blockGhostAttacks);
  api.onCanEat(onADiet);
  api.onCanDrink(dehydration);
  api.onCanTeleport(ghostsCantTeleport);
  api.onCanEquip(ghostsCantEquip);
  api.onCanUnequip(ghostsCantEquip);
};
