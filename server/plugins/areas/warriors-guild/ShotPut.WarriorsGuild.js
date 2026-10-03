/**
 * Warriors' Guild: the shot put room behind the heavy doors (50 Strength to push open). A shot
 * from the 18lb or 22lb pile is put in one of three styles; how far it goes, whether it lands on
 * the player's toe instead, the Strength XP and the run energy it costs all follow the Wiki's
 * X = Strength + run energy + style + dusted hands - weight (Calculator:Shot put). Tokens are the
 * distance plus 1 (18lb) or 3 (22lb). Animations and messages follow Near-Reality's port.
 */
const Guild = require("./Common.WarriorsGuild");

const DOOR_STRENGTH = 50;
const DOOR_PUSH_ANIMATION = 4188;
const PICK_UP_ANIMATION = 827;
const SHOT_GRAPHIC = 690;
const GRIND_ANIMATION = 364;
const MIN_RUN_ENERGY = 5;
/** X below each threshold throws 1, 2, ... yards; 216 and over throws 14. */
const DISTANCE_THRESHOLDS = [58, 71, 84, 97, 110, 124, 137, 150, 163, 176, 190, 203, 216];

const STYLES = [
  { name: "Standing throw", bonus: 30, animation: 4181, message: "You throw the shot as hard as you can.", delay: 100 },
  { name: "Step and throw", bonus: 20, animation: 4182, message: "You take a step and throw the shot as hard as you can.", delay: 50 },
  { name: "Spin and throw", bonus: 10, animation: 4183, message: "You spin around and release the shot.", delay: 100 },
];
const LAND_MESSAGES = [
  "The shot is perfectly thrown and gently drops to the floor.",
  "The shot drops to the floor.",
  "The shot falls from the air like a brick, landing with a sickening thud.",
];
const DUSTED_BONUS = 5;
const DUSTED_ATTRIBUTE = "warriors-guild:dusted-hands";

let api;
let LANES = [];

function buildLanes() {
  const Objects = Guild.core.ObjectIdentifiers;
  return [
    { pile: Objects.SHOT, weight: 18, shot: Guild.ITEMS.SHOT_18LB, tokens: 1, at: [2861, 3553, 1], ref: Guild.NPCS.REF_NORTH },
    { pile: Objects.SHOT_2, weight: 22, shot: Guild.ITEMS.SHOT_22LB, tokens: 3, at: [2861, 3547, 1], ref: Guild.NPCS.REF_SOUTH },
  ];
}

/** The Wiki's X; with it the throw's distance, success chance, XP and energy all follow. */
function throwPower(strength, energy, style, dusted, weight) {
  return strength + energy + style.bonus + (dusted ? DUSTED_BONUS : 0) - weight;
}

function throwDistance(power) {
  return Math.min(14, 1 + DISTANCE_THRESHOLDS.filter((threshold) => power >= threshold).length);
}

// --- The heavy doors.

function pushHeavyDoor({ player, object, objectId, location }) {
  const { Skill, Animation, ObjectIdentifiers } = Guild.core;
  if (Guild.baseLevel(player, Skill.STRENGTH) < DOOR_STRENGTH) {
    // ponytail: unverified message; the Wiki only gives the 50 Strength requirement.
    player.sendMessage(`You need a Strength level of ${DOOR_STRENGTH} to open this door.`);
    return;
  }
  player.performAnimation(new Animation(DOOR_PUSH_ANIMATION));
  player.sendMessage("The doors creak slowly open - you rush through before they close behind you.");
  // Wiki: the northern door gives 0-11 XP (averaging about 3), the southern one 0 or 1.
  const roll = Math.random();
  const xp = objectId === ObjectIdentifiers.HEAVY_DOOR
    ? (roll < 0.25 ? 0 : roll < 0.5 ? 1 : Guild.random(2, 11))
    : (roll < 0.57 ? 1 : 0);
  if (xp > 0) player.getSkillManager().addExperiences(Skill.STRENGTH, xp);
  const east = player.getLocation().getX() <= location.x;
  Guild.later(player, 1, () => Guild.crossDoor(player, object, Guild.tile(location.x + (east ? 1 : 0), location.y, location.z)));
}

// --- Putting the shot.

function laneFor(objectId) {
  return LANES.find((lane) => lane.pile === objectId);
}

function routeToLane(event) {
  const lane = laneFor(event.objectId);
  if (lane) event.destination = { x: lane.at[0], y: lane.at[1], z: lane.at[2] };
}

function faceLane(player, lane) {
  player.setPositionToFace(Guild.tile(lane.at[0] + 3, lane.at[1], lane.at[2]));
}

