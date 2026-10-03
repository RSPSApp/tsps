// Developer commands for testing sailing until boats can be bought (and the Pandemonium quest
// hands out the first raft): ::raft, ::skiff and ::sloop moor a new boat at The Pandemonium.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatMoveMode } = require("../../../src/main/typescript/elvarg/game/content/sailing/Boat");
const { packedHeadingToAngle } = require("../../../src/main/typescript/elvarg/game/content/sailing/HeadingUtils");
const { PlayerRights } = require("../../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { content, boatName, randomBoatName } = require("./sailingContent");
const { sendBoatVarbits } = require("./boatVarbits");
const { TOOLS_UNLOCKED_ATTRIBUTE, sendToolUnlocks } = require("./cargo");
const { PARTS, partOptions, requirementsOf } = require("./boatParts");
const { facilityNamed, facilityRequirements } = require("./boatFacilities");
const { visitedBoat } = require("./Shipyard.plugin");

/** Tier names by part, in tier order (hulls and sails by wood, keels and helms by metal). */
const WOOD_TIERS = ["wooden", "oak", "teak", "mahogany", "camphor", "ironwood", "rosewood"];
const METAL_TIERS = ["bronze", "iron", "steel", "mithril", "adamant", "rune", "dragon"];
const TIER_NAMES = { hull: WOOD_TIERS, sails: WOOD_TIERS, keel: METAL_TIERS, helm: METAL_TIERS };
const BOAT_TYPES = ["raft", "skiff", "sloop"];

const BOAT_DOCK = "the_pandemonium";
const MOVE_MODES = {
  full: BoatMoveMode.Full,
  half: BoatMoveMode.Half,
  reverse: BoatMoveMode.Reverse,
  stop: BoatMoveMode.Stopped,
};

/** Moors a new boat of `type` for the player at The Pandemonium, with a random name. */
function giveBoatOfType(player, type) {
  const boat = Sailing.giveBoat(player, type, BOAT_DOCK, randomBoatName());
  if (boat) sendBoatVarbits(player);
  player.sendMessage(boat
    ? `The ${boatName(boat)}, a ${type}, is moored for you at ${Sailing.getDock(BOAT_DOCK).name} (slot ${boat.slot}).`
    : "You can't own another boat.");
}

function giveRaft({ player }) {
  giveBoatOfType(player, "raft");
}

function giveSkiff({ player }) {
  giveBoatOfType(player, "skiff");
}

function giveSloop({ player }) {
  giveBoatOfType(player, "sloop");
}

/** Teleports to The Pandemonium's gangplank. Like any teleport, it sinks a boat you're on. */
function toPandemonium({ player }) {
  const { landing } = Sailing.getDock(BOAT_DOCK);
  player.moveTo(new Location(landing.x, landing.y, landing.z));
}

/** Shows every tool in the cargo hold's tools compartment, as if their quests were done. */
function unlockSailingTools({ player }) {
  player.setAttribute(TOOLS_UNLOCKED_ATTRIBUTE, true);
  sendToolUnlocks(player);
  player.sendMessage("Every tool now shows in your cargo hold's tools compartment.");
}

const BOATMATS_USAGE = "Usage: ::boatmats <hull|keel|sails|helm> <tier 0-6 or name> [raft|skiff|sloop], or ::boatmats facility <name>";

/**
 * Spawns what building a boat part or facility costs, from the same cache row the shipyard
 * checks: ::boatmats <hull|keel|sails|helm> <tier 0-6 or name> [raft|skiff|sloop], or
 * ::boatmats facility <name>. A part's boat type defaults to the boat being customised in the
 * shipyard, then the active boat.
 */
function spawnPartMaterials({ player, parts }) {
  if (parts[1] === "facility") {
    spawnFacilityMaterials(player, parts.slice(2).join(" "));
    return;
  }
  const part = parts[1];
  const tierArg = parts[2]?.toLowerCase();
  const tier = PARTS.includes(part)
    ? (/^\d+$/.test(tierArg ?? "") ? Number(tierArg) : TIER_NAMES[part].indexOf(tierArg))
    : -1;
  const type = parts[3] ?? visitedBoat(player)?.type ?? Sailing.activeBoat(player)?.type;
  const option = BOAT_TYPES.includes(type) && tier >= 0 ? partOptions(type, part)[tier] : undefined;
  if (option === undefined) {
    player.sendMessage(BOATMATS_USAGE);
    return;
  }
  const requirements = requirementsOf(part, option);
  for (const [item, count] of requirements.materials) player.getInventory().adds(item, count);
  player.sendMessage(`Spawned the materials for a ${type}'s ${requirements.name} (Sailing ${requirements.sailing}, Construction ${requirements.construction}).`);
}

function spawnFacilityMaterials(player, name) {
  const facility = name ? facilityNamed(name) : undefined;
  if (facility === undefined) {
    player.sendMessage(BOATMATS_USAGE);
    return;
  }
  const requirements = facilityRequirements(facility);
  for (const [item, count] of requirements.materials) player.getInventory().adds(item, count);
  player.sendMessage(`Spawned the materials for a ${requirements.name} (Sailing ${requirements.sailing}, Construction ${requirements.construction}).`);
}

function describe(boat) {
  const where = boat.location.kind === "docked" ? `docked at ${boat.location.dock}`
    : boat.location.kind === "at_sea" ? `at sea (${Math.floor(boat.location.fineX / 128)}, ${Math.floor(boat.location.fineY / 128)})`
    : "sunk";
  return `Slot ${boat.slot}: ${boat.type} "${boatName(boat)}", ${where}`;
}

function boatInfo({ player }) {
  const { boats, activeBoatSlot } = player.getSailing();
  if (boats.length === 0) {
    player.sendMessage("You don't own a boat. Use ::raft.");
    return;
  }
  for (const boat of boats) player.sendMessage(describe(boat) + (boat.slot === activeBoatSlot ? " (active)" : ""));
  const aboard = Sailing.instanceAboard(player);
  if (aboard) {
    player.sendMessage(`Aboard boat ${aboard.entityIndex}: angle ${aboard.angle}, heading ${aboard.heading}, mode ${aboard.moveMode}.`);
  }
}

function sailMode({ player, parts }) {
  const boat = Sailing.instanceAboard(player);
  const mode = MOVE_MODES[parts[1]];
  if (!boat || mode === undefined) {
    player.sendMessage("Usage (aboard): ::sailmode full|half|reverse|stop");
    return;
  }
  boat.moveMode = mode;
}

function heading({ player, parts }) {
  const boat = Sailing.instanceAboard(player);
  const packed = Number(parts[1]);
  if (!boat || !Number.isInteger(packed) || packed < 0 || packed > 15) {
    player.sendMessage("Usage (aboard): ::heading 0-15");
    return;
  }
  boat.heading = packedHeadingToAngle(packed);
}

module.exports = {
  name: "SailingCommands",
  members: true,
  register(api) {
    content();
    api.registerCommand("raft", giveRaft, PlayerRights.DEVELOPER);
    api.registerCommand("skiff", giveSkiff, PlayerRights.DEVELOPER);
    api.registerCommand("sloop", giveSloop, PlayerRights.DEVELOPER);
    api.persistAttribute(TOOLS_UNLOCKED_ATTRIBUTE);
    api.registerCommand("pandemonium", toPandemonium, PlayerRights.DEVELOPER);
    api.registerCommand("sailingtools", unlockSailingTools, PlayerRights.DEVELOPER);
    api.registerCommand("boatmats", spawnPartMaterials, PlayerRights.DEVELOPER);
    api.registerCommand("boatinfo", boatInfo, PlayerRights.DEVELOPER);
    api.registerCommand("sailmode", sailMode, PlayerRights.DEVELOPER);
    api.registerCommand("heading", heading, PlayerRights.DEVELOPER);
  },
};
