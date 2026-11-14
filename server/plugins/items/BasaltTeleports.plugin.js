/**
 * Icy basalt's Weiss teleport and stony basalt's Troll Stronghold teleports (Making Friends with
 * My Arm), as in rsprox captures (icy: rec 1633, 312, 3154, 1694, rev 226-232; stony: rec 1631,
 * rev 226). See docs/basalt-teleports.md.
 */
const BASALT_NAME = "Icy basalt";
const STONY_BASALT_NAME = "Stony basalt";
const QUEST_KEY = "making_friends_with_my_arm";
const DESTINATION = [2846, 3940, 0]; // every captured landing (4 of 4 recordings)
// Wiki (Icy basalt, Destination): the square of radius 2 around 2846,3938. Standing in it refuses.
const DESTINATION_SQUARE = { x: 2846, y: 3938, radius: 2 };
const ALREADY_HERE = "You are already here. You don't want to burn to ashes then reconstitute, just to travel to the same place do you?";
// Ours: no capture or Wiki line for a player without the quest.
const QUEST_LOCKED = "You need to complete Making Friends with My Arm to use this.";
const SEQ_ID = 8172; // my2arm_fire_teleport_human
const SPOTANIM_ID = 1628; // my2arm_flame_teleport_weiss
const STONY_SPOTANIM_ID = 1617; // my2arm_flame_teleport_spot (rec 1631)
const SOUND_ID = 2596; // sound_area, range 10, at the player's tile on the click
const SOUND_RANGE = 10;
const SPOTANIM_DELAY = 10;
const LANDING_TICK = 4;

// Stony basalt. Wiki (Stony basalt, Destination): the entrance square is radius 2 around 2845,3694
// and the roof square radius 2 around 2837,3695.
const STRONGHOLD_ROOF = [2838, 3693, 0]; // rec 1631 t577+4: a 73 Agility, hard-diary player's landing
const STRONGHOLD_ROOF_SQUARE = { x: 2837, y: 3695, radius: 2 };
const STRONGHOLD_ENTRANCE = [2845, 3694, 0]; // Ours: the Wiki square's centre; no capture lands there
const STRONGHOLD_ENTRANCE_SQUARE = { x: 2845, y: 3694, radius: 2 };
// Wiki: the roof needs 73 Agility (boostable; drained below a 73 base still counts) and the hard
// Fremennik Diary.
const ROOF_AGILITY = 73;
// Cache varbit 19649, bit 30 of my2arm_perm_1: which destination "Troll Stronghold" (the left-click)
// takes. Ours: 0 is the roof, the left-click's only destination before the 17 December 2025 update.
const STRONGHOLD_TOGGLE_VARBIT = "my2arm_stronghold_tele_toggle";
const STRONGHOLD_TOGGLE_ATTRIBUTE = "basalt:stronghold-entrance-default";
// Ours: neither the captures nor the Wiki give these lines.
const ROOF_LOCKED = "You need 73 Agility and the hard Fremennik Diary to teleport to the Troll Stronghold roof.";
const TOGGLED_ROOF = "Your stony basalt will now take you to the Troll Stronghold roof when possible.";
const TOGGLED_ENTRANCE = "Your stony basalt will now take you to the Troll Stronghold entrance.";

let teleportType = null;
let stonyTeleportType = null;

/** Captured: my2arm_fire_teleport_human with my2arm_flame_teleport_weiss (delay 10) and the sound on the click,
 * the landing on tick 4 with the animation reset, the reset again on tick 5; no varbit busy. */
function makeTeleport(core, spotanimId) {
  const { Animation, Graphic, Priority, Sound, TeleportType } = core;
  return new TeleportType(LANDING_TICK,
    new Animation(SEQ_ID, Priority.HIGH),
    null, Animation.DEFAULT_RESET_ANIMATION,
    new Graphic(spotanimId).withDelay(SPOTANIM_DELAY),
    null, null,
    { sound: new Sound(SOUND_ID, 1, 0, 0), areaSoundRange: SOUND_RANGE, repeatEndAnimation: true });
}

function basaltTeleport(core) {
  return teleportType ??= makeTeleport(core, SPOTANIM_ID);
}

/** Rec 1631: the icy basalt's teleport with my2arm_flame_teleport_spot; the sound is the Wiki's (fire_lit, 2596). */
function stonyBasaltTeleport(core) {
  return stonyTeleportType ??= makeTeleport(core, STONY_SPOTANIM_ID);
}

function inSquare(location, { x, y, radius }) {
  return location.getZ() === 0 && Math.abs(location.getX() - x) <= radius && Math.abs(location.getY() - y) <= radius;
}