function takeShot({ player, objectId }) {
  const lane = laneFor(objectId);
  if (!lane) return false;
  const { Equipment, Animation } = Guild.core;
  const hands = [Equipment.WEAPON_SLOT, Equipment.SHIELD_SLOT, Equipment.HANDS_SLOT];
  if (hands.some((slot) => player.getEquipment().getItems()[slot]?.getId() > 0)) {
    player.sendMessage("You must have both your hands completely free to throw a shot.");
    return;
  }
  if (!Guild.at(player, ...lane.at)) return;
  if (player.getRunEnergy() < MIN_RUN_ENERGY) {
    // ponytail: unverified message; the Wiki only says shots need 5% run energy.
    player.sendMessage("You're too tired to throw the shot.");
    return;
  }
  player.performAnimation(new Animation(PICK_UP_ANIMATION));
  faceLane(player, lane);
  Guild.later(player, 1, () => {
    const choices = STYLES.flatMap((style) => [style.name, () => throwShot(player, lane, style)]);
    api.sendMultiChatboxPrompt(player, "Choose your style", ...choices);
  });
}

function throwShot(player, lane, style) {
  if (!Guild.at(player, ...lane.at)) return;
  player.getPacketSender().sendInterfaceRemoval();
  const { Skill, Animation } = Guild.core;
  const dusted = player.getAttribute(DUSTED_ATTRIBUTE) === true;
  player.setAttribute(DUSTED_ATTRIBUTE, false);
  const energy = player.getRunEnergy();
  const power = throwPower(Guild.baseLevel(player, Skill.STRENGTH), energy, style, dusted, lane.weight);
  faceLane(player, lane);
  player.sendMessage("You take a deep breath and prepare yourself.");
  Guild.later(player, 1, () => {
    player.sendMessage(style.message);
    player.performAnimation(new Animation(style.animation));
  });
  Guild.later(player, 2, () => {
    player.setRunEnergy(energy - power * 0.1);
    player.getPacketSender().sendRunEnergy();
    if (Math.random() >= power / 250) {
      player.sendMessage("You fumble and drop the shot onto your toe. Ow!");
      Guild.damage(player, 1);
      return;
    }
    const distance = throwDistance(power);
    const landing = Guild.tile(lane.at[0] + distance, lane.at[1], lane.at[2]);
    const flight = style.delay + distance * 10;
    player.getPacketSender().sendProjectile(player.getLocation(), landing, 0, flight, SHOT_GRAPHIC, 30, 0, null, style.delay, 15);
    Guild.later(player, Math.ceil(flight / 30), () => landShot(player, lane, distance, power, landing));
  });
}

function landShot(player, lane, distance, power, landing) {
  const roll = Guild.random(0, 15);
  if (roll < LAND_MESSAGES.length) player.sendMessage(LAND_MESSAGES[roll]);
  Guild.core.ItemOnGroundManager.registerLocation(player, new Guild.core.Item(lane.shot, 1), landing);
  player.getSkillManager().addExperiences(Guild.core.Skill.STRENGTH, power * 0.7);
  Guild.credit(player, lane.tokens + distance);
  Guild.npcSays(player, lane.ref, `Well done. You threw the shot ${distance} yard${distance === 1 ? "" : "s"}!`);
}

/** The landed shot is guild property. */
function keepShotsInTheRoom(event) {
  const lane = LANES.find((candidate) => candidate.shot === event.groundItem.getItem().getId());
  if (!lane) return;
  Guild.npcSays(event.player, lane.ref, "Hey! You can't take that, it's guild property. Take one from the pile.");
  event.handled = true;
}

// --- Ground ashes: a fine powder on the hands puts the next shot further.

function grindAshes({ player }) {
  const Items = Guild.core.ItemIdentifiers;
  player.performAnimation(new Guild.core.Animation(GRIND_ANIMATION));
  player.getInventory().deleteNumber(Items.ASHES, 1);
  player.getInventory().adds(Guild.ITEMS.GROUND_ASHES, 1);
}

function dustHands({ player }) {
  player.getInventory().deleteNumber(Guild.ITEMS.GROUND_ASHES, 1);
  player.setAttribute(DUSTED_ATTRIBUTE, true);
  // ponytail: unverified message; the Wiki only shows the dusting animation.
  player.sendMessage("You dust your hands with the finely ground ash.");
}

module.exports = function attachShotPut(pluginApi) {
  api = pluginApi;
  LANES = buildLanes();
  api.onObjectInteraction("Heavy door", { Open: pushHeavyDoor });
  api.onObjectRoute(routeToLane);
  api.onObjectInteraction("Shot", { Throw: takeShot });
  api.onGroundItemPickup(keepShotsInTheRoom);
  api.onItemOnItem("Ashes", "Pestle and mortar", grindAshes);
  api.onItemAction("Ground ashes", { "Dust-hands": dustHands });
};
module.exports._test = { throwPower, throwDistance, STYLES };
