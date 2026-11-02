"use strict";

/**
 * Inside the chambers: the party tab, the steps out, passages between rooms, the holes and
 * ropes between floors, deaths, points for damage, and the raid's rules.
 *
 * Not on the Wiki (to check against a capture):
 * - The party tab (500): Refresh, and the leader's Start raid ("No-one may join the party
 *   after the raid begins.").
 * - The first room's steps leave the raid: "You will not be able to rejoin this raid again."
 * - A passage moves you to its far side if the room lets you through (the first room only
 *   once the raid has begun; later rooms once their encounter is done).
 * - A floor's end hole drops you to the next floor's start (or the Olm's chamber); the rope
 *   there climbs back. Climbing down is anim 827, up 828, with the raid fade.
 * - No dropping items before the raid starts: "You should keep your raiding dungeon tidy until
 *   your raid has begun."
 * - Raiders who log out inside are put back in when they log in, if their raid is still on.
 * Wiki: you can't teleport out; deaths are safe (CoxRaid.onDeath); damage gives points.
 */

const Shared = require("./Shared.ChambersOfXeric");
const Raid = require("./RaidState.ChambersOfXeric");

const ANIM = { CLIMB_DOWN: 827, CLIMB_UP: 828 };
const TAB = { REFRESH: 2, START: 14 };

const uid = (component) => (Shared.INTERFACE.PARTY_TAB << 16) | component;

function inside(player) {
  const raid = Raid.raidOf(player);
  return raid?.map?.contains?.(player.getLocation()) ? raid : null;
}

// ---------------------------------------------------------------- the party tab

function refreshTab({ player }) {
  Raid.raidOf(player)?.refreshTab(player);
  return true;
}

function startRaid({ player }) {
  const raid = Raid.raidOf(player);
  if (!raid || raid.stage !== Raid.STAGE.WAITING) return true;
  if (!raid.party.isLeader(player)) {
    player.sendMessage("Only the party leader can begin the raid.");
    return true;
  }
  Shared.options(player, "No-one may join the party after the raid begins.",
    "Begin the raid.", () => raid.start(),
    "Don't begin the raid yet.", () => {});
  return true;
}

// ---------------------------------------------------------------- moving around

function climbSteps(event) {
  const raid = inside(event.player);
  if (!raid) return false;
  // rsprox captures: "You won't be able to re-enter." - "Leave." or "Stay.".
  Shared.options(event.player, "You won't be able to re-enter.",
    "Leave.", () => raid.leave(event.player),
    "Stay.", () => {});
  return true;
}

/** rsprox capture 2528: the leader's new layout, before the raid has begun. */
function reloadRaid(event) {
  const { player } = event;
  const raid = inside(player);
  if (!raid) return false;
  if (raid.stage !== Raid.STAGE.WAITING) {
    player.sendMessage("The raid has already begun.");
    return true;
  }
  if (!raid.party.isLeader(player)) {
    player.sendMessage("Only the party leader can reload the raid.");
    return true;
  }
  Shared.options(player, "Reload the raid to generate a new layout?",
    "Yes, reload the raid.", () => raid.reload(player),
    "No, keep the existing layout.", () => {});
  return true;
}

/** Through a passage to its far side, if the room lets you on. */
function enterPassage(event) {
  const { player, object } = event;
  const raid = inside(player);
  if (!raid) return false;
  const room = raid.roomAt(player.getLocation());
  if (room && !room.canPass(player, object)) return true;
  const at = object.getLocation();
  const here = player.getLocation();
  const face = object.getFace();
  let x = here.getX();
  let y = here.getY();
  if (face === 1 || face === 3) y = here.getY() > at.getY() ? at.getY() - 1 : at.getY() + 3;
  else x = here.getX() < at.getX() ? at.getX() + 3 : at.getX() - 1;
  // rsprox captures: the player faces the passage and is through it 2 ticks later.
  const to = Shared.loc({ x, y, z: here.getZ() });
  player.setPositionToFace(at);
  Shared.later(player, PASSAGE_TICKS, () => {
    if (player.isRegistered?.() && player.getLocation().equals(here)) player.moveTo(to);
  });
  return true;
}

const PASSAGE_TICKS = 2;

function climb(player, animation, destination) {
  const { Animation } = Shared.core();
  player.performAnimation(new Animation(animation));
  Shared.fadeMove(player, () => player.moveTo(destination));
}

/** Down the hole at a floor's end: to the next floor's start, or the Olm's chamber. */
function enterHole(event) {
  const raid = inside(event.player);
  const room = raid?.roomAt(event.player.getLocation());
  if (!room || room.key !== "FLOOR_END_DOWNSTAIRS" || !room.record.bound) return false;
  // rsprox captures: down 2 ticks after arriving, with the fade.
  const player = event.player;
  player.setPositionToFace(event.object.getLocation());
  Shared.later(player, PASSAGE_TICKS, () => player.isRegistered?.() && climb(player, ANIM.CLIMB_DOWN, raid.map.landing(room.record.bound)));
  return true;
}

