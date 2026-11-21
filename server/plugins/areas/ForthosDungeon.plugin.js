"use strict";

/**
 * Forthos Dungeon: the grubby gate and the Spider's Den (issues #3977, #5233).
 *
 * The Spider's Den is multi-combat. Wiki (Forthos Dungeon): "The Spider's Den, formerly a ritual
 * circle for worshippers, is a multi-combat area containing 21 Temple Spiders". The bounds below
 * are the den's walkable room: every one of the 21 temple-spider spawns is inside, and the nearest
 * undead druids (x 1808-1812, y 9961-9970 and x 1847-1852, y 9937-9941), the Sarachnis tomb and
 * the grubby gate are outside.
 *
 * `Grubby Door` 34840 carries one action, Pick-lock, and nothing implemented it, so every click
 * fell through to nothing. Wiki: Grubby Door — "a locked door that requires 57 Thieving to
 * unlock, rewarding 10 Thieving experience", and "once unlocked, the player can access the Grubby
 * Chest" behind it.
 *
 * The gate is not walked through once it is unlocked: the cache's own open leaf (34841) still
 * clips the tile, and despawning the shut leaf does not free the map's collision either, so the
 * unlock hands the player across the gateway instead — one tile inside from the east side, and
 * one tile back out when it is used from within.
 *
 * The chest behind it (multiloc 34901, varbit hosdun_chest_status) is a key chest: see
 * plugins/objects/keychests (the "grubby" entry in key-chests.json).
 *
 * The pick animation is the one Pyramid Plunder's tomb doors already use for their own Pick-lock
 * (Passages.PyramidPlunder.js, `human_pickuptable`); no capture of this door exists.
 *
 * The two `Temple Door`s (34842 west, 34843 east) had no handler either, and "Temple Door" is not
 * one of the Doors plugin's names, so Open did nothing. Wiki (Temple Door): "Upon first visiting
 * the dungeon, only the eastern door can be opened and only in one direction: east." rsprox
 * capture 3926 ticks 613-616: from the west tile the door swings open, the player walks one step east
 * and "The door slams shut and locks behind you." follows a tick later; the swap itself is the
 * Doors plugin's pass-through entry, opened here through door:open. The temple key that unlocks
 * both doors for good (Sacred Bone Burner faith) is not implemented, so the other directions stay
 * shut. Ours: a locked click sends nothing, since no recording shows one.
 */

const DOOR = 34840;
const THIEVING_REQUIRED = 57;
const LOCK_EXPERIENCE = 10;
const PICK_ANIMATION = "human_pickuptable";
/** The placed Grubby Chest multiloc (its closed child `hosdun_grubby_chest_closed` is 34838). */
const GRUBBY_CHEST = 34901;
/** The Spider's Den room, from its walkable floor: x, y, and the far edges. */
const SPIDERS_DEN = Object.freeze([1828, 1850, 9946, 9970]);

/** The east Temple Door, and the tick after the crossing that its message is sent on. */
const EAST_TEMPLE_DOOR = { x: 1825, y: 9973, z: 0 };
const SLAM_MESSAGE = "The door slams shut and locks behind you.";
const SLAM_DELAY = 1;

let core = null;
let api = null;

/** Pick-lock: 57 Thieving, 10 XP, and the player is handed across the gateway. */
function pickLock({ player, object }) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < THIEVING_REQUIRED) {
    player.sendMessage(
      `You need a Thieving level of at least ${THIEVING_REQUIRED} to pick this lock.`,
    );
    return true;
  }
  const sequence = core.CacheDefinitions.getSeqId(PICK_ANIMATION);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  const at = object?.getLocation?.().clone() ?? player.getLocation().clone();
  const west = player.getLocation().getX() < at.getX();
  player.moveTo(new core.Location(west ? at.getX() + 1 : at.getX() - 1, at.getY(), at.getZ()));
  core.Sounds.sendSound(player, core.Sound.DOOR_OPEN);
  player.getSkillManager().addExperiences(core.Skill.THIEVING, LOCK_EXPERIENCE);
  player.sendMessage("You pick the lock on the gate.");
  return true;
}

/** Open on a Temple Door: the east one, from the west, lets the player in (one way). */
function openTempleDoor({ player, object }) {
  const at = object?.getLocation?.();
  if (!at || object.getId?.() !== core.CacheDefinitions.getLocId("hosdun_east_door")
    || at.getX() !== EAST_TEMPLE_DOOR.x || at.getY() !== EAST_TEMPLE_DOOR.y || at.getZ() !== EAST_TEMPLE_DOOR.z) return true;
  const from = player.getLocation();
  if (from.getX() >= at.getX() || from.getZ() !== at.getZ()) return true;
  const request = { player, object, handled: false };
  api.emitCustomEvent("door:open", request);
  if (!request.handled) return true;
  const slam = new core.Task(SLAM_DELAY, player, false);
  slam.execute = () => {
    slam.stop();
    if (player.isRegistered?.() !== false) player.sendMessage(SLAM_MESSAGE);
  };
  core.TaskManager.submit(slam);
  return true;
}

/**
 * The Grubby Chest sits in a torch-lit niche at (1795, 9925). Its cache access edge faces the
 * south torch tile, which the map clips, while the only walkable side is the alcove east of it;
 * clicking it from inside the gate therefore ended in "I can't reach that!" (issue #5237).
 * Route that click to the east tile so the chest's Open/Check run once the player is there.
 */
function routeGrubbyChest(event) {
  if (event.objectId !== GRUBBY_CHEST) return;
  const at = event.object.getLocation();
  const from = event.player.getLocation();
  const dx = from.getX() - at.getX();
  // Only from inside the gate, on the niche's plane and rows: outside, the closed door still
  // blocks the walk to the niche.
  if ((dx !== 1 && dx !== 2) || from.getZ() !== at.getZ() || Math.abs(from.getY() - at.getY()) > 2) return;
  event.destination = { x: at.getX() + 1, y: at.getY(), z: at.getZ() };
}

/** The Spider's Den, multi-combat as the Wiki describes it. */
function createSpiderDen(pluginApi) {
  const { Area, Boundary } = pluginApi.core;
  class SpiderDen extends Area {
    getName() {
      return "Forthos Dungeon Spider's Den";
    }

    isMulti() {
      return true;
    }
  }
  return new SpiderDen([new Boundary(...SPIDERS_DEN, 0)]);
}

module.exports = {
  name: "ForthosDungeon",
  description: "Forthos Dungeon: the Spider's Den's multi-combat room, the grubby gate's 57 Thieving unlock and the one-way east Temple Door.",
  members: true,
  _test: {
    pickLock, routeGrubbyChest, openTempleDoor, EAST_TEMPLE_DOOR, SLAM_MESSAGE, createSpiderDen, DOOR, THIEVING_REQUIRED, LOCK_EXPERIENCE, PICK_ANIMATION,
    GRUBBY_CHEST, SPIDERS_DEN,
  },
  register(pluginApi) {
    core = pluginApi.core;
    api = pluginApi;
    pluginApi.onObjectRoute(routeGrubbyChest);
    pluginApi.registerArea(createSpiderDen(pluginApi));
    pluginApi.onObjectInteraction("Grubby Door", { "Pick-lock": pickLock });
    pluginApi.onObjectInteraction("Temple Door", { Open: openTempleDoor });
  },
};
