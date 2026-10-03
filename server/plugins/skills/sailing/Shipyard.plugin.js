// The shipyard: a shipwright's Customise-boat takes the player there with the chosen boat, the
// boat schematics (interface 939) swap its hull, keel, sails or helm for another tier, and the
// portal returns them to the dock. Upgrades and downgrades cost the part's materials and give
// Construction XP; the old part isn't refunded. The boat's own gangplank puts the player on its
// deck, where facilities are built (ShipyardFacilities.plugin.js). The flow follows live
// captures (docs/sailing-osrs-reference.md); part options, levels and materials are the cache's.
const { Sailing } = require("../../../src/main/typescript/elvarg/game/content/sailing/Sailing");
const { BoatManager } = require("../../../src/main/typescript/elvarg/game/content/sailing/BoatManager");
const { Mobile } = require("../../../src/main/typescript/elvarg/game/entity/impl/Mobile");
const { Location } = require("../../../src/main/typescript/elvarg/game/model/Location");
const { Skill } = require("../../../src/main/typescript/elvarg/game/model/Skill");
const { Task } = require("../../../src/main/typescript/elvarg/game/task/Task");
const { TaskManager } = require("../../../src/main/typescript/elvarg/game/task/TaskManager");
const { DialogueChainBuilder } = require("../../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { StatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/StatementDialogue");
const { EndDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/EndDialogue");
const { VARBIT, content, boatType, setVarbit, fade } = require("./sailingContent");
const { describeBoat, boatVarps, clearBoatVarps, openSidepanel, DESCRIPTION_VARBITS } = require("./sidepanel");
const { sendBoatVarbits } = require("./boatVarbits");
const { sendToolUnlocks } = require("./cargo");
const parts = require("./boatParts");
const facilities = require("./boatFacilities");
const { MODE, openBoatSelection } = require("./BoatSelection.plugin");

/** Where the player and their boat stand in the shipyard (map square 32, 42), as captured. */
const SHIPYARD = {
  arrival: { x: 2084, y: 2730, z: 0 },
  boat: { fineX: 2091 * 128 + 64, fineY: 2724 * 128, level: 0, angle: 1536 },
  /** The boat's gangplank (59719), and where Disembark puts the player. */
  gangplank: { x: 2087, y: 2723 },
  landing: { x: 2086, y: 2724, z: 0 },
  bounds: { minX: 2048, maxX: 2111, minY: 2688, maxY: 2751 },
};
const VARBIT_SHIPYARD_MODE = 19173;
const VARBIT_SHIPYARD_BOAT_ANGLE = 19519;
const VARBIT_SHIPYARD_BOAT_OFFSET_FINEX = 19520;
const VARBIT_CUSTOMISATION_TYPE = 19523;
const VARBIT_CUSTOMISATION_HOTSPOT = 19524;
const VARBIT_CUSTOMISATION_SLOT = 19525;
/** `sailing_boat_customisation_type`: 0 the boat's parts, 1 a facility hotspot. */
const CUSTOMISATION_TYPE_FACILITY = 1;
/** The parts customisation's option events, as captured. */
const PART_OPTION_SLOTS = 50;
const VARP_CUSTOMISATION_BOAT = 5190;
const CUSTOMISATION = 939;
const CUSTOMISATION_OPTIONS = 17;
const MAIN_MODAL = (161 << 16) | 16;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_CUSTOMISATION_INIT = 8809;
const IF_EVENT_OP1 = 1 << 1;
/** Ticks from a build's fade out to its fade in, as captured. */
const REBUILD_FADE_TICKS = 4;
/** How each part is named when swapped ("…you swap out the hull of your boat."). */
const PART_NAMES = { hull: "hull", keel: "keel", sails: "mast and sails", helm: "helm" };

/**
 * Per player in the shipyard: the boat slot being customised, the boat shown, whether they're
 * aboard it, and the hotspot the customisation interface is building on (parts when unset).
 */
const visits = new Map();
let pluginApi;

function later(player, ticks, action) {
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticks, player); }
    execute() {
      action();
      this.stop();
    }
  })());
}

function inShipyard(location) {
  const { minX, maxX, minY, maxY } = SHIPYARD.bounds;
  return location.x >= minX && location.x <= maxX && location.y >= minY && location.y <= maxY;
}

function ownedBoat(player, slot) {
  return player.getSailing().boats.find((boat) => boat.slot === slot);
}

