/**
 * Icy basalt's Weiss teleport (Making Friends with My Arm), as in rsprox captures (rec 1633, 312,
 * 3154, 1694; rev 226-232). See docs/basalt-teleports.md.
 */
const BASALT_NAME = "Icy basalt";
const QUEST_KEY = "making_friends_with_my_arm";
const DESTINATION = [2846, 3940, 0]; // every captured landing (4 of 4 recordings)
// Wiki (Icy basalt, Destination): the square of radius 2 around 2846,3938. Standing in it refuses.
const DESTINATION_SQUARE = { x: 2846, y: 3938, radius: 2 };
const ALREADY_HERE = "You are already here. You don't want to burn to ashes then reconstitute, just to travel to the same place do you?";
// Ours: no capture or Wiki line for a player without the quest.
const QUEST_LOCKED = "You need to complete Making Friends with My Arm to use this.";
const SEQ_ID = 8172; // my2arm_fire_teleport_human
const SPOTANIM_ID = 1628; // my2arm_flame_teleport_weiss
const SOUND_ID = 2596; // sound_area, range 10, at the player's tile on the click
const SOUND_RANGE = 10;
const SPOTANIM_DELAY = 10;
const LANDING_TICK = 4;

let teleportType = null;

/** Captured: my2arm_fire_teleport_human with my2arm_flame_teleport_weiss (delay 10) and the sound on the click,
 * the landing on tick 4 with the animation reset, the reset again on tick 5; no varbit busy. */
function basaltTeleport(core) {
  if (teleportType) return teleportType;
  const { Animation, Graphic, Priority, Sound, TeleportType } = core;
  teleportType = new TeleportType(LANDING_TICK,
    new Animation(SEQ_ID, Priority.HIGH),
    null, Animation.DEFAULT_RESET_ANIMATION,
    new Graphic(SPOTANIM_ID).withDelay(SPOTANIM_DELAY),
    null, null,
    { sound: new Sound(SOUND_ID, 1, 0, 0), areaSoundRange: SOUND_RANGE, repeatEndAnimation: true });
  return teleportType;
}

function inSquare(location, { x, y, radius }) {
  return location.getZ() === DESTINATION[2] && Math.abs(location.getX() - x) <= radius && Math.abs(location.getY() - y) <= radius;
}

function questComplete(api, player) {
  const request = { player, key: QUEST_KEY, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function attach(api) {
  const { core } = api;
  const { Location, TeleportHandler } = core;

  function weiss({ player, itemId }) {
    const inventory = player.getInventory();
    if (!inventory.contains(itemId)) return false;
    if (!questComplete(api, player)) {
      player.sendMessage(QUEST_LOCKED);
      return true;
    }
    if (inSquare(player.getLocation(), DESTINATION_SQUARE)) {
      player.sendMessage(ALREADY_HERE);
      return true;
    }
    const destination = new Location(...DESTINATION);
    if (!TeleportHandler.checkReqs(player, destination)) return true;
    // Captured: the basalt leaves the inventory on the click, with the animation.
    TeleportHandler.confirm(player, destination, () => {
      if (!inventory.contains(itemId)) return;
      inventory.deleteNumber(itemId, 1);
      TeleportHandler.teleport(player, destination, basaltTeleport(core), false);
    }, 20, { item: itemId });
    return true;
  }

  api.onItemAction(BASALT_NAME, { Weiss: weiss });
}

module.exports = {
  name: "BasaltTeleports",
  description: "Icy basalt teleports to Weiss after Making Friends with My Arm, as live.",
  members: true,
  register(api) {
    attach(api);
  },
  attach,
  basaltTeleport,
  DESTINATION,
  ALREADY_HERE,
  QUEST_LOCKED,
};
