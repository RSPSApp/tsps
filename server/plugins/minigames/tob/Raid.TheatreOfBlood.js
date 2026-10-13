"use strict";

/**
 * Raid-wide rules and the objects every room shares: barriers, passages, the Vyre Orators,
 * deaths, teleports, escape crystals and coming back after a logout.
 *
 * Captured: resigning ("There is no penalty for resigning now."). Not captured (our wording):
 * the passage's "Are you ready to proceed?", the rest of the Vyre Orator's dialogue and
 * "You can't teleport from the Theatre of Blood.". Wiki: escape crystals are the
 * only teleport out; a logout during a fight is a death, and the game returns the player to
 * their party on logging in if it can (otherwise it's a full death).
 */

const Shared = require("./TobShared");
const Raid = require("./TobRaid");
const Retrieval = require("./Retrieval.TheatreOfBlood");

const { OBJECT, NPC } = Shared;
/** The treasure-room door's width (cache: 3x4), and how far south of it it's used from. */
const TREASURE_DOOR_WIDTH = 3;
const TREASURE_DOOR_REACH = 2;

function raidIn(player) {
  const raid = Raid.raidOf(player);
  return raid && Shared.inTheatre(player.getLocation()) ? raid : null;
}

/** The room the player is standing in, when it's the one the party has reached. */
function activeRoom(player) {
  const raid = raidIn(player);
  if (!raid?.room) return null;
  return raid.member(player).roomKey === raid.room.key ? raid.room : null;
}

// ---------------------------------------------------------------- objects

function passBarrier(event) {
  const room = activeRoom(event.player);
  if (!room) return false;
  room.passBarrier(event.player, event.object);
  return true;
}

/** Formidable passages, Xarpus' door and Verzik's treasure room: on to the next room. */
function usePassage(event) {
  const { player } = event;
  const raid = raidIn(player);
  if (!raid) return false;
  const member = raid.member(player);
  const proceed = () => {
    if (member.roomKey !== raid.room?.key) raid.follow(player);
    else raid.advance(player);
  };
  if (event.objectId !== OBJECT.TREASURE_ROOM && event.option === "Enter") {
    Shared.options(player, "Are you ready to proceed?", "Yes.", proceed, "No - Stay here.", () => {});
  } else {
    proceed();
  }
  return true;
}

function talkToOrator(event) {
  const { player } = event;
  const raid = raidIn(player);
  if (!raid) return false;
  if (event.option === "Resign") {
    resign(player, raid);
    return true;
  }
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, ActionDialogue } = Shared.core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, NPC.VYRE_ORATOR, "Lady Verzik Vitur lets people in here to perform, not to chat."),
    new ActionDialogue(1, {
      execute: () => Shared.options(player, "Select an Option",
        "What am I supposed to do in here?", () => player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
          new PlayerDialogue(0, "What am I supposed to do in here?"),
          new NpcDialogue(1, NPC.VYRE_ORATOR, "Pass through the barrier and face your challenge. If you survive, and your struggle entertains Verzik, she will grant you freedom from the blood tithes."),
          new PlayerDialogue(2, "Okay."),
        )),
        "I want to resign from the party.", () => resign(player, raid),
        "Sorry, I'll get on with it.", () => {}),
    }),
  ));
  return true;
}

function resign(player, raid) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue } = Shared.core();
  Shared.options(player, "There is no penalty for resigning now.",
    "Resign and leave the Theatre.", () => raid.leave(player, "Nice try."),
    "Do not resign.", () => player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new PlayerDialogue(0, "Actually, I'll stay in for now."),
      new NpcDialogue(1, NPC.VYRE_ORATOR, "As you wish."),
    )));
}

// ---------------------------------------------------------------- deaths and teleports

function keepItemsOnDeath(event) {
  if (raidIn(event.player)) event.shouldDrop = false;
}

function dieInTheatre(event) {
  const raid = raidIn(event.player);
  if (!raid) return;
  event.handled = true;
  raid.onPlayerDied(event.player);
}