/** Shows the boat in the shipyard, built from its parts, and describes it on the sidepanel. */
function showBoat(player, visit) {
  if (visit.shown) BoatManager.dispose(visit.shown);
  const boat = ownedBoat(player, visit.slot);
  const spec = boat && Sailing.specFor(boat);
  // In the shipyard the empty hotspots show, and only the owner sees the boat.
  const placeholders = spec ? facilities.hotspotLocs(boat, true).filter((loc) => facilities.facilityAt(boat, loc.hotspot) === undefined) : [];
  visit.shown = spec ? BoatManager.spawn(player.getIndex(), { ...spec, locs: [...spec.locs, ...placeholders] }, SHIPYARD.boat) : undefined;
  if (visit.shown) visit.shown.ownerOnly = true;
  describeVisit(player, visit);
}

/** The sidepanel in the shipyard: the visited boat, seen from the yard. */
function describeVisit(player, visit) {
  const boat = ownedBoat(player, visit.slot);
  const type = boatType(boat?.type);
  if (!type) return;
  const varbits = {
    ...describeBoat(type, boat),
    [VARBIT_SHIPYARD_MODE]: 1,
    [VARBIT_SHIPYARD_BOAT_ANGLE]: SHIPYARD.boat.angle,
    [VARBIT_SHIPYARD_BOAT_OFFSET_FINEX]: 1,
    [VARBIT.SIDEPANEL_VISIBLE]: 1,
  };
  const varps = boatVarps(type, boat);
  for (const [id, value] of Object.entries(varbits)) setVarbit(player, Number(id), value);
  for (const [id, value] of Object.entries(varps)) player.getPacketSender().sendConfig(Number(id), value);
  openSidepanel(player, type, varbits, varps);
  sendBoatVarbits(player);
}

/** Ends a shipyard visit: the shown boat goes and the sidepanel stops describing it. */
function endVisit(player) {
  const visit = visits.get(player);
  if (!visit) return;
  visits.delete(player);
  if (visit.aboard) leaveDeck(player, visit);
  if (visit.shown) BoatManager.dispose(visit.shown);
  for (const id of [...DESCRIPTION_VARBITS, VARBIT_SHIPYARD_MODE, VARBIT_SHIPYARD_BOAT_ANGLE,
    VARBIT_SHIPYARD_BOAT_OFFSET_FINEX, VARBIT.SIDEPANEL_VISIBLE]) {
    setVarbit(player, id, 0);
  }
  // Back to what the tools unlock says (::sailingtools).
  setVarbit(player, VARBIT.SAILING_INTRO, 0);
  sendToolUnlocks(player);
  clearBoatVarps(player);
  player.getPacketSender().sendTabInterface(0, 0);
}

function enterShipyard(player, dock, slot) {
  const boat = ownedBoat(player, slot);
  if (!boat || boat.location.kind !== "docked" || boat.location.dock !== dock.id) {
    player.sendMessage("You can't choose that boat at the moment.");
    return;
  }
  fade(player, true);
  later(player, 1, () => {
    beginVisit(player, dock, slot);
    later(player, 1, () => fade(player, false));
  });
}

/** Puts the player in the shipyard with the boat in `slot` shown. */
function beginVisit(player, dock, slot) {
  player.moveTo(new Location(SHIPYARD.arrival.x, SHIPYARD.arrival.y, SHIPYARD.arrival.z));
  const visit = { slot, dock: dock.id, shown: undefined, aboard: false, hotspot: undefined };
  visits.set(player, visit);
  // Owning a boat means The Pandemonium is done; the customisation refuses every build without
  // it (script 8807 via 9022). Only for the visit, so the tools stay behind ::sailingtools.
  setVarbit(player, VARBIT.SAILING_INTRO, 50);
  showBoat(player, visit);
}

/** A shipwright's Customise-boat: choose the boat, then go to the shipyard with it. */
function customiseBoat({ player, npc }) {
  const name = npc.getDefinition?.()?.getName?.() ?? "";
  const dock = content().docks.find((candidate) => candidate.shipwright === name);
  if (!dock) return false;
  openBoatSelection(player, MODE.CUSTOMISE, dock, (slot) => enterShipyard(player, dock, slot));
}

/** The boat schematics' Modify: the customisation interface for the boat's parts. */
function openSchematics({ player }) {
  const visit = visits.get(player);
  if (visit) openCustomisation(player, visit, undefined, PART_OPTION_SLOTS);
}

/**
 * Opens the customisation interface (939) for the visited boat: its parts, or with a hotspot
 * (facility mode, varbits 19523 and 19524) what can be built there. As captured, the init
 * script runs before and after the option events are set.
 */
