"use strict";

/**
 * Necrovarus's tomb in the Temple of Phasmatys, as the user's revision 242 capture plays it
 * (20261112T092603-5ab63b4, ticks 1642-1713):
 *
 * - The petition burned, Necrovarus drops the bone key on the floor at the player's feet
 *   (messagebox "In his rage, Necrovarus drops a key on the floor.", tick 1643).
 * - The tomb door (3656,3514,1) while locked: a Ghost disciple asks "What are you doing going
 *   in there?" (1668, 1675, 1682). The bone key on it: "You unlock the door." (spam, 1689),
 *   ahoy_templedoor_unlocked; the key is kept. Once unlocked it is a pass-through door
 *   (plugins/objects/Doors.plugin.js).
 * - The coffin: Open says "The coffin creaks open..." (1696), Search gives the robes in an item
 *   box then "Nothing interesting happens." (1699-1702), Close says "You close the coffin."
 *   (1705).
 */

const State = require("./State.GhostsAhoy");

const DOOR = Object.freeze({ x: 3656, y: 3514, z: 1 });
const PAGE = "Ghosts Ahoy";
const TOMB_VARIANT = "robes-of-necrovarus-entering-necrovarus-tomb";
/** "If the player attempts to use the door without the key (or ... did not use the key on the door):" */
const DISCIPLE_CONDITION = "8bTImV";
/** How far a Ghost disciple can be to speak (the capture's was about 6 tiles away). */
const DISCIPLE_RANGE = 16;

const MESSAGE = Object.freeze({
  UNLOCK: "You unlock the door.",
  ALREADY_UNLOCKED: "The door is already unlocked.",
  COFFIN_OPENS: "The coffin creaks open...",
  COFFIN_CLOSE: "You close the coffin.",
  ROBES: "You take the Robes of Necrovarus from the remains of his mortal body.",
  NOTHING: "Nothing interesting happens.",
});

let api;
let core;
let ids;
let quest;
let box;
let startTranscript;

const isDoor = (location) => location && location.x === DOOR.x && location.y === DOOR.y && location.z === DOOR.z;

function nearestDisciple(player) {
  const at = player.getLocation();
  let best = null;
  for (const npc of core.World.getNpcs?.() ?? []) {
    if (!npc || npc.getId?.() !== ids.GHOST_DISCIPLE) continue;
    const there = npc.getLocation();
    if (there.getZ() !== at.getZ()) continue;
    const distance = Math.max(Math.abs(there.getX() - at.getX()), Math.abs(there.getY() - at.getY()));
    if (distance <= DISCIPLE_RANGE && (!best || distance < best.distance)) best = { npc, distance };
  }
  return best?.npc ?? null;
}

/** The locked door: the disciple's warning. Unlocked, Doors passes the player through. */
function toggleDoor(request) {
  if (request.handled || !isDoor(request.location) || request.objectId !== ids.TOMB_DOOR) return;
  const { player } = request;
  if (State.get(player, State.VARBIT.TEMPLE_DOOR) === 1) return;
  request.handled = true;
  const disciple = nearestDisciple(player);
  startTranscript(api, player, ids.GHOST_DISCIPLE, PAGE, TOMB_VARIANT,
    (steps) => steps.find((step) => step?.id === DISCIPLE_CONDITION)?.steps ?? [], disciple);
}

function keyOnDoor(event) {
  const { player, itemId, location } = event;
  if (itemId !== ids.BONE_KEY || event.objectId !== ids.TOMB_DOOR || !isDoor(location)) return;
  event.handled = true;
  if (State.get(player, State.VARBIT.TEMPLE_DOOR) === 1) {
    player.sendMessage(MESSAGE.ALREADY_UNLOCKED);
    return;
  }
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MESSAGE.UNLOCK);
  State.set(player, State.VARBIT.TEMPLE_DOOR, 1);
}

function replaceLoc(object, id) {
  const { GameObject, Location, ObjectManager } = core;
  const location = object.getLocation();
  ObjectManager.deregister(object, true);
  ObjectManager.register(new GameObject(id, new Location(location.getX(), location.getY(), location.getZ()),
    object.getType(), object.getFace(), object.getPrivateArea?.() ?? null), true);
}

function openCoffin(event) {
  if (event.objectId !== ids.COFFIN) return false;
  const { player, object } = event;
  player.sendMessage(MESSAGE.COFFIN_OPENS);
  core.Sounds.sendSound(player, new core.Sound(54, 1, 0, 0));
  replaceLoc(object, ids.COFFIN_OPEN);
  return true;
}

function closeCoffin(event) {
  if (event.objectId !== ids.COFFIN_OPEN) return false;
  const { player, object } = event;
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MESSAGE.COFFIN_CLOSE);
  core.Sounds.sendSound(player, new core.Sound(53, 1, 0, 0));
  replaceLoc(object, ids.COFFIN);
  return true;
}

/** Ours: no robes to take (held, handed in, or before the crone asks for them) is the same tail line. */
function searchCoffin(event) {
  if (event.objectId !== ids.COFFIN_OPEN) return false;
  const { player } = event;
  const wanted = quest.getStage(player) >= quest.STAGE.CRONE_HELP && !quest.isComplete(player)
    && player.getInventory().getAmount(ids.MYSTICAL_ROBES) === 0
    && State.get(player, State.VARBIT.GIVEN_ROBES) !== 1;
  if (!wanted) {
    player.sendMessage(MESSAGE.NOTHING);
    return true;
  }
  player.getInventory().adds(ids.MYSTICAL_ROBES, 1);
  box.item(player, ids.MYSTICAL_ROBES, MESSAGE.ROBES, () => player.sendMessage(MESSAGE.NOTHING));
  return true;
}

/** The bone key falls at the player's feet, theirs to pick up (tick 1648 took it from 3660,3517). */
function dropBoneKey(player) {
  const { Item, Location } = core;
  const at = player.getLocation();
  const ground = api.getItemOnGroundManager?.();
  if (!ground) {
    player.getInventory().adds(ids.BONE_KEY, 1);
    return;
  }
  ground.registerLocation(player, new Item(ids.BONE_KEY, 1), new Location(at.getX(), at.getY(), at.getZ()));
}

function attach(registry, shared) {
  api = registry;
  core = registry.core;
  ({ ids, quest, box } = shared);
  ({ startTranscript } = require("../QuestRuntime"));
}

module.exports = { attach, toggleDoor, keyOnDoor, openCoffin, closeCoffin, searchCoffin, dropBoneKey, DOOR, MESSAGE };