/** Wiki: an escape crystal is used up getting out of the theatre. */
function useEscapeCrystal(event) {
  const { player } = event;
  if (event.itemId !== Shared.ITEM.ESCAPE_CRYSTAL) return false;
  const raid = raidIn(player);
  if (!raid) return false;
  if (raid.member(player).jailed) return true;
  player.getInventory().delete(Shared.ITEM.ESCAPE_CRYSTAL, 1);
  raid.leave(player, "");
  return true;
}

// ---------------------------------------------------------------- combat

/** Damage to a room's NPCs counts towards the MVP and the supply points. */
function trackDamage(event) {
  const { player, target, hit } = event;
  const room = target?.__tobRoom;
  if (!room || room.destroyed || room.raid !== Raid.raidOf(player)) return;
  const dealt = Math.min(hit?.getTotalDamage?.() ?? 0, Math.max(0, target.getHitpoints()));
  room.recordDamage(player, dealt);
}

/** A room can change hits on its NPCs as they land (Bloat halves them while it walks). */
function roomModifiesHit(event) {
  event.npc?.__tobRoom?.modifyHit?.(event.npc, event.hit);
}

/** Some NPCs' hitpoints running out is the room's to handle: Verzik's phases, falling supports. */
function roomHoldsOn(event) {
  if (event.npc?.__tobRoom?.holdsOn?.(event.npc)) event.preventDeath = true;
}

// ---------------------------------------------------------------- logging in

/**
 * Back after a logout: into the party's room if the raid is still on. If it isn't, a logout
 * mid-fight was a death, and the items go to the retrieval chest; anyone still standing in
 * the theatre is put outside.
 */
function returnAfterLogout({ player }) {
  const left = player.getAttribute(Raid.ATTR_LOGOUT);
  if (left) {
    const raid = Raid.byId(left.raid);
    if (raid?.rejoin(player)) return;
    player.setAttribute(Raid.ATTR_LOGOUT, null);
    if (left.fight) {
      Retrieval.storeAfterWipe(player);
      player.sendMessage("Your party could not be found. A magical chest has retrieved some of your items; you can collect them from it outside of the Theatre of Blood.");
    }
  }
  if (Shared.inTheatre(player.getLocation())) player.moveTo(Shared.loc(Shared.OUTSIDE));
}

/**
 * The treasure-room door (3x4) is used from two tiles south of it, as captured (the row
 * between is the throne's step): walk there rather than to the door.
 */
function routeToTreasureRoom(event) {
  if (event.objectId !== OBJECT.TREASURE_ROOM || !raidIn(event.player)) return;
  const door = event.object.getLocation();
  const x = Math.max(door.getX(), Math.min(door.getX() + TREASURE_DOOR_WIDTH - 1, event.player.getLocation().getX()));
  event.destination = { x, y: door.getY() - TREASURE_DOOR_REACH, z: door.getZ() };
}

module.exports = function registerTheatreRaid(api) {
  Shared.bind(api);
  api.persistAttribute(Raid.ATTR_LOGOUT);
  Shared.onObject(api, OBJECT.BARRIER, passBarrier);
  Shared.onObject(api, [OBJECT.PASSAGE, OBJECT.XARPUS_DOOR, OBJECT.TREASURE_ROOM], usePassage);
  api.onObjectRoute(routeToTreasureRoom);
  Shared.onObject(api, [OBJECT.ORATOR, OBJECT.ORATOR_SEATED], talkToOrator);
  api.onShouldDropItemsOnDeath(keepItemsOnDeath);
  api.onPlayerDeath(dieInTheatre);
  api.onItemAction("Escape crystal", { Teleport: useEscapeCrystal });
  api.onPlayerLogin(returnAfterLogout);
  api.onPlayerDealtDamage(trackDamage);
  api.onNpcHitModify(roomModifiesHit);
  api.onNpcBeforeDeath(roomHoldsOn);
};

Object.assign(module.exports, { passBarrier, usePassage, talkToOrator, dieInTheatre, useEscapeCrystal, returnAfterLogout });