function questComplete(api, player) {
  const request = { player, key: QUEST_KEY, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function fremennikHard(api, player) {
  const request = { player, diary: "fremennik", tier: "hard", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

function canReachRoof(api, player) {
  const { Skill } = api.core;
  const skills = player.getSkillManager();
  const agility = Math.max(skills.getCurrentLevel(Skill.AGILITY), skills.getMaxLevel(Skill.AGILITY));
  return agility >= ROOF_AGILITY && fremennikHard(api, player);
}

function entranceDefault(player) {
  return player.getAttribute(STRONGHOLD_TOGGLE_ATTRIBUTE) === true;
}

function sendStrongholdToggle(core, player) {
  const id = core.CacheDefinitions.getVarbitId(STRONGHOLD_TOGGLE_VARBIT);
  if (id == null || id < 0) return;
  const sender = player.getPacketSender();
  const value = entranceDefault(player) ? 1 : 0;
  if (sender.getVarbit(id) !== value) sender.sendVarbit(id, value);
}

function attach(api) {
  const { core } = api;
  const { Location, TeleportHandler } = core;

  /** One basalt teleport: the quest, the destination square, the usual checks, then the basalt goes. */
  function teleport(player, itemId, tile, square, type) {
    const inventory = player.getInventory();
    if (!inventory.contains(itemId)) return false;
    if (!questComplete(api, player)) {
      player.sendMessage(QUEST_LOCKED);
      return true;
    }
    if (inSquare(player.getLocation(), square)) {
      player.sendMessage(ALREADY_HERE);
      return true;
    }
    const destination = new Location(...tile);
    if (!TeleportHandler.checkReqs(player, destination)) return true;
    // Captured: the basalt leaves the inventory on the click, with the animation.
    TeleportHandler.confirm(player, destination, () => {
      if (!inventory.contains(itemId)) return;
      inventory.deleteNumber(itemId, 1);
      TeleportHandler.teleport(player, destination, type, false);
    }, 20, { item: itemId });
    return true;
  }

  const weiss = ({ player, itemId }) => teleport(player, itemId, DESTINATION, DESTINATION_SQUARE, basaltTeleport(core));
  const entrance = ({ player, itemId }) =>
    teleport(player, itemId, STRONGHOLD_ENTRANCE, STRONGHOLD_ENTRANCE_SQUARE, stonyBasaltTeleport(core));
  const roof = ({ player, itemId }) =>
    teleport(player, itemId, STRONGHOLD_ROOF, STRONGHOLD_ROOF_SQUARE, stonyBasaltTeleport(core));

  function roofOption(event) {
    const { player, itemId } = event;
    if (!player.getInventory().contains(itemId)) return false;
    if (questComplete(api, player) && !canReachRoof(api, player)) {
      player.sendMessage(ROOF_LOCKED);
      return true;
    }
    return roof(event);
  }

  /** The left-click: the toggled destination; the roof falls back to the entrance (Wiki: before the toggle it went to the roof only with the requirements). */
  function stronghold(event) {
    if (!entranceDefault(event.player) && canReachRoof(api, event.player)) return roof(event);
    return entrance(event);
  }

  function toggle({ player }) {
    const toEntrance = !entranceDefault(player);
    player.setAttribute(STRONGHOLD_TOGGLE_ATTRIBUTE, toEntrance);
    sendStrongholdToggle(core, player);
    player.sendMessage(toEntrance ? TOGGLED_ENTRANCE : TOGGLED_ROOF);
    return true;
  }

  api.onItemAction(BASALT_NAME, { Weiss: weiss });
  api.onItemAction(STONY_BASALT_NAME, {
    "Troll Stronghold": stronghold,
    "Troll Stronghold entrance": entrance,
    "Troll Stronghold roof": roofOption,
    Toggle: toggle,
  });
  api.onPlayerLogin(({ player }) => player && sendStrongholdToggle(core, player));
}

module.exports = {
  name: "BasaltTeleports",
  description: "Icy basalt teleports to Weiss, and stony basalt to the Troll Stronghold entrance or roof, after Making Friends with My Arm, as live.",
  members: true,
  register(api) {
    api.persistAttribute(STRONGHOLD_TOGGLE_ATTRIBUTE, false);
    attach(api);
  },
  attach,
  basaltTeleport,
  stonyBasaltTeleport,
  STRONGHOLD_ROOF,
  STRONGHOLD_ENTRANCE,
  STRONGHOLD_TOGGLE_ATTRIBUTE,
  ROOF_LOCKED,
  TOGGLED_ROOF,
  TOGGLED_ENTRANCE,
  DESTINATION,
  ALREADY_HERE,
  QUEST_LOCKED,
};
