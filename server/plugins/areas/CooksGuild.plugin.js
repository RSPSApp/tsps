/**
 * The Cooks' Guild door in Varrock (https://oldschool.runescape.wiki/w/Cooks%27_Guild): coming in
 * needs 32 Cooking and one of a chef's hat (or golden chef's hat), a Cooking cape or hood, a max
 * cape or hood (or a variant), or Varrock armour 3 or 4 worn. The head chef turns the rest away
 * with his Wiki transcript's lines. Leaving is never stopped.
 *
 * The door is walked through, as captured (rsprox recordings 3181, 3213): the door sound on the
 * click; two ticks later the doorway holds an invisible wall, the open leaf (chefdoor_open)
 * stands just inside, and the player steps one tile through; two ticks after that the door
 * shuts again.
 */
const REQUIRED_LEVEL = 32;
const NO_HAT_VARIANT = "standard-dialogue-trying-to-open-the-door-without-a-chef-s-hat-a-skillcape-of-cooking-or-varrock-armour-3";
const LOW_LEVEL_NO_HAT_VARIANT = "standard-dialogue-trying-to-open-the-door-with-below-32-cooking-and-without-a-chef-s-hat";
const LOW_LEVEL_HAT_VARIANT = "standard-dialogue-trying-to-open-the-door-with-below-32-cooking-with-a-chef-s-hat";
/** The guild is north of the door; its tile is outside. */
const INSIDE_FROM_Y = 3444;
const DOOR_SOUND = 62;
const OPEN_TICKS = 2;
const CLOSE_TICKS = 2;
const WALK_ANIMATION = 819;
/** The open leaf's quarter turn, as captured. */
const OPEN_ROTATION = 2;
const HATS = /^(?:golden )?chef's hat$|^cooking hood$|max hood$/i;
const VARROCK_ARMOUR = /^varrock armour [34]$/i;

let api;
let core;

function wornName(player, slot) {
  const id = player.getEquipment().getItems()[slot]?.getId?.() ?? -1;
  return id > 0 ? core.ItemDefinition.forId(id)?.getName?.() ?? "" : "";
}

function wearsCookingCape(player) {
  const request = { player, skill: "COOKING", result: false };
  api.emitCustomEvent("skillcape:has-perk", request);
  return request.result === true;
}

/** A chef's hat, or something like that. */
function dressedForIt(player) {
  const { Equipment } = core;
  return HATS.test(wornName(player, Equipment.HEAD_SLOT)) || VARROCK_ARMOUR.test(wornName(player, Equipment.BODY_SLOT)) ||
    wearsCookingCape(player);
}

function refusal(player) {
  const skills = player.getSkillManager();
  const level = Math.max(skills.getMaxLevel(core.Skill.COOKING), skills.getCurrentLevel(core.Skill.COOKING)) >= REQUIRED_LEVEL;
  const dressed = dressedForIt(player);
  if (level && dressed) return null;
  if (level) return NO_HAT_VARIANT;
  return dressed ? LOW_LEVEL_HAT_VARIANT : LOW_LEVEL_NO_HAT_VARIANT;
}

function later(player, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, player, false); }
    execute() { this.stop(); action(); }
  })());
}

/** Walks the player through the door, one tile in or out, as the captures play it. */
function walkThrough(player, door) {
  const { GameObject, Location, ForceMovement, ForceMovementTask, CacheDefinitions } = core;
  const doorTile = door.getLocation();
  const inside = new Location(doorTile.getX(), INSIDE_FROM_Y, doorTile.getZ());
  const goingIn = player.getLocation().getY() < INSIDE_FROM_Y;
  const from = goingIn ? doorTile : inside;
  const sender = player.getPacketSender();
  const wall = new GameObject(CacheDefinitions.getLocId("inviswall"), doorTile.clone(), door.getType(), door.getFace(), null);
  const leaf = new GameObject(CacheDefinitions.getLocId("chefdoor_open"), inside.clone(), door.getType(), OPEN_ROTATION, null);
  sender.sendSound(DOOR_SOUND, 1, 0);
  player.getMovementQueue().setBlockMovement(true).reset();
  later(player, OPEN_TICKS, () => {
    if (!player.getLocation().equals(from)) player.moveTo(from.clone());
    sender.sendObject(wall);
    sender.sendObject(leaf);
    const direction = goingIn ? 0 : 2;
    core.TaskManager.submit(new ForceMovementTask(player, 1,
      new ForceMovement(from.clone(), new Location(0, goingIn ? 1 : -1), 0, 30, direction, WALK_ANIMATION)));
    later(player, CLOSE_TICKS, () => {
      player.getMovementQueue().setBlockMovement(false);
      sender.sendObjectRemoval(leaf);
      sender.sendObject(door);
    });
  });
}

function openDoor(event) {
  const { player, object } = event;
  const entering = player.getLocation().getY() < INSIDE_FROM_Y;
  const variant = entering ? refusal(player) : null;
  if (variant) {
    api.emitCustomEvent("npc-dialogue:start", { player, npcId: core.NpcIdentifiers.HEAD_CHEF, variant, handled: false });
    return true;
  }
  walkThrough(player, object);
  return true;
}

module.exports = {
  name: "CooksGuild",
  description: "Guards the Cooks' Guild door in Varrock: 32 Cooking and a chef's hat, Cooking cape or Varrock armour, with the head chef's refusals.",
  _test: { refusal, openDoor },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onObjectFirstClick(core.CacheDefinitions.getLocId("chefdoor"), openDoor);
  },
};
