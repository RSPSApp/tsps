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
 *
 * The bank room on the ground floor: its door lets in only players who have done the hard Varrock
 * Diary or have 99 Cooking. It is walked through the same way, with no change to the door and the
 * door sound on the step rather than the click; the room is east of it. Leaving is never stopped.
 * The bank is not available on free-to-play worlds (Wiki), so there the door refuses everyone.
 * Ours: both refusals' wording, which has no source (every recording is on a members' world).
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
const BANK_LEVEL = 99;
const BANK_REFUSAL = "Only those who have completed the hard Varrock Diary or have 99 Cooking may enter.";
const BANK_FREE_WORLD_REFUSAL = "You need to be on a members' world to enter the bank.";
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

function canUseBank(player) {
  if (player.getSkillManager().getMaxLevel(core.Skill.COOKING) >= BANK_LEVEL) return true;
  const request = { player, diary: "varrock", tier: "hard", complete: false };
  api.emitCustomEvent("diary:is-complete", request);
  return request.complete === true;
}

/** Walks the player one tile east into the bank room, or west out of it. */
function walkThroughBankDoor(player, door) {
  const { Location, ForceMovement, ForceMovementTask } = core;
  const doorTile = door.getLocation();
  const outside = new Location(doorTile.getX() - 1, doorTile.getY(), doorTile.getZ());
  const goingIn = player.getLocation().getX() < doorTile.getX();
  const from = goingIn ? outside : doorTile;
  player.getMovementQueue().setBlockMovement(true).reset();
  later(player, OPEN_TICKS, () => {
    if (!player.getLocation().equals(from)) player.moveTo(from.clone());
    player.getPacketSender().sendSound(DOOR_SOUND, 1, 0);
    const direction = goingIn ? 1 : 3;
    core.TaskManager.submit(new ForceMovementTask(player, 1,
      new ForceMovement(from.clone(), new Location(goingIn ? 1 : -1, 0), 0, 30, direction, WALK_ANIMATION)));
    later(player, CLOSE_TICKS, () => player.getMovementQueue().setBlockMovement(false));
  });
}

function openBankDoor(event) {
  const { player, object } = event;
  const entering = player.getLocation().getX() < object.getLocation().getX();
  if (entering && !core.WorldDefinition.isMembersWorld()) {
    player.sendMessage(BANK_FREE_WORLD_REFUSAL);
    return true;
  }
  if (entering && !canUseBank(player)) {
    player.sendMessage(BANK_REFUSAL);
    return true;
  }
  walkThroughBankDoor(player, object);
  return true;
}

module.exports = {
  name: "CooksGuild",
  description: "Guards the Cooks' Guild door in Varrock (32 Cooking and a chef's hat, Cooking cape or Varrock armour, with the head chef's refusals) and its bank room door (hard Varrock Diary or 99 Cooking, members' worlds only).",
  _test: { refusal, openDoor, canUseBank, openBankDoor },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onObjectFirstClick(core.CacheDefinitions.getLocId("chefdoor"), openDoor);
    api.onObjectFirstClick(core.CacheDefinitions.getLocId("fai_varrock_cook_guild_door"), openBankDoor);
  },
};