function openCustomisation(player, visit, hotspot, optionSlots) {
  const boat = ownedBoat(player, visit.slot);
  const type = boatType(boat?.type);
  if (!type) return;
  visit.hotspot = hotspot;
  const sender = player.getPacketSender();
  if (hotspot !== undefined) setVarbit(player, VARBIT_CUSTOMISATION_HOTSPOT, hotspot);
  sender.sendConfig(VARP_CUSTOMISATION_BOAT, type.sidepanelBoatType);
  if (hotspot !== undefined) setVarbit(player, VARBIT_CUSTOMISATION_TYPE, CUSTOMISATION_TYPE_FACILITY);
  setVarbit(player, VARBIT_CUSTOMISATION_SLOT, visit.slot + 1);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -3]);
  player.setInterfaceId(CUSTOMISATION);
  sender.sendSubInterface(MAIN_MODAL, CUSTOMISATION, 0);
  sender.sendInterfaceScript(SCRIPT_CUSTOMISATION_INIT);
  sender.sendInterfaceFlagsRange((CUSTOMISATION << 16) | CUSTOMISATION_OPTIONS, 0, optionSlots, IF_EVENT_OP1);
  sender.sendInterfaceScript(SCRIPT_CUSTOMISATION_INIT);
}

/** Closes the customisation interface, resetting what opening it set. */
function closeCustomisation(player, visit) {
  const sender = player.getPacketSender();
  if (visit.hotspot !== undefined) {
    setVarbit(player, VARBIT_CUSTOMISATION_TYPE, 0);
    setVarbit(player, VARBIT_CUSTOMISATION_HOTSPOT, 0);
  }
  setVarbit(player, VARBIT_CUSTOMISATION_SLOT, 0);
  sender.sendConfig(VARP_CUSTOMISATION_BOAT, -1);
  sender.sendInterfaceRemoval();
  visit.hotspot = undefined;
}

/** The Build trigger's argument: the option's db row, as our client sends an int (zigzag varint). */
function readOptionRow(argsData) {
  if (!argsData?.length) return undefined;
  let value = 0;
  let shift = 0;
  for (const byte of argsData) {
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return (value >>> 1) ^ -(value & 1);
    shift += 7;
  }
  return undefined;
}

function refusal(player, requirements) {
  const skills = player.getSkillManager();
  if (skills.getMaxLevel(Skill.SAILING) < requirements.sailing
    || skills.getMaxLevel(Skill.CONSTRUCTION) < requirements.construction) {
    return `You need a Sailing level of ${requirements.sailing} and a Construction level of ${requirements.construction} to build that.`;
  }
  const inventory = player.getInventory();
  if (requirements.materials.some(([item, count]) => inventory.getAmount(item) < count)) {
    return "You don't have the materials needed to build that.";
  }
  return null;
}

/** Builds the chosen option on the boat: its part becomes that tier. */
function build(player, optionRow) {
  const visit = visits.get(player);
  const boat = visit && ownedBoat(player, visit.slot);
  const option = boat && parts.optionFor(boat, optionRow);
  if (!option) return;
  if ((boat.parts?.[option.part] ?? 0) === option.tier) {
    player.sendMessage("Your boat already has that.");
    return;
  }
  const requirements = parts.requirementsOf(option.part, optionRow);
  const refused = refusal(player, requirements);
  if (refused) {
    player.sendMessage(refused);
    return;
  }
  for (const [item, count] of requirements.materials) player.getInventory().delete(item, count);
  boat.parts = { ...boat.parts, [option.part]: option.tier };
  player.getSkillManager().addExperience(Skill.CONSTRUCTION, parts.constructionXp(boat.type, option.part, option.tier), true);
  closeCustomisation(player, visit);
  // As captured: the message shows while the screen fades and the boat is rebuilt, and can be
  // continued once it fades back in.
  const message = `With the help of some workers, you swap out the ${PART_NAMES[option.part]} of your boat.`;
  StatementDialogue.send(player, message, false);
  fade(player, true);
  later(player, 1, () => showBoat(player, visit));
  later(player, REBUILD_FADE_TICKS, () => {
    fade(player, false);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, message),
      new EndDialogue(1),
    ));
  });
}

/** A Build in the parts customisation (facility builds are ShipyardFacilities.plugin.js's). */
function clickCustomisation(event) {
  if (!isBuildTrigger(event) || visits.get(event.player)?.hotspot !== undefined) return;
  event.handled = true;
  const optionRow = readOptionRow(event.argsData);
  if (optionRow !== undefined) build(event.player, optionRow);
}

function isBuildTrigger(event) {
  return event.groupId === CUSTOMISATION && event.childId === CUSTOMISATION_OPTIONS && event.scriptTrigger === true;
}

function atGangplank(location) {
  return location?.x === SHIPYARD.gangplank.x && location?.y === SHIPYARD.gangplank.y;
}