/** Up the rope at a floor's start: back to the floor above's end. */
function climbRope(event) {
  const raid = inside(event.player);
  const room = raid?.roomAt(event.player.getLocation());
  if (!room || room.key !== "FLOOR_START_UPSTAIRS" || !room.record.bound) return false;
  climb(event.player, ANIM.CLIMB_UP, raid.map.landing(room.record.bound));
  return true;
}

// ---------------------------------------------------------------- deaths, damage, rules

function keepItemsOnDeath(event) {
  if (inside(event.player)) event.shouldDrop = false;
}

function respawnInRaid(event) {
  const raid = inside(event.player);
  if (!raid) return;
  event.handled = true;
  raid.onDeath(event.player);
}

/** Points: 5 per hitpoint dealt to the raid's NPCs, within what the room has to give. */
function damagePoints(event) {
  const { player, target, hit } = event;
  const room = target?.__coxRoom;
  if (!room || room.raid !== Raid.raidOf(player)) return;
  const dealt = hit?.getTotalDamage?.() ?? 0;
  if (dealt <= 0) return;
  const multiplier = target.__coxPointsMultiplier ?? 1;
  room.raid.addCombatPoints(player, dealt * Raid.POINTS_PER_DAMAGE * multiplier);
}

function noTeleporting(event) {
  if (!inside(event.player)) return;
  event.player.sendMessage("You cannot teleport from the Chambers of Xeric.");
  event.allow = false;
}

function tidyUntilStarted(event) {
  const raid = inside(event.player);
  if (!raid || raid.stage !== Raid.STAGE.WAITING) return;
  event.player.sendMessage("You should keep your raiding dungeon tidy until your raid has begun.");
  event.handled = true;
}

// ---------------------------------------------------------------- logging in

/** Back into the raid if it is still on and they were in it from the start; else outside. */
function returnOnLogin({ player }) {
  const raid = Raid.takeRejoin(player.getUsername());
  if (raid) {
    raid.admit(player);
    return;
  }
  if (!player.getAttribute(Shared.ATTR.INSIDE)) return;
  player.setAttribute(Shared.ATTR.INSIDE, null);
  player.moveTo(Shared.loc(Shared.OUTSIDE));
  Shared.raidMessage(player, "Your party could not be re-found.");
}

/** A raid NPC died: its room hears of it. */
function roomNpcDied(event) {
  const room = event.npc?.__coxRoom;
  if (!room || room.raid.destroyed) return;
  room.npcs.delete(event.npc);
  room.onNpcDeath(event.npc, event.killer?.isPlayer?.() ? event.killer.getAsPlayer() : null);
}

/** A raid NPC about to die: its room may keep it alive (Vanguards out of balance, phases). */
function roomNpcDying(event) {
  const room = event.npc?.__coxRoom;
  if (room && !room.raid.destroyed && room.beforeNpcDeath(event.npc)) event.preventDeath = true;
}

/** A hit on a raid NPC: its room may change it (the Ice Demon's resistances, the Olm's claws). */
function roomNpcHit(event) {
  event.npc?.__coxRoom?.modifyHit(event.npc, event.hit);
}

module.exports = function registerCoxRaid(api) {
  Shared.bind(api);
  api.persistAttribute(Shared.ATTR.INSIDE);
  api.onInterfaceActionButton(uid(TAB.REFRESH), refreshTab);
  api.onInterfaceActionButton(uid(TAB.START), startRaid);
  api.onObjectInteraction("Steps", { Climb: climbSteps, Reload: reloadRaid });
  api.onObjectInteraction("Passage", { Enter: enterPassage });
  api.onObjectInteraction("Hole", { Enter: enterHole });
  api.onObjectInteraction("Rope", { "Climb-up": climbRope });
  api.onShouldDropItemsOnDeath(keepItemsOnDeath);
  api.onPlayerDeath(respawnInRaid);
  api.onPlayerDealtDamage(damagePoints);
  Raid.onRaidArea("canTeleport", noTeleporting);
  api.onItemDropPolicy(tidyUntilStarted);
  api.onPlayerLogin(returnOnLogin);
  api.onNpcDeath(roomNpcDied);
  api.onNpcBeforeDeath(roomNpcDying);
  api.onNpcHitModify(roomNpcHit);
};

module.exports.enterPassage = enterPassage;
module.exports.enterHole = enterHole;
module.exports.climbRope = climbRope;
module.exports.startRaid = startRaid;
module.exports.damagePoints = damagePoints;
module.exports.returnOnLogin = returnOnLogin;
