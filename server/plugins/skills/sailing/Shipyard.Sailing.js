// The shipyard: a shipwright's Customise-boat takes the player there with the chosen boat, the
// boat schematics (interface 939) swap its hull, keel, sails or helm for another tier, paint its
// trim, fly a flag or build the eternal brazier, and the portal returns them to the dock. Every
// build costs the option's materials and gives Construction XP; the old part isn't refunded.
// The boat's own gangplank puts the player on its deck, where facilities are built
// (ShipyardFacilities.Sailing.js). The flow follows live captures (docs/sailing-osrs-reference.md); part options, levels and materials are the cache's.
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
const { ItemStatementDialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { Item } = require("../../../src/main/typescript/elvarg/game/model/Item");
const { ItemIdentifiers } = require("../../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { VARBIT, content, boatType, setVarbit, fade, tileBeside, playSound } = require("./SailingContent.Sailing");
const { describeBoat, boatVarps, clearBoatVarps, openSidepanel, DESCRIPTION_VARBITS,
  VARBIT_SIDEPANEL_TABS, SIDEPANEL_TAB } = require("./Sidepanel.Sailing");
const { sendBoatVarbits } = require("./BoatVarbits.Sailing");
const { sendToolUnlocks } = require("./Cargo.Sailing");
const parts = require("./BoatParts.Sailing");
const facilities = require("./BoatFacilities.Sailing");
const { MODE, openBoatSelection } = require("./BoatSelection.Sailing");

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
/**
 * if_setevents IF_SCRIPT_TRIGGER (bit 23, as RSProx names it). The options get it with op 1, as
 * captured: Build (script 8834) shows the loading spinner, then sends its if_triggeroplocal only
 * if the option has this event, so without it the official client waits on the spinner forever.
 */
const IF_EVENT_SCRIPT_TRIGGER = 1 << 23;
/** Ticks from a build's fade out to its fade in, as captured. */
const REBUILD_FADE_TICKS = 4;
/** How each part is named when swapped: "…the hull of your boat.", "…the helm on your boat." */
const PART_NAMES = {
  hull: "hull of", keel: "keel of", trim: "trim of",
  sails: "mast and sails on", helm: "helm on", flag: "flag on", brazier: "brazier on",
};
/** Played with the rebuild, the tick after a part is swapped. */
const SOUND_SWAP = 2104;
const SOUND_SWAP_AFTER = 2103;
const SOUND_SWAP_AFTER_DELAY = 15;

/** The yard's tool crates: a saw or a hammer for every facility build, as captured. */
const TOOL_CRATES = {
  "Crate of saws": { item: ItemIdentifiers.SAW, name: "saw" },
  "Crate of hammers": { item: ItemIdentifiers.HAMMER, name: "hammer" },
};
const SOUND_TAKE_TOOL = 2582;

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
  // Its facilities show only Modify here (at sea they show everything else).
  const locs = spec ? spec.locs.map((loc) => (loc.hotspot !== undefined && loc.opFlags !== undefined
    ? { ...loc, opFlags: facilities.FACILITY_OPS.SHIPYARD } : loc)) : [];
  visit.shown = spec ? BoatManager.spawn(player.getIndex(), { ...spec, locs: [...locs, ...placeholders] }, SHIPYARD.boat) : undefined;
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
    // The shipyard shows the boat's stats tab.
    [VARBIT_SIDEPANEL_TABS]: SIDEPANEL_TAB.STATS,
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
  awardPendingXp(player, visit);
  if (visit.aboard) leaveDeck(player, visit);
  if (visit.shown) BoatManager.dispose(visit.shown);
  for (const id of [...DESCRIPTION_VARBITS, VARBIT_SHIPYARD_MODE, VARBIT_SHIPYARD_BOAT_ANGLE,
    VARBIT_SHIPYARD_BOAT_OFFSET_FINEX, VARBIT.SIDEPANEL_VISIBLE]) {
    setVarbit(player, id, 0);
  }
  // Back to what the tools unlock says; on a real save that may be Pandemonium
  // progress (varbit 18314 is that quest's stage), so restore what we saved.
  if (!visit.questVisit) setVarbit(player, VARBIT.SAILING_INTRO, visit.sailingIntro ?? 0);
  sendToolUnlocks(player);
  clearBoatVarps(player);
  player.getPacketSender().sendTabInterface(0, 0);
  // Every way out (the portal, a teleport, logging out) ends the visit here.
  pluginApi.emitCustomEvent("sailing:shipyard-visit-ended", { player, questVisit: visit.questVisit === true });
}

/** A copy of the player's tile, kept while they move on. */
function standingAt(player) {
  const here = player.getLocation();
  return new Location(here.getX(), here.getY(), here.getZ());
}

function enterShipyard(player, dock, slot) {
  const boat = ownedBoat(player, slot);
  if (!boat || boat.location.kind !== "docked" || boat.location.dock !== dock.id) {
    player.sendMessage("You can't choose that boat at the moment.");
    return;
  }
  // Where the player stood with the shipwright: the portal's Exit brings them back beside it.
  const from = standingAt(player);
  fade(player, true);
  later(player, 1, () => {
    beginVisit(player, dock, slot, from);
    later(player, 1, () => fade(player, false));
  });
}

/** Puts the player in the shipyard with the boat in `slot` shown. */
function beginVisit(player, dock, slot, from = standingAt(player), { questVisit = false } = {}) {
  player.moveTo(new Location(SHIPYARD.arrival.x, SHIPYARD.arrival.y, SHIPYARD.arrival.z));
  const visit = { slot, dock: dock.id, from, shown: undefined, aboard: false, hotspot: undefined,
    sailingIntro: player.getPacketSender().getVarbit(VARBIT.SAILING_INTRO), questVisit };
  visits.set(player, visit);
  // Owning a boat means The Pandemonium is done; the customisation refuses every build without
  // it (script 8807 via 9022). Only for the visit, so the tools stay behind ::sailingtools. The
  // quest's own visit keeps its stage: at 28 the client allows the raft's cargo hold (row 8462)
  // and shows Jim providing its materials (scripts 8807, 8828, 8839).
  if (!questVisit) setVarbit(player, VARBIT.SAILING_INTRO, 50);
  showBoat(player, visit);
}

/** A shipwright's Customise-boat: choose the boat, then go to the shipyard with it. */
function customiseBoat({ player, npc, definition }) {
  // The resolved form's name: the spawned parent (14972) is nameless, its varbit form is Junior Jim.
  const name = (definition ?? npc.getCurrentDefinition?.(player))?.getName?.() ?? "";
  const dock = content().docks.find((candidate) => candidate.shipwright === name);
  if (!dock) return false;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "customise-boat", resume: () => customiseBoat({ player, npc, definition }) };
  pluginApi.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
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
  // The parts open sets no mode (live leaves it at 0), so a facility mode still set would show
  // the hotspot's options instead of the parts.
  if (hotspot === undefined) clearFacilityMode(player);
  if (hotspot !== undefined) setVarbit(player, VARBIT_CUSTOMISATION_HOTSPOT, hotspot);
  sender.sendConfig(VARP_CUSTOMISATION_BOAT, type.sidepanelBoatType);
  if (hotspot !== undefined) setVarbit(player, VARBIT_CUSTOMISATION_TYPE, CUSTOMISATION_TYPE_FACILITY);
  setVarbit(player, VARBIT_CUSTOMISATION_SLOT, visit.slot + 1);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -3]);
  player.setInterfaceId(CUSTOMISATION);
  sender.sendSubInterface(MAIN_MODAL, CUSTOMISATION, 0);
  sender.sendInterfaceScript(SCRIPT_CUSTOMISATION_INIT);
  sender.sendInterfaceFlagsRange((CUSTOMISATION << 16) | CUSTOMISATION_OPTIONS, 0, optionSlots,
    IF_EVENT_OP1 | IF_EVENT_SCRIPT_TRIGGER);
  sender.sendInterfaceScript(SCRIPT_CUSTOMISATION_INIT);
}