/** The boat's gangplank: straight onto the deck, no fade (as captured). */
function boardShipyardBoat({ player, location }) {
  const visit = visits.get(player);
  const deck = visit?.shown && BoatManager.getDeck(visit.shown);
  const spec = visit?.shown && BoatManager.getSpec(visit.shown);
  if (!deck || !spec || visit.aboard || !atGangplank(location)) return false;
  visit.aboard = true;
  deck.enter(player);
  player.moveTo(new Location(visit.shown.deckBaseX + spec.boardingTile.x, visit.shown.deckBaseY + spec.boardingTile.y, 0));
  pluginApi.emitCustomEvent("sailing:boarded", { player, boat: visit.shown, owned: ownedBoat(player, visit.slot) });
}

function disembarkShipyardBoat({ player, location }) {
  const visit = visits.get(player);
  if (!visit?.aboard || !atGangplank(location)) return false;
  leaveDeck(player, visit);
  player.moveTo(new Location(SHIPYARD.landing.x, SHIPYARD.landing.y, SHIPYARD.landing.z));
  describeVisit(player, visit);
}

/** Takes the player off the shipyard boat's deck; the boat stays shown. */
function leaveDeck(player, visit) {
  visit.aboard = false;
  if (visit.shown) BoatManager.getDeck(visit.shown)?.leave(player, false);
  pluginApi.emitCustomEvent("sailing:left", { player, boat: visit.shown, reason: "disembark" });
}

/** The visit of a player aboard the boat shown in the shipyard, if they are. */
function aboardVisit(player) {
  const visit = visits.get(player);
  return visit?.aboard && visit.shown ? visit : undefined;
}

/** The Shipyard Portal's Exit: back to the dock the visit started from. */
function exitShipyard({ player }) {
  const dock = content().docks.find((candidate) => candidate.id === visits.get(player)?.dock)
    ?? content().docks.find((candidate) => candidate.shipyardReturn);
  const spot = dock?.shipyardReturn;
  if (!spot) return;
  fade(player, true);
  later(player, 1, () => {
    endVisit(player);
    player.moveTo(new Location(spot.x, spot.y, spot.z));
    later(player, 1, () => fade(player, false));
  });
}

/** Any move out of the shipyard (a teleport, the portal) ends the visit; its deck is part of it. */
function leaveOnMove(mobile, target) {
  const visit = mobile.isPlayer?.() ? visits.get(mobile) : undefined;
  if (!visit) return;
  if (visit.shown?.containsDeckTile(target.x, target.y)) return;
  if (!inShipyard(target)) endVisit(mobile);
}

/** The boat a player is customising in the shipyard, if any. */
function visitedBoat(player) {
  const visit = visits.get(player);
  return visit ? ownedBoat(player, visit.slot) : undefined;
}

function forgetVisit({ player }) {
  const visit = visits.get(player);
  // Saved off the deck, which goes with the visit.
  if (visit?.aboard) player.setLocation(new Location(SHIPYARD.landing.x, SHIPYARD.landing.y, SHIPYARD.landing.z));
  if (visit?.shown) BoatManager.dispose(visit.shown);
  visits.delete(player);
}

/** A player saved in the shipyard (logged out there) comes back at the dock's return spot. */
function returnFromShipyard({ player }) {
  if (!inShipyard(player.getLocation())) return;
  const spot = content().docks.find((dock) => dock.shipyardReturn)?.shipyardReturn;
  if (spot) player.moveTo(new Location(spot.x, spot.y, spot.z));
}

module.exports = {
  name: "SailingShipyard",
  members: true,
  readOptionRow,
  beginVisit,
  visitedBoat,
  aboardVisit,
  ownedBoat,
  openCustomisation,
  closeCustomisation,
  isBuildTrigger,
  refusal,
  register(api) {
    pluginApi = api;
    content();
    const { docks } = content();
    for (const shipwright of new Set(docks.map((dock) => dock.shipwright).filter(Boolean))) {
      api.onNpcInteraction(shipwright, { "Customise-boat": customiseBoat });
    }
    api.onObjectInteraction("Boat schematics", { Modify: openSchematics });
    api.onObjectInteraction("Shipyard Portal", { Exit: exitShipyard });
    api.onObjectInteraction("Gangplank", { Board: boardShipyardBoat, Disembark: disembarkShipyardBoat });
    api.onInterfaceActionClick(clickCustomisation);
    api.onPlayerLogout(forgetVisit);
    api.onPlayerLogin(returnFromShipyard);
    Mobile.onBeforeTeleport(leaveOnMove);
  },
};