/** Closes the customisation interface; `customisationClosed` resets what opening it set. */
function closeCustomisation(player) {
  player.getPacketSender().sendInterfaceRemoval();
}

/**
 * The customisation interface gone by any route (a build, its close button, walking away): as
 * captured, closing it resets 19523, 19524, 19525 and 5190.
 */
function customisationClosed({ player, interfaceId }) {
  if (interfaceId !== CUSTOMISATION) return;
  clearFacilityMode(player);
  setVarbit(player, VARBIT_CUSTOMISATION_SLOT, 0);
  player.getPacketSender().sendConfig(VARP_CUSTOMISATION_BOAT, -1);
  const visit = visits.get(player);
  if (visit) visit.hotspot = undefined;
}

/** Takes the customisation out of facility mode (19523 and 19524), if a hotspot's open set it. */
function clearFacilityMode(player) {
  if (player.getPacketSender().getVarbit(VARBIT_CUSTOMISATION_TYPE) === 0) return;
  setVarbit(player, VARBIT_CUSTOMISATION_TYPE, 0);
  setVarbit(player, VARBIT_CUSTOMISATION_HOTSPOT, 0);
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

/** Builds the chosen option on the boat: its part becomes that tier. False if it's refused. */
function build(player, optionRow) {
  const visit = visits.get(player);
  const boat = visit && ownedBoat(player, visit.slot);
  const option = boat && parts.optionFor(boat, optionRow);
  if (!option) return false;
  const schematic = { player, row: optionRow, allow: null };
  pluginApi.emitCustomEvent("sailing:schematic-can-build", schematic);
  if (schematic.allow === false) return false;
  if (parts.hasBuilt(boat, option)) {
    player.sendMessage("Your boat already has that.");
    return false;
  }
  const requirements = parts.requirementsOf(option.part, optionRow);
  const refused = refusal(player, requirements);
  if (refused) {
    player.sendMessage(refused);
    return false;
  }
  for (const [item, count] of requirements.materials) {
    if (!parts.KEPT_MATERIALS.has(item)) player.getInventory().delete(item, count);
  }
  boat.parts = parts.withOption(boat, option);
  const xp = parts.constructionXp(boat.type, option.part, option.tier);
  closeCustomisation(player);
  // As captured: the message shows while the screen fades and the boat is rebuilt, and can be
  // continued once it fades back in, when the XP is given.
  const message = `With the help of some workers, you swap out the ${PART_NAMES[option.part]} your boat.`;
  StatementDialogue.send(player, message, false);
  fade(player, true);
  later(player, 1, () => {
    showBoat(player, visit);
    playSound(player, SOUND_SWAP);
    playSound(player, SOUND_SWAP_AFTER, SOUND_SWAP_AFTER_DELAY);
  });
  visit.pendingXp = (visit.pendingXp ?? 0) + xp;
  later(player, REBUILD_FADE_TICKS, () => {
    fade(player, false);
    awardPendingXp(player, visit);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new StatementDialogue(0, message),
      new EndDialogue(1),
    ));
  });
  return true;
}

/** The XP of a swap still fading in; also given if the player logs out first. */
function awardPendingXp(player, visit) {
  const xp = visit.pendingXp ?? 0;
  visit.pendingXp = 0;
  if (xp > 0) player.getSkillManager().addExperience(Skill.CONSTRUCTION, xp, true);
}

/** A Build in the parts customisation (facility builds are ShipyardFacilities.Sailing.js's). */
function clickCustomisation(event) {
  if (!isBuildTrigger(event) || visits.get(event.player)?.hotspot !== undefined) return;
  event.handled = true;
  const optionRow = readOptionRow(event.argsData);
  if (optionRow === undefined || !build(event.player, optionRow)) refreshCustomisation(event.player);
}

/**
 * Script 8834's Build trigger, while the customisation is still open. One that arrives after 939
 * closed (Build clicked, then walking off) builds nothing.
 */
function isBuildTrigger(event) {
  return event.groupId === CUSTOMISATION && event.childId === CUSTOMISATION_OPTIONS && event.scriptTrigger === true
    && event.player.getInterfaceId() === CUSTOMISATION;
}

/**
 * Redraws the open customisation after a refused Build: Build's spinner (939:23) stays up until
 * 939 closes or 8811 redraws it, and the init (8809) runs 8811, keeping the selected tab.
 */
function refreshCustomisation(player) {
  player.getPacketSender().sendInterfaceScript(SCRIPT_CUSTOMISATION_INIT);
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

/**
 * The Shipyard Portal's Exit: back to the dock the visit started from, on a random tile within
 * one of where the player stood with its shipwright.
 */
function exitShipyard({ player }) {
  const from = visits.get(player)?.from;
  const fallback = content().docks.find((candidate) => candidate.shipyardReturn)?.shipyardReturn;
  if (!from && !fallback) return;
  fade(player, true);
  later(player, 1, () => {
    const spot = from
      ? tileBeside(pluginApi.getRegionManager?.(), from, null, true)
      : new Location(fallback.x, fallback.y, fallback.z);
    endVisit(player);
    player.moveTo(spot);
    pluginApi.emitCustomEvent("sailing:shipyard-exited", { player });
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

/**
 * A tool crate's Take-from: a tick after reaching it, the tool and an item box. Ours: a full
 * inventory is refused with the usual line; carrying one already doesn't stop another.
 */
function takeTool({ player, location, definition }) {
  const crate = TOOL_CRATES[definition?.getName?.()];
  if (!crate || !location || !inShipyard(location)) return false;
  later(player, 1, () => {
    if (player.getInventory().getFreeSlots() <= 0) {
      player.getInventory().full();
      return;
    }
    player.getInventory().add(new Item(crate.item, 1));
    playSound(player, SOUND_TAKE_TOOL);
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ItemStatementDialogue(0, crate.item, `You take a ${crate.name} from the crate.`)));
  });
}

/** Rebuilds the boat shown in the shipyard after it was changed elsewhere (::maxboat). */
function refreshShownBoat(player) {
  const visit = visits.get(player);
  if (visit && !visit.aboard) showBoat(player, visit);
}

function visitedBoat(player) {
  const visit = visits.get(player);
  return visit ? ownedBoat(player, visit.slot) : undefined;
}

function forgetVisit({ player }) {
  const visit = visits.get(player);
  if (visit) awardPendingXp(player, visit);
  // Ours: saved back at the dock the visit started from, as the portal's Exit would leave them.
  if (visit) player.setLocation(visit.from);
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
  readOptionRow,
  customiseBoat,
  beginVisit,
  visitedBoat,
  refreshShownBoat,
  aboardVisit,
  ownedBoat,
  openCustomisation,
  closeCustomisation,
  refreshCustomisation,
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
    for (const name of Object.keys(TOOL_CRATES)) api.onObjectInteraction(name, { "Take-from": takeTool });
    api.onObjectInteraction("Gangplank", { Board: boardShipyardBoat, Disembark: disembarkShipyardBoat });
    api.onInterfaceActionClick(clickCustomisation);
    api.onCustomEvent("interface:closed", customisationClosed);
    api.onPlayerLogout(forgetVisit);
    api.onPlayerLogin(returnFromShipyard);
    Mobile.onBeforeTeleport(leaveOnMove);
  },
};
